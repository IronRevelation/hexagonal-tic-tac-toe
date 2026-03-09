import {
  PRESENCE_TTL_MS,
  type PresenceRecord,
  parsePresenceRecord,
  presenceRedisKey,
} from './presence'
import type { PlayerSlot } from './hexGame'

type UpstashResponse<T> = {
  result?: T
  error?: string
}

async function runUpstashCommand<T>(
  baseUrl: string,
  token: string,
  command: Array<string>,
) {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  })

  if (!response.ok) {
    throw new Error(`Upstash request failed with ${response.status}.`)
  }

  const payload = (await response.json()) as UpstashResponse<T>
  if (payload.error) {
    throw new Error(payload.error)
  }

  return payload.result as T
}

export async function writePresenceRecord(
  baseUrl: string,
  token: string,
  gameId: string,
  slot: PlayerSlot,
  record: PresenceRecord,
) {
  await runUpstashCommand(
    baseUrl,
    token,
    [
      'SET',
      presenceRedisKey(gameId, slot),
      JSON.stringify(record),
      'PX',
      String(PRESENCE_TTL_MS),
    ],
  )
}

export async function readPresenceRecord(
  baseUrl: string,
  token: string,
  gameId: string,
  slot: PlayerSlot,
) {
  const result = await runUpstashCommand<string | null>(
    baseUrl,
    token,
    ['GET', presenceRedisKey(gameId, slot)],
  )

  return parsePresenceRecord(result)
}
