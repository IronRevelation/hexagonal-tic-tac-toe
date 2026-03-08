// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveLiveClockState } from './useGameClock'

describe('useGameClock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-08T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks the active player clock against server time', () => {
    const serverNow = Date.now()

    vi.advanceTimersByTime(2_250)

    const state = resolveLiveClockState(
      {
        preset: '3m',
        initialTimeMs: 180_000,
        remainingMs: {
          one: 180_000,
          two: 180_000,
        },
        activePlayer: 'one',
        serverNow,
      },
      Date.now(),
    )

    expect(state.remainingMs.one).toBe(177_750)
    expect(state.remainingMs.two).toBe(180_000)
  })

  it('does not tick paused clocks', () => {
    const serverNow = Date.now()

    vi.advanceTimersByTime(5_000)

    const state = resolveLiveClockState(
      {
        preset: '5m',
        initialTimeMs: 300_000,
        remainingMs: {
          one: 300_000,
          two: 300_000,
        },
        activePlayer: null,
        serverNow,
      },
      Date.now(),
    )

    expect(state.remainingMs.one).toBe(300_000)
    expect(state.remainingMs.two).toBe(300_000)
  })

  it('formats clock text for timed games', () => {
    const state = resolveLiveClockState(
      {
        preset: '3m',
        initialTimeMs: 180_000,
        remainingMs: {
          one: 180_000,
          two: 59_900,
        },
        activePlayer: null,
        serverNow: Date.now(),
      },
      Date.now(),
    )

    expect(state.displayText.one).toBe('3:00')
    expect(state.displayText.two).toBe('0:59')
  })

  it('shows tenths for the active player even above one minute', () => {
    const state = resolveLiveClockState(
      {
        preset: '3m',
        initialTimeMs: 180_000,
        remainingMs: {
          one: 179_800,
          two: 180_000,
        },
        activePlayer: 'one',
        serverNow: Date.now(),
      },
      Date.now(),
    )

    expect(state.displayText.one).toBe('2:59.8')
    expect(state.displayText.two).toBe('3:00')
  })

  it('clamps the active player clock at zero', () => {
    const state = resolveLiveClockState(
      {
        preset: '1m',
        initialTimeMs: 60_000,
        remainingMs: {
          one: 500,
          two: 60_000,
        },
        activePlayer: 'one',
        serverNow: Date.now(),
      },
      Date.now() + 2_000,
    )

    expect(state.remainingMs.one).toBe(0)
    expect(state.remainingMs.two).toBe(60_000)
    expect(state.displayText.one).toBe('0:00.0')
  })
})
