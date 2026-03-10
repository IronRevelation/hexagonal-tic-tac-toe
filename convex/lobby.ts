import { v } from 'convex/values'
import { query } from './_generated/server'
import { resolveLobbyStatus } from './lib'

export const statusForGuest = query({
  args: {
    guestToken: v.string(),
  },
  handler: async (ctx, args) => resolveLobbyStatus(ctx.db, args.guestToken),
})
