import { describe, expect, it } from 'vitest'
import {
  advanceReplayPlayback,
  getReplayPlaybackStart,
  stepReplayMoveCount,
} from './useGameReplay'

describe('useGameReplay helpers', () => {
  it('moves backward and forward across the replay timeline', () => {
    expect(stepReplayMoveCount(0, 1, 4)).toBe(1)
    expect(stepReplayMoveCount(1, 1, 4)).toBe(2)
    expect(stepReplayMoveCount(2, -1, 4)).toBe(1)
    expect(stepReplayMoveCount(4, 1, 4)).toBe(4)
    expect(stepReplayMoveCount(0, -1, 4)).toBe(0)
  })

  it('autoplay advances until the end and then stops', () => {
    expect(advanceReplayPlayback(0, 3)).toEqual({
      appliedMoveCount: 1,
      isPlaying: true,
    })
    expect(advanceReplayPlayback(1, 3)).toEqual({
      appliedMoveCount: 2,
      isPlaying: true,
    })
    expect(advanceReplayPlayback(2, 3)).toEqual({
      appliedMoveCount: 3,
      isPlaying: false,
    })
  })

  it('restarts from the beginning when play is pressed at the final move', () => {
    expect(getReplayPlaybackStart(3, 3)).toEqual({
      appliedMoveCount: 0,
      isPlaying: true,
    })
    expect(getReplayPlaybackStart(1, 3)).toEqual({
      appliedMoveCount: 1,
      isPlaying: true,
    })
  })
})
