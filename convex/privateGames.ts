import { v } from 'convex/values'
import { mutation } from './_generated/server'
import {
  assertCanJoinAsPlayer,
  canCreatePrivateRoom,
  canDeletePrivateRoom,
  createStoredInitialState,
  createUniqueRoomCode,
  getQueueEntry,
  getParticipant,
  isPlayerParticipant,
  listParticipants,
  now,
  refreshDisconnectForfeit,
  requireGuest,
  throwGameError,
} from './lib'
import type { RoomJoinResult } from '../shared/contracts'
import { getInitialClockMs } from '../shared/timeControl'

export const create = mutation({
  args: {
    guestToken: v.string(),
    timeControl: v.union(
      v.literal('unlimited'),
      v.literal('1m'),
      v.literal('3m'),
      v.literal('5m'),
      v.literal('10m'),
    ),
    turnCommitMode: v.union(v.literal('instant'), v.literal('confirmTurn')),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    await assertCanJoinAsPlayer(ctx.db, guest._id)
    const queueEntry = await getQueueEntry(ctx.db, guest._id)

    if (!canCreatePrivateRoom(Boolean(queueEntry))) {
      throwGameError(
        'MATCHMAKING_ACTIVE',
        'Cancel matchmaking before creating a private room.',
      )
    }

    const timestamp = now()
    const initialClockMs = getInitialClockMs(args.timeControl)
    const gameId = await ctx.db.insert('games', {
      mode: 'private',
      status: 'waiting',
      timeControl: args.timeControl,
      turnCommitMode: args.turnCommitMode,
      createdByGuestId: guest._id,
      playerOneGuestId: guest._id,
      playerOneTimeRemainingMs: initialClockMs ?? undefined,
      playerTwoTimeRemainingMs: initialClockMs ?? undefined,
      serializedState: createStoredInitialState(),
      updatedAt: timestamp,
      rematchRequestedByPlayerOne: false,
      rematchRequestedByPlayerTwo: false,
      nextDrawOfferMoveIndexPlayerOne: 0,
      nextDrawOfferMoveIndexPlayerTwo: 0,
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
    const guest = await requireGuest(ctx.db, args.guestToken)
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
      const queueEntry = await getQueueEntry(ctx.db, guest._id)
      if (queueEntry) {
        await ctx.db.delete(queueEntry._id)
      }

      const creator = playerParticipants[0]
      if (!creator) {
        throw new Error('Private room is missing its creator participant.')
      }

      const creatorStaysPlayerOne =
        (String(game._id).charCodeAt(0) + String(guest._id).charCodeAt(0)) % 2 === 0

      if (creatorStaysPlayerOne) {
        const playerTwoParticipantId = await ctx.db.insert('gameParticipants', {
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
        const playerOneParticipant = await ctx.db.get(creator._id)
        const playerTwoParticipant = await ctx.db.get(playerTwoParticipantId)

        if (!playerOneParticipant || !isPlayerParticipant(playerOneParticipant) || !playerTwoParticipant || !isPlayerParticipant(playerTwoParticipant)) {
          throw new Error('Private game participants were not created correctly.')
        }

        await refreshDisconnectForfeit(ctx, game._id)

        return {
          gameId: game._id,
          role: 'playerTwo',
        } satisfies RoomJoinResult
      }

      await ctx.db.patch(creator._id, {
        role: 'playerTwo',
        lastSeenAt: timestamp,
      })
      const playerOneParticipantId = await ctx.db.insert('gameParticipants', {
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
      const playerOneParticipant = await ctx.db.get(playerOneParticipantId)
      const playerTwoParticipant = await ctx.db.get(creator._id)

      if (!playerOneParticipant || !isPlayerParticipant(playerOneParticipant) || !playerTwoParticipant || !isPlayerParticipant(playerTwoParticipant)) {
        throw new Error('Private game participants were not created correctly.')
      }

      await refreshDisconnectForfeit(ctx, game._id)

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

export const remove = mutation({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    const game = await ctx.db.get(args.gameId)

    if (!game) {
      throwGameError('GAME_NOT_FOUND', 'Private room not found.')
    }

    const participants = await listParticipants(ctx.db, game._id)

    if (!canDeletePrivateRoom(game, participants, guest._id)) {
      throwGameError(
        'ROOM_DELETE_NOT_ALLOWED',
        'This private room can only be deleted by its creator before anyone joins it.',
      )
    }

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

    await ctx.db.delete(game._id)

    return { ok: true }
  },
})
