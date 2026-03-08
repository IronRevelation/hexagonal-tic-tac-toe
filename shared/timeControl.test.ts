import { describe, expect, it } from 'vitest'
import { getInitialClockMs, TIME_CONTROL_PRESETS } from './timeControl'

describe('time control presets', () => {
  it('keeps the room choices in the expected order', () => {
    expect(TIME_CONTROL_PRESETS.map((preset) => preset.value)).toEqual([
      'unlimited',
      '1m',
      '3m',
      '5m',
      '10m',
    ])
  })

  it('maps presets to their starting clock values', () => {
    expect(getInitialClockMs('unlimited')).toBeNull()
    expect(getInitialClockMs('1m')).toBe(60_000)
    expect(getInitialClockMs('3m')).toBe(180_000)
    expect(getInitialClockMs('5m')).toBe(300_000)
    expect(getInitialClockMs('10m')).toBe(600_000)
  })
})
