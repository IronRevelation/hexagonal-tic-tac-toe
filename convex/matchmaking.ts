import { v } from 'convex/values'
import { mutation } from './_generated/server'
import {
  assertCanJoinAsPlayer,
  chooseOpeningOrder,
  createStoredInitialState,
  findAvailableMatchmakingOpponent,
  findActivePlayerGameParticipant,
  getGuestByToken,
  getQueueEntry,
  isPlayerParticipant,
  now,
  refreshDisconnectForfeit,
  refreshGuestLiveStatus,
  requireGuest,
} from './lib'
import type { MatchmakingStatus } from '../shared/contracts'

export const join = mutation({
  args: {
    guestToken: v.string(),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    const existingPlayerGame = await findActivePlayerGameParticipant(ctx.db, guest._id)
    const existingQueueEntry = await getQueueEntry(ctx.db, guest._id)

    if (existingPlayerGame) {
      if (existingQueueEntry) {
        await ctx.db.delete(existingQueueEntry._id)
      }
      await refreshGuestLiveStatus(ctx.db, guest)

      return {
        state: 'matched',
        gameId: existingPlayerGame.game._id,
      } satisfies MatchmakingStatus
    }

    await assertCanJoinAsPlayer(ctx.db, guest._id)
    const availableOpponent = await findAvailableMatchmakingOpponent(
      ctx.db,
      guest._id,
      async (entry) => {
        await ctx.db.delete(entry._id)
      },
    )

    if (!availableOpponent) {
      if (existingQueueEntry) {
        await refreshGuestLiveStatus(ctx.db, guest)
        return {
          state: 'queued',
          queuedAt: existingQueueEntry.queuedAt,
        } satisfies MatchmakingStatus
      }

      const queuedAt = now()
      await ctx.db.insert('matchmakingQueue', {
        guestId: guest._id,
        queuedAt,
      })
      await refreshGuestLiveStatus(ctx.db, guest)

      return {
        state: 'queued',
        queuedAt,
      } satisfies MatchmakingStatus
    }

    if (existingQueueEntry) {
      await ctx.db.delete(existingQueueEntry._id)
    }
    await ctx.db.delete(availableOpponent._id)

    const openingOrder = chooseOpeningOrder(
      availableOpponent.guestId,
      guest._id,
      `${availableOpponent._id}:${guest._id}`,
    )
    const timestamp = now()
    const gameId = await ctx.db.insert('games', {
      mode: 'matchmaking',
      status: 'active',
      timeControl: 'unlimited',
      createdByGuestId: availableOpponent.guestId,
      playerOneGuestId: openingOrder.playerOneGuestId,
      playerTwoGuestId: openingOrder.playerTwoGuestId,
      startedAt: timestamp,
      updatedAt: timestamp,
      rematchRequestedByPlayerOne: false,
      rematchRequestedByPlayerTwo: false,
    })
    await ctx.db.insert('gameStates', {
      gameId,
      turnCommitMode: 'confirmTurn',
      serializedState: createStoredInitialState(),
      updatedAt: timestamp,
      nextDrawOfferMoveIndexPlayerOne: 0,
      nextDrawOfferMoveIndexPlayerTwo: 0,
    })

    await ctx.db.patch(gameId, {
      seriesId: gameId,
    })

    const playerOneParticipantId = await ctx.db.insert('gameParticipants', {
      gameId,
      guestId: openingOrder.playerOneGuestId,
      role: 'playerOne',
      joinedAt: timestamp,
      lastSeenAt: timestamp,
    })
    const playerTwoParticipantId = await ctx.db.insert('gameParticipants', {
      gameId,
      guestId: openingOrder.playerTwoGuestId,
      role: 'playerTwo',
      joinedAt: timestamp,
      lastSeenAt: timestamp,
    })
    const playerOneParticipant = await ctx.db.get(playerOneParticipantId)
    const playerTwoParticipant = await ctx.db.get(playerTwoParticipantId)

    if (!playerOneParticipant || !isPlayerParticipant(playerOneParticipant) || !playerTwoParticipant || !isPlayerParticipant(playerTwoParticipant)) {
      throw new Error('Matchmaking participants were not created correctly.')
    }

    await refreshDisconnectForfeit(ctx, gameId)
    const [playerOneGuest, playerTwoGuest] = await Promise.all([
      ctx.db.get(openingOrder.playerOneGuestId),
      ctx.db.get(openingOrder.playerTwoGuestId),
    ])
    if (playerOneGuest) {
      await refreshGuestLiveStatus(ctx.db, playerOneGuest)
    }
    if (playerTwoGuest) {
      await refreshGuestLiveStatus(ctx.db, playerTwoGuest)
    }

    return {
      state: 'matched',
      gameId,
    } satisfies MatchmakingStatus
  },
})

export const cancel = mutation({
  args: {
    guestToken: v.string(),
  },
  handler: async (ctx, args) => {
    const guest = await getGuestByToken(ctx.db, args.guestToken)
    if (!guest) {
      return { ok: true }
    }

    const queueEntry = await getQueueEntry(ctx.db, guest._id)
    if (queueEntry) {
      await ctx.db.delete(queueEntry._id)
    }
    await refreshGuestLiveStatus(ctx.db, guest)

    return { ok: true }
  },
})
