import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '../../convex/_generated/api'
import { useGuestSession } from '../lib/GuestSessionProvider'
import { getConvexErrorMessage } from '../lib/convexError'
import {
  displayTitle,
  eyebrow,
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

  const actionCardClass = `${surfacePanel} grid content-start gap-4 rounded-[1.7rem] p-[1.4rem] max-[720px]:rounded-[1.35rem]`

  return (
    <main className={`${pageWrap} px-4 pb-12 pt-10`}>
      <section
        className={`${surfacePanel} relative overflow-hidden rounded-[2rem] p-[clamp(1.6rem,3vw,2.6rem)] before:pointer-events-none before:absolute before:inset-[auto_-6rem_-8rem_auto] before:h-72 before:w-72 before:rounded-full before:bg-[radial-gradient(circle,rgba(78,174,196,0.22),transparent_70%)] before:content-['']`}
      >
        <p className={eyebrow}>Realtime Multiplayer</p>
        <h1
          className={`${displayTitle} mt-[0.15rem] mb-4 max-w-[12ch] text-[clamp(2.8rem,6vw,5.6rem)] max-[720px]:text-[clamp(2.2rem,12vw,3.6rem)]`}
        >
          Play infinite-board hexagonal tic-tac-toe online.
        </h1>
        <p className="m-0 max-w-[56ch] text-[1.02rem] leading-[1.7] text-[var(--sea-ink-soft)]">
          Guest identity is automatic. Matchmaking pairs two random players, and
          private rooms can be shared with a friend or watched by spectators.
        </p>
        <div className="mt-6 flex flex-wrap gap-[0.8rem]">
          <span
            className={`${guestChip} bg-[color-mix(in_oklab,var(--chip-bg)_85%,white_15%)]`}
          >
            {isLoading ? 'Creating guest…' : session?.displayName ?? 'Offline guest'}
          </span>
          <Link className={secondaryButton} to="/about">
            Review the rules
          </Link>
        </div>
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2 max-[820px]:grid-cols-1">
        <article className={actionCardClass}>
          <p className={eyebrow}>Resume</p>
          <h2 className="m-0 text-[1.35rem]">Continue where you left off</h2>
          <p className="m-0 leading-[1.6] text-[var(--sea-ink-soft)]">
            Active games stay resumable. If you refresh on the same device, the
            guest token reconnects you automatically.
          </p>
          {session?.activeGameId ? (
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
              Resume as {describeRole(session.activeRole)}
            </button>
          ) : (
            <div className={infoCard}>No active game attached to this guest.</div>
          )}
        </article>

        <article className={actionCardClass}>
          <p className={eyebrow}>Matchmaking</p>
          <h2 className="m-0 text-[1.35rem]">Find a random opponent</h2>
          <p className="m-0 leading-[1.6] text-[var(--sea-ink-soft)]">
            Queue into the public pool and start instantly when another guest is
            waiting.
          </p>
          {matchmakingStatus?.state === 'queued' ? (
            <div className="grid gap-3">
              <div className={infoCard}>
                <span className="h-[0.7rem] w-[0.7rem] shrink-0 rounded-full bg-[#2bb57d] shadow-[0_0_0_6px_rgba(43,181,125,0.14)]" />
                Waiting for another player to join the queue.
              </div>
              <button
                className={secondaryButton}
                disabled={pendingAction !== null}
                onClick={() => void handleCancelMatchmaking()}
                type="button"
              >
                {pendingAction === 'cancel' ? 'Cancelling…' : 'Cancel matchmaking'}
              </button>
            </div>
          ) : (
            <button
              className={primaryButton}
              disabled={pendingAction !== null || isAlreadyPlaying}
              onClick={() => void handleJoinMatchmaking()}
              type="button"
            >
              {pendingAction === 'matchmaking' ? 'Joining…' : 'Join matchmaking'}
            </button>
          )}
          {isAlreadyPlaying ? (
            <p className={mutedCopy}>
              Finish or resume your current player game before starting another.
            </p>
          ) : null}
        </article>

        <article className={actionCardClass}>
          <p className={eyebrow}>Private Room</p>
          <h2 className="m-0 text-[1.35rem]">Create a code to share</h2>
          <p className="m-0 leading-[1.6] text-[var(--sea-ink-soft)]">
            Open a private room, send the six-character code, and let extra
            guests spectate once both seats are taken.
          </p>
          <button
            className={primaryButton}
            disabled={pendingAction !== null || isAlreadyPlaying}
            onClick={() => void handleCreatePrivateGame()}
            type="button"
          >
            {pendingAction === 'private' ? 'Creating…' : 'Create private room'}
          </button>
        </article>

        <article className={actionCardClass}>
          <p className={eyebrow}>Join Room</p>
          <h2 className="m-0 text-[1.35rem]">Enter a private code</h2>
          <p className="m-0 leading-[1.6] text-[var(--sea-ink-soft)]">
            A waiting room joins you as a player. A full room joins you as a
            spectator.
          </p>
          <form className="grid gap-3" onSubmit={handleJoinCodeSubmit}>
            <label className={fieldLabel} htmlFor="room-code">
              Room code
            </label>
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
          </form>
        </article>
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
