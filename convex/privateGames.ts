import { v } from 'convex/values'
import { mutation } from './_generated/server'
import {
  assertCanJoinAsPlayer,
  createStoredInitialState,
  createUniqueRoomCode,
  ensureGuest,
  getParticipant,
  listParticipants,
  now,
  throwGameError,
} from './lib'
import type { RoomJoinResult } from '../shared/contracts'

export const create = mutation({
  args: {
    guestToken: v.string(),
  },
  handler: async (ctx, args) => {
    const guest = await ensureGuest(ctx, args.guestToken)
    await assertCanJoinAsPlayer(ctx.db, guest._id)

    const timestamp = now()
    const gameId = await ctx.db.insert('games', {
      mode: 'private',
      status: 'waiting',
      createdByGuestId: guest._id,
      playerOneGuestId: guest._id,
      serializedState: createStoredInitialState(),
      updatedAt: timestamp,
      rematchRequestedByPlayerOne: false,
      rematchRequestedByPlayerTwo: false,
    })
    const roomCode = await createUniqueRoomCode(ctx.db, String(gameId))

    await ctx.db.patch(gameId, {
      roomCode,
      seriesId: gameId,
    })

    await ctx.db.insert('gameParticipants', {
      gameId,
      guestId: guest._id,
      role: 'playerOne',
      joinedAt: timestamp,
      lastSeenAt: timestamp,
    })

    return {
      gameId,
      role: 'playerOne',
    } satisfies RoomJoinResult
  },
})

export const join = mutation({
  args: {
    guestToken: v.string(),
    roomCode: v.string(),
  },
  handler: async (ctx, args) => {
    const guest = await ensureGuest(ctx, args.guestToken)
    const roomCode = args.roomCode.trim().toUpperCase()
    const game = await ctx.db
      .query('games')
      .withIndex('by_roomCode', (query) => query.eq('roomCode', roomCode))
      .unique()

    if (!game || game.mode !== 'private') {
      throwGameError('GAME_NOT_FOUND', 'Private room not found.')
    }

    const existingParticipant = await getParticipant(ctx.db, game._id, guest._id)
    if (existingParticipant) {
      return {
        gameId: game._id,
        role: existingParticipant.role,
      } satisfies RoomJoinResult
    }

    if (game.status === 'finished') {
      throwGameError(
        'GAME_FINISHED',
        'This room already finished and is not accepting new spectators.',
      )
    }

    const participants = await listParticipants(ctx.db, game._id)
    const playerParticipants = participants.filter(
      (participant) =>
        participant.role === 'playerOne' || participant.role === 'playerTwo',
    )
    const timestamp = now()

    if (playerParticipants.length < 2) {
      await assertCanJoinAsPlayer(ctx.db, guest._id, game._id)
      const creator = playerParticipants[0]
      if (!creator) {
        throw new Error('Private room is missing its creator participant.')
      }

      const creatorStaysPlayerOne =
        (String(game._id).charCodeAt(0) + String(guest._id).charCodeAt(0)) % 2 === 0

      if (creatorStaysPlayerOne) {
        await ctx.db.insert('gameParticipants', {
          gameId: game._id,
          guestId: guest._id,
          role: 'playerTwo',
          joinedAt: timestamp,
          lastSeenAt: timestamp,
        })
        await ctx.db.patch(game._id, {
          status: 'active',
          playerOneGuestId: creator.guestId,
          playerTwoGuestId: guest._id,
          startedAt: timestamp,
          updatedAt: timestamp,
        })

        return {
          gameId: game._id,
          role: 'playerTwo',
        } satisfies RoomJoinResult
      }

      await ctx.db.patch(creator._id, {
        role: 'playerTwo',
        lastSeenAt: timestamp,
      })
      await ctx.db.insert('gameParticipants', {
        gameId: game._id,
        guestId: guest._id,
        role: 'playerOne',
        joinedAt: timestamp,
        lastSeenAt: timestamp,
      })
      await ctx.db.patch(game._id, {
        status: 'active',
        playerOneGuestId: guest._id,
        playerTwoGuestId: creator.guestId,
        startedAt: timestamp,
        updatedAt: timestamp,
      })

      return {
        gameId: game._id,
        role: 'playerOne',
      } satisfies RoomJoinResult
    }

    await ctx.db.insert('gameParticipants', {
      gameId: game._id,
      guestId: guest._id,
      role: 'spectator',
      joinedAt: timestamp,
      lastSeenAt: timestamp,
    })

    return {
      gameId: game._id,
      role: 'spectator',
    } satisfies RoomJoinResult
  },
})
