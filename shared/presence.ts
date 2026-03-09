import type { PlayerSlot } from './hexGame'

export const PRESENCE_TOUCH_MS = 30_000
export const PRESENCE_FRESH_MS = 60_000
export const PRESENCE_STALE_AWAY_MS = 75_000
export const PRESENCE_TTL_MS = 300_000
export const PRESENCE_TOKEN_TTL_MS = 15 * 60 * 1000
export const PRESENCE_TOKEN_REFRESH_BUFFER_MS = 60_000
export const DISCONNECT_VERIFIER_MS = 30_000
export const DISCONNECT_FORFEIT_MS = 90_000

export type PresenceRecordStatus = 'online' | 'away'

export type PresenceRecord = {
  status: PresenceRecordStatus
  lastSeenAt: number
  lastAwayAt: number | null
}

export type PresenceTokenPayload = {
  sub: string
  gameId: string
  slot: PlayerSlot
  exp: number
}

export function presenceRedisKey(gameId: string, slot: PlayerSlot) {
  return `presence:game:${gameId}:player:${slot}`
}

export function parsePresenceRecord(value: unknown): PresenceRecord | null {
  if (typeof value !== 'string') {
    return null
  }

  try {
    const parsed = JSON.parse(value) as Partial<PresenceRecord>
    if (
      (parsed.status === 'online' || parsed.status === 'away') &&
      typeof parsed.lastSeenAt === 'number' &&
      (typeof parsed.lastAwayAt === 'number' || parsed.lastAwayAt === null)
    ) {
      return {
        status: parsed.status,
        lastSeenAt: parsed.lastSeenAt,
        lastAwayAt: parsed.lastAwayAt,
      }
    }
  } catch {
    return null
  }

  return null
}

export function getPresenceAwaySince(
  record: PresenceRecord | null,
  checkedAt: number,
) {
  if (!record) {
    return checkedAt
  }

  if (record.status === 'away') {
    return record.lastAwayAt ?? record.lastSeenAt
  }

  if (checkedAt - record.lastSeenAt > PRESENCE_STALE_AWAY_MS) {
    return record.lastSeenAt + PRESENCE_STALE_AWAY_MS
  }

  return null
}
