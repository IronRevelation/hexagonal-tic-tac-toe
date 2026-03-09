import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import {
  DISCONNECT_FORFEIT_MS,
  DISCONNECT_VERIFIER_MS,
  PRESENCE_STALE_AWAY_MS,
  getPresenceAwaySince,
} from '../shared/presence'
import { readPresenceRecord } from '../shared/upstashPresence'
import {
  buildForfeitGamePatch,
  buildResolvedClockPatch,
  isPlayerParticipant,
  loadGameState,
  normalizeGameTimeControl,
  now,
  refreshClockTimeout,
  requirePlayerRole,
  resolveTimedGameClock,
} from './lib'

function requireUpstashConfig() {
  const redisRestUrl = process.env.UPSTASH_REDIS_REST_URL
  const redisRestToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!redisRestUrl || !redisRestToken) {
    throw new Error('Missing Upstash presence configuration.')
  }

  return {
    redisRestUrl,
    redisRestToken,
  }
}

export const getActivePresenceTarget = internalQuery({
  args: {
    gameId: v.id('games'),
  },
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId)
    if (!game || game.status !== 'active') {
      return null
    }

    const state = loadGameState(game)
    const participants = await ctx.db
      .query('gameParticipants')
      .withIndex('by_gameId', (query) => query.eq('gameId', game._id))
      .collect()
    const participant =
      participants.find(
        (entry) =>
          isPlayerParticipant(entry) &&
          requirePlayerRole(entry.role) === state.currentPlayer,
      ) ?? null

    if (!participant || !isPlayerParticipant(participant)) {
      return null
    }

    return {
      gameId: game._id,
      participantId: participant._id,
      participantRole: participant.role,
      generation: participant.disconnectForfeitGeneration ?? 0,
      currentPlayer: state.currentPlayer,
    }
  },
})

export const storeDisconnectVerifier = internalMutation({
  args: {
    participantId: v.id('gameParticipants'),
    expectedGeneration: v.number(),
    nextGeneration: v.number(),
    disconnectForfeitJobId: v.id('_scheduled_functions'),
    disconnectDeadlineAt: v.number(),
  },
  handler: async (ctx, args) => {
    const participant = await ctx.db.get(args.participantId)
    if (!participant || !isPlayerParticipant(participant)) {
      try {
        await ctx.scheduler.cancel(args.disconnectForfeitJobId)
      } catch {
        // The scheduled function may already be gone.
      }
      return { ok: false }
    }

    if ((participant.disconnectForfeitGeneration ?? 0) !== args.expectedGeneration) {
      try {
        await ctx.scheduler.cancel(args.disconnectForfeitJobId)
      } catch {
        // The scheduled function may already be gone.
      }
      return { ok: false }
    }

    await ctx.db.patch(participant._id, {
      disconnectDeadlineAt: args.disconnectDeadlineAt,
      disconnectForfeitGeneration: args.nextGeneration,
      disconnectForfeitJobId: args.disconnectForfeitJobId,
    })

    return { ok: true }
  },
})

export const clearDisconnectVerifier = internalMutation({
  args: {
    participantId: v.id('gameParticipants'),
    expectedGeneration: v.number(),
  },
  handler: async (ctx, args) => {
    const participant = await ctx.db.get(args.participantId)
    if (!participant || !isPlayerParticipant(participant)) {
      return { ok: false }
    }

    if ((participant.disconnectForfeitGeneration ?? 0) !== args.expectedGeneration) {
      return { ok: false }
    }

    await ctx.db.patch(participant._id, {
      disconnectDeadlineAt: undefined,
      disconnectForfeitGeneration: args.expectedGeneration + 1,
      disconnectForfeitJobId: undefined,
    })

    return { ok: true }
  },
})

export const forfeitActivePlayerForPresenceLoss = internalMutation({
  args: {
    gameId: v.id('games'),
    participantId: v.id('gameParticipants'),
    expectedGeneration: v.number(),
  },
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId)
    if (!game || game.status !== 'active') {
      return { ok: false }
    }

    const participant = await ctx.db.get(args.participantId)
    if (!participant || participant.gameId !== game._id || !isPlayerParticipant(participant)) {
      return { ok: false }
    }

    if ((participant.disconnectForfeitGeneration ?? 0) !== args.expectedGeneration) {
      return { ok: false }
    }

    const timestamp = now()
    const state = loadGameState(game)
    const participantSlot = requirePlayerRole(participant.role)

    if (participantSlot !== state.currentPlayer) {
      return { ok: false }
    }

    const resolvedClock = resolveTimedGameClock(game, state.currentPlayer, timestamp)
    await ctx.db.patch(game._id, {
      ...buildForfeitGamePatch(participantSlot, timestamp),
      ...buildResolvedClockPatch(resolvedClock, null, timestamp),
    })
    await ctx.db.patch(participant._id, {
      disconnectDeadlineAt: undefined,
      disconnectForfeitGeneration: args.expectedGeneration + 1,
      disconnectForfeitJobId: undefined,
    })

    if (normalizeGameTimeControl(game) !== 'unlimited') {
      await refreshClockTimeout(ctx, game, null)
    }

    return { ok: true }
  },
})

export const verifyActivePlayerPresence = internalAction({
  args: {
    gameId: v.id('games'),
    generation: v.number(),
  },
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.presence.getActivePresenceTarget, {
      gameId: args.gameId,
    })

    if (!target || target.generation !== args.generation) {
      return { ok: true }
    }

    let record
    try {
      const config = requireUpstashConfig()
      record = await readPresenceRecord(
        config.redisRestUrl,
        config.redisRestToken,
        String(args.gameId),
        target.currentPlayer,
      )
    } catch {
      await ctx.runMutation(internal.presence.clearDisconnectVerifier, {
        participantId: target.participantId,
        expectedGeneration: target.generation,
      })
      return { ok: false, degraded: true as const }
    }

    const timestamp = now()
    const awaySince = getPresenceAwaySince(record, timestamp)

    if (awaySince !== null && timestamp - awaySince >= DISCONNECT_FORFEIT_MS) {
      await ctx.runMutation(internal.presence.forfeitActivePlayerForPresenceLoss, {
        gameId: args.gameId,
        participantId: target.participantId,
        expectedGeneration: target.generation,
      })
      return { ok: true }
    }

    const delayMs =
      awaySince === null
        ? DISCONNECT_VERIFIER_MS
        : Math.max(
            1,
            Math.min(
              DISCONNECT_VERIFIER_MS,
              awaySince + DISCONNECT_FORFEIT_MS - timestamp,
            ),
          )

    const disconnectForfeitJobId = await ctx.scheduler.runAfter(
      delayMs,
      internal.presence.verifyActivePlayerPresence,
      {
        gameId: args.gameId,
        generation: target.generation + 1,
      },
    )

    await ctx.runMutation(internal.presence.storeDisconnectVerifier, {
      participantId: target.participantId,
      expectedGeneration: target.generation,
      nextGeneration: target.generation + 1,
      disconnectForfeitJobId,
      disconnectDeadlineAt:
        awaySince === null
          ? timestamp + DISCONNECT_FORFEIT_MS
          : awaySince + DISCONNECT_FORFEIT_MS,
    })

    return {
      ok: true,
      staleFallbackAt: record?.lastSeenAt
        ? record.lastSeenAt + PRESENCE_STALE_AWAY_MS
        : null,
    }
  },
})
