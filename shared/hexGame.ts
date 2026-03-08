import type { GameReplayMove } from './contracts'

export type PlayerSlot = 'one' | 'two'
export type TurnCommitMode = 'instant' | 'confirmTurn'

export type HexCoord = {
  q: number
  r: number
}

export type GameState = {
  board: Map<string, PlayerSlot>
  currentPlayer: PlayerSlot
  movesRemaining: number
  turnNumber: number
  totalMoves: number
  lastMove: HexCoord | null
  lastTurnMoves: HexCoord[]
  winner: PlayerSlot | null
  winningLine: HexCoord[]
}

export type SerializedGameState = {
  board: Array<[string, PlayerSlot]>
  currentPlayer: PlayerSlot
  movesRemaining: number
  turnNumber: number
  totalMoves: number
  lastMove: HexCoord | null
  lastTurnMoves: HexCoord[]
  winner: PlayerSlot | null
  winningLine: HexCoord[]
}

export const WINNING_LENGTH = 6
export const MAX_ABS_COORD = 100_000

export const PRIMARY_DIRECTIONS: HexCoord[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: 1, r: -1 },
]

export const PLAYER_LABELS: Record<PlayerSlot, string> = {
  one: 'Player 1',
  two: 'Player 2',
}

export const PLAYER_MARKS: Record<PlayerSlot, string> = {
  one: 'X',
  two: 'O',
}

export function coordKey({ q, r }: HexCoord): string {
  return `${q},${r}`
}

export function isValidHexCoord({ q, r }: HexCoord): boolean {
  return (
    Number.isSafeInteger(q) &&
    Number.isSafeInteger(r) &&
    Math.abs(q) <= MAX_ABS_COORD &&
    Math.abs(r) <= MAX_ABS_COORD
  )
}

export function createInitialGameState(): GameState {
  return {
    board: new Map(),
    currentPlayer: 'one',
    movesRemaining: 1,
    turnNumber: 1,
    totalMoves: 0,
    lastMove: null,
    lastTurnMoves: [],
    winner: null,
    winningLine: [],
  }
}

export function serializeGameState(state: GameState): SerializedGameState {
  return {
    board: Array.from(state.board.entries()),
    currentPlayer: state.currentPlayer,
    movesRemaining: state.movesRemaining,
    turnNumber: state.turnNumber,
    totalMoves: state.totalMoves,
    lastMove: state.lastMove,
    lastTurnMoves: state.lastTurnMoves,
    winner: state.winner,
    winningLine: state.winningLine,
  }
}

export function deserializeGameState(state: SerializedGameState): GameState {
  return {
    board: new Map(state.board),
    currentPlayer: state.currentPlayer,
    movesRemaining: state.movesRemaining,
    turnNumber: state.turnNumber,
    totalMoves: state.totalMoves,
    lastMove: state.lastMove,
    lastTurnMoves: state.lastTurnMoves,
    winner: state.winner,
    winningLine: state.winningLine,
  }
}

export function opponentOf(player: PlayerSlot): PlayerSlot {
  return player === 'one' ? 'two' : 'one'
}

export function parseCoordKey(key: string): HexCoord {
  const [q, r] = key.split(',').map(Number)
  return { q, r }
}

export function checkWinner(
  board: Map<string, PlayerSlot>,
  coord: HexCoord,
  player: PlayerSlot,
): HexCoord[] | null {
  for (const direction of PRIMARY_DIRECTIONS) {
    const backward = collectLine(board, coord, player, negate(direction)).reverse()
    const forward = collectLine(board, coord, player, direction)
    const line = [...backward, coord, ...forward]

    if (line.length >= WINNING_LENGTH) {
      return line
    }
  }

  return null
}

export function applyMove(state: GameState, coord: HexCoord): GameState {
  if (state.winner || state.board.has(coordKey(coord))) {
    return state
  }

  const nextBoard = new Map(state.board)
  nextBoard.set(coordKey(coord), state.currentPlayer)

  const winningLine = checkWinner(nextBoard, coord, state.currentPlayer)
  const nextTotalMoves = state.totalMoves + 1
  const nextLastTurnMoves =
    state.movesRemaining === 1 ? [...state.lastTurnMoves, coord] : [coord]

  if (winningLine) {
    return {
      ...state,
      board: nextBoard,
      totalMoves: nextTotalMoves,
      lastMove: coord,
      lastTurnMoves: nextLastTurnMoves,
      winner: state.currentPlayer,
      winningLine,
      movesRemaining: 0,
    }
  }

  if (state.movesRemaining > 1) {
    return {
      ...state,
      board: nextBoard,
      totalMoves: nextTotalMoves,
      lastMove: coord,
      lastTurnMoves: nextLastTurnMoves,
      movesRemaining: state.movesRemaining - 1,
      winningLine: [],
    }
  }

  return {
    ...state,
    board: nextBoard,
    currentPlayer: opponentOf(state.currentPlayer),
    movesRemaining: 2,
    turnNumber: state.turnNumber + 1,
    totalMoves: nextTotalMoves,
    lastMove: coord,
    lastTurnMoves: nextLastTurnMoves,
    winningLine: [],
  }
}

export function applyPendingPlacement(state: GameState, coord: HexCoord): GameState {
  if (state.winner || state.movesRemaining <= 0 || state.board.has(coordKey(coord))) {
    return state
  }

  const nextBoard = new Map(state.board)
  nextBoard.set(coordKey(coord), state.currentPlayer)

  return {
    ...state,
    board: nextBoard,
    totalMoves: state.totalMoves + 1,
    lastMove: coord,
    movesRemaining: state.movesRemaining - 1,
    winningLine: [],
  }
}

export function applyConfirmedTurn(
  state: GameState,
  coords: ReadonlyArray<HexCoord>,
): GameState {
  if (state.winner || coords.length === 0 || coords.length !== state.movesRemaining) {
    return state
  }

  const nextBoard = new Map(state.board)

  for (const coord of coords) {
    const key = coordKey(coord)
    if (nextBoard.has(key)) {
      return state
    }
    nextBoard.set(key, state.currentPlayer)
  }

  let winningLine: HexCoord[] | null = null
  for (const coord of coords) {
    winningLine = checkWinner(nextBoard, coord, state.currentPlayer)
    if (winningLine) {
      break
    }
  }

  const lastMove = coords[coords.length - 1] ?? null
  const nextTotalMoves = state.totalMoves + coords.length
  const lastTurnMoves = [...coords]

  if (winningLine) {
    return {
      ...state,
      board: nextBoard,
      totalMoves: nextTotalMoves,
      lastMove,
      lastTurnMoves,
      winner: state.currentPlayer,
      winningLine,
      movesRemaining: 0,
    }
  }

  return {
    ...state,
    board: nextBoard,
    currentPlayer: opponentOf(state.currentPlayer),
    movesRemaining: 2,
    turnNumber: state.turnNumber + 1,
    totalMoves: nextTotalMoves,
    lastMove,
    lastTurnMoves,
    winningLine: [],
  }
}

export function buildReplayState(
  moves: ReadonlyArray<GameReplayMove>,
  appliedMoveCount: number,
  turnCommitMode: TurnCommitMode = 'instant',
): GameState {
  const clampedMoveCount = Math.max(
    0,
    Math.min(Math.floor(appliedMoveCount), moves.length),
  )
  let state = createInitialGameState()

  if (turnCommitMode === 'confirmTurn') {
    let index = 0

    while (index < clampedMoveCount) {
      const move = moves[index]
      if (!move) {
        break
      }

      const turnMoves: GameReplayMove[] = [move]
      index += 1

      while (index < moves.length && moves[index]?.turnNumber === move.turnNumber) {
        turnMoves.push(moves[index]!)
        index += 1
      }

      const appliedTurnMoves = turnMoves.slice(
        0,
        Math.max(0, clampedMoveCount - (index - turnMoves.length)),
      )

      if (appliedTurnMoves.length === turnMoves.length) {
        state = applyConfirmedTurn(
          state,
          appliedTurnMoves.map((entry) => entry.coord),
        )
        continue
      }

      for (const partialMove of appliedTurnMoves) {
        state = applyPendingPlacement(state, partialMove.coord)
      }
    }

    return state
  }

  for (let index = 0; index < clampedMoveCount; index += 1) {
    const move = moves[index]
    if (!move) {
      break
    }

    state = applyMove(state, move.coord)
  }

  return state
}

export function compareCoords(a: HexCoord, b: HexCoord): number {
  if (a.q !== b.q) {
    return a.q - b.q
  }

  return a.r - b.r
}

function collectLine(
  board: Map<string, PlayerSlot>,
  origin: HexCoord,
  player: PlayerSlot,
  direction: HexCoord,
): HexCoord[] {
  const cells: HexCoord[] = []
  let current = add(origin, direction)

  while (board.get(coordKey(current)) === player) {
    cells.push(current)
    current = add(current, direction)
  }

  return cells
}

function add(a: HexCoord, b: HexCoord): HexCoord {
  return {
    q: a.q + b.q,
    r: a.r + b.r,
  }
}

function negate(coord: HexCoord): HexCoord {
  return {
    q: -coord.q,
    r: -coord.r,
  }
}
