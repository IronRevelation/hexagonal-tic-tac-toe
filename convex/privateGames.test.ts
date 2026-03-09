import { ConvexError } from 'convex/values'
import { describe, expect, it } from 'vitest'
import { createStoredInitialState, chooseOpeningOrder } from './lib'
import {
  joinPrivateGame,
  leavePrivateGameLobby,
  startPrivateGame,
  swapPrivateGameOpponent,
} from './privateGames'

class FakeDb {
  private records = new Map<string, Record<string, unknown>>()

  constructor(seed: Array<{ table: string; doc: Record<string, unknown> }>) {
    for (const { doc } of seed) {
      this.records.set(String(doc._id), { ...doc })
    }
  }

  async get(id: string) {
    return this.records.get(String(id)) ?? null
  }

  async insert(table: string, value: Record<string, unknown>) {
    const id = `${table}_${this.records.size + 1}`
    this.records.set(id, { _id: id, ...value })
    return id
  }

  async patch(id: string, value: Record<string, unknown>) {
    const current = this.records.get(String(id))
    if (!current) {
      throw new Error(`Missing record ${id}`)
    }

    this.records.set(String(id), { ...current, ...value })
  }

  async delete(id: string) {
    this.records.delete(String(id))
  }

  query(table: string) {
    const matches = () =>
      Array.from(this.records.values()).filter((record) => String(record._id).startsWith(`${table}_`))

    return {
      withIndex: (
        index: string,
        builder: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => {
        const filters: Array<{ field: string; value: unknown }> = []
        const query = {
          eq(field: string, value: unknown) {
            filters.push({ field, value })
            return query
          },
        }
        builder(query)
        const filtered = matches().filter((record) =>
          filters.every(({ field, value }) => record[field] === value),
        )

        return {
          unique: async () => filtered[0] ?? null,
          collect: async () => filtered,
        }
      },
    }
  }

  findOne(table: string, predicate: (record: Record<string, unknown>) => boolean) {
    return Array.from(this.records.values()).find(
      (record) =>
        String(record._id).startsWith(`${table}_`) && predicate(record),
    ) ?? null
  }
}

function createGuest(id: string, displayName: string) {
  return {
    table: 'guests',
    doc: {
      _id: id,
      displayName,
      state: 'active',
    },
  }
}

function createWaitingPrivateGame(id: string, creatorGuestId: string, roomCode = 'ROOM42') {
  return {
    table: 'games',
    doc: {
      _id: id,
      mode: 'private',
      status: 'waiting',
      roomCode,
      createdByGuestId: creatorGuestId,
      playerOneGuestId: creatorGuestId,
      playerOneTimeRemainingMs: 180_000,
      playerTwoTimeRemainingMs: 180_000,
      serializedState: createStoredInitialState(),
      updatedAt: 1,
      rematchRequestedByPlayerOne: false,
      rematchRequestedByPlayerTwo: false,
      nextDrawOfferMoveIndexPlayerOne: 0,
      nextDrawOfferMoveIndexPlayerTwo: 0,
    },
  }
}

function createParticipant(
  id: string,
  gameId: string,
  guestId: string,
  role: 'playerOne' | 'playerTwo' | 'spectator',
  joinedAt: number,
) {
  return {
    table: 'gameParticipants',
    doc: {
      _id: id,
      gameId,
      guestId,
      role,
      joinedAt,
      lastSeenAt: joinedAt,
    },
  }
}

function createQueueEntry(id: string, guestId: string) {
  return {
    table: 'matchmakingQueue',
    doc: {
      _id: id,
      guestId,
      queuedAt: 1,
    },
  }
}

function createCtx(db: FakeDb) {
  return {
    db,
    scheduler: {
      runAfter: async () => 'job_1',
      cancel: async () => undefined,
    },
  } as never
}

describe('privateGames helpers', () => {
  it('keeps the first joiner as pending opponent and the room waiting', async () => {
    const db = new FakeDb([
      createGuest('guest_creator', 'Amber Crane 10'),
      createGuest('guest_opponent', 'River Otter 01'),
      createWaitingPrivateGame('games_1', 'guest_creator'),
      createParticipant('gameParticipants_1', 'games_1', 'guest_creator', 'playerOne', 1),
      createQueueEntry('matchmakingQueue_1', 'guest_opponent'),
    ])

    await expect(
      joinPrivateGame(createCtx(db), { _id: 'guest_opponent' } as never, 'room42'),
    ).resolves.toEqual({
      gameId: 'games_1',
      role: 'playerTwo',
    })

    await expect(db.get('games_1')).resolves.toMatchObject({
      status: 'waiting',
      playerOneGuestId: 'guest_creator',
    })
    await expect(db.get('matchmakingQueue_1')).resolves.toBeNull()
    expect(
      db.findOne(
        'gameParticipants',
        (participant) => participant.guestId === 'guest_opponent',
      ),
    ).toMatchObject({
      guestId: 'guest_opponent',
      role: 'playerTwo',
    })
  })

  it('adds later joiners as spectators', async () => {
    const db = new FakeDb([
      createGuest('guest_creator', 'Amber Crane 10'),
      createGuest('guest_opponent', 'River Otter 01'),
      createGuest('guest_spectator', 'Golden Falcon 22'),
      createWaitingPrivateGame('games_1', 'guest_creator'),
      createParticipant('gameParticipants_1', 'games_1', 'guest_creator', 'playerOne', 1),
      createParticipant('gameParticipants_2', 'games_1', 'guest_opponent', 'playerTwo', 2),
    ])

    await expect(
      joinPrivateGame(createCtx(db), { _id: 'guest_spectator' } as never, 'ROOM42'),
    ).resolves.toEqual({
      gameId: 'games_1',
      role: 'spectator',
    })

    expect(
      db.findOne(
        'gameParticipants',
        (participant) => participant.guestId === 'guest_spectator',
      ),
    ).toMatchObject({
      guestId: 'guest_spectator',
      role: 'spectator',
    })
  })

  it('allows only the creator to start and assigns player slots at start time', async () => {
    const db = new FakeDb([
      createGuest('guest_creator', 'Amber Crane 10'),
      createGuest('guest_opponent', 'River Otter 01'),
      createWaitingPrivateGame('games_1', 'guest_creator'),
      createParticipant('gameParticipants_1', 'games_1', 'guest_creator', 'playerOne', 1),
      createParticipant('gameParticipants_2', 'games_1', 'guest_opponent', 'playerTwo', 2),
    ])
    const ctx = createCtx(db)
    const openingOrder = chooseOpeningOrder(
      'guest_creator' as never,
      'guest_opponent' as never,
      'games_1',
    )

    await startPrivateGame(ctx, { _id: 'guest_creator' } as never, 'games_1' as never)

    await expect(db.get('games_1')).resolves.toMatchObject({
      status: 'active',
      playerOneGuestId: openingOrder.playerOneGuestId,
      playerTwoGuestId: openingOrder.playerTwoGuestId,
    })

    const creatorParticipant = await db.get('gameParticipants_1')
    const opponentParticipant = await db.get('gameParticipants_2')
    expect(creatorParticipant).toMatchObject({
      role:
        openingOrder.playerOneGuestId === 'guest_creator' ? 'playerOne' : 'playerTwo',
    })
    expect(opponentParticipant).toMatchObject({
      role:
        openingOrder.playerOneGuestId === 'guest_opponent' ? 'playerOne' : 'playerTwo',
    })
  })

  it('rejects non-creators and missing opponents when starting a private lobby', async () => {
    const db = new FakeDb([
      createGuest('guest_creator', 'Amber Crane 10'),
      createGuest('guest_other', 'River Otter 01'),
      createWaitingPrivateGame('games_1', 'guest_creator'),
      createParticipant('gameParticipants_1', 'games_1', 'guest_creator', 'playerOne', 1),
    ])

    await expect(
      startPrivateGame(createCtx(db), { _id: 'guest_other' } as never, 'games_1' as never),
    ).rejects.toMatchObject({
      data: {
        code: 'PRIVATE_ROOM_START_NOT_ALLOWED',
      },
    })

    await expect(
      startPrivateGame(
        createCtx(db),
        { _id: 'guest_creator' } as never,
        'games_1' as never,
      ),
    ).rejects.toMatchObject({
      data: {
        code: 'PRIVATE_ROOM_OPPONENT_REQUIRED',
      },
    })
  })

  it('swaps the opponent with a spectator and preserves rejoin roles', async () => {
    const db = new FakeDb([
      createGuest('guest_creator', 'Amber Crane 10'),
      createGuest('guest_opponent', 'River Otter 01'),
      createGuest('guest_spectator', 'Golden Falcon 22'),
      createWaitingPrivateGame('games_1', 'guest_creator'),
      createParticipant('gameParticipants_1', 'games_1', 'guest_creator', 'playerOne', 1),
      createParticipant('gameParticipants_2', 'games_1', 'guest_opponent', 'playerTwo', 2),
      createParticipant('gameParticipants_3', 'games_1', 'guest_spectator', 'spectator', 3),
      createQueueEntry('matchmakingQueue_1', 'guest_spectator'),
    ])

    await swapPrivateGameOpponent(
      createCtx(db),
      { _id: 'guest_creator' } as never,
      'games_1' as never,
      'guest_spectator' as never,
    )

    await expect(db.get('gameParticipants_2')).resolves.toMatchObject({
      role: 'spectator',
    })
    await expect(db.get('gameParticipants_3')).resolves.toMatchObject({
      role: 'playerTwo',
    })
    await expect(db.get('matchmakingQueue_1')).resolves.toBeNull()

    await expect(
      joinPrivateGame(createCtx(db), { _id: 'guest_opponent' } as never, 'ROOM42'),
    ).resolves.toEqual({
      gameId: 'games_1',
      role: 'spectator',
    })
    await expect(
      joinPrivateGame(createCtx(db), { _id: 'guest_spectator' } as never, 'ROOM42'),
    ).resolves.toEqual({
      gameId: 'games_1',
      role: 'playerTwo',
    })
  })

  it('blocks swapping in a spectator who is already an active player elsewhere', async () => {
    const db = new FakeDb([
      createGuest('guest_creator', 'Amber Crane 10'),
      createGuest('guest_opponent', 'River Otter 01'),
      createGuest('guest_spectator', 'Golden Falcon 22'),
      createWaitingPrivateGame('games_1', 'guest_creator'),
      {
        table: 'games',
        doc: {
          _id: 'games_2',
          mode: 'matchmaking',
          status: 'active',
        },
      },
      createParticipant('gameParticipants_1', 'games_1', 'guest_creator', 'playerOne', 1),
      createParticipant('gameParticipants_2', 'games_1', 'guest_opponent', 'playerTwo', 2),
      createParticipant('gameParticipants_3', 'games_1', 'guest_spectator', 'spectator', 3),
      createParticipant('gameParticipants_4', 'games_2', 'guest_spectator', 'playerOne', 4),
    ])

    const result = swapPrivateGameOpponent(
      createCtx(db),
      { _id: 'guest_creator' } as never,
      'games_1' as never,
      'guest_spectator' as never,
    )

    await expect(result).rejects.toBeInstanceOf(ConvexError)
    await expect(result).rejects.toMatchObject({
      data: {
        code: 'ALREADY_IN_GAME',
      },
    })
  })

  it('promotes the first joined spectator when the waiting-room opponent leaves', async () => {
    const db = new FakeDb([
      createGuest('guest_creator', 'Amber Crane 10'),
      createGuest('guest_opponent', 'River Otter 01'),
      createGuest('guest_spectator_one', 'Golden Falcon 22'),
      createGuest('guest_spectator_two', 'Clever Lynx 14'),
      createWaitingPrivateGame('games_1', 'guest_creator'),
      createParticipant('gameParticipants_1', 'games_1', 'guest_creator', 'playerOne', 1),
      createParticipant('gameParticipants_2', 'games_1', 'guest_opponent', 'playerTwo', 2),
      createParticipant(
        'gameParticipants_3',
        'games_1',
        'guest_spectator_one',
        'spectator',
        3,
      ),
      createParticipant(
        'gameParticipants_4',
        'games_1',
        'guest_spectator_two',
        'spectator',
        4,
      ),
    ])

    await expect(
      leavePrivateGameLobby(
        createCtx(db),
        { _id: 'guest_opponent' } as never,
        'games_1' as never,
      ),
    ).resolves.toEqual({ ok: true })

    await expect(db.get('gameParticipants_2')).resolves.toBeNull()
    await expect(db.get('gameParticipants_3')).resolves.toMatchObject({
      role: 'playerTwo',
    })
    await expect(db.get('gameParticipants_4')).resolves.toMatchObject({
      role: 'spectator',
    })
    await expect(
      joinPrivateGame(
        createCtx(db),
        { _id: 'guest_spectator_one' } as never,
        'ROOM42',
      ),
    ).resolves.toEqual({
      gameId: 'games_1',
      role: 'playerTwo',
    })
  })

  it('lets a spectator leave and blocks the creator from leaving the lobby', async () => {
    const db = new FakeDb([
      createGuest('guest_creator', 'Amber Crane 10'),
      createGuest('guest_opponent', 'River Otter 01'),
      createGuest('guest_spectator', 'Golden Falcon 22'),
      createWaitingPrivateGame('games_1', 'guest_creator'),
      createParticipant('gameParticipants_1', 'games_1', 'guest_creator', 'playerOne', 1),
      createParticipant('gameParticipants_2', 'games_1', 'guest_opponent', 'playerTwo', 2),
      createParticipant('gameParticipants_3', 'games_1', 'guest_spectator', 'spectator', 3),
    ])

    await expect(
      leavePrivateGameLobby(
        createCtx(db),
        { _id: 'guest_spectator' } as never,
        'games_1' as never,
      ),
    ).resolves.toEqual({ ok: true })

    await expect(db.get('gameParticipants_3')).resolves.toBeNull()

    await expect(
      leavePrivateGameLobby(
        createCtx(db),
        { _id: 'guest_creator' } as never,
        'games_1' as never,
      ),
    ).rejects.toMatchObject({
      data: {
        code: 'PRIVATE_ROOM_LEAVE_NOT_ALLOWED',
      },
    })
  })
})
