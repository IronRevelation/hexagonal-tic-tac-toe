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
  const viewerRematchRequested =
    (game.viewerRole === 'playerOne' && game.rematch.requestedByPlayerOne) ||
    (game.viewerRole === 'playerTwo' && game.rematch.requestedByPlayerTwo)

  return (
    <main className="game-layout page-wrap px-4 pb-10 pt-8">
      <aside className="sidebar panel">
        <p className="eyebrow">Game status</p>
        <h1>{game.mode === 'private' ? 'Private Room' : 'Matchmaking Game'}</h1>
        <p className="intro">{buildTurnCopy(game, currentPlayerLabel, winnerLabel)}</p>

        <section className="status-card">
          <div className="status-heading">
            <span>{viewerIsPlayer ? 'Player seat' : 'Viewing as spectator'}</span>
            <span>Turn {game.state.turnNumber}</span>
          </div>
          <p className="status-copy">
            {viewerIsPlayer
              ? `You are ${game.viewerRole === 'playerOne' ? 'Player 1' : 'Player 2'}.`
              : 'Spectators see the board live but cannot place moves.'}
          </p>

          <div className="player-pills">
            <PlayerCard
              active={currentPlayer === 'one' && game.status === 'active'}
              label={game.players.one?.displayName ?? PLAYER_LABELS.one}
              online={game.players.one?.isOnline ?? false}
              role="Player 1"
              slot="one"
            />
            <PlayerCard
              active={currentPlayer === 'two' && game.status === 'active'}
              label={game.players.two?.displayName ?? PLAYER_LABELS.two}
              online={game.players.two?.isOnline ?? false}
              role={game.players.two ? 'Player 2' : waitingForOpponent ? 'Waiting' : 'Player 2'}
              slot="two"
            />
          </div>

          <div className="meta-grid">
            <div>
              <span className="meta-label">Moves played</span>
              <strong>{game.state.totalMoves}</strong>
            </div>
            <div>
              <span className="meta-label">Moves left</span>
              <strong>{game.status === 'active' ? game.state.movesRemaining : 0}</strong>
            </div>
            <div>
              <span className="meta-label">Last move</span>
              <strong>
                {game.state.lastMove
                  ? `${game.state.lastMove.q}, ${game.state.lastMove.r}`
                  : 'None'}
              </strong>
            </div>
            <div>
              <span className="meta-label">Spectators</span>
              <strong>{game.spectatorCount}</strong>
            </div>
          </div>
        </section>

        {game.mode === 'private' && game.roomCode ? (
          <section className="setup-card">
            <div className="section-heading">
              <h2>Share room</h2>
              <p>Invite a friend or open the game as a spectator.</p>
            </div>
            <div className="share-box">
              <strong>{game.roomCode}</strong>
              <span>{buildShareLink(game.roomCode)}</span>
            </div>
          </section>
        ) : null}

        {game.status === 'finished' ? (
          <section className="setup-card">
            <div className="section-heading">
              <h2>Rematch</h2>
              <p>
                {game.nextGameId
                  ? 'A new round is ready. Redirecting everyone now.'
                  : 'Both players must opt in before the next game begins.'}
              </p>
            </div>
            <div className="rematch-grid">
              <div className="notice-card">
                <span
                  className={`status-dot ${
                    game.rematch.requestedByPlayerOne ? 'is-live' : 'is-idle'
                  }`}
                />
                {game.players.one?.displayName ?? 'Player 1'}{' '}
                {game.rematch.requestedByPlayerOne ? 'is ready' : 'is waiting'}
              </div>
              <div className="notice-card">
                <span
                  className={`status-dot ${
                    game.rematch.requestedByPlayerTwo ? 'is-live' : 'is-idle'
                  }`}
                />
                {game.players.two?.displayName ?? 'Player 2'}{' '}
                {game.rematch.requestedByPlayerTwo ? 'is ready' : 'is waiting'}
              </div>
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
                    ? 'Cancel rematch request'
                    : 'Request rematch'}
              </button>
            ) : null}
          </section>
        ) : null}

        {moveError ? <section className="surface-panel error-panel">{moveError}</section> : null}
      </aside>

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
  online,
  role,
  slot,
}: {
  active: boolean
  label: string
  online: boolean
  role: string
  slot: PlayerSlot
}) {
  return (
    <div className={`player-pill ${active ? 'is-active' : ''} player-${slot}`}>
      <div className="player-pill-copy">
        <strong>{label}</strong>
        <span className="player-pill-role">
          {role} · {online ? 'Online' : 'Offline'}
        </span>
      </div>
      <span className="player-pill-mark">{slot === 'one' ? 'X' : 'O'}</span>
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

  return `${currentPlayerLabel} to move with ${game.state.movesRemaining} ${
    game.state.movesRemaining === 1 ? 'placement' : 'placements'
  } left this turn.`
}

function buildShareLink(roomCode: string) {
  if (typeof window === 'undefined') {
    return `/join/${roomCode}`
  }

  return `${window.location.origin}/join/${roomCode}`
}
