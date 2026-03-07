import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import {
  assertValidMoveCoord,
  buildForfeitGamePatch,
  buildGameSnapshot,
  clearDrawOfferFields,
  createStoredInitialState,
  DISCONNECT_FORFEIT_MS,
  drawOfferCooldownPatch,
  DRAW_OFFER_COOLDOWN_MOVES,
  getGuestByToken,
  getParticipant,
  isPlayerParticipant,
  listParticipants,
  loadGameState,
  now,
  refreshDisconnectForfeit,
  requireGuest,
  requirePlayerRole,
  throwGameError,
  toStoredState,
} from './lib'
import { applyMove, coordKey, serializeGameState } from '../shared/hexGame'

export const resumeForGuest = query({
  args: {
    guestToken: v.string(),
  },
  handler: async (ctx, args) => {
    const guest = await getGuestByToken(ctx.db, args.guestToken)
    if (!guest) {
      return null
    }

    const participations = await ctx.db
      .query('gameParticipants')
      .withIndex('by_guestId', (query) => query.eq('guestId', guest._id))
      .collect()
    const ordered = participations.sort((left, right) => right.joinedAt - left.joinedAt)

    for (const participation of ordered) {
      const game = await ctx.db.get(participation.gameId)
      if (game && (game.status === 'waiting' || game.status === 'active')) {
        return {
          gameId: game._id,
          role: participation.role,
        }
      }
    }

    return null
  },
})

export const byIdForGuest = query({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
  },
  handler: async (ctx, args) => {
    const guest = await getGuestByToken(ctx.db, args.guestToken)
    if (!guest) {
      return null
    }

    const game = await ctx.db.get(args.gameId)
    if (!game) {
      return null
    }

    return buildGameSnapshot(ctx.db, guest, game)
  },
})

export const placeMove = mutation({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
    coord: v.object({
      q: v.number(),
      r: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    const game = await ctx.db.get(args.gameId)
    if (!game) {
      throwGameError('GAME_NOT_FOUND', 'Game not found.')
    }
    if (game.status !== 'active') {
      throwGameError('GAME_FINISHED', 'This game is no longer active.')
    }

    const participant = await getParticipant(ctx.db, game._id, guest._id)
    if (!participant) {
      throwGameError('NOT_A_PLAYER', 'You are not part of this game.')
    }

    const playerSlot = requirePlayerRole(participant.role)
    const state = loadGameState(game)
    if (state.currentPlayer !== playerSlot) {
      throwGameError('NOT_YOUR_TURN', 'It is not your turn.')
    }
    assertValidMoveCoord(args.coord)
    if (state.board.has(coordKey(args.coord))) {
      throwGameError('CELL_OCCUPIED', 'That hexagon is already occupied.')
    }

    const pendingDrawOfferedBy = game.drawOfferedBy ?? null
    const pendingDrawPatch =
      pendingDrawOfferedBy === null
        ? {}
        : {
            ...clearDrawOfferFields(),
            ...drawOfferCooldownPatch(pendingDrawOfferedBy, state.totalMoves),
          }
    const nextState = applyMove(state, args.coord)
    const timestamp = now()
    const nextSerializedState = serializeGameState(nextState)

    await ctx.db.insert('gameMoves', {
      gameId: game._id,
      moveIndex: state.totalMoves,
      turnNumber: state.turnNumber,
      slot: playerSlot,
      q: args.coord.q,
      r: args.coord.r,
      createdAt: timestamp,
    })

    await ctx.db.patch(game._id, {
      serializedState: toStoredState(nextSerializedState),
      winnerSlot: nextState.winner ?? undefined,
      finishReason: nextState.winner ? 'line' : undefined,
      status: nextState.winner ? 'finished' : 'active',
      finishedAt: nextState.winner ? timestamp : undefined,
      updatedAt: timestamp,
      ...pendingDrawPatch,
      ...(nextState.winner ? clearDrawOfferFields() : {}),
    })

    return {
      ok: true,
      winner: nextState.winner,
    }
  },
})

export const forfeitGame = mutation({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    const game = await ctx.db.get(args.gameId)
    if (!game) {
      throwGameError('GAME_NOT_FOUND', 'Game not found.')
    }
    if (game.status !== 'active') {
      throwGameError('GAME_FINISHED', 'This game is no longer active.')
    }

    const participant = await getParticipant(ctx.db, game._id, guest._id)
    if (!participant) {
      throwGameError('NOT_A_PLAYER', 'You are not part of this game.')
    }

    const slot = requirePlayerRole(participant.role)
    const timestamp = now()

    await ctx.db.patch(game._id, buildForfeitGamePatch(slot, timestamp))

    return { ok: true }
  },
})

export const forfeitDisconnectedPlayer = internalMutation({
  args: {
    gameId: v.id('games'),
    participantId: v.id('gameParticipants'),
    generation: v.number(),
  },
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId)
    if (!game || game.status !== 'active') {
      return { ok: true }
    }

    const participant = await ctx.db.get(args.participantId)
    if (!participant || participant.gameId !== game._id || !isPlayerParticipant(participant)) {
      return { ok: true }
    }
    if ((participant.disconnectForfeitGeneration ?? 0) !== args.generation) {
      return { ok: true }
    }

    const timestamp = now()
    if (timestamp - participant.lastSeenAt < DISCONNECT_FORFEIT_MS) {
      return { ok: true }
    }

    await ctx.db.patch(
      game._id,
      buildForfeitGamePatch(requirePlayerRole(participant.role), timestamp),
    )
    await ctx.db.patch(participant._id, {
      disconnectDeadlineAt: undefined,
      disconnectForfeitJobId: undefined,
    })

    return { ok: true }
  },
})

export const offerDraw = mutation({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    const game = await ctx.db.get(args.gameId)
    if (!game) {
      throwGameError('GAME_NOT_FOUND', 'Game not found.')
    }
    if (game.status !== 'active') {
      throwGameError('GAME_FINISHED', 'This game is no longer active.')
    }
    if (game.drawOfferedBy) {
      throwGameError('DRAW_ALREADY_PENDING', 'A draw offer is already pending.')
    }

    const participant = await getParticipant(ctx.db, game._id, guest._id)
    if (!participant) {
      throwGameError('NOT_A_PLAYER', 'You are not part of this game.')
    }

    const slot = requirePlayerRole(participant.role)
    const state = loadGameState(game)
    const minMoveIndex =
      slot === 'one'
        ? game.nextDrawOfferMoveIndexPlayerOne ?? 0
        : game.nextDrawOfferMoveIndexPlayerTwo ?? 0

    if (state.totalMoves < minMoveIndex) {
      throwGameError(
        'DRAW_NOT_ALLOWED',
        `Draw offers are available every ${DRAW_OFFER_COOLDOWN_MOVES} moves.`,
      )
    }

    await ctx.db.patch(game._id, {
      drawOfferedBy: slot,
      drawOfferedAtMoveIndex: state.totalMoves,
      updatedAt: now(),
    })

    return { ok: true }
  },
})

export const acceptDraw = mutation({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    const game = await ctx.db.get(args.gameId)
    if (!game) {
      throwGameError('GAME_NOT_FOUND', 'Game not found.')
    }
    if (game.status !== 'active') {
      throwGameError('GAME_FINISHED', 'This game is no longer active.')
    }
    if (!game.drawOfferedBy) {
      throwGameError('DRAW_NOT_PENDING', 'There is no pending draw offer.')
    }

    const participant = await getParticipant(ctx.db, game._id, guest._id)
    if (!participant) {
      throwGameError('NOT_A_PLAYER', 'You are not part of this game.')
    }

    const slot = requirePlayerRole(participant.role)
    if (game.drawOfferedBy === slot) {
      throwGameError('DRAW_NOT_ALLOWED', 'You cannot accept your own draw offer.')
    }

    const timestamp = now()
    await ctx.db.patch(game._id, {
      winnerSlot: undefined,
      finishReason: 'drawAgreement',
      status: 'finished',
      finishedAt: timestamp,
      updatedAt: timestamp,
      ...clearDrawOfferFields(),
    })

    return { ok: true }
  },
})

export const declineDraw = mutation({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    const game = await ctx.db.get(args.gameId)
    if (!game) {
      throwGameError('GAME_NOT_FOUND', 'Game not found.')
    }
    if (game.status !== 'active') {
      throwGameError('GAME_FINISHED', 'This game is no longer active.')
    }
    if (!game.drawOfferedBy) {
      throwGameError('DRAW_NOT_PENDING', 'There is no pending draw offer.')
    }

    const participant = await getParticipant(ctx.db, game._id, guest._id)
    if (!participant) {
      throwGameError('NOT_A_PLAYER', 'You are not part of this game.')
    }

    const slot = requirePlayerRole(participant.role)
    if (game.drawOfferedBy === slot) {
      throwGameError('DRAW_NOT_ALLOWED', 'You cannot decline your own draw offer.')
    }

    const state = loadGameState(game)
    await ctx.db.patch(game._id, {
      updatedAt: now(),
      ...clearDrawOfferFields(),
      ...drawOfferCooldownPatch(game.drawOfferedBy, state.totalMoves),
    })

    return { ok: true }
  },
})

export const requestRematch = mutation({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    const game = await ctx.db.get(args.gameId)
    if (!game) {
      throwGameError('GAME_NOT_FOUND', 'Game not found.')
    }
    if (game.status !== 'finished') {
      throwGameError('REMATCH_NOT_ALLOWED', 'Rematch is only available after the game ends.')
    }
    if (game.nextGameId) {
      throwGameError('REMATCH_ALREADY_EXISTS', 'A rematch already exists for this game.')
    }

    const participant = await getParticipant(ctx.db, game._id, guest._id)
    if (!participant) {
      throwGameError('NOT_A_PLAYER', 'You are not part of this game.')
    }
    const slot = requirePlayerRole(participant.role)
    const isPlayerOne = slot === 'one'
    const requestedByPlayerOne =
      game.rematchRequestedByPlayerOne || isPlayerOne
    const requestedByPlayerTwo =
      game.rematchRequestedByPlayerTwo || !isPlayerOne
    const timestamp = now()

    if (!requestedByPlayerOne || !requestedByPlayerTwo) {
      await ctx.db.patch(game._id, {
        rematchRequestedByPlayerOne: requestedByPlayerOne,
        rematchRequestedByPlayerTwo: requestedByPlayerTwo,
        updatedAt: timestamp,
      })

      return {
        nextGameId: null,
      }
    }

    if (!game.playerOneGuestId || !game.playerTwoGuestId) {
      throwGameError('REMATCH_NOT_ALLOWED', 'This game is missing player assignments.')
    }

    const nextGameId = await ctx.db.insert('games', {
      mode: game.mode,
      status: 'active',
      roomCode: game.mode === 'private' ? game.roomCode : undefined,
      createdByGuestId: game.createdByGuestId,
      playerOneGuestId: game.playerTwoGuestId,
      playerTwoGuestId: game.playerOneGuestId,
      serializedState: createStoredInitialState(),
      startedAt: timestamp,
      updatedAt: timestamp,
      seriesId: game.seriesId ?? game._id,
      previousGameId: game._id,
      rematchRequestedByPlayerOne: false,
      rematchRequestedByPlayerTwo: false,
      nextDrawOfferMoveIndexPlayerOne: 0,
      nextDrawOfferMoveIndexPlayerTwo: 0,
    })

    await ctx.db.patch(game._id, {
      nextGameId,
      rematchRequestedByPlayerOne: true,
      rematchRequestedByPlayerTwo: true,
      updatedAt: timestamp,
    })

    const playerOneParticipantId = await ctx.db.insert('gameParticipants', {
      gameId: nextGameId,
      guestId: game.playerTwoGuestId,
      role: 'playerOne',
      joinedAt: timestamp,
      lastSeenAt: timestamp,
    })
    const playerTwoParticipantId = await ctx.db.insert('gameParticipants', {
      gameId: nextGameId,
      guestId: game.playerOneGuestId,
      role: 'playerTwo',
      joinedAt: timestamp,
      lastSeenAt: timestamp,
    })
    const playerOneParticipant = await ctx.db.get(playerOneParticipantId)
    const playerTwoParticipant = await ctx.db.get(playerTwoParticipantId)

    if (
      !playerOneParticipant ||
      !isPlayerParticipant(playerOneParticipant) ||
      !playerTwoParticipant ||
      !isPlayerParticipant(playerTwoParticipant)
    ) {
      throw new Error('Rematch participants were not created correctly.')
    }

    await refreshDisconnectForfeit(ctx, nextGameId, playerOneParticipant, timestamp)
    await refreshDisconnectForfeit(ctx, nextGameId, playerTwoParticipant, timestamp)

    if (game.mode === 'private') {
      const participants = await listParticipants(ctx.db, game._id)
      for (const spectator of participants) {
        if (spectator.role !== 'spectator') {
          continue
        }

        await ctx.db.insert('gameParticipants', {
          gameId: nextGameId,
          guestId: spectator.guestId,
          role: 'spectator',
          joinedAt: timestamp,
          lastSeenAt: spectator.lastSeenAt,
        })
      }
    }

    return {
      nextGameId,
    }
  },
})

export const cancelRematch = mutation({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    const game = await ctx.db.get(args.gameId)
    if (!game) {
      throwGameError('GAME_NOT_FOUND', 'Game not found.')
    }
    if (game.status !== 'finished' || game.nextGameId) {
      throwGameError('REMATCH_NOT_ALLOWED', 'Rematch can no longer be changed.')
    }

    const participant = await getParticipant(ctx.db, game._id, guest._id)
    if (!participant) {
      throwGameError('NOT_A_PLAYER', 'You are not part of this game.')
    }
    const slot = requirePlayerRole(participant.role)

    await ctx.db.patch(game._id, {
      rematchRequestedByPlayerOne:
        slot === 'one' ? false : game.rematchRequestedByPlayerOne,
      rematchRequestedByPlayerTwo:
        slot === 'two' ? false : game.rematchRequestedByPlayerTwo,
      updatedAt: now(),
    })

    return { ok: true }
  },
})
