import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
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
  const game = useQuery(
    api.games.byIdForGuest,
    guestToken ? { guestToken, gameId: asGameId(gameId) } : 'skip',
  )
  const placeMove = useMutation(api.games.placeMove)
  const requestRematch = useMutation(api.games.requestRematch)
  const cancelRematch = useMutation(api.games.cancelRematch)

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
  const winnerLabel = game.state.winner ? describePlayer(game, game.state.winner) : null
  const summaryLabel = game.mode === 'private' ? 'Private Room' : 'Live Match'
  const viewerRematchRequested =
    (game.viewerRole === 'playerOne' && game.rematch.requestedByPlayerOne) ||
    (game.viewerRole === 'playerTwo' && game.rematch.requestedByPlayerTwo)
  const rematchReadyCount =
    Number(game.rematch.requestedByPlayerOne) + Number(game.rematch.requestedByPlayerTwo)

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

        {game.status === 'finished' ? (
          <section className="game-utility-card">
            <div className="game-utility-header">
              <span className="game-utility-label">Rematch</span>
              <span className="game-chip">{rematchReadyCount}/2 ready</span>
            </div>
            <p className="game-utility-copy">
              {game.nextGameId
                ? 'Next round is loading.'
                : viewerIsPlayer
                  ? 'Opt in when you are ready.'
                  : 'Waiting for both players to opt in.'}
            </p>

            <div className="rematch-status-row">
              <span className="rematch-status">
                <span
                  className={`status-dot ${
                    game.rematch.requestedByPlayerOne ? 'is-live' : 'is-idle'
                  }`}
                />
                {game.players.one?.displayName ?? 'Player 1'}
              </span>
              <span className="rematch-status">
                <span
                  className={`status-dot ${
                    game.rematch.requestedByPlayerTwo ? 'is-live' : 'is-idle'
                  }`}
                />
                {game.players.two?.displayName ?? 'Player 2'}
              </span>
            </div>

            {viewerIsPlayer && !game.nextGameId ? (
              <button
                className="primary-button"
                disabled={isUpdatingRematch}
                onClick={() => void handleRematchToggle()}
                type="button"
              >
                {isUpdatingRematch
                  ? 'Updating…'
                  : viewerRematchRequested
                    ? 'Cancel rematch'
                    : 'Request rematch'}
              </button>
            ) : null}
          </section>
        ) : null}
      </section>

      {moveError ? <section className="surface-panel error-panel">{moveError}</section> : null}

      <HexBoard
        canPlay={game.viewerCanMove && !waitingForOpponent}
        disabled={isSubmittingMove || game.status !== 'active'}
        onSelect={handleSelect}
        state={game.state}
      />
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
    return `${winnerLabel} wins with six in a row.`
  }

  if (game.status === 'finished') {
    return 'Game finished.'
  }

  return `${currentPlayerLabel} to move.`
}

function buildShareLink(roomCode: string) {
  if (typeof window === 'undefined') {
    return `/join/${roomCode}`
  }

  return `${window.location.origin}/join/${roomCode}`
}
