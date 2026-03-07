import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import {
  buildGameSnapshot,
  createStoredInitialState,
  ensureGuest,
  fromStoredState,
  getGuestByToken,
  getParticipant,
  listParticipants,
  loadGameState,
  now,
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
    const guest = await ensureGuest(ctx, args.guestToken)
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
    if (state.board.has(coordKey(args.coord))) {
      throwGameError('CELL_OCCUPIED', 'That hexagon is already occupied.')
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
      status: nextState.winner ? 'finished' : 'active',
      finishedAt: nextState.winner ? timestamp : undefined,
      updatedAt: timestamp,
    })

    return {
      ok: true,
      winner: nextState.winner,
    }
  },
})

export const requestRematch = mutation({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
  },
  handler: async (ctx, args) => {
    const guest = await ensureGuest(ctx, args.guestToken)
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
    })

    await ctx.db.patch(game._id, {
      nextGameId,
      rematchRequestedByPlayerOne: true,
      rematchRequestedByPlayerTwo: true,
      updatedAt: timestamp,
    })

    await ctx.db.insert('gameParticipants', {
      gameId: nextGameId,
      guestId: game.playerTwoGuestId,
      role: 'playerOne',
      joinedAt: timestamp,
      lastSeenAt: timestamp,
    })
    await ctx.db.insert('gameParticipants', {
      gameId: nextGameId,
      guestId: game.playerOneGuestId,
      role: 'playerTwo',
      joinedAt: timestamp,
      lastSeenAt: timestamp,
    })

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
    const guest = await ensureGuest(ctx, args.guestToken)
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
