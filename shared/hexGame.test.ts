import { describe, expect, it } from 'vitest'
import {
  applyMove,
  checkWinner,
  coordKey,
  createInitialGameState,
  deserializeGameState,
  serializeGameState,
  type GameState,
  type HexCoord,
  type PlayerSlot,
} from './hexGame'

describe('hex game rules', () => {
  it('gives player one a single opening move and then switches to two-move turns', () => {
    let state = createInitialGameState()

    state = applyMove(state, { q: 0, r: 0 })
    expect(state.currentPlayer).toBe('two')
    expect(state.movesRemaining).toBe(2)
    expect(state.turnNumber).toBe(2)

    state = applyMove(state, { q: 1, r: 0 })
    expect(state.currentPlayer).toBe('two')
    expect(state.movesRemaining).toBe(1)
    expect(state.turnNumber).toBe(2)

    state = applyMove(state, { q: 2, r: 0 })
    expect(state.currentPlayer).toBe('one')
    expect(state.movesRemaining).toBe(2)
    expect(state.turnNumber).toBe(3)
  })

  it('detects a six-stone line on all three hex axes', () => {
    const axisLines: HexCoord[][] = [
      [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 2, r: 0 },
        { q: 3, r: 0 },
        { q: 4, r: 0 },
        { q: 5, r: 0 },
      ],
      [
        { q: 0, r: 0 },
        { q: 0, r: 1 },
        { q: 0, r: 2 },
        { q: 0, r: 3 },
        { q: 0, r: 4 },
        { q: 0, r: 5 },
      ],
      [
        { q: 0, r: 0 },
        { q: 1, r: -1 },
        { q: 2, r: -2 },
        { q: 3, r: -3 },
        { q: 4, r: -4 },
        { q: 5, r: -5 },
      ],
    ]

    for (const line of axisLines) {
      const board = new Map<string, PlayerSlot>()

      for (const coord of line) {
        board.set(coordKey(coord), 'one')
      }

      const winner = checkWinner(board, line[2]!, 'one')

      expect(winner).not.toBeNull()
      expect(winner?.length).toBe(6)
    }
  })

  it('ends the turn immediately when a winning move is played with placements remaining', () => {
    const winningLine = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
      { q: 4, r: 0 },
    ]
    let state = createState(
      winningLine.map((coord) => [coord, 'two'] as const),
      'two',
      2,
    )

    state = applyMove(state, { q: 5, r: 0 })

    expect(state.winner).toBe('two')
    expect(state.movesRemaining).toBe(0)

    const frozenState = applyMove(state, { q: 8, r: 0 })
    expect(frozenState).toEqual(state)
  })

  it('round-trips serialized game state', () => {
    let state = createInitialGameState()
    state = applyMove(state, { q: 0, r: 0 })
    state = applyMove(state, { q: 1, r: 0 })

    const serialized = serializeGameState(state)
    const deserialized = deserializeGameState(serialized)

    expect(deserialized.currentPlayer).toBe(state.currentPlayer)
    expect(deserialized.movesRemaining).toBe(state.movesRemaining)
    expect(Array.from(deserialized.board.entries())).toEqual(
      Array.from(state.board.entries()),
    )
  })
})

function createState(
  entries: ReadonlyArray<readonly [HexCoord, PlayerSlot]>,
  currentPlayer: PlayerSlot,
  movesRemaining: number,
): GameState {
  return {
    ...createInitialGameState(),
    board: new Map(entries.map(([coord, player]) => [coordKey(coord), player])),
    currentPlayer,
    movesRemaining,
    totalMoves: entries.length,
  }
}
