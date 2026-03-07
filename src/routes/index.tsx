import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '../../convex/_generated/api'
import { useGuestSession } from '../lib/GuestSessionProvider'
import { getConvexErrorMessage } from '../lib/convexError'
import {
  displayTitle,
  errorPanel,
  fieldLabel,
  guestChip,
  infoCard,
  mutedCopy,
  pageWrap,
  primaryButton,
  secondaryButton,
  surfacePanel,
  textInput,
} from '../lib/ui'
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
  const hasActiveGame = Boolean(session?.activeGameId)
  const isQueued = matchmakingStatus?.state === 'queued'

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
    <main className={`${pageWrap} px-4 pb-16 pt-10`}>
      <section className="mx-auto grid max-w-[54rem] justify-items-center gap-10">
        <div className="grid content-start justify-items-center gap-6 text-center">
          <div className="grid justify-items-center gap-3">
            <h1
              className={`${displayTitle} m-0 max-w-[14ch] text-[clamp(2.8rem,6vw,5.2rem)] max-[720px]:max-w-[11ch] max-[720px]:text-[clamp(2.15rem,11vw,3.3rem)]`}
            >
              Hexagonal tic-tac-toe.
            </h1>
            <p className="m-0 max-w-[34rem] text-[1.05rem] leading-[1.85] text-[var(--sea-ink-soft)]">
              Start a quick match, open a private room for a friend, or join a
              game with a code. No account needed.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className={guestChip}>
              {isLoading ? 'Creating guest…' : session?.displayName ?? 'Offline guest'}
            </span>
            <Link className={secondaryButton} to="/about">
              Rules
            </Link>
          </div>

          {hasActiveGame ? (
            <div className={`${infoCard} max-w-[34rem]`}>
              Active game available. Resume as {describeRole(session?.activeRole)}.
            </div>
          ) : null}
        </div>

        <div
          className={`${surfacePanel} grid w-full max-w-[42rem] content-start gap-5 rounded-[2rem] p-[clamp(1.6rem,2.4vw,2.2rem)]`}
        >
          {hasActiveGame ? (
            <button
              className={primaryButton}
              onClick={() =>
                void navigate({
                  to: '/games/$gameId',
                  params: { gameId: session.activeGameId! },
                })
              }
              type="button"
            >
              Resume game
            </button>
          ) : null}

          {isQueued ? (
            <>
              <div className={infoCard}>
                <span className="h-[0.7rem] w-[0.7rem] shrink-0 rounded-full bg-[#2bb57d] shadow-[0_0_0_6px_rgba(43,181,125,0.14)]" />
                Waiting for another player.
              </div>
              <button
                className={secondaryButton}
                disabled={pendingAction !== null}
                onClick={() => void handleCancelMatchmaking()}
                type="button"
              >
                {pendingAction === 'cancel' ? 'Cancelling…' : 'Cancel matchmaking'}
              </button>
            </>
          ) : (
            <button
              className={primaryButton}
              disabled={pendingAction !== null || isAlreadyPlaying}
              onClick={() => void handleJoinMatchmaking()}
              type="button"
            >
              {pendingAction === 'matchmaking' ? 'Joining…' : 'Play random opponent'}
            </button>
          )}

          <button
            className={secondaryButton}
            disabled={pendingAction !== null || isAlreadyPlaying}
            onClick={() => void handleCreatePrivateGame()}
            type="button"
          >
            {pendingAction === 'private' ? 'Creating…' : 'Create private room'}
          </button>

          <form className="grid gap-3 pt-1" onSubmit={handleJoinCodeSubmit}>
            <label className={fieldLabel} htmlFor="room-code">
              Join with code
            </label>
            <div className="grid gap-2 min-[520px]:grid-cols-[minmax(0,1fr)_auto]">
              <input
                id="room-code"
                className={textInput}
                maxLength={6}
                onChange={(event) =>
                  setRoomCode(
                    event.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
                  )
                }
                placeholder="ABC123"
                value={roomCode}
              />
              <button className={primaryButton} type="submit">
                Join room
              </button>
            </div>
            <p className={`${mutedCopy} m-0`}>
              Open seat joins as player. Full room joins as spectator.
            </p>
          </form>

          {isAlreadyPlaying ? (
            <p className={`${mutedCopy} mt-1 mb-0`}>
              Finish or resume your current player game before starting another.
            </p>
          ) : null}
        </div>
      </section>

      {error || actionError ? (
        <section className={`${surfacePanel} ${errorPanel}`}>
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
