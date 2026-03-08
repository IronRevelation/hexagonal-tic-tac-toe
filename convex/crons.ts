import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.daily(
  'privacy cleanup',
  {
    hourUTC: 3,
    minuteUTC: 15,
  },
  internal.privacy.cleanupExpiredData,
)

export default crons
