import { describe, expect, it } from 'vitest'
import {
  buildHistoryEntry,
  buildLiveGameCoreSnapshot,
  buildLiveGameRoomSnapshot,
  buildLivePrivateLobbySnapshot,
  buildPresenceAccessSnapshot,
  buildReplayData,
  buildResolvedClockPatch,
  buildForfeitGamePatch,
  buildTimeoutGamePatch,
  canCreatePrivateRoom,
  canDeletePrivateRoom,
  clearLegacyGameStateFields,
  compareHistoryEntries,
  clearDrawOfferFields,
  createStoredInitialState,
  DISCONNECT_FORFEIT_MS,
  drawOfferCooldownPatch,
  DRAW_OFFER_COOLDOWN_MOVES,
  ensureGameStateRecord,
  findAvailableMatchmakingOpponent,
  getLegacyGameStateFields,
  isValidGuestToken,
  normalizeGameTimeControl,
  normalizeTurnCommitMode,
  resolveHistoryResult,
  resolveTimedGameClock,
} from './lib'

describe('draw offer helpers', () => {
  it('clears pending draw offer fields', () => {
    expect(clearDrawOfferFields()).toEqual({
      drawOfferedBy: undefined,
      drawOfferedAtMoveIndex: undefined,
    })
  })

  it('applies the cooldown to player one', () => {
    expect(drawOfferCooldownPatch('one', 12)).toEqual({
      nextDrawOfferMoveIndexPlayerOne: 12 + DRAW_OFFER_COOLDOWN_MOVES,
    })
  })

  it('applies the cooldown to player two', () => {
    expect(drawOfferCooldownPatch('two', 7)).toEqual({
      nextDrawOfferMoveIndexPlayerTwo: 7 + DRAW_OFFER_COOLDOWN_MOVES,
    })
  })

  it('builds the standard forfeit patch', () => {
    expect(buildForfeitGamePatch('one', DISCONNECT_FORFEIT_MS)).toEqual({
      winnerSlot: 'two',
      finishReason: 'forfeit',
      status: 'finished',
      finishedAt: DISCONNECT_FORFEIT_MS,
      updatedAt: DISCONNECT_FORFEIT_MS,
      drawOfferedBy: undefined,
      drawOfferedAtMoveIndex: undefined,
    })
  })

  it('builds the standard timeout patch', () => {
    expect(
      buildTimeoutGamePatch('two', DISCONNECT_FORFEIT_MS, {
        one: 45_000,
        two: 0,
      }),
    ).toEqual({
      winnerSlot: 'one',
      finishReason: 'timeout',
      status: 'finished',
      finishedAt: DISCONNECT_FORFEIT_MS,
      updatedAt: DISCONNECT_FORFEIT_MS,
      playerOneTimeRemainingMs: 45_000,
      playerTwoTimeRemainingMs: 0,
      turnStartedAt: undefined,
      clockTimeoutJobId: undefined,
      drawOfferedBy: undefined,
      drawOfferedAtMoveIndex: undefined,
    })
  })

  it('allows deleting only untouched waiting private rooms owned by the creator', () => {
    const creatorId = 'guest_creator' as never
    const otherId = 'guest_other' as never
    const waitingPrivateGame = {
      mode: 'private',
      status: 'waiting',
      createdByGuestId: creatorId,
    } as never
    const activePrivateGame = {
      mode: 'private',
      status: 'active',
      createdByGuestId: creatorId,
    } as never

    expect(
      canDeletePrivateRoom(
        waitingPrivateGame,
        [{ guestId: creatorId, role: 'playerOne' }] as never,
        creatorId,
      ),
    ).toBe(true)
    expect(
      canDeletePrivateRoom(
        waitingPrivateGame,
        [{ guestId: creatorId, role: 'playerOne' }, { guestId: otherId, role: 'playerTwo' }] as never,
        creatorId,
      ),
    ).toBe(false)
    expect(
      canDeletePrivateRoom(
        activePrivateGame,
        [{ guestId: creatorId, role: 'playerOne' }] as never,
        creatorId,
      ),
    ).toBe(false)
    expect(
      canDeletePrivateRoom(
        waitingPrivateGame,
        [{ guestId: creatorId, role: 'playerOne' }] as never,
        otherId,
      ),
    ).toBe(false)
  })

  it('blocks private room creation while queued for matchmaking', () => {
    expect(canCreatePrivateRoom(false)).toBe(true)
    expect(canCreatePrivateRoom(true)).toBe(false)
  })

  it('builds split live snapshots for waiting private rooms', async () => {
    const creatorId = 'guest_creator' as never
    const opponentId = 'guest_opponent' as never
    const spectatorId = 'guest_spectator' as never
    const participants = [
      {
        guestId: creatorId,
        role: 'playerOne',
        joinedAt: 1,
      },
      {
        guestId: opponentId,
        role: 'playerTwo',
        joinedAt: 2,
      },
      {
        guestId: spectatorId,
        role: 'spectator',
        joinedAt: 3,
      },
    ] as never
    const guestNames = new Map<string, { displayName: string }>([
      [creatorId, { displayName: 'Amber Crane 10' }],
      [opponentId, { displayName: 'River Otter 01' }],
      [spectatorId, { displayName: 'Golden Falcon 22' }],
    ])
    const db = {
      async get(id: string) {
        return guestNames.get(id) ?? null
      },
      query(table: string) {
        expect(table).toBe('gameParticipants')
        return {
          withIndex(
            index: string,
            builder: (query: { eq: (field: string, value: string) => unknown }) => unknown,
          ) {
            expect(index).toBe('by_gameId')
            let gameId = ''
            const query = {
              eq(field: string, value: string) {
                expect(field).toBe('gameId')
                gameId = value
                return query
              },
            }
            builder(query)
            expect(gameId).toBe('game_1')
            return {
              collect: async () => participants,
            }
          },
        }
      },
    }

    const game = {
      _id: 'game_1',
      mode: 'private',
      status: 'waiting',
      createdByGuestId: creatorId,
      playerOneGuestId: creatorId,
      serializedState: createStoredInitialState(),
      updatedAt: 40,
      rematchRequestedByPlayerOne: false,
      rematchRequestedByPlayerTwo: false,
      nextDrawOfferMoveIndexPlayerOne: 0,
      nextDrawOfferMoveIndexPlayerTwo: 0,
    } as never

    await expect(buildLiveGameCoreSnapshot(db as never, { _id: creatorId } as never, game))
      .resolves.toMatchObject({
        viewerRole: 'playerOne',
        viewerCanMove: false,
        status: 'waiting',
        rematch: {
          requestedByPlayerOne: false,
          requestedByPlayerTwo: false,
          nextGameId: null,
        },
        drawOffer: {
          offeredBy: null,
          offeredAtMoveIndex: null,
          minMoveIndexForPlayerOne: 0,
          minMoveIndexForPlayerTwo: 0,
        },
      })

    await expect(buildLiveGameRoomSnapshot(db as never, { _id: creatorId } as never, game))
      .resolves.toMatchObject({
        mode: 'private',
        spectatorCount: 1,
        players: {
          one: {
            displayName: 'Amber Crane 10',
          },
          two: {
            displayName: 'River Otter 01',
          },
        },
      })

    await expect(
      buildLivePrivateLobbySnapshot(db as never, { _id: creatorId } as never, game),
    ).resolves.toMatchObject({
      creator: {
        guestId: creatorId,
        displayName: 'Amber Crane 10',
      },
      opponent: {
        guestId: opponentId,
        displayName: 'River Otter 01',
      },
      spectators: [
        {
          guestId: spectatorId,
          displayName: 'Golden Falcon 22',
        },
      ],
      viewerIsCreator: true,
      canStart: true,
    })
  })

  it('returns null private lobby snapshots outside waiting private rooms', async () => {
    const creatorId = 'guest_creator' as never
    const db = {
      query() {
        return {
          withIndex(_index: string, builder: (query: { eq: (field: string, value: string) => unknown }) => unknown) {
            const query = {
              eq(_field: string, _value: string) {
                return query
              },
            }
            builder(query)
            return {
              collect: async () => [{ guestId: creatorId, role: 'playerOne', joinedAt: 1 }],
            }
          },
        }
      },
    }

    await expect(
      buildLivePrivateLobbySnapshot(
        db as never,
        { _id: creatorId } as never,
        {
          _id: 'game_active',
          mode: 'private',
          status: 'active',
        } as never,
      ),
    ).resolves.toBeNull()

    await expect(
      buildLivePrivateLobbySnapshot(
        db as never,
        { _id: creatorId } as never,
        {
          _id: 'game_matchmaking',
          mode: 'matchmaking',
          status: 'waiting',
        } as never,
      ),
    ).resolves.toBeNull()

    await expect(
      buildLivePrivateLobbySnapshot(
        db as never,
        { _id: creatorId } as never,
        {
          _id: 'game_finished',
          mode: 'private',
          status: 'finished',
        } as never,
      ),
    ).resolves.toBeNull()
  })

  it('builds presence access only for players', async () => {
    const creatorId = 'guest_creator' as never
    const opponentId = 'guest_opponent' as never
    const spectatorId = 'guest_spectator' as never
    const participants: Array<{
      guestId: string
      gameId: string
      role: 'playerOne' | 'playerTwo' | 'spectator'
      joinedAt: number
    }> = [
      {
        guestId: creatorId,
        gameId: 'game_1',
        role: 'playerOne',
        joinedAt: 1,
      },
      {
        guestId: opponentId,
        gameId: 'game_1',
        role: 'playerTwo',
        joinedAt: 2,
      },
      {
        guestId: spectatorId,
        gameId: 'game_1',
        role: 'spectator',
        joinedAt: 3,
      },
    ]
    const db = {
      query(table: string) {
        expect(table).toBe('gameParticipants')
        return {
          withIndex(
            index: string,
            builder: (query: { eq: (field: string, value: string) => unknown }) => unknown,
          ) {
            expect(index).toBe('by_gameId_guestId')
            const filters: Record<string, string> = {}
            const query = {
              eq(field: string, value: string) {
                filters[field] = value
                return query
              },
            }
            builder(query)
            return {
              unique: async () =>
                participants.find(
                  (participant) =>
                    participant.gameId === filters.gameId &&
                    participant.guestId === filters.guestId,
                ) ?? null,
            }
          },
        }
      },
    }
    const game = { _id: 'game_1' } as never

    await expect(
      buildPresenceAccessSnapshot(
        db as never,
        { _id: creatorId } as never,
        game,
      ),
    ).resolves.toEqual({
      gameId: 'game_1',
      slot: 'one',
    })

    await expect(
      buildPresenceAccessSnapshot(
        db as never,
        { _id: opponentId } as never,
        game,
      ),
    ).resolves.toEqual({
      gameId: 'game_1',
      slot: 'two',
    })

    await expect(
      buildPresenceAccessSnapshot(
        db as never,
        { _id: spectatorId } as never,
        game,
      ),
    ).resolves.toBeNull()

    await expect(
      buildPresenceAccessSnapshot(
        db as never,
        { _id: 'guest_missing' } as never,
        game,
      ),
    ).resolves.toBeNull()
  })

  it('only depletes the active player clock', () => {
    const resolvedClock = resolveTimedGameClock(
      {
        status: 'active',
        timeControl: '3m',
        playerOneTimeRemainingMs: 180_000,
        playerTwoTimeRemainingMs: 180_000,
        turnStartedAt: 1_000,
      } as never,
      'one',
      31_000,
    )

    expect(resolvedClock?.remainingMs).toEqual({
      one: 150_000,
      two: 180_000,
    })
    expect(resolvedClock?.activePlayer).toBe('one')
  })

  it('keeps timed games paused until the first move starts the turn clock', () => {
    const resolvedClock = resolveTimedGameClock(
      {
        status: 'active',
        timeControl: '3m',
        playerOneTimeRemainingMs: 180_000,
        playerTwoTimeRemainingMs: 180_000,
        turnStartedAt: undefined,
      } as never,
      'one',
      31_000,
    )

    expect(resolvedClock?.remainingMs).toEqual({
      one: 180_000,
      two: 180_000,
    })
    expect(resolvedClock?.activePlayer).toBeNull()
  })

  it('persists the same active player clock after the first placement of a two-move turn', () => {
    const resolvedClock = resolveTimedGameClock(
      {
        status: 'active',
        timeControl: '5m',
        playerOneTimeRemainingMs: 300_000,
        playerTwoTimeRemainingMs: 300_000,
        turnStartedAt: 10_000,
      } as never,
      'two',
      14_000,
    )

    expect(buildResolvedClockPatch(resolvedClock, 'two', 14_000)).toEqual({
      playerOneTimeRemainingMs: 300_000,
      playerTwoTimeRemainingMs: 296_000,
      turnStartedAt: 14_000,
    })
  })

  it('treats legacy games without a time control as unlimited', () => {
    expect(normalizeGameTimeControl({} as never)).toBe('unlimited')
    expect(normalizeTurnCommitMode({} as never)).toBe('instant')
    expect(
      resolveTimedGameClock(
        {
          status: 'active',
          playerOneTimeRemainingMs: undefined,
          playerTwoTimeRemainingMs: undefined,
          turnStartedAt: 0,
        } as never,
        'one',
        1_000,
      ),
    ).toBeNull()
  })

  it('reads turn commit mode from newer games', () => {
    expect(normalizeTurnCommitMode({ turnCommitMode: 'confirmTurn' } as never)).toBe(
      'confirmTurn',
    )
  })

  it('accepts UUID guest tokens and rejects arbitrary strings', () => {
    expect(isValidGuestToken('123e4567-e89b-42d3-a456-426614174000')).toBe(true)
    expect(isValidGuestToken('not-a-token')).toBe(false)
  })

  it('resolves history results from the viewer perspective', () => {
    expect(resolveHistoryResult('one', 'one', 'line')).toBe('win')
    expect(resolveHistoryResult('one', 'two', 'timeout')).toBe('loss')
    expect(resolveHistoryResult('two', null, 'drawAgreement')).toBe('draw')
  })

  it('orders history entries by newest finished timestamp first', () => {
    const entries = [
      {
        finishedAt: 20,
        updatedAt: 30,
      },
      {
        finishedAt: 50,
        updatedAt: 10,
      },
      {
        finishedAt: 50,
        updatedAt: 40,
      },
    ]

    expect(entries.sort(compareHistoryEntries)).toEqual([
      {
        finishedAt: 50,
        updatedAt: 40,
      },
      {
        finishedAt: 50,
        updatedAt: 10,
      },
      {
        finishedAt: 20,
        updatedAt: 30,
      },
    ])
  })

  it('excludes spectators from history and replay access', async () => {
    const game = {
      _id: 'game_1',
      status: 'finished',
      finishReason: 'line',
      updatedAt: 20,
      finishedAt: 20,
      mode: 'matchmaking',
      timeControl: 'unlimited',
      winnerSlot: 'one',
      playerOneGuestId: 'guest_1',
      playerTwoGuestId: 'guest_2',
      seriesId: 'series_1',
      serializedState: {
        totalMoves: 3,
      },
    } as never
    const spectatorParticipant = {
      guestId: 'guest_3',
      role: 'spectator',
    } as never
    const db = {
      get: async () => null,
      query() {
        throw new Error('query should not be called for spectator access')
      },
    }

    expect(
      await buildHistoryEntry(db as never, 'guest_3' as never, game, spectatorParticipant),
    ).toBeNull()
    expect(
      await buildReplayData(db as never, 'guest_3' as never, game, spectatorParticipant),
    ).toBeNull()
  })

  it('builds history entries with opponent data and viewer result', async () => {
    const game = {
      _id: 'game_1',
      status: 'finished',
      finishReason: 'timeout',
      updatedAt: 20,
      finishedAt: 18,
      mode: 'private',
      timeControl: '3m',
      winnerSlot: 'two',
      playerOneGuestId: 'guest_1',
      playerTwoGuestId: 'guest_2',
      seriesId: 'series_1',
      serializedState: {
        totalMoves: 9,
      },
    } as never
    const participant = {
      guestId: 'guest_1',
      role: 'playerOne',
    } as never
    const db = {
      async get(id: string) {
        if (id === 'guest_2') {
          return {
            displayName: 'River Otter 01',
          }
        }

        return null
      },
    }

    await expect(
      buildHistoryEntry(db as never, 'guest_1' as never, game, participant),
    ).resolves.toEqual({
      gameId: 'game_1',
      seriesId: 'series_1',
      mode: 'private',
      timeControl: '3m',
      finishReason: 'timeout',
      result: 'loss',
      viewerSlot: 'one',
      opponent: {
        displayName: 'River Otter 01',
        slot: 'two',
      },
      finishedAt: 18,
      updatedAt: 20,
      totalMoves: 9,
    })
  })

  it('builds replay data with turn commit mode and hydrated last-turn state', async () => {
    const game = {
      _id: 'game_1',
      status: 'finished',
      finishReason: 'line',
      updatedAt: 20,
      finishedAt: 18,
      mode: 'private',
      timeControl: 'unlimited',
      turnCommitMode: 'confirmTurn',
      winnerSlot: 'one',
      playerOneGuestId: 'guest_1',
      playerTwoGuestId: 'guest_2',
      seriesId: 'series_1',
      serializedState: {
        board: [{ key: '0,0', player: 'one' }],
        currentPlayer: 'two',
        movesRemaining: 2,
        turnNumber: 2,
        totalMoves: 1,
        lastMove: { q: 0, r: 0 },
        winner: null,
        winningLine: [],
      },
    } as never
    const participant = {
      guestId: 'guest_1',
      role: 'playerOne',
    } as never
    const moves = [
      {
        moveIndex: 0,
        turnNumber: 1,
        slot: 'one',
        q: 0,
        r: 0,
        createdAt: 11,
      },
    ]
    const db = {
      async get(id: string) {
        if (id === 'guest_1') {
          return { displayName: 'Amber Crane 10' }
        }
        if (id === 'guest_2') {
          return { displayName: 'River Otter 01' }
        }
        return null
      },
      query(table: string) {
        expect(table).toBe('gameMoves')
        return {
          withIndex(index: string, builder: (query: { eq: (field: string, value: string) => unknown }) => unknown) {
            expect(index).toBe('by_gameId_moveIndex')
            let gameId = ''
            const query = {
              eq(field: string, value: string) {
                expect(field).toBe('gameId')
                gameId = value
                return query
              },
            }
            builder(query)
            expect(gameId).toBe('game_1')
            return {
              collect: async () => moves,
            }
          },
        }
      },
    }

    await expect(
      buildReplayData(db as never, 'guest_1' as never, game, participant),
    ).resolves.toEqual({
      gameId: 'game_1',
      seriesId: 'series_1',
      mode: 'private',
      timeControl: 'unlimited',
      finishReason: 'line',
      winnerSlot: 'one',
      viewerSlot: 'one',
      finishedAt: 18,
      updatedAt: 20,
      turnCommitMode: 'confirmTurn',
      players: {
        one: {
          displayName: 'Amber Crane 10',
        },
        two: {
          displayName: 'River Otter 01',
        },
      },
      finalState: {
        board: [['0,0', 'one']],
        currentPlayer: 'two',
        movesRemaining: 2,
        turnNumber: 2,
        totalMoves: 1,
        lastMove: { q: 0, r: 0 },
        lastTurnMoves: [{ q: 0, r: 0 }],
        winner: null,
        winningLine: [],
      },
      moves: [
        {
          moveIndex: 0,
          turnNumber: 1,
          slot: 'one',
          coord: { q: 0, r: 0 },
          createdAt: 11,
        },
      ],
    })
  })

  it('skips stale queued opponents who are already in an active player game', async () => {
    const currentGuestId = 'guest_current' as never
    const staleGuestId = 'guest_stale' as never
    const liveGuestId = 'guest_live' as never
    const activeGameId = 'game_active' as never
    const staleQueueEntry = {
      _id: 'queue_stale',
      guestId: staleGuestId,
      queuedAt: 10,
    } as never
    const liveQueueEntry = {
      _id: 'queue_live',
      guestId: liveGuestId,
      queuedAt: 20,
    } as never
    const queueEntries = [
      {
        _id: 'queue_current',
        guestId: currentGuestId,
        queuedAt: 5,
      } as never,
      staleQueueEntry,
      liveQueueEntry,
    ]
    const participantsByGuestId = new Map<string, unknown[]>([
      [
        staleGuestId,
        [
          {
            role: 'playerOne',
            joinedAt: 1,
            gameId: activeGameId,
          },
        ],
      ],
      [liveGuestId, []],
    ])
    const gamesById = new Map<string, unknown>([
      [
        activeGameId,
        {
          _id: activeGameId,
          status: 'active',
        },
      ],
    ])
    const deletedQueueEntryIds: string[] = []

    const db = {
      query(table: string) {
        if (table === 'matchmakingQueue') {
          return {
            withIndex(index: string) {
              expect(index).toBe('by_queuedAt')
              return {
                collect: async () => queueEntries,
              }
            },
          }
        }

        if (table === 'gameParticipants') {
          return {
            withIndex(index: string, builder: (query: { eq: (field: string, value: string) => unknown }) => unknown) {
              expect(index).toBe('by_guestId')
              let guestId: string | null = null
              const query = {
                eq(field: string, value: string) {
                  expect(field).toBe('guestId')
                  guestId = value
                  return query
                },
              }
              builder(query)

              return {
                collect: async () => participantsByGuestId.get(guestId ?? '') ?? [],
              }
            },
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      },
      async get(id: string) {
        return gamesById.get(id) ?? null
      },
    }

    const opponent = await findAvailableMatchmakingOpponent(
      db as never,
      currentGuestId,
      async (entry) => {
        deletedQueueEntryIds.push(entry._id)
      },
    )

    expect(opponent).toBe(liveQueueEntry)
    expect(deletedQueueEntryIds).toEqual(['queue_stale'])
  })
})

describe('game state migration helpers', () => {
  class FakeWriter {
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

    query(table: string) {
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
          const filtered = Array.from(this.records.values()).filter((record) => {
            if (!String(record._id).startsWith(`${table}_`)) {
              return false
            }

            return filters.every(({ field, value }) => record[field] === value)
          })

          return {
            unique: async () => {
              if (table === 'gameStates') {
                expect(index).toBe('by_gameId')
              }
              return filtered[0] ?? null
            },
          }
        },
      }
    }

    findOne(table: string) {
      return Array.from(this.records.values()).find((record) =>
        String(record._id).startsWith(`${table}_`),
      ) ?? null
    }
  }

  it('extracts legacy state fields from a games row', () => {
    const serializedState = createStoredInitialState()
    const game = {
      _id: 'games_1',
      serializedState,
      winnerSlot: 'one',
      finishReason: 'line',
      turnCommitMode: 'confirmTurn',
      playerOneTimeRemainingMs: 50_000,
      playerTwoTimeRemainingMs: 49_000,
      turnStartedAt: 321,
      clockTimeoutGeneration: 4,
      clockTimeoutJobId: 'job_1',
      drawOfferedBy: 'two',
      drawOfferedAtMoveIndex: 8,
      nextDrawOfferMoveIndexPlayerOne: 15,
      nextDrawOfferMoveIndexPlayerTwo: 16,
      updatedAt: 500,
    } as {
      serializedState: ReturnType<typeof createStoredInitialState>
    }

    expect(getLegacyGameStateFields(game as never)).toMatchObject({
      serializedState,
      winnerSlot: 'one',
      finishReason: 'line',
      turnCommitMode: 'confirmTurn',
      playerOneTimeRemainingMs: 50_000,
      playerTwoTimeRemainingMs: 49_000,
      turnStartedAt: 321,
      clockTimeoutGeneration: 4,
      clockTimeoutJobId: 'job_1',
      drawOfferedBy: 'two',
      drawOfferedAtMoveIndex: 8,
      nextDrawOfferMoveIndexPlayerOne: 15,
      nextDrawOfferMoveIndexPlayerTwo: 16,
      updatedAt: 500,
    })
  })

  it('backfills a missing gameStates row from legacy game fields', async () => {
    const db = new FakeWriter([
      {
        table: 'games',
        doc: {
          _id: 'games_1',
          serializedState: createStoredInitialState(),
          turnCommitMode: 'confirmTurn',
          updatedAt: 100,
        },
      },
    ])

    const game = (await db.get('games_1')) as {
      _id: string
      serializedState: ReturnType<typeof createStoredInitialState>
      turnCommitMode: 'confirmTurn'
      updatedAt: number
    }
    const stateRecord = await ensureGameStateRecord(db as never, game as never)

    expect(stateRecord).toMatchObject({
      gameId: 'games_1',
      serializedState: game.serializedState,
      turnCommitMode: 'confirmTurn',
      updatedAt: 100,
    })
    expect(db.findOne('gameStates')).toMatchObject({
      gameId: 'games_1',
      turnCommitMode: 'confirmTurn',
    })
  })

  it('repairs a gameStates row missing turnCommitMode', async () => {
    const db = new FakeWriter([
      {
        table: 'games',
        doc: {
          _id: 'games_1',
          serializedState: createStoredInitialState(),
          turnCommitMode: 'confirmTurn',
          updatedAt: 100,
        },
      },
      {
        table: 'gameStates',
        doc: {
          _id: 'gameStates_1',
          gameId: 'games_1',
          serializedState: createStoredInitialState(),
          updatedAt: 100,
        },
      },
    ])

    const game = (await db.get('games_1')) as {
      _id: string
      serializedState: ReturnType<typeof createStoredInitialState>
      turnCommitMode: 'confirmTurn'
      updatedAt: number
    }
    const stateRecord = await ensureGameStateRecord(db as never, game as never)

    expect(stateRecord.turnCommitMode).toBe('confirmTurn')
    await expect(db.get('gameStates_1')).resolves.toMatchObject({
      turnCommitMode: 'confirmTurn',
    })
  })

  it('clears legacy state fields from games after rollout', () => {
    expect(clearLegacyGameStateFields()).toEqual({
      playerOneTimeRemainingMs: undefined,
      playerTwoTimeRemainingMs: undefined,
      turnStartedAt: undefined,
      clockTimeoutGeneration: undefined,
      clockTimeoutJobId: undefined,
      turnCommitMode: undefined,
      serializedState: undefined,
      winnerSlot: undefined,
      finishReason: undefined,
      drawOfferedBy: undefined,
      drawOfferedAtMoveIndex: undefined,
      nextDrawOfferMoveIndexPlayerOne: undefined,
      nextDrawOfferMoveIndexPlayerTwo: undefined,
    })
  })
})
