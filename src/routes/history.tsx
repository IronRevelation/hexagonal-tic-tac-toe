import { Outlet, createFileRoute } from '@tanstack/react-router'
import { getClientStoredGuestToken } from '../lib/GuestSessionProvider'
import { historyQueryOptions } from '../lib/historyQueries'

export const Route = createFileRoute('/history')({
  preloadStaleTime: 300_000,
  loader: async ({ context }) => {
    const guestToken = getClientStoredGuestToken()
    if (!guestToken) {
      return
    }

    await context.queryClient.ensureQueryData(historyQueryOptions(guestToken))
  },
  component: HistoryLayout,
})

function HistoryLayout() {
  return <Outlet />
}
