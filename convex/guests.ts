import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { buildGuestSession, ensureGuest, getGuestByToken, getParticipant, now } from './lib'

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
    const guest = await ensureGuest(ctx, args.guestToken)
    const seenAt = now()

    await ctx.db.patch(guest._id, {
      lastSeenAt: seenAt,
    })

    if (args.gameId) {
      const participant = await getParticipant(ctx.db, args.gameId, guest._id)
      if (participant) {
        await ctx.db.patch(participant._id, {
          lastSeenAt: seenAt,
        })
      }
    }

    return { ok: true }
  },
})
