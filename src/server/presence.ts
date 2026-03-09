import { createServerFn } from '@tanstack/react-start'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import {
  PRESENCE_TOKEN_TTL_MS,
  type PresenceTokenPayload,
} from '../../shared/presence'
import { writePresenceRecord } from '../../shared/upstashPresence'
import { asGameId } from '../lib/ids'

type PresenceTokenResponse = {
  token: string
  expiresAt: number
  slot: 'one' | 'two'
}

type PresenceMutationInput = {
  token: string
  gameId: string
}

type PresenceConfig = {
  convexUrl: string
  redisRestUrl: string
  redisRestToken: string
  tokenSecret: string
}

let convexClient: ConvexHttpClient | null = null

function requirePresenceConfig(): PresenceConfig {
  const convexUrl = process.env.VITE_CONVEX_URL
  const redisRestUrl = process.env.UPSTASH_REDIS_REST_URL
  const redisRestToken = process.env.UPSTASH_REDIS_REST_TOKEN
  const tokenSecret = process.env.PRESENCE_TOKEN_SECRET

  if (!convexUrl) {
    throw new Error('Missing VITE_CONVEX_URL.')
  }
  if (!redisRestUrl) {
    throw new Error('Missing UPSTASH_REDIS_REST_URL.')
  }
  if (!redisRestToken) {
    throw new Error('Missing UPSTASH_REDIS_REST_TOKEN.')
  }
  if (!tokenSecret) {
    throw new Error('Missing PRESENCE_TOKEN_SECRET.')
  }

  return {
    convexUrl,
    redisRestUrl,
    redisRestToken,
    tokenSecret,
  }
}

function getConvexClient(url: string) {
  if (!convexClient || convexClient.url !== url) {
    convexClient = new ConvexHttpClient(url)
  }

  return convexClient
}

function base64UrlEncode(value: Uint8Array) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const normalized = padded + '='.repeat((4 - (padded.length % 4 || 4)) % 4)
  return new Uint8Array(Buffer.from(normalized, 'base64'))
}

async function signPresenceToken(
  payload: PresenceTokenPayload,
  secret: string,
) {
  const encodedPayload = new TextEncoder().encode(JSON.stringify(payload))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encodedPayload),
  )

  return `${base64UrlEncode(encodedPayload)}.${base64UrlEncode(signature)}`
}

async function verifyPresenceToken(token: string, secret: string) {
  const [payloadPart, signaturePart] = token.split('.')
  if (!payloadPart || !signaturePart) {
    throw new Error('Invalid presence token.')
  }

  const payloadBytes = base64UrlDecode(payloadPart)
  const signatureBytes = base64UrlDecode(signaturePart)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const isValid = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    payloadBytes,
  )

  if (!isValid) {
    throw new Error('Invalid presence token.')
  }

  const payload = JSON.parse(
    new TextDecoder().decode(payloadBytes),
  ) as PresenceTokenPayload

  if (
    typeof payload.sub !== 'string' ||
    typeof payload.gameId !== 'string' ||
    (payload.slot !== 'one' && payload.slot !== 'two') ||
    typeof payload.exp !== 'number'
  ) {
    throw new Error('Invalid presence token.')
  }

  if (payload.exp <= Date.now()) {
    throw new Error('Presence token expired.')
  }

  return payload
}

function roleToSlot(viewerRole: string | null) {
  if (viewerRole === 'playerOne') {
    return 'one' as const
  }
  if (viewerRole === 'playerTwo') {
    return 'two' as const
  }

  return null
}

export const mintPresenceToken = createServerFn({ method: 'POST' })
  .inputValidator((input: { guestToken: string; gameId: string }) => input)
  .handler(async ({ data }): Promise<PresenceTokenResponse> => {
    const config = requirePresenceConfig()
    const client = getConvexClient(config.convexUrl)
    const game = await client.query(api.games.byIdForGuest, {
      guestToken: data.guestToken,
      gameId: asGameId(data.gameId),
    })

    if (!game) {
      throw new Error('This game is not available to this guest.')
    }

    const slot = roleToSlot(game.viewerRole)
    if (!slot) {
      throw new Error('Only players can use live presence.')
    }

    const expiresAt = Date.now() + PRESENCE_TOKEN_TTL_MS
    const token = await signPresenceToken(
      {
        sub: data.guestToken,
        gameId: data.gameId,
        slot,
        exp: expiresAt,
      },
      config.tokenSecret,
    )

    return {
      token,
      expiresAt,
      slot,
    }
  })

export const touchGamePresence = createServerFn({ method: 'POST' })
  .inputValidator((input: PresenceMutationInput) => input)
  .handler(async ({ data }) => {
    const config = requirePresenceConfig()
    const tokenPayload = await verifyPresenceToken(data.token, config.tokenSecret)

    if (tokenPayload.gameId !== data.gameId) {
      throw new Error('Presence token does not match this game.')
    }

    const timestamp = Date.now()
    await writePresenceRecord(
      config.redisRestUrl,
      config.redisRestToken,
      data.gameId,
      tokenPayload.slot,
      {
        status: 'online',
        lastSeenAt: timestamp,
        lastAwayAt: null,
      },
    )

    return { ok: true as const }
  })

export const markGamePresenceAway = createServerFn({ method: 'POST' })
  .inputValidator((input: PresenceMutationInput) => input)
  .handler(async ({ data }) => {
    const config = requirePresenceConfig()
    const tokenPayload = await verifyPresenceToken(data.token, config.tokenSecret)

    if (tokenPayload.gameId !== data.gameId) {
      throw new Error('Presence token does not match this game.')
    }

    const timestamp = Date.now()
    await writePresenceRecord(
      config.redisRestUrl,
      config.redisRestToken,
      data.gameId,
      tokenPayload.slot,
      {
        status: 'away',
        lastSeenAt: timestamp,
        lastAwayAt: timestamp,
      },
    )

    return { ok: true as const }
  })
