import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../convex/_generated/api'
import { asGameId } from './ids'

export function historyQueryOptions(guestToken: string | 'skip') {
  return convexQuery(api.games.listHistoryForGuest, guestToken === 'skip' ? 'skip' : { guestToken })
}

export function replayQueryOptions(
  guestToken: string | 'skip',
  gameId: string | 'skip',
) {
  return convexQuery(
    api.games.replayByIdForGuest,
    guestToken === 'skip' || gameId === 'skip'
      ? 'skip'
      : {
          guestToken,
          gameId: asGameId(gameId),
        },
  )
}
