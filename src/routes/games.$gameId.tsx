import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Flag, Handshake } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { GameSnapshot } from '../../shared/contracts'
import { PLAYER_LABELS, type HexCoord, type PlayerSlot } from '../../shared/hexGame'
import HexBoard from '../components/HexBoard'
import { useGuestSession } from '../lib/GuestSessionProvider'
import { getConvexErrorMessage } from '../lib/convexError'
import { asGameId } from '../lib/ids'
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

  useVisibleHeartbeat(guestToken, gameId)

  useEffect(() => {
    if (game?.nextGameId && game.nextGameId !== game.gameId) {
      void navigate({
        to: '/games/$gameId',
        params: { gameId: game.nextGameId },
      })
    }
  }, [game?.gameId, game?.nextGameId, navigate])

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

  if (isGuestLoading || game === undefined) {
    return (
      <main className="page-wrap px-4 py-16">
        <section className="surface-panel action-card narrow-card">
          <p className="eyebrow">Loading game</p>
          <h1>Syncing live state…</h1>
        </section>
      </main>
    )
  }

  if (!game) {
    return (
      <main className="page-wrap px-4 py-16">
        <section className="surface-panel action-card narrow-card">
          <p className="eyebrow">Unavailable</p>
          <h1>This game is not available to this guest.</h1>
          <p>Use the private join code or return to the lobby.</p>
          <Link className="secondary-button inline-flex" to="/">
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
    <main className="game-page px-4 py-3">
      <section className="game-overview panel">
        <div className="game-overview-main">
          <div className="game-overview-start">
            <Link to="/" className="game-wordmark">
              <span className="brand-orb" />
              <span>Hexagonal Tic-Tac-Toe</span>
            </Link>

            <div className="header-links game-nav-links">
              <Link
                to="/"
                className="nav-link"
                activeProps={{ className: 'nav-link is-active' }}
              >
                Lobby
              </Link>
              <Link
                to="/about"
                className="nav-link"
                activeProps={{ className: 'nav-link is-active' }}
              >
                Rules
              </Link>
            </div>
          </div>

          <div className="game-summary-card">
            <span className="game-summary-label">{summaryLabel}</span>
            <strong className="game-summary-title">
              {buildTurnCopy(game, currentPlayerLabel, winnerLabel)}
            </strong>
            <div className="game-summary-meta">
              {game.mode === 'private' && game.roomCode ? <span>Room {game.roomCode}</span> : null}
            </div>
          </div>

          <div className="game-overview-end">
            <div className="game-seats">
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

        {game.mode === 'private' && game.roomCode ? (
          <section className="game-utility-card">
            <div className="game-utility-header">
              <span className="game-utility-label">Share room</span>
              <strong>{game.roomCode}</strong>
            </div>
            <a href={buildShareLink(game.roomCode)}>{buildShareLink(game.roomCode)}</a>
          </section>
        ) : null}

        {incomingDrawOffer ? (
          <section className="game-alert-strip">
            <div>
              <strong>Draw offered by {drawOfferPlayerLabel}</strong>
              <p>Accept to end the game as a draw, or decline and keep playing.</p>
            </div>
            <div className="game-alert-actions">
              <button
                className="primary-button"
                disabled={isRespondingToDraw}
                onClick={() => void handleDrawResponse('accept')}
                type="button"
              >
                {isRespondingToDraw ? 'Updating...' : 'Accept'}
              </button>
              <button
                className="secondary-button"
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
          <section className="game-alert-strip is-passive">
            <div>
              <strong>Draw offer sent</strong>
              <p>Waiting for your opponent to respond.</p>
            </div>
          </section>
        ) : null}
      </section>

      {moveError ? <section className="surface-panel error-panel">{moveError}</section> : null}

      <HexBoard
        canPlay={game.viewerCanMove && !waitingForOpponent}
        disabled={isSubmittingMove || game.status !== 'active'}
        onSelect={handleSelect}
        overlay={
          viewerIsPlayer && game.status === 'active' ? (
            <div className="game-board-actions">
              <button
                aria-label={
                  pendingDrawOfferedBy === null && remainingDrawMoves > 0
                    ? `Offer draw available in ${remainingDrawMoves} moves`
                    : isOfferingDraw
                      ? 'Sending draw offer'
                      : 'Offer draw'
                }
                className="board-icon-button"
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
                className="board-icon-button is-danger"
                disabled={isForfeitingGame}
                onClick={() => setIsConfirmingForfeit(true)}
                title="Forfeit"
                type="button"
              >
                <Flag size={16} strokeWidth={2.2} />
              </button>
              {pendingDrawOfferedBy === null && remainingDrawMoves > 0 ? (
                <span className="board-action-hint">
                  Draw in {remainingDrawMoves}
                </span>
              ) : null}
            </div>
          ) : null
        }
        state={game.state}
      />

      {game.status === 'finished' ? (
        <div className="game-result-overlay" role="presentation">
          <section
            aria-labelledby="game-result-title"
            aria-modal="true"
            className="game-result-modal panel"
            role="dialog"
          >
            <p className="game-result-kicker">Game Over</p>
            <h2 id="game-result-title">{buildFinishedTitle(game, winnerLabel)}</h2>
            <p className="game-result-copy">
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
            <p className="game-result-meta">{rematchReadyCount}/2 ready for rematch</p>
            <div className="game-result-actions">
              {viewerIsPlayer && !opponentLeft ? (
                <button
                  className="primary-button"
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
                className="secondary-button"
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
        <div className="game-result-overlay" role="presentation">
          <section
            aria-labelledby="forfeit-title"
            aria-modal="true"
            className="game-result-modal panel"
            role="dialog"
          >
            <p className="game-result-kicker">Confirm</p>
            <h2 id="forfeit-title">Forfeit game?</h2>
            <p className="game-result-copy">This ends the game immediately and counts as a loss.</p>
            <div className="game-result-actions">
              <button
                className="secondary-button"
                disabled={isForfeitingGame}
                onClick={() => setIsConfirmingForfeit(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button danger-button"
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
    <div className={`player-seat ${active ? 'is-active' : ''} player-${slot}`}>
      <span className="player-seat-mark">{slot === 'one' ? 'X' : 'O'}</span>
      <div className="player-seat-copy">
        <strong>{label}</strong>
        <span className="player-seat-note">{note}</span>
      </div>
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
