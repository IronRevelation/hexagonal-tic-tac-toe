import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import {
  clearLegacyGameStateFields,
  ensureGameStateRecord,
  getGameState,
  getGuestLiveStatus,
  getLegacyGameStateFields,
  refreshGuestLiveStatus,
} from './lib'

const DEFAULT_BATCH_LIMIT = 100

export const gameStateRolloutStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const games = await ctx.db.query('games').collect()
    let withGameState = 0
    let withLegacyState = 0
    let readyForLegacyCleanup = 0

    for (const game of games) {
      const stateRow = await getGameState(ctx.db, game._id)
      if (stateRow) {
        withGameState += 1
      }

      const hasLegacyState =
        game.serializedState !== undefined ||
        game.turnCommitMode !== undefined ||
        game.playerOneTimeRemainingMs !== undefined ||
        game.playerTwoTimeRemainingMs !== undefined ||
        game.turnStartedAt !== undefined ||
        game.clockTimeoutGeneration !== undefined ||
        game.clockTimeoutJobId !== undefined ||
        game.winnerSlot !== undefined ||
        game.finishReason !== undefined ||
        game.drawOfferedBy !== undefined ||
        game.drawOfferedAtMoveIndex !== undefined ||
        game.nextDrawOfferMoveIndexPlayerOne !== undefined ||
        game.nextDrawOfferMoveIndexPlayerTwo !== undefined

      if (hasLegacyState) {
        withLegacyState += 1
      }

      if (stateRow && hasLegacyState) {
        readyForLegacyCleanup += 1
      }
    }

    const guests = await ctx.db.query('guests').collect()
    let guestsWithLiveStatus = 0
    for (const guest of guests) {
      if (await getGuestLiveStatus(ctx.db, guest._id)) {
        guestsWithLiveStatus += 1
      }
    }

    return {
      totalGames: games.length,
      withGameState,
      withLegacyState,
      readyForLegacyCleanup,
      totalGuests: guests.length,
      guestsWithLiveStatus,
    }
  },
})

export const backfillGameStatesBatch = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const games = await ctx.db.query('games').collect()
    const limit = Math.max(1, args.limit ?? DEFAULT_BATCH_LIMIT)
    let inserted = 0
    let repaired = 0

    for (const game of games) {
      if (inserted + repaired >= limit) {
        break
      }

      const existing = await getGameState(ctx.db, game._id)
      if (!existing) {
        if (!game.serializedState) {
          continue
        }

        await ensureGameStateRecord(ctx.db, game)
        inserted += 1
        continue
      }

      const legacy = getLegacyGameStateFields(game)
      const repairPatch: Record<string, unknown> = {}

      if (!(existing as { serializedState?: unknown }).serializedState && legacy?.serializedState) {
        repairPatch.serializedState = legacy.serializedState
      }
      if (!(existing as { turnCommitMode?: 'instant' | 'confirmTurn' }).turnCommitMode) {
        repairPatch.turnCommitMode = legacy?.turnCommitMode ?? 'instant'
      }
      if ((existing as { updatedAt?: number }).updatedAt === undefined) {
        repairPatch.updatedAt = legacy?.updatedAt ?? game.updatedAt
      }

      if (Object.keys(repairPatch).length === 0) {
        continue
      }

      await ctx.db.patch(existing._id, repairPatch)
      repaired += 1
    }

    return {
      inserted,
      repaired,
      processed: inserted + repaired,
    }
  },
})

export const backfillGuestLiveStatusBatch = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const guests = await ctx.db.query('guests').collect()
    const limit = Math.max(1, args.limit ?? DEFAULT_BATCH_LIMIT)
    let updated = 0

    for (const guest of guests) {
      if (updated >= limit) {
        break
      }

      await refreshGuestLiveStatus(ctx.db, guest)
      updated += 1
    }

    return {
      updated,
    }
  },
})

export const clearLegacyGameStateFieldsBatch = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const games = await ctx.db.query('games').collect()
    const limit = Math.max(1, args.limit ?? DEFAULT_BATCH_LIMIT)
    let cleared = 0

    for (const game of games) {
      if (cleared >= limit) {
        break
      }

      const stateRow = await getGameState(ctx.db, game._id)
      if (!stateRow) {
        continue
      }

      const hasLegacyState =
        game.serializedState !== undefined ||
        game.turnCommitMode !== undefined ||
        game.playerOneTimeRemainingMs !== undefined ||
        game.playerTwoTimeRemainingMs !== undefined ||
        game.turnStartedAt !== undefined ||
        game.clockTimeoutGeneration !== undefined ||
        game.clockTimeoutJobId !== undefined ||
        game.winnerSlot !== undefined ||
        game.finishReason !== undefined ||
        game.drawOfferedBy !== undefined ||
        game.drawOfferedAtMoveIndex !== undefined ||
        game.nextDrawOfferMoveIndexPlayerOne !== undefined ||
        game.nextDrawOfferMoveIndexPlayerTwo !== undefined

      if (!hasLegacyState) {
        continue
      }

      await ctx.db.patch(game._id, clearLegacyGameStateFields())
      cleared += 1
    }

    return {
      cleared,
    }
  },
})
