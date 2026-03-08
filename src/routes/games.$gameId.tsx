import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, Copy, Flag, Handshake, Trash2 } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { GameSnapshot } from '../../shared/contracts'
import { PLAYER_LABELS, type HexCoord, type PlayerSlot } from '../../shared/hexGame'
import HexBoard from '../components/HexBoard'
import { useGuestSession } from '../lib/GuestSessionProvider'
import { getConvexErrorMessage } from '../lib/convexError'
import { asGameId } from '../lib/ids'
import {
  brandOrb,
  cn,
  dangerButton,
  eyebrow,
  errorPanel,
  modalKicker,
  modalOverlay,
  modalPanel,
  navLink,
  navLinkActive,
  pageWrap,
  primaryButton,
  secondaryButton,
  surfacePanel,
} from '../lib/ui'
import { useVisibleHeartbeat } from '../lib/useVisibleHeartbeat'

export const Route = createFileRoute('/games/$gameId')({
  component: GamePage,
})

function GamePage() {
  const navigate = useNavigate()
  const { gameId } = Route.useParams()
  const { guestToken, isLoading: isGuestLoading } = useGuestSession()
  const [moveError, setMoveError] = useState<string | null>(null)
  const [isSubmittingMove, setIsSubmittingMove] = useState(false)
  const [isUpdatingRematch, setIsUpdatingRematch] = useState(false)
  const [isOfferingDraw, setIsOfferingDraw] = useState(false)
  const [isRespondingToDraw, setIsRespondingToDraw] = useState(false)
  const [isForfeitingGame, setIsForfeitingGame] = useState(false)
  const [isConfirmingForfeit, setIsConfirmingForfeit] = useState(false)
  const [isDeletingRoom, setIsDeletingRoom] = useState(false)
  const [isConfirmingDeleteRoom, setIsConfirmingDeleteRoom] = useState(false)
  const [copiedShareLink, setCopiedShareLink] = useState(false)
  const [isLeavingGame, setIsLeavingGame] = useState(false)
  const game = useQuery(
    api.games.byIdForGuest,
    guestToken ? { guestToken, gameId: asGameId(gameId) } : 'skip',
  )
  const placeMove = useMutation(api.games.placeMove)
  const requestRematch = useMutation(api.games.requestRematch)
  const cancelRematch = useMutation(api.games.cancelRematch)
  const offerDraw = useMutation(api.games.offerDraw)
  const acceptDraw = useMutation(api.games.acceptDraw)
  const declineDraw = useMutation(api.games.declineDraw)
  const forfeitGame = useMutation(api.games.forfeitGame)
  const leaveFinishedGame = useMutation(api.guests.leaveFinishedGame)
  const deletePrivateRoom = useMutation(api.privateGames.remove)

  useVisibleHeartbeat(guestToken, gameId)

  useEffect(() => {
    if (game?.nextGameId && game.nextGameId !== game.gameId) {
      void navigate({
        to: '/games/$gameId',
        params: { gameId: game.nextGameId },
      })
    }
  }, [game?.gameId, game?.nextGameId, navigate])

  useEffect(() => {
    if (!copiedShareLink) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setCopiedShareLink(false)
    }, 1800)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [copiedShareLink])

  async function handleSelect(coord: HexCoord) {
    if (!guestToken) {
      return
    }

    setIsSubmittingMove(true)
    setMoveError(null)

    try {
      await placeMove({
        guestToken,
        gameId: asGameId(gameId),
        coord,
      })
    } catch (cause) {
      setMoveError(getConvexErrorMessage(cause, 'Unable to place that move.'))
    } finally {
      setIsSubmittingMove(false)
    }
  }

  async function handleRematchToggle() {
    if (!guestToken || !game) {
      return
    }

    setIsUpdatingRematch(true)
    setMoveError(null)

    try {
      const hasRequested =
        (game.viewerRole === 'playerOne' && game.rematch.requestedByPlayerOne) ||
        (game.viewerRole === 'playerTwo' && game.rematch.requestedByPlayerTwo)

      if (hasRequested) {
        await cancelRematch({
          guestToken,
          gameId: asGameId(gameId),
        })
      } else {
        await requestRematch({
          guestToken,
          gameId: asGameId(gameId),
        })
      }
    } catch (cause) {
      setMoveError(getConvexErrorMessage(cause, 'Unable to update the rematch state.'))
    } finally {
      setIsUpdatingRematch(false)
    }
  }

  async function handleLeaveGame() {
    if (!guestToken) {
      void navigate({ to: '/' })
      return
    }

    setIsLeavingGame(true)

    try {
      if (game?.status === 'finished') {
        await leaveFinishedGame({
          guestToken,
          gameId: asGameId(gameId),
        })
      }
    } finally {
      void navigate({ to: '/' })
    }
  }

  async function handleOfferDraw() {
    if (!guestToken || !game) {
      return
    }

    setIsOfferingDraw(true)
    setMoveError(null)

    try {
      await offerDraw({
        guestToken,
        gameId: asGameId(gameId),
      })
    } catch (cause) {
      setMoveError(getConvexErrorMessage(cause, 'Unable to offer a draw.'))
    } finally {
      setIsOfferingDraw(false)
    }
  }

  async function handleDrawResponse(action: 'accept' | 'decline') {
    if (!guestToken || !game) {
      return
    }

    setIsRespondingToDraw(true)
    setMoveError(null)

    try {
      if (action === 'accept') {
        await acceptDraw({
          guestToken,
          gameId: asGameId(gameId),
        })
      } else {
        await declineDraw({
          guestToken,
          gameId: asGameId(gameId),
        })
      }
    } catch (cause) {
      setMoveError(
        getConvexErrorMessage(
          cause,
          action === 'accept' ? 'Unable to accept the draw.' : 'Unable to decline the draw.',
        ),
      )
    } finally {
      setIsRespondingToDraw(false)
    }
  }

  async function handleConfirmForfeit() {
    if (!guestToken || !game) {
      return
    }

    setIsForfeitingGame(true)
    setMoveError(null)

    try {
      await forfeitGame({
        guestToken,
        gameId: asGameId(gameId),
      })
      setIsConfirmingForfeit(false)
    } catch (cause) {
      setMoveError(getConvexErrorMessage(cause, 'Unable to forfeit the game.'))
    } finally {
      setIsForfeitingGame(false)
    }
  }

  async function handleCopyShareLink() {
    if (!game?.roomCode) {
      return
    }

    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        throw new Error('Clipboard unavailable')
      }

      await navigator.clipboard.writeText(buildShareLink(game.roomCode))
      setCopiedShareLink(true)
    } catch {
      setMoveError('Unable to copy the room link on this device.')
    }
  }

  async function handleDeleteRoom() {
    if (!guestToken || !game) {
      return
    }

    setIsDeletingRoom(true)
    setMoveError(null)

    try {
      await deletePrivateRoom({
        guestToken,
        gameId: asGameId(gameId),
      })
      setIsConfirmingDeleteRoom(false)
      await navigate({ to: '/' })
    } catch (cause) {
      setMoveError(getConvexErrorMessage(cause, 'Unable to delete this private room.'))
    } finally {
      setIsDeletingRoom(false)
    }
  }

  if (isGuestLoading || (guestToken !== null && game === undefined)) {
    return (
      <main className={`${pageWrap} px-4 py-16`}>
        <section
          className={`${surfacePanel} grid max-w-[34rem] gap-4 rounded-[1.7rem] p-[1.4rem] max-[720px]:rounded-[1.35rem]`}
        >
          <p className={eyebrow}>Loading game</p>
          <h1 className="m-0 text-[1.35rem]">Syncing live state…</h1>
        </section>
      </main>
    )
  }

  if (!game) {
    return (
      <main className={`${pageWrap} px-4 py-16`}>
        <section
          className={`${surfacePanel} grid max-w-[34rem] gap-4 rounded-[1.7rem] p-[1.4rem] max-[720px]:rounded-[1.35rem]`}
        >
          <p className={eyebrow}>Unavailable</p>
          <h1 className="m-0 text-[1.35rem]">This game is not available to this guest.</h1>
          <p className="m-0 leading-[1.6] text-[var(--sea-ink-soft)]">
            Use the private join code or return to the lobby.
          </p>
          <Link className={secondaryButton} to="/">
            Return to lobby
          </Link>
        </section>
      </main>
    )
  }

  const currentPlayer = game.state.currentPlayer
  const viewerIsPlayer =
    game.viewerRole === 'playerOne' || game.viewerRole === 'playerTwo'
  const waitingForOpponent = game.status === 'waiting'
  const currentPlayerLabel = describePlayer(game, currentPlayer)
  const winnerSlot = game.state.winner ?? game.winnerSlot
  const winnerLabel = winnerSlot ? describePlayer(game, winnerSlot) : null
  const summaryLabel = game.mode === 'private' ? 'Private Room' : 'Live Match'
  const privateRoomLink = game.roomCode ? buildShareLink(game.roomCode) : null
  const canDeleteRoom =
    game.canDeleteRoom ||
    (game.mode === 'private' &&
      waitingForOpponent &&
      game.viewerRole === 'playerOne' &&
      game.players.two === null)
  const viewerSlot =
    game.viewerRole === 'playerOne' ? 'one' : game.viewerRole === 'playerTwo' ? 'two' : null
  const opponentSlot =
    viewerSlot === 'one' ? 'two' : viewerSlot === 'two' ? 'one' : null
  const opponentPresence = opponentSlot ? game.players[opponentSlot] : null
  const viewerRematchRequested =
    (game.viewerRole === 'playerOne' && game.rematch.requestedByPlayerOne) ||
    (game.viewerRole === 'playerTwo' && game.rematch.requestedByPlayerTwo)
  const rematchReadyCount =
    Number(game.rematch.requestedByPlayerOne) + Number(game.rematch.requestedByPlayerTwo)
  const pendingDrawOfferedBy = game.drawOffer.offeredBy
  const incomingDrawOffer =
    viewerIsPlayer &&
    viewerSlot !== null &&
    pendingDrawOfferedBy !== null &&
    pendingDrawOfferedBy !== viewerSlot
  const outgoingDrawOffer =
    viewerIsPlayer && viewerSlot !== null && pendingDrawOfferedBy === viewerSlot
  const drawOfferPlayerLabel =
    pendingDrawOfferedBy ? describePlayer(game, pendingDrawOfferedBy) : null
  const nextDrawOfferMoveIndex =
    viewerSlot === 'one'
      ? game.drawOffer.minMoveIndexForPlayerOne
      : viewerSlot === 'two'
        ? game.drawOffer.minMoveIndexForPlayerTwo
        : 0
  const remainingDrawMoves = Math.max(0, nextDrawOfferMoveIndex - game.state.totalMoves)
  const canOfferDraw =
    viewerIsPlayer &&
    game.status === 'active' &&
    !waitingForOpponent &&
    pendingDrawOfferedBy === null &&
    remainingDrawMoves === 0
  const opponentLeft =
    game.status === 'finished' &&
    viewerIsPlayer &&
    opponentPresence !== null &&
    !opponentPresence.isOnline &&
    !game.nextGameId

  return (
    <main className="mx-auto grid h-dvh w-[calc(100%-2rem)] max-w-[1680px] grid-rows-[auto_minmax(0,1fr)] gap-[0.6rem] px-4 py-3 max-[1080px]:min-h-dvh max-[1080px]:w-[min(100%,calc(100%-2rem))] max-[720px]:w-[min(100%,calc(100%-1rem))]">
      <section className={`${surfacePanel} rounded-[1.6rem] px-[0.95rem] py-[0.65rem]`}>
        <div className="grid items-center gap-x-4 gap-y-2 min-[1240px]:grid-cols-[auto_minmax(0,1fr)_auto] max-[1239px]:grid-cols-[auto_minmax(0,1fr)] max-[920px]:grid-cols-1">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-[0.55rem] text-[0.96rem] font-bold text-[var(--sea-ink)] no-underline"
            >
              <span className={brandOrb} />
              <span>Hexagonal Tic-Tac-Toe</span>
            </Link>

            <div className="flex items-center gap-4">
              <Link
                to="/"
                className={navLink}
                activeProps={{ className: navLinkActive }}
              >
                Lobby
              </Link>
              <Link
                to="/about"
                className={navLink}
                activeProps={{ className: navLinkActive }}
              >
                Rules
              </Link>
            </div>
          </div>

          <div className="grid min-w-0 gap-x-4 gap-y-2 text-left min-[760px]:grid-cols-[minmax(0,1fr)_auto] min-[1240px]:justify-self-center">
            <div className="grid min-w-0 gap-[0.2rem] content-center">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.72rem] text-[var(--sea-ink-soft)]">
                <span className="font-bold uppercase tracking-[0.12em]">
                  {summaryLabel}
                </span>
                {game.spectatorCount > 0 ? (
                  <span>
                    {game.spectatorCount} spectator{game.spectatorCount === 1 ? '' : 's'}
                  </span>
                ) : null}
              </div>
              <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[0.98rem] leading-[1.2] max-[720px]:whitespace-normal">
                {buildTurnCopy(game, currentPlayerLabel, winnerLabel)}
              </strong>
            </div>
            {game.roomCode && privateRoomLink ? (
              <div className="grid justify-items-stretch gap-[0.4rem] min-[760px]:justify-self-end">
                <span className="inline-flex h-[1.9rem] w-[7.6rem] items-center justify-center rounded-full border border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_80%,transparent_20%)] px-[0.85rem] py-0 text-[0.74rem] font-bold leading-none tracking-[0.12em] text-[var(--sea-ink)]">
                  {game.roomCode}
                </span>
                <button
                  className="inline-flex h-[1.9rem] w-[7.6rem] items-center justify-center rounded-full border border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_80%,transparent_20%)] px-[0.85rem] py-0 text-[0.74rem] font-medium leading-none text-[var(--sea-ink-soft)]"
                  onClick={() => void handleCopyShareLink()}
                  type="button"
                >
                  <span className="inline-flex min-w-[4.9rem] items-center justify-start gap-[0.35rem]">
                    {copiedShareLink ? (
                      <Check size={13} strokeWidth={2.5} />
                    ) : (
                      <Copy size={13} strokeWidth={2.2} />
                    )}
                    {copiedShareLink ? 'Copied' : 'Copy link'}
                  </span>
                </button>
                {canDeleteRoom ? (
                  <button
                    className="inline-flex h-[1.9rem] w-[7.6rem] items-center justify-center rounded-full border border-[rgba(214,118,95,0.22)] bg-[color-mix(in_oklab,var(--surface)_80%,transparent_20%)] px-[0.85rem] py-0 text-[0.74rem] font-medium leading-none text-[#d98d79]"
                    onClick={() => setIsConfirmingDeleteRoom(true)}
                    type="button"
                  >
                    <span className="inline-flex min-w-[4.9rem] items-center justify-start gap-[0.35rem]">
                      <Trash2 size={13} strokeWidth={2.2} />
                      Delete
                    </span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="justify-self-end max-[1240px]:col-span-2 max-[1240px]:justify-self-stretch max-[920px]:col-span-1">
            <div className="flex flex-wrap items-center gap-[0.45rem] max-[820px]:justify-start">
              <PlayerCard
                active={currentPlayer === 'one' && game.status === 'active'}
                label={game.players.one?.displayName ?? PLAYER_LABELS.one}
                note={game.players.one?.isOnline ? 'Online' : 'Offline'}
                slot="one"
              />
              <PlayerCard
                active={currentPlayer === 'two' && game.status === 'active'}
                label={game.players.two?.displayName ?? PLAYER_LABELS.two}
                note={
                  game.players.two
                    ? game.players.two.isOnline
                      ? 'Online'
                      : 'Offline'
                    : waitingForOpponent
                      ? 'Waiting to join'
                      : 'Player 2'
                }
                slot="two"
              />
            </div>
          </div>
        </div>

        {incomingDrawOffer ? (
          <section className="flex items-center justify-between gap-[0.9rem] rounded-[1.1rem] border border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_82%,transparent_18%)] px-[0.9rem] py-[0.8rem] max-[720px]:flex-col max-[720px]:items-start">
            <div>
              <strong>Draw offered by {drawOfferPlayerLabel}</strong>
              <p className="mt-[0.2rem] text-[0.84rem] text-[var(--sea-ink-soft)]">
                Accept to end the game as a draw, or decline and keep playing.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-[0.65rem]">
              <button
                className={primaryButton}
                disabled={isRespondingToDraw}
                onClick={() => void handleDrawResponse('accept')}
                type="button"
              >
                {isRespondingToDraw ? 'Updating...' : 'Accept'}
              </button>
              <button
                className={secondaryButton}
                disabled={isRespondingToDraw}
                onClick={() => void handleDrawResponse('decline')}
                type="button"
              >
                Decline
              </button>
            </div>
          </section>
        ) : null}

        {outgoingDrawOffer ? (
          <section className="flex items-center gap-[0.9rem] rounded-[1.1rem] border border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_82%,transparent_18%)] px-[0.9rem] py-[0.8rem]">
            <div>
              <strong>Draw offer sent</strong>
              <p className="mt-[0.2rem] text-[0.84rem] text-[var(--sea-ink-soft)]">
                Waiting for your opponent to respond.
              </p>
            </div>
          </section>
        ) : null}
      </section>

      {moveError ? <section className={errorPanel}>{moveError}</section> : null}

      <HexBoard
        canPlay={game.viewerCanMove && !waitingForOpponent}
        disabled={isSubmittingMove || game.status !== 'active'}
        onSelect={handleSelect}
        overlay={
          viewerIsPlayer && game.status === 'active' ? (
            <div className="inline-flex max-w-[11rem] flex-wrap items-center gap-[0.55rem]">
              <button
                aria-label={
                  pendingDrawOfferedBy === null && remainingDrawMoves > 0
                    ? `Offer draw available in ${remainingDrawMoves} moves`
                    : isOfferingDraw
                      ? 'Sending draw offer'
                      : 'Offer draw'
                }
                className="inline-flex h-10 w-10 min-h-0 items-center justify-center rounded-full border border-[rgba(207,228,237,0.18)] bg-[rgba(10,24,35,0.72)] p-0 text-[rgba(221,234,240,0.92)] shadow-[0_10px_24px_rgba(5,13,20,0.22)] backdrop-blur-[10px] transition-[background-color,color,border-color,transform] duration-[180ms] hover:bg-[rgba(16,35,48,0.88)] disabled:cursor-not-allowed disabled:opacity-[0.56]"
                disabled={!canOfferDraw || isOfferingDraw}
                onClick={() => void handleOfferDraw()}
                title={
                  pendingDrawOfferedBy === null && remainingDrawMoves > 0
                    ? `Offer draw available in ${remainingDrawMoves} moves`
                    : 'Offer draw'
                }
                type="button"
              >
                <Handshake size={16} strokeWidth={2.2} />
              </button>
              <button
                aria-label="Forfeit game"
                className="inline-flex h-10 w-10 min-h-0 items-center justify-center rounded-full border border-[rgba(214,118,95,0.28)] bg-[rgba(10,24,35,0.72)] p-0 text-[#ffd7cf] shadow-[0_10px_24px_rgba(5,13,20,0.22)] backdrop-blur-[10px] transition-[background-color,color,border-color,transform] duration-[180ms] hover:bg-[rgba(16,35,48,0.88)] disabled:cursor-not-allowed disabled:opacity-[0.56]"
                disabled={isForfeitingGame}
                onClick={() => setIsConfirmingForfeit(true)}
                title="Forfeit"
                type="button"
              >
                <Flag size={16} strokeWidth={2.2} />
              </button>
              {pendingDrawOfferedBy === null && remainingDrawMoves > 0 ? (
                <span className="inline-flex min-h-8 items-center rounded-full bg-[rgba(10,24,35,0.72)] px-[0.7rem] py-[0.32rem] text-[0.78rem] font-bold text-[var(--sea-ink-soft)] backdrop-blur-[10px]">
                  Draw in {remainingDrawMoves}
                </span>
              ) : null}
            </div>
          ) : null
        }
        state={game.state}
      />

      {game.status === 'finished' ? (
        <div className={modalOverlay} role="presentation">
          <section
            aria-labelledby="game-result-title"
            aria-modal="true"
            className={modalPanel}
            role="dialog"
          >
            <p className={modalKicker}>Game Over</p>
            <h2 id="game-result-title" className="m-0 text-[1.8rem]">
              {buildFinishedTitle(game, winnerLabel)}
            </h2>
            <p className="m-0 text-[var(--sea-ink-soft)]">
              {game.finishReason === 'drawAgreement'
                ? 'Both players agreed to a draw.'
                : game.finishReason === 'forfeit'
                  ? `${winnerLabel ?? 'A player'} won by forfeit.`
                  : opponentLeft
                ? `${opponentPresence?.displayName ?? 'The other player'} left the game.`
                : game.nextGameId
                ? 'Starting the rematch now.'
                : viewerIsPlayer
                  ? 'Choose whether to rematch or leave.'
                : `${rematchReadyCount}/2 players ready.`}
            </p>
            <p className="mt-[-0.2rem] text-[0.8rem] font-bold text-[var(--sea-ink-soft)]">
              {rematchReadyCount}/2 ready for rematch
            </p>
            <div className="flex flex-wrap justify-center gap-3 max-[720px]:flex-col">
              {viewerIsPlayer && !opponentLeft ? (
                <button
                  className={primaryButton}
                  disabled={isUpdatingRematch || Boolean(game.nextGameId)}
                  onClick={() => void handleRematchToggle()}
                  type="button"
                >
                  {game.nextGameId
                    ? 'Rematch'
                    : isUpdatingRematch
                      ? 'Updating...'
                      : viewerRematchRequested
                        ? 'Cancel rematch'
                        : 'Rematch'}
                </button>
              ) : null}
              <button
                className={secondaryButton}
                disabled={isLeavingGame}
                onClick={() => void handleLeaveGame()}
                type="button"
              >
                {isLeavingGame ? 'Leaving...' : 'Leave'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isConfirmingForfeit ? (
        <div className={modalOverlay} role="presentation">
          <section
            aria-labelledby="forfeit-title"
            aria-modal="true"
            className={modalPanel}
            role="dialog"
          >
            <p className={modalKicker}>Confirm</p>
            <h2 id="forfeit-title" className="m-0 text-[1.8rem]">
              Forfeit game?
            </h2>
            <p className="m-0 text-[var(--sea-ink-soft)]">
              This ends the game immediately and counts as a loss.
            </p>
            <div className="flex flex-wrap justify-center gap-3 max-[720px]:flex-col">
              <button
                className={secondaryButton}
                disabled={isForfeitingGame}
                onClick={() => setIsConfirmingForfeit(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className={dangerButton}
                disabled={isForfeitingGame}
                onClick={() => void handleConfirmForfeit()}
                type="button"
              >
                {isForfeitingGame ? 'Forfeiting...' : 'Forfeit'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isConfirmingDeleteRoom ? (
        <div className={modalOverlay} role="presentation">
          <section
            aria-labelledby="delete-room-title"
            aria-modal="true"
            className={modalPanel}
            role="dialog"
          >
            <p className={modalKicker}>Delete room</p>
            <h2 id="delete-room-title" className="m-0 text-[1.8rem]">
              Delete this private room?
            </h2>
            <p className="m-0 text-[var(--sea-ink-soft)]">
              This removes the room code immediately. You can only do this before anyone
              else joins.
            </p>
            <div className="flex flex-wrap justify-center gap-3 max-[720px]:flex-col">
              <button
                className={secondaryButton}
                disabled={isDeletingRoom}
                onClick={() => setIsConfirmingDeleteRoom(false)}
                type="button"
              >
                Keep room
              </button>
              <button
                className={dangerButton}
                disabled={isDeletingRoom}
                onClick={() => void handleDeleteRoom()}
                type="button"
              >
                {isDeletingRoom ? 'Deleting...' : 'Delete room'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

function PlayerCard({
  active,
  label,
  note,
  slot,
}: {
  active: boolean
  label: string
  note: string
  slot: PlayerSlot
}) {
  return (
    <div
      className={cn(
        'grid min-w-[10.2rem] gap-[0.28rem] rounded-[1rem] border border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_78%,transparent_22%)] px-[0.8rem] py-[0.65rem] max-[720px]:w-full max-[720px]:min-w-0',
        active &&
          'border-[color-mix(in_oklab,var(--lagoon)_28%,var(--line))] bg-[color-mix(in_oklab,var(--surface-strong)_84%,transparent_16%)] text-[var(--sea-ink)]',
      )}
    >
      <div className="flex items-center gap-[0.55rem]">
        <span
          className="inline-flex h-[1.45rem] w-[1.45rem] shrink-0 items-center justify-center rounded-full bg-[rgba(255,255,255,0.08)] text-[0.82rem] leading-none font-extrabold text-[var(--sea-ink-soft)] transition-[color] duration-[180ms]"
          style={
            active
              ? { color: slot === 'one' ? 'var(--amber)' : 'var(--lagoon)' }
              : undefined
          }
        >
          {slot === 'one' ? 'X' : 'O'}
        </span>
        <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[0.84rem] font-bold">
          {label}
        </strong>
      </div>
      <span className="text-[0.7rem] text-[var(--sea-ink-soft)]">{note}</span>
    </div>
  )
}

function describePlayer(game: GameSnapshot, slot: PlayerSlot) {
  return game.players[slot]?.displayName ?? PLAYER_LABELS[slot]
}

function buildTurnCopy(
  game: GameSnapshot,
  currentPlayerLabel: string,
  winnerLabel: string | null,
) {
  if (game.status === 'waiting') {
    return 'Waiting for the second player to join this private room.'
  }

  if (winnerLabel) {
    return game.finishReason === 'forfeit'
      ? `${winnerLabel} wins by forfeit.`
      : `${winnerLabel} wins with six in a row.`
  }

  if (game.finishReason === 'drawAgreement') {
    return 'Draw agreed.'
  }

  if (game.status === 'finished') {
    return 'Game finished.'
  }

  return `${currentPlayerLabel} to move.`
}

function buildFinishedTitle(game: GameSnapshot, winnerLabel: string | null) {
  if (game.finishReason === 'drawAgreement') {
    return 'Draw'
  }

  return `${winnerLabel ?? 'Player'} won!`
}

function buildShareLink(roomCode: string) {
  if (typeof window === 'undefined') {
    return `/join/${roomCode}`
  }

  return `${window.location.origin}/join/${roomCode}`
}
