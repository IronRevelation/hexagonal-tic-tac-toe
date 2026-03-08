import { useEffect, useState } from 'react'
import { useMutation } from 'convex/react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '../../convex/_generated/api'
import { useGuestSession } from '../lib/GuestSessionProvider'
import { getConvexErrorMessage } from '../lib/convexError'
import { eyebrow, infoCard, pageWrap, secondaryButton, surfacePanel } from '../lib/ui'

export const Route = createFileRoute('/join/$roomCode')({
  component: JoinRoomPage,
})

function JoinRoomPage() {
  const navigate = useNavigate()
  const { roomCode } = Route.useParams()
  const { guestToken, isLoading, ensureGuestSession } = useGuestSession()
  const joinRoom = useMutation(api.privateGames.join)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isLoading) {
      return
    }

    let cancelled = false

    Promise.resolve(guestToken ?? ensureGuestSession())
      .then((activeGuestToken) => joinRoom({ guestToken: activeGuestToken, roomCode }))
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
  }, [ensureGuestSession, guestToken, isLoading, joinRoom, navigate, roomCode])

  return (
    <main className={`${pageWrap} px-4 py-16`}>
      <section
        className={`${surfacePanel} grid max-w-[34rem] gap-4 rounded-[1.7rem] p-[1.4rem] max-[720px]:rounded-[1.35rem]`}
      >
        <p className={eyebrow}>Joining room</p>
        <h1 className="m-0 text-[1.35rem]">Code {roomCode}</h1>
        <p className="m-0 leading-[1.6] text-[var(--sea-ink-soft)]">
          {error
            ? error
            : 'Checking the room and attaching your anonymous guest identity to the match.'}
        </p>
        {!guestToken ? (
          <p className="m-0 text-sm leading-[1.6] text-[var(--sea-ink-soft)]">
            Joining creates an anonymous guest ID on this device, stores a hashed
            copy on the backend, and records gameplay and presence data through
            Convex and Vercel infrastructure. See{' '}
            <Link className="font-semibold text-[var(--sea-ink)]" to="/privacy">
              Privacy
            </Link>{' '}
            for retention, transfers, and deletion options.
          </p>
        ) : null}
        {error ? (
          <button
            className={secondaryButton}
            onClick={() => void navigate({ to: '/' })}
            type="button"
          >
            Return to lobby
          </button>
        ) : (
          <div className={infoCard}>Connecting…</div>
        )}
      </section>
    </main>
  )
}
