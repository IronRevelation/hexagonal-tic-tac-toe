import { useEffect, useState } from 'react'
import { useMutation } from 'convex/react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '../../convex/_generated/api'
import { useGuestSession } from '../lib/GuestSessionProvider'
import { getConvexErrorMessage } from '../lib/convexError'

export const Route = createFileRoute('/join/$roomCode')({
  component: JoinRoomPage,
})

function JoinRoomPage() {
  const navigate = useNavigate()
  const { roomCode } = Route.useParams()
  const { guestToken, isLoading } = useGuestSession()
  const joinRoom = useMutation(api.privateGames.join)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!guestToken || isLoading) {
      return
    }

    let cancelled = false

    joinRoom({ guestToken, roomCode })
      .then((result) => {
        if (!cancelled) {
          void navigate({
            to: '/games/$gameId',
            params: { gameId: result.gameId },
          })
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(getConvexErrorMessage(cause, 'Unable to join that room.'))
        }
      })

    return () => {
      cancelled = true
    }
  }, [guestToken, isLoading, joinRoom, navigate, roomCode])

  return (
    <main className="page-wrap px-4 py-16">
      <section className="surface-panel action-card narrow-card">
        <p className="eyebrow">Joining room</p>
        <h1>Code {roomCode}</h1>
        <p>
          {error
            ? error
            : 'Checking the room and attaching your guest identity to the match.'}
        </p>
        {error ? (
          <button
            className="secondary-button"
            onClick={() => void navigate({ to: '/' })}
            type="button"
          >
            Return to lobby
          </button>
        ) : (
          <div className="empty-state">Connecting…</div>
        )}
      </section>
    </main>
  )
}
