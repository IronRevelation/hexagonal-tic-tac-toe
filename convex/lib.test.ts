import { describe, expect, it } from 'vitest'
import {
  buildHistoryEntry,
  buildReplayData,
  buildResolvedClockPatch,
  buildForfeitGamePatch,
  buildTimeoutGamePatch,
  canCreatePrivateRoom,
  canDeletePrivateRoom,
  compareHistoryEntries,
  clearDrawOfferFields,
  DISCONNECT_FORFEIT_MS,
  drawOfferCooldownPatch,
  DRAW_OFFER_COOLDOWN_MOVES,
  findAvailableMatchmakingOpponent,
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
