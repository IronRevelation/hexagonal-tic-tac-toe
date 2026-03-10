import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import {
  compareHistoryEntries,
  buildClockStateFields,
  buildHistoryEntry,
  buildLiveGameSnapshot,
  buildPresenceAccessSnapshot,
  buildReplayData,
  assertValidMoveCoord,
  buildForfeitGamePatch,
  buildResolvedClockPatch,
  buildTimeoutGamePatch,
  clearDrawOfferFields,
  createStoredInitialState,
  drawOfferCooldownPatch,
  DRAW_OFFER_COOLDOWN_MOVES,
  ensureGameStateRecord,
  type GameDoc,
  getGuestByToken,
  getParticipant,
  isPlayerParticipant,
  listParticipants,
  loadSerializedGameState,
  normalizeGameTimeControl,
  normalizeTurnCommitMode,
  now,
  refreshClockTimeout,
  refreshDisconnectForfeit,
  refreshGuestLiveStatus,
  requireGameStateFields,
  requireGuest,
  requirePlayerRole,
  resolveLobbyStatus,
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

const HISTORY_PAGE_SIZE = 20
const MAX_HISTORY_PAGE_SIZE = 50

export const resumeForGuest = query({
  args: {
    guestToken: v.string(),
  },
  handler: async (ctx, args) => {
    const status = await resolveLobbyStatus(ctx.db, args.guestToken)
    if (!status?.activeGameId || !status.activeRole) {
      return null
    }

    return {
      gameId: status.activeGameId,
      role: status.activeRole,
    }
  },
})

export const liveByIdForGuest = query({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
  },
  handler: async (ctx, args) => {
    const guest = await getGuestByToken(ctx.db, args.guestToken)
    if (!guest) {
      return null
    }

    const participant = await getParticipant(ctx.db, args.gameId, guest._id)
    if (!participant) {
      return null
    }

    const game = await ctx.db.get(args.gameId)
    if (!game) {
      return null
    }

    return buildLiveGameSnapshot(ctx.db, guest, game)
  },
})

export const presenceAccessByIdForGuest = query({
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

    return buildPresenceAccessSnapshot(ctx.db, guest, game)
  },
})

export const listHistoryPageForGuest = query({
  args: {
    guestToken: v.string(),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const guest = await getGuestByToken(ctx.db, args.guestToken)
    if (!guest) {
      return {
        items: [],
        nextCursor: null,
        hasMore: false,
      }
    }

    const limit = Math.min(
      MAX_HISTORY_PAGE_SIZE,
      Math.max(1, args.limit ?? HISTORY_PAGE_SIZE),
    )
    const offset = decodeHistoryCursor(args.cursor)
    const participations = await ctx.db
      .query('gameParticipants')
      .withIndex('by_guestId', (query) => query.eq('guestId', guest._id))
      .collect()
    const playerParticipations = participations.filter(
      (participant) =>
        participant.role === 'playerOne' || participant.role === 'playerTwo',
    )
    const entries = (
      await Promise.all(
        playerParticipations.map(async (participant) => {
          const game = await ctx.db.get(participant.gameId)
          if (!game || game.status !== 'finished') {
            return null
          }

          return buildHistoryEntry(ctx.db, guest._id, game, participant)
        }),
      )
    )
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort(compareHistoryEntries)

    const items = entries.slice(offset, offset + limit)
    const nextOffset = offset + items.length

    return {
      items,
      nextCursor: nextOffset < entries.length ? encodeHistoryCursor(nextOffset) : null,
      hasMore: nextOffset < entries.length,
    }
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
    const game = await requireActiveGame(ctx, args.gameId)
    const participant = await getParticipant(ctx.db, game._id, guest._id)
    if (!participant) {
      throwGameError('NOT_A_PLAYER', 'You are not part of this game.')
    }

    const playerSlot = requirePlayerRole(participant.role)
    const stateFields = await requireGameStateFields(ctx.db, game)
    if (normalizeTurnCommitMode(stateFields) !== 'instant') {
      throwGameError(
        'TURN_CONFIRM_REQUIRED',
        'This game requires confirming the full turn before submitting moves.',
      )
    }

    const state = loadSerializedGameState(stateFields)
    const timestamp = now()
    const resolvedClock = await ensureGameHasTimeRemaining(
      ctx,
      game,
      stateFields,
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

    const pendingDrawOfferedBy = stateFields.drawOfferedBy ?? null
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
    const statePatch = {
      serializedState: toStoredState(nextSerializedState),
      winnerSlot: nextState.winner ?? undefined,
      finishReason: nextState.winner ? 'line' : undefined,
      updatedAt: timestamp,
      ...buildResolvedClockPatch(resolvedClock, nextActivePlayer, timestamp),
      ...pendingDrawPatch,
      ...(nextState.winner ? clearDrawOfferFields() : {}),
    }
    const gamePatch = {
      status: nextState.winner ? ('finished' as const) : ('active' as const),
      finishedAt: nextState.winner ? timestamp : undefined,
      updatedAt: timestamp,
    }

    await ctx.db.insert('gameMoves', {
      gameId: game._id,
      moveIndex: state.totalMoves,
      turnNumber: state.turnNumber,
      slot: playerSlot,
      q: args.coord.q,
      r: args.coord.r,
      createdAt: timestamp,
    })

    await patchGameAndState(ctx, game, gamePatch, statePatch)

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
    if (nextState.winner) {
      await refreshGameParticipantStatuses(ctx, game._id)
    }

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
    const game = await requireActiveGame(ctx, args.gameId)
    const stateFields = await requireGameStateFields(ctx.db, game)

    if (normalizeTurnCommitMode(stateFields) !== 'confirmTurn') {
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
    const state = loadSerializedGameState(stateFields)
    const timestamp = now()
    const resolvedClock = await ensureGameHasTimeRemaining(
      ctx,
      game,
      stateFields,
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

    const pendingDrawOfferedBy = stateFields.drawOfferedBy ?? null
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
    const statePatch = {
      serializedState: toStoredState(nextSerializedState),
      winnerSlot: nextState.winner ?? undefined,
      finishReason: nextState.winner ? 'line' : undefined,
      updatedAt: timestamp,
      ...buildResolvedClockPatch(resolvedClock, nextActivePlayer, timestamp),
      ...pendingDrawPatch,
      ...(nextState.winner ? clearDrawOfferFields() : {}),
    }
    const gamePatch = {
      status: nextState.winner ? ('finished' as const) : ('active' as const),
      finishedAt: nextState.winner ? timestamp : undefined,
      updatedAt: timestamp,
    }

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

    await patchGameAndState(ctx, game, gamePatch, statePatch)

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
    if (nextState.winner) {
      await refreshGameParticipantStatuses(ctx, game._id)
    }

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
    const game = await requireActiveGame(ctx, args.gameId)
    const participant = await getParticipant(ctx.db, game._id, guest._id)
    if (!participant) {
      throwGameError('NOT_A_PLAYER', 'You are not part of this game.')
    }

    const slot = requirePlayerRole(participant.role)
    const timestamp = now()
    const stateFields = await requireGameStateFields(ctx.db, game)
    const state = loadSerializedGameState(stateFields)
    const resolvedClock = await ensureGameHasTimeRemaining(
      ctx,
      game,
      stateFields,
      state.currentPlayer,
      timestamp,
    )
    const patch = {
      ...buildForfeitGamePatch(slot, timestamp),
      ...buildResolvedClockPatch(resolvedClock, null, timestamp),
    }

    await patchGameAndState(
      ctx,
      game,
      {
        status: 'finished',
        finishedAt: timestamp,
        updatedAt: timestamp,
      },
      patch,
    )

    if (normalizeGameTimeControl(game) !== 'unlimited') {
      await refreshClockTimeout(ctx, game, null)
    }

    await refreshDisconnectForfeit(ctx, game._id)
    await refreshGameParticipantStatuses(ctx, game._id)

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

    const stateFields = await requireGameStateFields(ctx.db, game)
    if ((stateFields.clockTimeoutGeneration ?? 0) !== args.generation) {
      return { ok: true }
    }

    const timestamp = now()
    const state = loadSerializedGameState(stateFields)
    const resolvedClock = resolveTimedGameClock(
      buildClockStateFields(game, stateFields),
      state.currentPlayer,
      timestamp,
    )

    if (!resolvedClock || resolvedClock.activePlayer === null) {
      return { ok: true }
    }
    if (resolvedClock.remainingMs[resolvedClock.activePlayer] > 0) {
      return { ok: true }
    }

    const patch = buildTimeoutGamePatch(
      resolvedClock.activePlayer,
      timestamp,
      resolvedClock.remainingMs,
    )
    await patchGameAndState(
      ctx,
      game,
      {
        status: 'finished',
        finishedAt: timestamp,
        updatedAt: timestamp,
      },
      patch,
    )

    await refreshDisconnectForfeit(ctx, game._id)
    await refreshGameParticipantStatuses(ctx, game._id)

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
    const game = await requireActiveGame(ctx, args.gameId)
    const stateFields = await requireGameStateFields(ctx.db, game)
    if (stateFields.drawOfferedBy) {
      throwGameError('DRAW_ALREADY_PENDING', 'A draw offer is already pending.')
    }

    const participant = await getParticipant(ctx.db, game._id, guest._id)
    if (!participant) {
      throwGameError('NOT_A_PLAYER', 'You are not part of this game.')
    }

    const slot = requirePlayerRole(participant.role)
    const state = loadSerializedGameState(stateFields)
    const timestamp = now()
    await ensureGameHasTimeRemaining(
      ctx,
      game,
      stateFields,
      state.currentPlayer,
      timestamp,
    )
    const minMoveIndex =
      slot === 'one'
        ? stateFields.nextDrawOfferMoveIndexPlayerOne ?? 0
        : stateFields.nextDrawOfferMoveIndexPlayerTwo ?? 0

    if (state.totalMoves < minMoveIndex) {
      throwGameError(
        'DRAW_NOT_ALLOWED',
        `Draw offers are available every ${DRAW_OFFER_COOLDOWN_MOVES} moves.`,
      )
    }

    await patchGameAndState(
      ctx,
      game,
      {
        updatedAt: timestamp,
      },
      {
        drawOfferedBy: slot,
        drawOfferedAtMoveIndex: state.totalMoves,
        updatedAt: timestamp,
      },
    )

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
    const game = await requireActiveGame(ctx, args.gameId)
    const stateFields = await requireGameStateFields(ctx.db, game)
    if (!stateFields.drawOfferedBy) {
      throwGameError('DRAW_NOT_PENDING', 'There is no pending draw offer.')
    }

    const participant = await getParticipant(ctx.db, game._id, guest._id)
    if (!participant) {
      throwGameError('NOT_A_PLAYER', 'You are not part of this game.')
    }

    const slot = requirePlayerRole(participant.role)
    if (stateFields.drawOfferedBy === slot) {
      throwGameError('DRAW_NOT_ALLOWED', 'You cannot accept your own draw offer.')
    }

    const timestamp = now()
    const state = loadSerializedGameState(stateFields)
    const resolvedClock = await ensureGameHasTimeRemaining(
      ctx,
      game,
      stateFields,
      state.currentPlayer,
      timestamp,
    )
    await patchGameAndState(
      ctx,
      game,
      {
        status: 'finished',
        finishedAt: timestamp,
        updatedAt: timestamp,
      },
      {
        winnerSlot: undefined,
        finishReason: 'drawAgreement',
        updatedAt: timestamp,
        ...buildResolvedClockPatch(resolvedClock, null, timestamp),
        ...clearDrawOfferFields(),
      },
    )

    await refreshDisconnectForfeit(ctx, game._id)
    await refreshGameParticipantStatuses(ctx, game._id)

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
    const game = await requireActiveGame(ctx, args.gameId)
    const stateFields = await requireGameStateFields(ctx.db, game)
    if (!stateFields.drawOfferedBy) {
      throwGameError('DRAW_NOT_PENDING', 'There is no pending draw offer.')
    }

    const participant = await getParticipant(ctx.db, game._id, guest._id)
    if (!participant) {
      throwGameError('NOT_A_PLAYER', 'You are not part of this game.')
    }

    const slot = requirePlayerRole(participant.role)
    if (stateFields.drawOfferedBy === slot) {
      throwGameError('DRAW_NOT_ALLOWED', 'You cannot decline your own draw offer.')
    }

    const state = loadSerializedGameState(stateFields)
    const timestamp = now()
    await ensureGameHasTimeRemaining(
      ctx,
      game,
      stateFields,
      state.currentPlayer,
      timestamp,
    )
    await patchGameAndState(
      ctx,
      game,
      {
        updatedAt: timestamp,
      },
      {
        updatedAt: timestamp,
        ...clearDrawOfferFields(),
        ...drawOfferCooldownPatch(stateFields.drawOfferedBy, state.totalMoves),
      },
    )

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
    const requestedByPlayerOne = game.rematchRequestedByPlayerOne || isPlayerOne
    const requestedByPlayerTwo = game.rematchRequestedByPlayerTwo || !isPlayerOne
    const timestamp = now()
    const stateFields = await requireGameStateFields(ctx.db, game)
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
      roomCode: game.mode === 'private' ? game.roomCode : undefined,
      createdByGuestId: game.createdByGuestId,
      playerOneGuestId: game.playerTwoGuestId,
      playerTwoGuestId: game.playerOneGuestId,
      startedAt: timestamp,
      updatedAt: timestamp,
      seriesId: game.seriesId ?? game._id,
      previousGameId: game._id,
      rematchRequestedByPlayerOne: false,
      rematchRequestedByPlayerTwo: false,
    })
    await ctx.db.insert('gameStates', {
      gameId: nextGameId,
      turnCommitMode: normalizeTurnCommitMode(stateFields),
      serializedState: createStoredInitialState(),
      playerOneTimeRemainingMs: initialClockMs ?? undefined,
      playerTwoTimeRemainingMs: initialClockMs ?? undefined,
      updatedAt: timestamp,
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
    await refreshGameParticipantStatuses(ctx, game._id)
    await refreshGameParticipantStatuses(ctx, nextGameId)

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

async function requireActiveGame(
  ctx: Pick<MutationCtx, 'db'>,
  gameId: GameDoc['_id'],
) {
  const game = await ctx.db.get(gameId)
  if (!game) {
    throwGameError('GAME_NOT_FOUND', 'Game not found.')
  }
  if (game.status !== 'active') {
    throwGameError('GAME_FINISHED', 'This game is no longer active.')
  }

  return game
}

async function patchGameAndState(
  ctx: Pick<MutationCtx, 'db'>,
  game: GameDoc,
  gamePatch: Record<string, any>,
  statePatch: Record<string, any>,
) {
  const stateRecord = await ensureGameStateRecord(ctx.db, game)
  const persistedStatePatch = toPersistedGameStatePatch(
    statePatch,
    stateRecord,
    stateRecord.turnCommitMode ?? game.turnCommitMode ?? 'instant',
  )
  await Promise.all([
    ctx.db.patch(game._id, gamePatch),
    ctx.db.patch(stateRecord._id, persistedStatePatch),
  ])
}

async function refreshGameParticipantStatuses(
  ctx: Pick<MutationCtx, 'db'>,
  gameId: GameDoc['_id'],
) {
  const participants = await listParticipants(ctx.db, gameId)
  const uniqueGuestIds = Array.from(new Set(participants.map((participant) => participant.guestId)))
  const guests = await Promise.all(uniqueGuestIds.map((guestId) => ctx.db.get(guestId)))

  for (const guest of guests) {
    if (!guest) {
      continue
    }

    await refreshGuestLiveStatus(ctx.db, guest)
  }
}

async function ensureGameHasTimeRemaining(
  ctx: MutationCtx,
  game: GameDoc,
  stateFields: Awaited<ReturnType<typeof requireGameStateFields>>,
  currentPlayer: 'one' | 'two',
  timestamp: number,
) {
  const resolvedClock = resolveTimedGameClock(
    buildClockStateFields(game, stateFields),
    currentPlayer,
    timestamp,
  )

  if (
    resolvedClock &&
    resolvedClock.activePlayer !== null &&
    resolvedClock.remainingMs[resolvedClock.activePlayer] <= 0
  ) {
    const patch = buildTimeoutGamePatch(
      resolvedClock.activePlayer,
      timestamp,
      resolvedClock.remainingMs,
    )
    await patchGameAndState(
      ctx,
      game,
      {
        status: 'finished',
        finishedAt: timestamp,
        updatedAt: timestamp,
      },
      patch,
    )
    await refreshClockTimeout(ctx, game, null)
    await refreshDisconnectForfeit(ctx, game._id)
    await refreshGameParticipantStatuses(ctx, game._id)
    throwGameError('GAME_FINISHED', 'This game ended on time.')
  }

  return resolvedClock
}

function decodeHistoryCursor(cursor: string | undefined) {
  if (!cursor) {
    return 0
  }

  const parsed = Number(cursor)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

function encodeHistoryCursor(offset: number) {
  return String(offset)
}

function toPersistedGameStatePatch(
  statePatch: Record<string, any>,
  stateRecord: {
    serializedState: GameDoc['serializedState']
    updatedAt: number
  },
  turnCommitMode: 'instant' | 'confirmTurn',
) {
  return {
    serializedState: statePatch.serializedState ?? stateRecord.serializedState,
    winnerSlot: statePatch.winnerSlot,
    finishReason: statePatch.finishReason,
    turnCommitMode: statePatch.turnCommitMode ?? turnCommitMode,
    playerOneTimeRemainingMs: statePatch.playerOneTimeRemainingMs,
    playerTwoTimeRemainingMs: statePatch.playerTwoTimeRemainingMs,
    turnStartedAt: statePatch.turnStartedAt,
    clockTimeoutGeneration: statePatch.clockTimeoutGeneration,
    clockTimeoutJobId: statePatch.clockTimeoutJobId,
    drawOfferedBy: statePatch.drawOfferedBy,
    drawOfferedAtMoveIndex: statePatch.drawOfferedAtMoveIndex,
    nextDrawOfferMoveIndexPlayerOne: statePatch.nextDrawOfferMoveIndexPlayerOne,
    nextDrawOfferMoveIndexPlayerTwo: statePatch.nextDrawOfferMoveIndexPlayerTwo,
    updatedAt: statePatch.updatedAt ?? stateRecord.updatedAt,
  }
}
