import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import {
  buildGuestSession,
  ensureGuest,
  getGuestByToken,
  getParticipant,
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
