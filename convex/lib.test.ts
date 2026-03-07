import { describe, expect, it } from 'vitest'
import {
  buildForfeitGamePatch,
  canCreatePrivateRoom,
  canDeletePrivateRoom,
  clearDrawOfferFields,
  DISCONNECT_FORFEIT_MS,
  drawOfferCooldownPatch,
  DRAW_OFFER_COOLDOWN_MOVES,
  findAvailableMatchmakingOpponent,
  isValidGuestToken,
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

  it('accepts UUID guest tokens and rejects arbitrary strings', () => {
    expect(isValidGuestToken('123e4567-e89b-42d3-a456-426614174000')).toBe(true)
    expect(isValidGuestToken('not-a-token')).toBe(false)
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
