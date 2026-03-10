import { ConvexError, v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { mutation, type MutationCtx } from './_generated/server'
import {
  assertCanJoinAsPlayer,
  canCreatePrivateRoom,
  canDeletePrivateRoom,
  chooseOpeningOrder,
  createStoredInitialState,
  createUniqueRoomCode,
  getQueueEntry,
  getParticipant,
  isPlayerParticipant,
  listParticipants,
  now,
  refreshDisconnectForfeit,
  refreshGuestLiveStatus,
  requireGuest,
  throwGameError,
  type GuestDoc,
  type ParticipantDoc,
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
      createdByGuestId: guest._id,
      playerOneGuestId: guest._id,
      updatedAt: timestamp,
      rematchRequestedByPlayerOne: false,
      rematchRequestedByPlayerTwo: false,
    })
    await ctx.db.insert('gameStates', {
      gameId,
      turnCommitMode: args.turnCommitMode,
      serializedState: createStoredInitialState(),
      playerOneTimeRemainingMs: initialClockMs ?? undefined,
      playerTwoTimeRemainingMs: initialClockMs ?? undefined,
      updatedAt: timestamp,
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
    await refreshGuestLiveStatus(ctx.db, guest)

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
    return joinPrivateGame(ctx, guest, args.roomCode)
  },
})

export const start = mutation({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    return startPrivateGame(ctx, guest, args.gameId)
  },
})

export const swapOpponent = mutation({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
    spectatorGuestId: v.id('guests'),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    return swapPrivateGameOpponent(ctx, guest, args.gameId, args.spectatorGuestId)
  },
})

export const leaveLobby = mutation({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    return leavePrivateGameLobby(ctx, guest, args.gameId)
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
    const gameState = await ctx.db
      .query('gameStates')
      .withIndex('by_gameId', (query) => query.eq('gameId', game._id))
      .unique()
    if (gameState) {
      await ctx.db.delete(gameState._id)
    }

    await ctx.db.delete(game._id)
    await refreshGuestLiveStatus(ctx.db, guest)

    return { ok: true }
  },
})

export async function joinPrivateGame(
  ctx: Pick<MutationCtx, 'db'>,
  guest: GuestDoc,
  roomCodeValue: string,
) {
  const roomCode = roomCodeValue.trim().toUpperCase()
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
  const playerParticipants = listPlayerParticipants(participants)
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

    await ctx.db.insert('gameParticipants', {
      gameId: game._id,
      guestId: guest._id,
      role: 'playerTwo',
      joinedAt: timestamp,
      lastSeenAt: timestamp,
    })

    await ctx.db.patch(game._id, {
      updatedAt: timestamp,
    })
    await refreshGuestLiveStatus(ctx.db, guest)

    return {
      gameId: game._id,
      role: 'playerTwo',
    } satisfies RoomJoinResult
  }

  await ctx.db.insert('gameParticipants', {
    gameId: game._id,
    guestId: guest._id,
    role: 'spectator',
    joinedAt: timestamp,
    lastSeenAt: timestamp,
  })

  await ctx.db.patch(game._id, {
    updatedAt: timestamp,
  })
  await refreshGuestLiveStatus(ctx.db, guest)

  return {
    gameId: game._id,
    role: 'spectator',
  } satisfies RoomJoinResult
}

export async function startPrivateGame(
  ctx: MutationCtx,
  guest: GuestDoc,
  gameId: Id<'games'>,
) {
  const game = await ctx.db.get(gameId)

  if (!game || game.mode !== 'private') {
    throwGameError('GAME_NOT_FOUND', 'Private room not found.')
  }

  if (game.status !== 'waiting' || game.createdByGuestId !== guest._id) {
    throwGameError(
      'PRIVATE_ROOM_START_NOT_ALLOWED',
      'Only the private room creator can start this game before it begins.',
    )
  }

  const participants = await listParticipants(ctx.db, game._id)
  const creatorParticipant = participants.find(
    (participant) => participant.guestId === game.createdByGuestId,
  )
  const opponentParticipant =
    participants.find((participant) => participant.role === 'playerTwo') ?? null

  if (!creatorParticipant || creatorParticipant.role !== 'playerOne') {
    throw new Error('Private room is missing its creator player.')
  }

  if (!opponentParticipant) {
    throwGameError(
      'PRIVATE_ROOM_OPPONENT_REQUIRED',
      'A private room needs an opponent before the creator can start the game.',
    )
  }

  const timestamp = now()
  const openingOrder = chooseOpeningOrder(
    game.createdByGuestId,
    opponentParticipant.guestId,
    String(game._id),
  )
  const creatorRole =
    openingOrder.playerOneGuestId === creatorParticipant.guestId
      ? 'playerOne'
      : 'playerTwo'
  const opponentRole = creatorRole === 'playerOne' ? 'playerTwo' : 'playerOne'

  await ctx.db.patch(creatorParticipant._id, {
    role: creatorRole,
    lastSeenAt: timestamp,
  })
  await ctx.db.patch(opponentParticipant._id, {
    role: opponentRole,
    lastSeenAt: timestamp,
  })

  const playerParticipants = await Promise.all([
    ctx.db.get(creatorParticipant._id),
    ctx.db.get(opponentParticipant._id),
  ])

  if (!playerParticipants.every(isPlayerParticipant)) {
    throw new Error('Private game participants were not created correctly.')
  }

  await ctx.db.patch(game._id, {
    status: 'active',
    playerOneGuestId: openingOrder.playerOneGuestId,
    playerTwoGuestId: openingOrder.playerTwoGuestId,
    startedAt: timestamp,
    updatedAt: timestamp,
  })

  await refreshDisconnectForfeit(ctx, game._id)
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

  return { ok: true }
}

export async function swapPrivateGameOpponent(
  ctx: Pick<MutationCtx, 'db'>,
  guest: GuestDoc,
  gameId: Id<'games'>,
  spectatorGuestId: Id<'guests'>,
) {
  const game = await ctx.db.get(gameId)

  if (!game || game.mode !== 'private') {
    throwGameError('GAME_NOT_FOUND', 'Private room not found.')
  }

  if (game.status !== 'waiting' || game.createdByGuestId !== guest._id) {
    throwGameError(
      'PRIVATE_ROOM_SWAP_NOT_ALLOWED',
      'Only the private room creator can change the opponent before the game starts.',
    )
  }

  const participants = await listParticipants(ctx.db, game._id)
  const currentOpponent =
    participants.find((participant) => participant.role === 'playerTwo') ?? null
  const spectator = participants.find(
    (participant) =>
      participant.guestId === spectatorGuestId && participant.role === 'spectator',
  )

  if (!currentOpponent || !spectator) {
    throwGameError(
      'PRIVATE_ROOM_SWAP_NOT_ALLOWED',
      'Choose a spectator to replace the current opponent before the game starts.',
    )
  }

  await assertCanJoinAsPlayer(ctx.db, spectatorGuestId, game._id)
  const queueEntry = await getQueueEntry(ctx.db, spectatorGuestId)
  if (queueEntry) {
    await ctx.db.delete(queueEntry._id)
  }

  const timestamp = now()

  await ctx.db.patch(currentOpponent._id, {
    role: 'spectator',
    lastSeenAt: timestamp,
  })
  await ctx.db.patch(spectator._id, {
    role: 'playerTwo',
    lastSeenAt: timestamp,
  })
  await ctx.db.patch(game._id, {
    updatedAt: timestamp,
  })
  const [currentOpponentGuest, spectatorGuest] = await Promise.all([
    ctx.db.get(currentOpponent.guestId),
    ctx.db.get(spectator.guestId),
  ])
  await refreshGuestLiveStatus(ctx.db, guest)
  if (currentOpponentGuest) {
    await refreshGuestLiveStatus(ctx.db, currentOpponentGuest)
  }
  if (spectatorGuest) {
    await refreshGuestLiveStatus(ctx.db, spectatorGuest)
  }

  return { ok: true }
}

export async function leavePrivateGameLobby(
  ctx: Pick<MutationCtx, 'db'>,
  guest: GuestDoc,
  gameId: Id<'games'>,
) {
  const game = await ctx.db.get(gameId)

  if (!game || game.mode !== 'private') {
    throwGameError('GAME_NOT_FOUND', 'Private room not found.')
  }

  const participants = await listParticipants(ctx.db, game._id)
  const participant = await getParticipant(ctx.db, game._id, guest._id)

  if (
    game.status !== 'waiting' ||
    !participant ||
    participant.role === 'playerOne' ||
    game.createdByGuestId === guest._id
  ) {
    throwGameError(
      'PRIVATE_ROOM_LEAVE_NOT_ALLOWED',
      'Only the waiting-room opponent or a spectator can leave this private room.',
    )
  }

  const replacementOpponent =
    participant.role === 'playerTwo'
      ? await findReplacementOpponent(ctx.db, participants, game._id)
      : null
  const timestamp = now()

  await ctx.db.delete(participant._id)
  if (replacementOpponent) {
    await ctx.db.patch(replacementOpponent._id, {
      role: 'playerTwo',
      lastSeenAt: timestamp,
    })
  }
  await ctx.db.patch(game._id, {
    updatedAt: timestamp,
  })
  await refreshGuestLiveStatus(ctx.db, guest)
  if (replacementOpponent) {
    const replacementGuest = await ctx.db.get(replacementOpponent.guestId)
    if (replacementGuest) {
      await refreshGuestLiveStatus(ctx.db, replacementGuest)
    }
  }

  return { ok: true }
}

function listPlayerParticipants(participants: ParticipantDoc[]) {
  return participants.filter(
    (participant) =>
      participant.role === 'playerOne' || participant.role === 'playerTwo',
  )
}

async function findReplacementOpponent(
  db: Pick<MutationCtx, 'db'>['db'],
  participants: ParticipantDoc[],
  gameId: Id<'games'>,
) {
  const spectators = participants
    .filter((participant) => participant.role === 'spectator')
    .sort((left, right) => left.joinedAt - right.joinedAt)

  for (const spectator of spectators) {
    try {
      await assertCanJoinAsPlayer(db, spectator.guestId, gameId)
      return spectator
    } catch (cause) {
      if (
        cause instanceof ConvexError &&
        cause.data &&
        typeof cause.data === 'object' &&
        'code' in cause.data &&
        cause.data.code === 'ALREADY_IN_GAME'
      ) {
        continue
      }

      throw cause
    }
  }

  return null
}
