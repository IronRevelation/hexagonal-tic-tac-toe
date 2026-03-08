import {
  coordKey,
  type HexCoord,
  type SerializedGameState,
  type TurnCommitMode,
} from '../../shared/hexGame'

export const DEFAULT_PRIVATE_TURN_COMMIT_MODE: TurnCommitMode = 'confirmTurn'

export function getRequiredSelections(
  state: Pick<SerializedGameState, 'movesRemaining'>,
) {
  return state.movesRemaining
}

export function getCanonicalTurnKey(
  gameId: string,
  state: Pick<
    SerializedGameState,
    'currentPlayer' | 'turnNumber' | 'totalMoves'
  >,
) {
  return `${gameId}:${state.turnNumber}:${state.totalMoves}:${state.currentPlayer}`
}

export function togglePendingSelection({
  committedKeys,
  coord,
  pendingCoords,
  requiredSelections,
}: {
  committedKeys: ReadonlySet<string>
  coord: HexCoord
  pendingCoords: ReadonlyArray<HexCoord>
  requiredSelections: number
}) {
  const key = coordKey(coord)
  const existingIndex = pendingCoords.findIndex(
    (pendingCoord) => coordKey(pendingCoord) === key,
  )

  if (existingIndex >= 0) {
    return pendingCoords.filter((_, index) => index !== existingIndex)
  }

  if (committedKeys.has(key) || pendingCoords.length >= requiredSelections) {
    return [...pendingCoords]
  }

  return [...pendingCoords, coord]
}
