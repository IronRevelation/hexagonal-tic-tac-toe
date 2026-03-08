import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRIVATE_TURN_COMMIT_MODE,
  getCanonicalTurnKey,
  getRequiredSelections,
  togglePendingSelection,
} from './turnSubmission'

describe('turnSubmission helpers', () => {
  it('defaults private rooms to confirmed turns', () => {
    expect(DEFAULT_PRIVATE_TURN_COMMIT_MODE).toBe('confirmTurn')
  })

  it('uses the current moves remaining as the selection requirement', () => {
    expect(getRequiredSelections({ movesRemaining: 1 })).toBe(1)
    expect(getRequiredSelections({ movesRemaining: 2 })).toBe(2)
  })

  it('adds pending selections until the turn quota is full', () => {
    const committedKeys = new Set<string>()

    expect(
      togglePendingSelection({
        committedKeys,
        coord: { q: 0, r: 0 },
        pendingCoords: [],
        requiredSelections: 2,
      }),
    ).toEqual([{ q: 0, r: 0 }])

    expect(
      togglePendingSelection({
        committedKeys,
        coord: { q: 1, r: 0 },
        pendingCoords: [{ q: 0, r: 0 }],
        requiredSelections: 2,
      }),
    ).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ])
  })

  it('removes a pending selection when it is clicked again', () => {
    expect(
      togglePendingSelection({
        committedKeys: new Set<string>(),
        coord: { q: 1, r: 0 },
        pendingCoords: [
          { q: 0, r: 0 },
          { q: 1, r: 0 },
        ],
        requiredSelections: 2,
      }),
    ).toEqual([{ q: 0, r: 0 }])
  })

  it('ignores committed cells and extra clicks once the turn quota is full', () => {
    const pendingCoords = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ]

    expect(
      togglePendingSelection({
        committedKeys: new Set(['2,0']),
        coord: { q: 2, r: 0 },
        pendingCoords: [{ q: 0, r: 0 }],
        requiredSelections: 2,
      }),
    ).toEqual([{ q: 0, r: 0 }])

    expect(
      togglePendingSelection({
        committedKeys: new Set<string>(),
        coord: { q: 3, r: 0 },
        pendingCoords,
        requiredSelections: 2,
      }),
    ).toEqual(pendingCoords)
  })

  it('changes the canonical turn key when the authoritative turn changes', () => {
    const currentTurn = getCanonicalTurnKey('game-1', {
      currentPlayer: 'one',
      turnNumber: 2,
      totalMoves: 3,
    })
    const nextTurn = getCanonicalTurnKey('game-1', {
      currentPlayer: 'two',
      turnNumber: 3,
      totalMoves: 4,
    })

    expect(nextTurn).not.toBe(currentTurn)
  })
})
