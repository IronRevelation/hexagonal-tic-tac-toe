import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import {
  buildGuestSession,
  ensureGuest,
  getGuestRetentionExpiresAt,
  getGuestByToken,
  getParticipant,
  isPlayerParticipant,
  now,
  refreshDisconnectForfeit,
  requireGuest,
} from './lib'

export const ensure = mutation({
  args: {
    guestToken: v.string(),
  },
  handler: async (ctx, args) => {
    const guest = await ensureGuest(ctx, args.guestToken)
    return buildGuestSession(ctx.db, guest)
  },
})

export const session = query({
  args: {
    guestToken: v.string(),
  },
  handler: async (ctx, args) => {
    const guest = await getGuestByToken(ctx.db, args.guestToken)
    if (!guest) {
      return null
    }

    return buildGuestSession(ctx.db, guest)
  },
})

export const heartbeat = mutation({
  args: {
    guestToken: v.string(),
    gameId: v.optional(v.id('games')),
  },
  handler: async (ctx, args) => {
    const guest = await getGuestByToken(ctx.db, args.guestToken)
    if (!guest || guest.state !== 'active') {
      return { ok: false, invalidSession: true as const }
    }

    const seenAt = now()

    await ctx.db.patch(guest._id, {
      lastSeenAt: seenAt,
      retentionExpiresAt: getGuestRetentionExpiresAt(seenAt),
    })

    if (args.gameId) {
      const participant = await getParticipant(ctx.db, args.gameId, guest._id)
      if (participant) {
        const game = await ctx.db.get(args.gameId)
        if (game?.status === 'active' && isPlayerParticipant(participant)) {
          await refreshDisconnectForfeit(ctx, game._id, participant, seenAt)
        } else {
          await ctx.db.patch(participant._id, {
            lastSeenAt: seenAt,
          })
        }
      }
    }

    return { ok: true, invalidSession: false as const }
  },
})

export const leaveFinishedGame = mutation({
  args: {
    guestToken: v.string(),
    gameId: v.id('games'),
  },
  handler: async (ctx, args) => {
    const guest = await requireGuest(ctx.db, args.guestToken)
    const participant = await getParticipant(ctx.db, args.gameId, guest._id)

    if (!participant) {
      return { ok: true }
    }

    await ctx.db.patch(participant._id, {
      lastSeenAt: 0,
    })

    return { ok: true }
  },
})
