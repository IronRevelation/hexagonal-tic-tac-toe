import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '../../convex/_generated/api'
import { useGuestSession } from '../lib/GuestSessionProvider'
import { getConvexErrorMessage } from '../lib/convexError'
import { useVisibleHeartbeat } from '../lib/useVisibleHeartbeat'

export const Route = createFileRoute('/')({
  component: LobbyPage,
})

function LobbyPage() {
  const navigate = useNavigate()
  const { guestToken, session, isLoading, error } = useGuestSession()
  const [roomCode, setRoomCode] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const previousMatchState = useRef<'idle' | 'queued' | 'matched'>('idle')
  const joinMatchmaking = useMutation(api.matchmaking.join)
  const cancelMatchmaking = useMutation(api.matchmaking.cancel)
  const createPrivateGame = useMutation(api.privateGames.create)
  const matchmakingStatus = useQuery(
    api.matchmaking.status,
    guestToken ? { guestToken } : 'skip',
  )

  useVisibleHeartbeat(guestToken)

  useEffect(() => {
    if (!matchmakingStatus) {
      return
    }

    if (
      previousMatchState.current === 'queued' &&
      matchmakingStatus.state === 'matched'
    ) {
      void navigate({
        to: '/games/$gameId',
        params: { gameId: matchmakingStatus.gameId },
      })
    }

    previousMatchState.current = matchmakingStatus.state
  }, [matchmakingStatus, navigate])

  const isAlreadyPlaying =
    session?.activeRole === 'playerOne' || session?.activeRole === 'playerTwo'

  async function handleJoinMatchmaking() {
    if (!guestToken) {
      return
    }

    setPendingAction('matchmaking')
    setActionError(null)

    try {
      const result = await joinMatchmaking({ guestToken })
      if (result.state === 'matched') {
        await navigate({
          to: '/games/$gameId',
          params: { gameId: result.gameId },
        })
      }
    } catch (cause) {
      setActionError(
        getConvexErrorMessage(cause, 'Unable to join matchmaking right now.'),
      )
    } finally {
      setPendingAction(null)
    }
  }

  async function handleCancelMatchmaking() {
    if (!guestToken) {
      return
    }

    setPendingAction('cancel')
    setActionError(null)

    try {
      await cancelMatchmaking({ guestToken })
    } catch (cause) {
      setActionError(
        getConvexErrorMessage(cause, 'Unable to cancel matchmaking right now.'),
      )
    } finally {
      setPendingAction(null)
    }
  }

  async function handleCreatePrivateGame() {
    if (!guestToken) {
      return
    }

    setPendingAction('private')
    setActionError(null)

    try {
      const result = await createPrivateGame({ guestToken })
      await navigate({
        to: '/games/$gameId',
        params: { gameId: result.gameId },
      })
    } catch (cause) {
      setActionError(
        getConvexErrorMessage(cause, 'Unable to create a private room.'),
      )
    } finally {
      setPendingAction(null)
    }
  }

  function handleJoinCodeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!roomCode.trim()) {
      return
    }

    void navigate({
      to: '/join/$roomCode',
      params: { roomCode: roomCode.trim().toUpperCase() },
    })
  }

  return (
    <main className="page-wrap px-4 pb-12 pt-10">
      <section className="hero-card surface-panel">
        <p className="eyebrow">Realtime Multiplayer</p>
        <h1 className="display-title">
          Play infinite-board hexagonal tic-tac-toe online.
        </h1>
        <p className="hero-copy">
          Guest identity is automatic. Matchmaking pairs two random players, and
          private rooms can be shared with a friend or watched by spectators.
        </p>
        <div className="hero-meta">
          <span className="guest-chip hero-chip">
            {isLoading ? 'Creating guest…' : session?.displayName ?? 'Offline guest'}
          </span>
          <Link className="secondary-button" to="/about">
            Review the rules
          </Link>
        </div>
      </section>

      <section className="lobby-grid">
        <article className="surface-panel action-card">
          <p className="eyebrow">Resume</p>
          <h2>Continue where you left off</h2>
          <p>
            Active games stay resumable. If you refresh on the same device, the
            guest token reconnects you automatically.
          </p>
          {session?.activeGameId ? (
            <button
              className="primary-button"
              onClick={() =>
                void navigate({
                  to: '/games/$gameId',
                  params: { gameId: session.activeGameId! },
                })
              }
              type="button"
            >
              Resume as {describeRole(session.activeRole)}
            </button>
          ) : (
            <div className="empty-state">No active game attached to this guest.</div>
          )}
        </article>

        <article className="surface-panel action-card">
          <p className="eyebrow">Matchmaking</p>
          <h2>Find a random opponent</h2>
          <p>
            Queue into the public pool and start instantly when another guest is
            waiting.
          </p>
          {matchmakingStatus?.state === 'queued' ? (
            <div className="stack-sm">
              <div className="notice-card">
                <span className="status-dot is-live" />
                Waiting for another player to join the queue.
              </div>
              <button
                className="secondary-button"
                disabled={pendingAction !== null}
                onClick={() => void handleCancelMatchmaking()}
                type="button"
              >
                {pendingAction === 'cancel' ? 'Cancelling…' : 'Cancel matchmaking'}
              </button>
            </div>
          ) : (
            <button
              className="primary-button"
              disabled={pendingAction !== null || isAlreadyPlaying}
              onClick={() => void handleJoinMatchmaking()}
              type="button"
            >
              {pendingAction === 'matchmaking' ? 'Joining…' : 'Join matchmaking'}
            </button>
          )}
          {isAlreadyPlaying ? (
            <p className="muted-copy">
              Finish or resume your current player game before starting another.
            </p>
          ) : null}
        </article>

        <article className="surface-panel action-card">
          <p className="eyebrow">Private Room</p>
          <h2>Create a code to share</h2>
          <p>
            Open a private room, send the six-character code, and let extra
            guests spectate once both seats are taken.
          </p>
          <button
            className="primary-button"
            disabled={pendingAction !== null || isAlreadyPlaying}
            onClick={() => void handleCreatePrivateGame()}
            type="button"
          >
            {pendingAction === 'private' ? 'Creating…' : 'Create private room'}
          </button>
        </article>

        <article className="surface-panel action-card">
          <p className="eyebrow">Join Room</p>
          <h2>Enter a private code</h2>
          <p>
            A waiting room joins you as a player. A full room joins you as a
            spectator.
          </p>
          <form className="stack-sm" onSubmit={handleJoinCodeSubmit}>
            <label className="field-label" htmlFor="room-code">
              Room code
            </label>
            <input
              id="room-code"
              className="text-input"
              maxLength={6}
              onChange={(event) =>
                setRoomCode(
                  event.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
                )
              }
              placeholder="ABC123"
              value={roomCode}
            />
            <button className="primary-button" type="submit">
              Join room
            </button>
          </form>
        </article>
      </section>

      {error || actionError ? (
        <section className="surface-panel error-panel">
          {error ?? actionError}
        </section>
      ) : null}
    </main>
  )
}

function describeRole(role: string | null | undefined) {
  if (role === 'playerOne') {
    return 'Player 1'
  }
  if (role === 'playerTwo') {
    return 'Player 2'
  }
  if (role === 'spectator') {
    return 'spectator'
  }
  return 'guest'
}
