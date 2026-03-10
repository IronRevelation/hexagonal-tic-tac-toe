import { v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { internalMutation, mutation, query } from './_generated/server'
import { PRIVACY_INFO } from '../shared/legal'
import {
  FINISHED_GAME_RETENTION_MS,
  MATCHMAKING_RETENTION_MS,
  WAITING_PRIVATE_ROOM_RETENTION_MS,
  buildForfeitGamePatch,
  canDeletePrivateRoom,
  ensureGameStateRecord,
  findActivePlayerGameParticipant,
  getQueueEntry,
  getGuestLiveStatus,
  listGuestParticipants,
  listParticipants,
  normalizeGameTimeControl,
  now,
  refreshGuestLiveStatus,
  requireGameStateFields,
  requireGuest,
  requirePlayerRole,
} from './lib'

export const getPrivacyInfo = query({
  args: {},
  handler: async () => PRIVACY_INFO,
})

export const exportMyData = query({
  args: {
    guestToken: v.string(),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    const queueEntry = await getQueueEntry(ctx.db, guest._id)
    const participants = await listGuestParticipants(ctx.db, guest._id)
    const uniqueGameIds = Array.from(
      new Set(participants.map((participant) => participant.gameId)),
    )
    const games = (
      await Promise.all(uniqueGameIds.map((gameId) => ctx.db.get(gameId)))
    ).filter((game): game is NonNullable<typeof game> => game !== null)
    const moveGroups = await Promise.all(
      uniqueGameIds.map((gameId) =>
        ctx.db
          .query('gameMoves')
          .withIndex('by_gameId_moveIndex', (query) => query.eq('gameId', gameId))
          .collect(),
      ),
    )
    const moves = moveGroups.flat()

    const gameStateFields = await Promise.all(
      games.map((game) => requireGameStateFields(ctx.db, game)),
    )

    return {
      exportedAt: now(),
      contactEmail: PRIVACY_INFO.contactEmail,
      guest: {
        id: guest._id,
        displayName: guest.displayName,
        state: guest.state,
        createdAt: guest.createdAt,
        erasedAt: guest.erasedAt ?? null,
        retentionExpiresAt: guest.retentionExpiresAt,
      },
      queueEntry: queueEntry
        ? {
            id: queueEntry._id,
            queuedAt: queueEntry.queuedAt,
          }
        : null,
      participants: participants.map((participant) => ({
        id: participant._id,
        gameId: participant.gameId,
        role: participant.role,
        joinedAt: participant.joinedAt,
        lastSeenAt: participant.lastSeenAt,
        disconnectDeadlineAt: participant.disconnectDeadlineAt ?? null,
      })),
      games: games.map((game, index) => ({
        id: game._id,
        mode: game.mode,
        status: game.status,
        timeControl: normalizeGameTimeControl(game),
        roomCode: game.roomCode ?? null,
        createdAt: game._creationTime,
        startedAt: game.startedAt ?? null,
        finishedAt: game.finishedAt ?? null,
        updatedAt: game.updatedAt,
        finishReason: gameStateFields[index]?.finishReason ?? null,
        winnerSlot: gameStateFields[index]?.winnerSlot ?? null,
      })),
      moves: moves.map((move) => ({
        id: move._id,
        gameId: move.gameId,
        moveIndex: move.moveIndex,
        turnNumber: move.turnNumber,
        slot: move.slot,
        q: move.q,
        r: move.r,
        createdAt: move.createdAt,
      })),
    }
  },
})

export const eraseMyData = mutation({
  args: {
    guestToken: v.string(),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    const timestamp = now()

    const queueEntry = await getQueueEntry(ctx.db, guest._id)
    if (queueEntry) {
      await ctx.db.delete(queueEntry._id)
    }

    const guestParticipants = await listGuestParticipants(ctx.db, guest._id)
    for (const participant of guestParticipants) {
      const game = await ctx.db.get(participant.gameId)
      if (!game) {
        continue
      }

      if (!canDeletePrivateRoom(game, [participant], guest._id)) {
        continue
      }

      await deleteGameCascade(ctx, game._id)
    }

    const activePlayerGame = await findActivePlayerGameParticipant(ctx.db, guest._id)
    if (activePlayerGame?.game.status === 'active') {
      const patch = buildForfeitGamePatch(
        requirePlayerRole(activePlayerGame.participant.role),
        timestamp,
      )
      const stateRecord = await ensureGameStateRecord(ctx.db, activePlayerGame.game)
      await ctx.db.patch(activePlayerGame.game._id, {
        status: patch.status,
        finishedAt: patch.finishedAt,
        updatedAt: patch.updatedAt,
      })
      await ctx.db.patch(stateRecord._id, {
        winnerSlot: patch.winnerSlot,
        finishReason: patch.finishReason,
        drawOfferedBy: patch.drawOfferedBy,
        drawOfferedAtMoveIndex: patch.drawOfferedAtMoveIndex,
        updatedAt: patch.updatedAt,
      })
    }

    await ctx.db.patch(guest._id, {
      guestTokenHash: undefined,
      displayName: 'Deleted guest',
      state: 'erased',
      erasedAt: timestamp,
      retentionExpiresAt: timestamp,
    })
    const liveStatus = await getGuestLiveStatus(ctx.db, guest._id)
    if (liveStatus) {
      await ctx.db.delete(liveStatus._id)
    }

    return { ok: true }
  },
})

export const cleanupExpiredData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const timestamp = now()
    let deletedQueueEntries = 0
    let deletedWaitingRooms = 0
    let deletedFinishedGames = 0
    let deletedGuests = 0

    const queueEntries = await ctx.db.query('matchmakingQueue').withIndex('by_queuedAt').collect()
    for (const entry of queueEntries) {
      if (timestamp - entry.queuedAt < MATCHMAKING_RETENTION_MS) {
        continue
      }

      await ctx.db.delete(entry._id)
      deletedQueueEntries += 1
    }

    const waitingGames = await ctx.db
      .query('games')
      .withIndex('by_status', (query) => query.eq('status', 'waiting'))
      .collect()
    for (const game of waitingGames) {
      if (game.mode !== 'private') {
        continue
      }
      if (timestamp - game.updatedAt < WAITING_PRIVATE_ROOM_RETENTION_MS) {
        continue
      }

      const participants = await listParticipants(ctx.db, game._id)
      if (participants.length !== 1) {
        continue
      }
      if (!canDeletePrivateRoom(game, participants, game.createdByGuestId)) {
        continue
      }

      await deleteGameCascade(ctx, game._id)
      deletedWaitingRooms += 1
    }

    const finishedGames = await ctx.db
      .query('games')
      .withIndex('by_status', (query) => query.eq('status', 'finished'))
      .collect()
    for (const game of finishedGames) {
      if (!game.finishedAt || timestamp - game.finishedAt < FINISHED_GAME_RETENTION_MS) {
        continue
      }

      await deleteGameCascade(ctx, game._id)
      deletedFinishedGames += 1
    }

    const guests = await ctx.db.query('guests').collect()
    for (const guest of guests) {
      if (guest.retentionExpiresAt > timestamp) {
        continue
      }

      const queue = await getQueueEntry(ctx.db, guest._id)
      if (queue) {
        continue
      }

      const participants = await listGuestParticipants(ctx.db, guest._id)
      if (participants.length > 0) {
        continue
      }

      await ctx.db.delete(guest._id)
      const liveStatus = await getGuestLiveStatus(ctx.db, guest._id)
      if (liveStatus) {
        await ctx.db.delete(liveStatus._id)
      }
      deletedGuests += 1
    }

    return {
      deletedQueueEntries,
      deletedWaitingRooms,
      deletedFinishedGames,
      deletedGuests,
    }
  },
})

async function deleteGameCascade(
  ctx: MutationCtx,
  gameId: Id<'games'>,
) {
  const game = await ctx.db.get(gameId)
  if (!game) {
    return
  }

  const participants = await listParticipants(ctx.db, game._id)
  const moves = await ctx.db
    .query('gameMoves')
    .withIndex('by_gameId_moveIndex', (query) => query.eq('gameId', game._id))
    .collect()

  for (const participant of participants) {
    await ctx.db.delete(participant._id)
  }

  for (const move of moves) {
    await ctx.db.delete(move._id)
  }
  const gameState = await ctx.db
    .query('gameStates')
    .withIndex('by_gameId', (query) => query.eq('gameId', game._id))
    .unique()
  if (gameState) {
    await ctx.db.delete(gameState._id)
  }

  await ctx.db.delete(game._id)
  const guests = await Promise.all(
    Array.from(new Set(participants.map((participant) => participant.guestId))).map(
      (guestId) => ctx.db.get(guestId),
    ),
  )
  for (const guestDoc of guests) {
    if (guestDoc) {
      await refreshGuestLiveStatus(ctx.db, guestDoc)
    }
  }
}
