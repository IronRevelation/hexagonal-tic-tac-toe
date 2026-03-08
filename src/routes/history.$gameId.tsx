import { createFileRoute } from '@tanstack/react-router'
import GameHistoryScreen from '../components/GameHistoryScreen'
import { getClientStoredGuestToken } from '../lib/GuestSessionProvider'
import { replayQueryOptions } from '../lib/historyQueries'

export const Route = createFileRoute('/history/$gameId')({
  loader: async ({ context, params }) => {
    const guestToken = getClientStoredGuestToken()
    if (!guestToken) {
      return
    }

    await context.queryClient.ensureQueryData(
      replayQueryOptions(guestToken, params.gameId),
    )
  },
  component: HistoryReplayPage,
})

function HistoryReplayPage() {
  const { gameId } = Route.useParams()

  return <GameHistoryScreen selectedGameId={gameId} />
}
