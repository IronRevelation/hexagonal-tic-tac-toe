import { describe, expect, it } from 'vitest'
import {
  buildForfeitGamePatch,
  canDeletePrivateRoom,
  clearDrawOfferFields,
  DISCONNECT_FORFEIT_MS,
  drawOfferCooldownPatch,
  DRAW_OFFER_COOLDOWN_MOVES,
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
        { ...waitingPrivateGame, status: 'active' },
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

  it('accepts UUID guest tokens and rejects arbitrary strings', () => {
    expect(isValidGuestToken('123e4567-e89b-42d3-a456-426614174000')).toBe(true)
    expect(isValidGuestToken('not-a-token')).toBe(false)
  })
})
