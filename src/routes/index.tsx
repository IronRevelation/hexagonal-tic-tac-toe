import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '../../convex/_generated/api'
import { useGuestSession } from '../lib/GuestSessionProvider'
import { getConvexErrorMessage } from '../lib/convexError'
import {
  cn,
  displayTitle,
  errorPanel,
  fieldLabel,
  guestChip,
  infoCard,
  modalKicker,
  modalOverlay,
  modalPanel,
  mutedCopy,
  pageWrap,
  primaryButton,
  secondaryButton,
  surfacePanel,
  textInput,
} from '../lib/ui'
import { TIME_CONTROL_PRESETS, type TimeControlPreset } from '../../shared/timeControl'
import { type TurnCommitMode } from '../../shared/hexGame'
import { DEFAULT_PRIVATE_TURN_COMMIT_MODE } from '../lib/turnSubmission'

export const Route = createFileRoute('/')({
  component: LobbyPage,
})

function LobbyPage() {
  const navigate = useNavigate()
  const { guestToken, isLoading, error, ensureGuestSession } = useGuestSession()
  const [roomCode, setRoomCode] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [isTimeControlModalOpen, setIsTimeControlModalOpen] = useState(false)
  const [selectedTimeControl, setSelectedTimeControl] =
    useState<TimeControlPreset>('unlimited')
  const [selectedTurnCommitMode, setSelectedTurnCommitMode] =
    useState<TurnCommitMode>(DEFAULT_PRIVATE_TURN_COMMIT_MODE)
  const previousMatchState = useRef<'idle' | 'queued' | 'matched'>('idle')
  const joinMatchmaking = useMutation(api.matchmaking.join)
  const cancelMatchmaking = useMutation(api.matchmaking.cancel)
  const createPrivateGame = useMutation(api.privateGames.create)
  const lobbyStatus = useQuery(
    api.lobby.statusForGuest,
    guestToken ? { guestToken } : 'skip',
  )

  useEffect(() => {
    if (!lobbyStatus) {
      return
    }

    if (
      previousMatchState.current === 'queued' &&
      lobbyStatus.matchmakingState === 'matched' &&
      lobbyStatus.activeGameId
    ) {
      void navigate({
        to: '/games/$gameId',
        params: { gameId: lobbyStatus.activeGameId },
      })
    }

    previousMatchState.current = lobbyStatus.matchmakingState
  }, [lobbyStatus, navigate])

  const isAlreadyPlaying =
    lobbyStatus?.activeRole === 'playerOne' || lobbyStatus?.activeRole === 'playerTwo'
  const activeGameId = lobbyStatus?.activeGameId ?? null
  const hasActiveGame = activeGameId !== null
  const isQueued = lobbyStatus?.matchmakingState === 'queued'
  const canCreatePrivateRoom = !isQueued && !isAlreadyPlaying

  async function handleJoinMatchmaking() {
    setPendingAction('matchmaking')
    setActionError(null)

    try {
      const activeGuestToken = guestToken ?? (await ensureGuestSession())
      const result = await joinMatchmaking({ guestToken: activeGuestToken })
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

  async function handleCreatePrivateGame(
    timeControl: TimeControlPreset,
    turnCommitMode: TurnCommitMode,
  ) {
    setPendingAction('private')
    setActionError(null)

    try {
      const activeGuestToken = guestToken ?? (await ensureGuestSession())
      const result = await createPrivateGame({
        guestToken: activeGuestToken,
        timeControl,
        turnCommitMode,
      })
      setIsTimeControlModalOpen(false)
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

  function openTimeControlModal() {
    setSelectedTimeControl('unlimited')
    setSelectedTurnCommitMode(DEFAULT_PRIVATE_TURN_COMMIT_MODE)
    setIsTimeControlModalOpen(true)
  }

  return (
    <main className={`${pageWrap} px-4 pb-14 pt-7 max-[720px]:px-2 max-[720px]:pb-10 max-[720px]:pt-4`}>
      <section className="mx-auto grid max-w-[54rem] justify-items-center gap-8 max-[720px]:gap-6">
        <div className="grid content-start justify-items-center gap-5 text-center max-[720px]:justify-items-stretch">
          <div className="grid justify-items-center gap-3 max-[720px]:text-center">
            <h1
              className={`${displayTitle} m-0 max-w-[14ch] text-[clamp(2.8rem,6vw,5.2rem)] max-[720px]:max-w-none max-[720px]:text-[clamp(2.15rem,10vw,3.5rem)]`}
            >
              Hexagonal tic-tac-toe.
            </h1>
            <p className="m-0 max-w-[34rem] text-[1.05rem] leading-[1.85] text-[var(--sea-ink-soft)] max-[720px]:text-[1rem] max-[720px]:leading-[1.7]">
              Start a quick match, open a private room for a friend, or join a
              game with a code. No account needed.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 max-[720px]:grid max-[720px]:grid-cols-[minmax(0,1fr)_auto] max-[720px]:items-stretch">
            <span className={`${guestChip} max-[720px]:w-full`}>
              {isLoading
                ? 'Loading guest…'
                : lobbyStatus?.displayName ?? 'Guest created on first game'}
            </span>
            <Link className={`${secondaryButton} max-[720px]:min-h-[3rem] max-[720px]:px-5`} to="/about">
              Rules
            </Link>
          </div>

          {hasActiveGame ? (
            <div className={`${infoCard} max-w-[34rem]`}>
              Active game available. Resume as {describeRole(lobbyStatus?.activeRole)}.
            </div>
          ) : null}
        </div>

        <div
          className={`${surfacePanel} grid w-full max-w-[42rem] content-start gap-5 rounded-[2rem] p-[clamp(1.6rem,2.4vw,2.2rem)] max-[720px]:gap-4 max-[720px]:rounded-[1.7rem] max-[720px]:p-5`}
        >
          {hasActiveGame ? (
            <button
              className={primaryButton}
              onClick={() =>
                void navigate({
                  to: '/games/$gameId',
                  params: { gameId: activeGameId },
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
              className={`${primaryButton} max-[720px]:w-full`}
              disabled={pendingAction !== null || isAlreadyPlaying}
              onClick={() => void handleJoinMatchmaking()}
              type="button"
            >
              {pendingAction === 'matchmaking' ? 'Joining…' : 'Play random opponent'}
            </button>
          )}

          <button
            className={`${secondaryButton} max-[720px]:w-full`}
            disabled={pendingAction !== null || !canCreatePrivateRoom}
            onClick={() => openTimeControlModal()}
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
              <button className={`${primaryButton} max-[520px]:w-full`} type="submit">
                Join room
              </button>
            </div>
            <p className={`${mutedCopy} m-0 max-[720px]:text-[0.98rem] max-[720px]:leading-[1.7]`}>
              If the room has an open player slot, you&apos;ll join as a player. If both
              player slots are taken, you&apos;ll join as a spectator.
            </p>
          </form>

          {!guestToken ? (
            <p className="m-0 rounded-2xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_86%,white_14%)] px-[0.95rem] py-[0.8rem] text-[0.92rem] leading-[1.7] text-[var(--sea-ink-soft)] max-[720px]:text-[0.98rem]">
              Starting or joining a game creates an anonymous guest ID on this
              device, stores a hashed copy on the backend, and records gameplay
              and presence data through Convex and Vercel infrastructure. See{' '}
              <Link className="inline font-semibold text-[var(--sea-ink)]" to="/privacy">
                Privacy
              </Link>{' '}
              for retention, transfers, and deletion options.
            </p>
          ) : null}

          {isAlreadyPlaying ? (
            <p className={`${mutedCopy} mt-1 mb-0`}>
              Finish or resume your current player game before starting another.
            </p>
          ) : isQueued ? (
            <p className={`${mutedCopy} mt-1 mb-0`}>
              Cancel matchmaking before creating a private room.
            </p>
          ) : null}
        </div>
      </section>

      {isTimeControlModalOpen ? (
        <div className={modalOverlay} role="presentation">
          <section
            aria-labelledby="time-control-title"
            aria-modal="true"
            className={`${modalPanel} w-[min(100%,26rem)] gap-4 p-6 text-left max-[720px]:p-5`}
            role="dialog"
          >
            <div className="grid gap-2 text-center">
              <p className={modalKicker}>Private room</p>
              <h2 id="time-control-title" className="m-0 text-[1.8rem] leading-[1.05]">
                Choose a time control
              </h2>
              <p className="m-0 text-[0.96rem] leading-[1.55] text-[var(--sea-ink-soft)]">
                Matchmaking stays unlimited and uses confirmed turns. Private rooms
                open in a lobby, and timed clocks begin with the first move after
                the creator starts the game.
              </p>
            </div>
            <div className="rounded-[1.15rem] border border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_88%,white_12%)] px-4 py-3 text-[0.82rem] leading-[1.5] text-[var(--sea-ink-soft)]">
              Selected:{' '}
              <strong className="font-semibold text-[var(--sea-ink)]">
                {TIME_CONTROL_PRESETS.find((preset) => preset.value === selectedTimeControl)?.label}
              </strong>
            </div>
            <div className="grid grid-cols-2 gap-2 text-left">
              {TIME_CONTROL_PRESETS.map((preset) => {
                const isSelected = preset.value === selectedTimeControl
                const isWide = preset.value === 'unlimited'

                return (
                  <button
                    key={preset.value}
                    className={cn(
                      'relative grid min-h-[5.2rem] content-between rounded-[1.15rem] border px-4 py-3 text-left transition-[background-color,color,border-color,transform,box-shadow] duration-[180ms]',
                      isWide && 'col-span-2',
                      isSelected
                        ? 'border-[color-mix(in_oklab,var(--amber)_40%,var(--lagoon))] bg-[linear-gradient(155deg,color-mix(in_oklab,var(--surface-strong)_78%,white_22%),color-mix(in_oklab,var(--surface)_88%,var(--amber)_12%))] text-[var(--sea-ink)] shadow-[0_14px_30px_rgba(15,24,32,0.14)]'
                        : 'border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_90%,white_10%)] text-[var(--sea-ink-soft)] hover:border-[color-mix(in_oklab,var(--lagoon)_26%,var(--line))] hover:bg-[color-mix(in_oklab,var(--surface-strong)_88%,white_12%)]',
                    )}
                    onClick={() => setSelectedTimeControl(preset.value)}
                    type="button"
                  >
                    <span
                      className={cn(
                        'absolute right-3 top-3 inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[0.66rem] font-bold uppercase tracking-[0.08em]',
                        isSelected
                          ? 'border-transparent bg-[linear-gradient(135deg,var(--amber),color-mix(in_oklab,var(--amber)_70%,white))] text-[#0f1820]'
                          : 'border-[var(--line)] text-[var(--sea-ink-soft)]',
                      )}
                    >
                      {isSelected ? 'On' : 'Off'}
                    </span>
                    <div className="grid gap-[0.18rem] pr-9">
                      <strong className="text-[1rem] text-[var(--sea-ink)]">
                        {preset.label}
                      </strong>
                      <span className="text-[0.8rem] leading-[1.35]">
                        {preset.description}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="grid gap-3">
              <span className={fieldLabel}>Move submission</span>
              <div className="grid grid-cols-2 gap-2 text-left">
                {[
                  {
                    value: 'confirmTurn',
                    label: 'Confirmed turns',
                    description: 'Place all required hexes, then press Confirm move.',
                  },
                  {
                    value: 'instant',
                    label: 'Instant',
                    description: 'Each click is submitted immediately.',
                  },
                ].map((option) => {
                  const isSelected = selectedTurnCommitMode === option.value

                  return (
                    <button
                      key={option.value}
                      className={cn(
                        'relative grid min-h-[5.2rem] content-between rounded-[1.15rem] border px-4 py-3 text-left transition-[background-color,color,border-color,transform,box-shadow] duration-[180ms]',
                        isSelected
                          ? 'border-[color-mix(in_oklab,var(--amber)_40%,var(--lagoon))] bg-[linear-gradient(155deg,color-mix(in_oklab,var(--surface-strong)_78%,white_22%),color-mix(in_oklab,var(--surface)_88%,var(--amber)_12%))] text-[var(--sea-ink)] shadow-[0_14px_30px_rgba(15,24,32,0.14)]'
                          : 'border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_90%,white_10%)] text-[var(--sea-ink-soft)] hover:border-[color-mix(in_oklab,var(--lagoon)_26%,var(--line))] hover:bg-[color-mix(in_oklab,var(--surface-strong)_88%,white_12%)]',
                      )}
                      onClick={() =>
                        setSelectedTurnCommitMode(option.value as TurnCommitMode)
                      }
                      type="button"
                    >
                      <span
                        className={cn(
                          'absolute right-3 top-3 inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[0.66rem] font-bold uppercase tracking-[0.08em]',
                          isSelected
                            ? 'border-transparent bg-[linear-gradient(135deg,var(--amber),color-mix(in_oklab,var(--amber)_70%,white))] text-[#0f1820]'
                            : 'border-[var(--line)] text-[var(--sea-ink-soft)]',
                        )}
                      >
                        {isSelected ? 'On' : 'Off'}
                      </span>
                      <div className="grid gap-[0.18rem] pr-9">
                        <strong className="text-[1rem] text-[var(--sea-ink)]">
                          {option.label}
                        </strong>
                        <span className="text-[0.8rem] leading-[1.35]">
                          {option.description}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-1 max-[720px]:grid max-[720px]:grid-cols-2">
              <button
                className={secondaryButton}
                disabled={pendingAction === 'private'}
                onClick={() => setIsTimeControlModalOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className={primaryButton}
                disabled={pendingAction === 'private'}
                onClick={() =>
                  void handleCreatePrivateGame(
                    selectedTimeControl,
                    selectedTurnCommitMode,
                  )
                }
                type="button"
              >
                {pendingAction === 'private' ? 'Creating…' : 'Create room'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

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
