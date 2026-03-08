import { useEffect, useState } from 'react'

export function clampReplayMoveCount(value: number, totalMoves: number) {
  return Math.max(0, Math.min(Math.floor(value), totalMoves))
}

export function stepReplayMoveCount(
  currentMoveCount: number,
  delta: number,
  totalMoves: number,
) {
  return clampReplayMoveCount(currentMoveCount + delta, totalMoves)
}

export function getReplayPlaybackStart(
  currentMoveCount: number,
  totalMoves: number,
) {
  return {
    appliedMoveCount:
      currentMoveCount >= totalMoves
        ? 0
        : clampReplayMoveCount(currentMoveCount, totalMoves),
    isPlaying: totalMoves > 0,
  }
}

export function advanceReplayPlayback(
  currentMoveCount: number,
  totalMoves: number,
) {
  const appliedMoveCount = stepReplayMoveCount(currentMoveCount, 1, totalMoves)

  return {
    appliedMoveCount,
    isPlaying: appliedMoveCount < totalMoves,
  }
}

export function useGameReplay({
  moveCount,
  resetKey,
  autoplayDelayMs = 700,
}: {
  moveCount: number
  resetKey: string
  autoplayDelayMs?: number
}) {
  const [appliedMoveCount, setAppliedMoveCount] = useState(moveCount)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    setAppliedMoveCount(moveCount)
    setIsPlaying(false)
  }, [moveCount, resetKey])

  useEffect(() => {
    if (!isPlaying) {
      return
    }
    if (appliedMoveCount >= moveCount) {
      setIsPlaying(false)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setAppliedMoveCount((current) => advanceReplayPlayback(current, moveCount).appliedMoveCount)
    }, autoplayDelayMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [appliedMoveCount, autoplayDelayMs, isPlaying, moveCount])

  function jumpTo(nextMoveCount: number) {
    setAppliedMoveCount(clampReplayMoveCount(nextMoveCount, moveCount))
    setIsPlaying(false)
  }

  function togglePlayback() {
    if (isPlaying) {
      setIsPlaying(false)
      return
    }

    const nextPlayback = getReplayPlaybackStart(appliedMoveCount, moveCount)
    setAppliedMoveCount(nextPlayback.appliedMoveCount)
    setIsPlaying(nextPlayback.isPlaying)
  }

  return {
    appliedMoveCount,
    isPlaying,
    jumpTo,
    goToStart: () => jumpTo(0),
    goToPrevious: () => jumpTo(appliedMoveCount - 1),
    goToNext: () => jumpTo(appliedMoveCount + 1),
    goToEnd: () => jumpTo(moveCount),
    togglePlayback,
  }
}
