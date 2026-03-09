import { describe, expect, it } from 'vitest'
import {
  getPresenceAwaySince,
  parsePresenceRecord,
  presenceRedisKey,
} from './presence'

describe('shared presence helpers', () => {
  it('builds stable redis keys by game and slot', () => {
    expect(presenceRedisKey('game_123', 'one')).toBe('presence:game:game_123:player:one')
  })

  it('parses valid serialized presence records', () => {
    expect(
      parsePresenceRecord(
        JSON.stringify({
          status: 'online',
          lastSeenAt: 100,
          lastAwayAt: null,
        }),
      ),
    ).toEqual({
      status: 'online',
      lastSeenAt: 100,
      lastAwayAt: null,
    })
  })

  it('computes awaySince from explicit away and stale online records', () => {
    expect(
      getPresenceAwaySince(
        {
          status: 'away',
          lastSeenAt: 1_000,
          lastAwayAt: 1_500,
        },
        2_000,
      ),
    ).toBe(1_500)

    expect(
      getPresenceAwaySince(
        {
          status: 'online',
          lastSeenAt: 10_000,
          lastAwayAt: null,
        },
        100_000,
      ),
    ).toBeGreaterThan(10_000)
  })
})
