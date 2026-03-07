import { describe, expect, it } from 'vitest'
import { clearDrawOfferFields, drawOfferCooldownPatch, DRAW_OFFER_COOLDOWN_MOVES } from './lib'

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
})
