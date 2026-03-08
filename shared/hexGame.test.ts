import { describe, expect, it } from 'vitest'
import {
  applyMove,
  buildReplayState,
  checkWinner,
  coordKey,
  createInitialGameState,
  deserializeGameState,
  isValidHexCoord,
  serializeGameState,
  type GameState,
  type HexCoord,
  type PlayerSlot,
} from './hexGame'
import type { GameReplayMove } from './contracts'

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

  it('rejects non-integer and oversized coordinates', () => {
    expect(isValidHexCoord({ q: 4, r: -3 })).toBe(true)
    expect(isValidHexCoord({ q: 1.5, r: 0 })).toBe(false)
    expect(isValidHexCoord({ q: 100_001, r: 0 })).toBe(false)
  })

  it('reconstructs the initial position when no replay moves are applied', () => {
    const state = buildReplayState(createReplayMoves(), 0)

    expect(state).toEqual(createInitialGameState())
  })

  it('reconstructs the first opening move from replay history', () => {
    const state = buildReplayState(createReplayMoves(), 1)

    expect(Array.from(state.board.entries())).toEqual([['0,0', 'one']])
    expect(state.currentPlayer).toBe('two')
    expect(state.movesRemaining).toBe(2)
    expect(state.turnNumber).toBe(2)
  })

  it('reconstructs the correct board in the middle of a two-move turn', () => {
    const state = buildReplayState(createReplayMoves(), 2)

    expect(Array.from(state.board.entries())).toEqual([
      ['0,0', 'one'],
      ['1,0', 'two'],
    ])
    expect(state.currentPlayer).toBe('two')
    expect(state.movesRemaining).toBe(1)
    expect(state.turnNumber).toBe(2)
  })

  it('shows the winning line only once the decisive replay move is applied', () => {
    const moves = createWinningReplayMoves()

    const preWinState = buildReplayState(moves, moves.length - 1)
    expect(preWinState.winner).toBeNull()
    expect(preWinState.winningLine).toEqual([])

    const finalState = buildReplayState(moves, moves.length)
    expect(finalState.winner).toBe('one')
    expect(finalState.winningLine).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
      { q: 4, r: 0 },
      { q: 5, r: 0 },
    ])
  })

  it('clamps replay move counts to the available move range', () => {
    const moves = createReplayMoves()

    expect(buildReplayState(moves, -4)).toEqual(createInitialGameState())
    expect(buildReplayState(moves, 99)).toEqual(buildReplayState(moves, moves.length))
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

function createReplayMoves(): GameReplayMove[] {
  return [
    {
      moveIndex: 0,
      turnNumber: 1,
      slot: 'one',
      coord: { q: 0, r: 0 },
      createdAt: 1,
    },
    {
      moveIndex: 1,
      turnNumber: 2,
      slot: 'two',
      coord: { q: 1, r: 0 },
      createdAt: 2,
    },
    {
      moveIndex: 2,
      turnNumber: 2,
      slot: 'two',
      coord: { q: 2, r: 0 },
      createdAt: 3,
    },
    {
      moveIndex: 3,
      turnNumber: 3,
      slot: 'one',
      coord: { q: 0, r: 1 },
      createdAt: 4,
    },
  ]
}

function createWinningReplayMoves(): GameReplayMove[] {
  return [
    {
      moveIndex: 0,
      turnNumber: 1,
      slot: 'one',
      coord: { q: 0, r: 0 },
      createdAt: 1,
    },
    {
      moveIndex: 1,
      turnNumber: 2,
      slot: 'two',
      coord: { q: 0, r: 1 },
      createdAt: 2,
    },
    {
      moveIndex: 2,
      turnNumber: 2,
      slot: 'two',
      coord: { q: 0, r: 2 },
      createdAt: 3,
    },
    {
      moveIndex: 3,
      turnNumber: 3,
      slot: 'one',
      coord: { q: 1, r: 0 },
      createdAt: 4,
    },
    {
      moveIndex: 4,
      turnNumber: 3,
      slot: 'one',
      coord: { q: 2, r: 0 },
      createdAt: 5,
    },
    {
      moveIndex: 5,
      turnNumber: 4,
      slot: 'two',
      coord: { q: 1, r: 1 },
      createdAt: 6,
    },
    {
      moveIndex: 6,
      turnNumber: 4,
      slot: 'two',
      coord: { q: 1, r: 2 },
      createdAt: 7,
    },
    {
      moveIndex: 7,
      turnNumber: 5,
      slot: 'one',
      coord: { q: 3, r: 0 },
      createdAt: 8,
    },
    {
      moveIndex: 8,
      turnNumber: 5,
      slot: 'one',
      coord: { q: 4, r: 0 },
      createdAt: 9,
    },
    {
      moveIndex: 9,
      turnNumber: 6,
      slot: 'two',
      coord: { q: 2, r: 1 },
      createdAt: 10,
    },
    {
      moveIndex: 10,
      turnNumber: 6,
      slot: 'two',
      coord: { q: 2, r: 2 },
      createdAt: 11,
    },
    {
      moveIndex: 11,
      turnNumber: 7,
      slot: 'one',
      coord: { q: 5, r: 0 },
      createdAt: 12,
    },
  ]
}
