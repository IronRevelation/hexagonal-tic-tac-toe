import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import {
  ensureGuest,
  getParticipant,
  refreshGuestLiveStatus,
  resolveGuestProfile,
  requireGuest,
} from './lib'

export const ensure = mutation({
  args: {
    guestToken: v.string(),
  },
  handler: async (ctx, args) => {
    const guest = await ensureGuest(ctx, args.guestToken)
    return {
      displayName: guest.displayName,
    }
  },
})

export const profile = query({
  args: {
    guestToken: v.string(),
  },
  handler: async (ctx, args) => {
    return resolveGuestProfile(ctx.db, args.guestToken)
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
    await refreshGuestLiveStatus(ctx.db, guest)

    return { ok: true }
  },
})
