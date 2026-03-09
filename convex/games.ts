import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import {
  compareHistoryEntries,
  buildHistoryEntry,
  buildReplayData,
  assertValidMoveCoord,
  buildForfeitGamePatch,
  buildGameSnapshot,
  buildResolvedClockPatch,
  buildTimeoutGamePatch,
  clearDrawOfferFields,
  createStoredInitialState,
  drawOfferCooldownPatch,
  DRAW_OFFER_COOLDOWN_MOVES,
  type GameDoc,
  getGuestByToken,
  getParticipant,
  isPlayerParticipant,
  listParticipants,
  loadGameState,
  normalizeGameTimeControl,
  normalizeTurnCommitMode,
  now,
  refreshClockTimeout,
  refreshDisconnectForfeit,
  requireGuest,
  requirePlayerRole,
  resolveTimedGameClock,
  throwGameError,
  toStoredState,
} from './lib'
import {
  applyConfirmedTurn,
  applyMove,
  coordKey,
  serializeGameState,
} from '../shared/hexGame'
import { getInitialClockMs } from '../shared/timeControl'

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

export const listHistoryForGuest = query({
  args: {
    guestToken: v.string(),
  },
  handler: async (ctx, args) => {
    const guest = await getGuestByToken(ctx.db, args.guestToken)
    if (!guest) {
      return []
    }

    const participations = await ctx.db
      .query('gameParticipants')
      .withIndex('by_guestId', (query) => query.eq('guestId', guest._id))
      .collect()
    const playerParticipations = participations.filter(
      (participant) =>
        participant.role === 'playerOne' || participant.role === 'playerTwo',
    )
    const games = await Promise.all(
      playerParticipations.map(async (participant) => {
        const game = await ctx.db.get(participant.gameId)
        if (!game || game.status !== 'finished') {
          return null
        }

        return buildHistoryEntry(ctx.db, guest._id, game, participant)
      }),
    )

    return games
      .filter((game): game is NonNullable<typeof game> => game !== null)
      .sort(compareHistoryEntries)
  },
})

export const replayByIdForGuest = query({
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
    if (!game || game.status !== 'finished') {
      return null
    }

    const participant = await getParticipant(ctx.db, game._id, guest._id)
    if (!participant) {
      return null
    }

    return buildReplayData(ctx.db, guest._id, game, participant)
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
    if (normalizeTurnCommitMode(game) !== 'instant') {
      throwGameError(
        'TURN_CONFIRM_REQUIRED',
        'This game requires confirming the full turn before submitting moves.',
      )
    }
    const state = loadGameState(game)
    const timestamp = now()
    const resolvedClock = await ensureGameHasTimeRemaining(
      ctx,
      game,
      state.currentPlayer,
      timestamp,
    )
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
    const nextSerializedState = serializeGameState(nextState)
    const nextActivePlayer = nextState.winner ? null : nextState.currentPlayer

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
      ...buildResolvedClockPatch(resolvedClock, nextActivePlayer, timestamp),
      ...pendingDrawPatch,
      ...(nextState.winner ? clearDrawOfferFields() : {}),
    })

    if (normalizeGameTimeControl(game) !== 'unlimited') {
      await refreshClockTimeout(
        ctx,
        game,
        resolvedClock
          ? {
              ...resolvedClock,
              activePlayer: nextActivePlayer,
              serverNow: timestamp,
            }
          : null,
      )
    }

    await refreshDisconnectForfeit(ctx, game._id)

    return {
      ok: true,
      winner: nextState.winner,
    }
  },
})

export const confirmTurn = mutation({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
    coords: v.array(
      v.object({
        q: v.number(),
        r: v.number(),
      }),
    ),
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

    if (normalizeTurnCommitMode(game) !== 'confirmTurn') {
      throwGameError(
        'INSTANT_MOVE_GAME',
        'This game submits moves immediately and does not support turn confirmation.',
      )
    }

    const participant = await getParticipant(ctx.db, game._id, guest._id)
    if (!participant) {
      throwGameError('NOT_A_PLAYER', 'You are not part of this game.')
    }

    const playerSlot = requirePlayerRole(participant.role)
    const state = loadGameState(game)
    const timestamp = now()
    const resolvedClock = await ensureGameHasTimeRemaining(
      ctx,
      game,
      state.currentPlayer,
      timestamp,
    )
    if (state.currentPlayer !== playerSlot) {
      throwGameError('NOT_YOUR_TURN', 'It is not your turn.')
    }
    if (args.coords.length !== state.movesRemaining) {
      throwGameError(
        'INVALID_TURN_SIZE',
        `This turn requires exactly ${state.movesRemaining} move${state.movesRemaining === 1 ? '' : 's'}.`,
      )
    }

    const occupiedKeys = new Set(state.board.keys())
    const seenKeys = new Set<string>()
    for (const coord of args.coords) {
      assertValidMoveCoord(coord)
      const key = coordKey(coord)
      if (seenKeys.has(key)) {
        throwGameError('DUPLICATE_MOVE', 'A turn cannot contain the same hexagon twice.')
      }
      if (occupiedKeys.has(key)) {
        throwGameError('CELL_OCCUPIED', 'That hexagon is already occupied.')
      }
      seenKeys.add(key)
      occupiedKeys.add(key)
    }

    const pendingDrawOfferedBy = game.drawOfferedBy ?? null
    const pendingDrawPatch =
      pendingDrawOfferedBy === null
        ? {}
        : {
            ...clearDrawOfferFields(),
            ...drawOfferCooldownPatch(pendingDrawOfferedBy, state.totalMoves),
          }
    const nextState = applyConfirmedTurn(state, args.coords)
    const nextSerializedState = serializeGameState(nextState)
    const nextActivePlayer = nextState.winner ? null : nextState.currentPlayer

    for (const [index, coord] of args.coords.entries()) {
      await ctx.db.insert('gameMoves', {
        gameId: game._id,
        moveIndex: state.totalMoves + index,
        turnNumber: state.turnNumber,
        slot: playerSlot,
        q: coord.q,
        r: coord.r,
        createdAt: timestamp,
      })
    }

    await ctx.db.patch(game._id, {
      serializedState: toStoredState(nextSerializedState),
      winnerSlot: nextState.winner ?? undefined,
      finishReason: nextState.winner ? 'line' : undefined,
      status: nextState.winner ? 'finished' : 'active',
      finishedAt: nextState.winner ? timestamp : undefined,
      updatedAt: timestamp,
      ...buildResolvedClockPatch(resolvedClock, nextActivePlayer, timestamp),
      ...pendingDrawPatch,
      ...(nextState.winner ? clearDrawOfferFields() : {}),
    })

    if (normalizeGameTimeControl(game) !== 'unlimited') {
      await refreshClockTimeout(
        ctx,
        game,
        resolvedClock
          ? {
              ...resolvedClock,
              activePlayer: nextActivePlayer,
              serverNow: timestamp,
            }
          : null,
      )
    }

    await refreshDisconnectForfeit(ctx, game._id)

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
    const state = loadGameState(game)
    const resolvedClock = await ensureGameHasTimeRemaining(
      ctx,
      game,
      state.currentPlayer,
      timestamp,
    )

    await ctx.db.patch(game._id, {
      ...buildForfeitGamePatch(slot, timestamp),
      ...buildResolvedClockPatch(resolvedClock, null, timestamp),
    })

    if (normalizeGameTimeControl(game) !== 'unlimited') {
      await refreshClockTimeout(ctx, game, null)
    }

    await refreshDisconnectForfeit(ctx, game._id)

    return { ok: true }
  },
})

export const timeoutActivePlayer = internalMutation({
  args: {
    gameId: v.id('games'),
    generation: v.number(),
  },
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId)
    if (!game || game.status !== 'active') {
      return { ok: true }
    }
    if (normalizeGameTimeControl(game) === 'unlimited') {
      return { ok: true }
    }
    if ((game.clockTimeoutGeneration ?? 0) !== args.generation) {
      return { ok: true }
    }

    const timestamp = now()
    const state = loadGameState(game)
    const resolvedClock = resolveTimedGameClock(game, state.currentPlayer, timestamp)

    if (!resolvedClock || resolvedClock.activePlayer === null) {
      return { ok: true }
    }
    if (resolvedClock.remainingMs[resolvedClock.activePlayer] > 0) {
      return { ok: true }
    }

    await ctx.db.patch(
      game._id,
      buildTimeoutGamePatch(
        resolvedClock.activePlayer,
        timestamp,
        resolvedClock.remainingMs,
      ),
    )

    await refreshDisconnectForfeit(ctx, game._id)

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
    const timestamp = now()
    await ensureGameHasTimeRemaining(ctx, game, state.currentPlayer, timestamp)
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
      updatedAt: timestamp,
    })

    if (normalizeGameTimeControl(game) !== 'unlimited') {
      await refreshClockTimeout(ctx, game, null)
    }

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
    const state = loadGameState(game)
    const resolvedClock = await ensureGameHasTimeRemaining(
      ctx,
      game,
      state.currentPlayer,
      timestamp,
    )
    await ctx.db.patch(game._id, {
      winnerSlot: undefined,
      finishReason: 'drawAgreement',
      status: 'finished',
      finishedAt: timestamp,
      updatedAt: timestamp,
      ...buildResolvedClockPatch(resolvedClock, null, timestamp),
      ...clearDrawOfferFields(),
    })

    await refreshDisconnectForfeit(ctx, game._id)

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
    const timestamp = now()
    await ensureGameHasTimeRemaining(ctx, game, state.currentPlayer, timestamp)
    await ctx.db.patch(game._id, {
      updatedAt: timestamp,
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
    const initialClockMs = getInitialClockMs(normalizeGameTimeControl(game))

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
      timeControl: normalizeGameTimeControl(game),
      turnCommitMode: normalizeTurnCommitMode(game),
      roomCode: game.mode === 'private' ? game.roomCode : undefined,
      createdByGuestId: game.createdByGuestId,
      playerOneGuestId: game.playerTwoGuestId,
      playerTwoGuestId: game.playerOneGuestId,
      playerOneTimeRemainingMs: initialClockMs ?? undefined,
      playerTwoTimeRemainingMs: initialClockMs ?? undefined,
      turnStartedAt: undefined,
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
      roomCode: game.mode === 'private' ? undefined : game.roomCode,
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

    await refreshDisconnectForfeit(ctx, nextGameId)

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

async function ensureGameHasTimeRemaining(
  ctx: MutationCtx,
  game: GameDoc,
  currentPlayer: 'one' | 'two',
  timestamp: number,
) {
  const resolvedClock = resolveTimedGameClock(game, currentPlayer, timestamp)

  if (
    resolvedClock &&
    resolvedClock.activePlayer !== null &&
    resolvedClock.remainingMs[resolvedClock.activePlayer] <= 0
  ) {
    await ctx.db.patch(
      game._id,
      buildTimeoutGamePatch(
        resolvedClock.activePlayer,
        timestamp,
        resolvedClock.remainingMs,
      ),
    )
    await refreshClockTimeout(ctx, game, null)
    await refreshDisconnectForfeit(ctx, game._id)
    throwGameError('GAME_FINISHED', 'This game ended on time.')
  }

  return resolvedClock
}
