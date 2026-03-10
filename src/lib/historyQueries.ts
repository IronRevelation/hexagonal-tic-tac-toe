import { queryOptions } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import type { HistoryPage } from '../../shared/contracts'
import { asGameId } from './ids'
import { getConvexHttpClient } from './convexHttp'

export function historyPageQueryOptions(
  guestToken: string,
  cursor: string | null,
  limit = 20,
) {
  return queryOptions({
    queryKey: ['history', guestToken, cursor, limit],
    queryFn: async (): Promise<HistoryPage> =>
      getConvexHttpClient().query(api.games.listHistoryPageForGuest, {
        guestToken,
        cursor: cursor ?? undefined,
        limit,
      }),
    staleTime: 300_000,
  })
}

export function replayQueryOptions(guestToken: string, gameId: string) {
  return queryOptions({
    queryKey: ['history-replay', guestToken, gameId],
    queryFn: async () =>
      getConvexHttpClient().query(api.games.replayByIdForGuest, {
        guestToken,
        gameId: asGameId(gameId),
      }),
    staleTime: 300_000,
  })
}
