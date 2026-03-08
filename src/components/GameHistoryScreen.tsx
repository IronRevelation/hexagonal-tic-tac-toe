import { Suspense, type ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
} from 'lucide-react'
import type {
  GameHistoryEntry,
  GameHistoryResult,
  GameReplayData,
  GameReplayMove,
} from '../../shared/contracts'
import {
  PLAYER_MARKS,
  buildReplayState,
  serializeGameState,
} from '../../shared/hexGame'
import { useGuestSession } from '../lib/GuestSessionProvider'
import { historyQueryOptions, replayQueryOptions } from '../lib/historyQueries'
import { useGameReplay } from '../lib/useGameReplay'
import {
  cn,
  eyebrow,
  pageWrap,
  primaryButton,
  secondaryButton,
  surfacePanel,
} from '../lib/ui'
import HexBoard from './HexBoard'

export default function GameHistoryScreen({
  selectedGameId,
}: {
  selectedGameId: string | null
}) {
  const { guestToken, isReady } = useGuestSession()

  if (!isReady) {
    return (
      <main className={`${pageWrap} px-4 py-10 max-[720px]:px-2 max-[720px]:py-6`}>
        <section className={`${surfacePanel} grid gap-3 rounded-[1.5rem] p-5`}>
          <p className={eyebrow}>Loading</p>
          <h1 className="m-0 text-[1.35rem]">Loading history…</h1>
        </section>
      </main>
    )
  }

  return (
    <main className={`${pageWrap} px-4 py-8 max-[720px]:px-2 max-[720px]:py-5`}>
      <section className="grid gap-4 min-[1080px]:grid-cols-[19rem_minmax(0,1fr)]">
        {guestToken ? (
          <Suspense
            fallback={
              <HistoryListPanel
                entries={[]}
                hasGuestToken
                isLoading
                selectedGameId={selectedGameId}
              />
            }
          >
            <HistoryListPanelLoader
              guestToken={guestToken}
              selectedGameId={selectedGameId}
            />
          </Suspense>
        ) : (
          <HistoryListPanel
            entries={[]}
            hasGuestToken={false}
            isLoading={false}
            selectedGameId={selectedGameId}
          />
        )}
        <ReplayPanelShell
          guestToken={guestToken}
          hasGuestToken={guestToken !== null}
          selectedGameId={selectedGameId}
        />
      </section>
    </main>
  )
}

function HistoryListPanelLoader({
  guestToken,
  selectedGameId,
}: {
  guestToken: string
  selectedGameId: string | null
}) {
  const { data: entries } = useSuspenseQuery(historyQueryOptions(guestToken))

  return (
    <HistoryListPanel
      entries={entries}
      hasGuestToken={true}
      isLoading={false}
      selectedGameId={selectedGameId}
    />
  )
}

function HistoryListPanel({
  entries,
  hasGuestToken,
  isLoading,
  selectedGameId,
}: {
  entries: GameHistoryEntry[]
  hasGuestToken: boolean
  isLoading: boolean
  selectedGameId: string | null
}) {
  return (
    <section className={`${surfacePanel} grid content-start gap-3 rounded-[1.55rem] p-4 max-[720px]:rounded-[1.25rem] max-[720px]:p-3`}>
      <div className="grid gap-1">
        <p className={eyebrow}>History</p>
        <h1 className="m-0 text-[1.35rem]">Previous games</h1>
        <p className="m-0 text-[0.86rem] text-[var(--sea-ink-soft)]">
          Finished games are kept for 30 days.
        </p>
      </div>

      {!hasGuestToken ? (
        <EmptyPanel
          title="Play a game to start building history."
          body="Guest history appears here once this browser has finished games."
        />
      ) : isLoading ? (
        <EmptyPanel title="Loading games…" body="Fetching your finished games." />
      ) : entries.length === 0 ? (
        <EmptyPanel
          title="No finished games yet."
          body="Complete a game as a player to see it here."
        />
      ) : (
        <div className="grid gap-2">
          {entries.map((entry) => {
            const isSelected = entry.gameId === selectedGameId

            return (
              <Link
                key={entry.gameId}
                className={cn(
                  'grid gap-2 rounded-[1.1rem] border border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_85%,transparent_15%)] px-4 py-3 no-underline transition-[border-color,background-color] duration-[180ms] hover:border-[color-mix(in_oklab,var(--lagoon)_28%,var(--line))] hover:bg-[color-mix(in_oklab,var(--surface-strong)_86%,transparent_14%)]',
                  isSelected &&
                    'border-[color-mix(in_oklab,var(--lagoon)_34%,var(--line))] bg-[color-mix(in_oklab,var(--surface-strong)_90%,transparent_10%)]',
                )}
                params={{ gameId: entry.gameId }}
                to="/history/$gameId"
              >
                <div className="grid gap-2 min-[340px]:grid-cols-[minmax(0,1fr)_auto] min-[340px]:items-start">
                  <div className="grid min-w-0 gap-[0.15rem]">
                    <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[0.96rem] text-[var(--sea-ink)]">
                      {entry.opponent?.displayName ?? 'Unknown opponent'}
                    </strong>
                    <span className="text-[0.74rem] uppercase tracking-[0.1em] text-[var(--sea-ink-soft)]">
                      {entry.mode === 'private' ? 'Private' : 'Matchmaking'} ·{' '}
                      {formatTimeControl(entry.timeControl)}
                    </span>
                  </div>
                  <ResultBadge result={entry.result} />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8rem] text-[var(--sea-ink-soft)]">
                  <span>{formatFinishedAt(entry.finishedAt)}</span>
                  <span>
                    {entry.totalMoves} move{entry.totalMoves === 1 ? '' : 's'}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ReplayPanelShell({
  guestToken,
  hasGuestToken,
  selectedGameId,
}: {
  guestToken: string | null
  hasGuestToken: boolean
  selectedGameId: string | null
}) {
  if (selectedGameId === null) {
    return (
      <section className={`${surfacePanel} grid min-h-[38rem] place-items-center rounded-[1.7rem] p-5 max-[720px]:min-h-[20rem] max-[720px]:rounded-[1.35rem]`}>
        <EmptyPanel
          title="Select a game to replay."
          body="Open any finished game from the list to step through the moves."
        />
      </section>
    )
  }

  if (!guestToken) {
    return (
      <section className={`${surfacePanel} grid min-h-[38rem] place-items-center rounded-[1.7rem] p-5 max-[720px]:min-h-[20rem] max-[720px]:rounded-[1.35rem]`}>
        <EmptyPanel
          action={
            <Link className={secondaryButton} to="/history">
              Back to history
            </Link>
          }
          title="This game is not available to this guest."
          body="Only finished games you played on this guest session can be replayed here."
        />
      </section>
    )
  }

  return (
    <Suspense fallback={<ReplayPanelLoading />}>
      <ReplayPanelLoader guestToken={guestToken} selectedGameId={selectedGameId} />
    </Suspense>
  )
}

function ReplayPanelLoading() {
  return (
    <section className={`${surfacePanel} grid min-h-[38rem] place-items-center rounded-[1.7rem] p-5 max-[720px]:min-h-[20rem] max-[720px]:rounded-[1.35rem]`}>
      <EmptyPanel
        title="Loading replay…"
        body="Preparing this game's move history."
      />
    </section>
  )
}

function ReplayPanelLoader({
  guestToken,
  selectedGameId,
}: {
  guestToken: string
  selectedGameId: string
}) {
  const { data: replay } = useSuspenseQuery(
    replayQueryOptions(guestToken, selectedGameId),
  )
  const { appliedMoveCount, goToEnd, goToNext, goToPrevious, goToStart, isPlaying, jumpTo, togglePlayback } =
    useGameReplay({
      moveCount: replay?.moves.length ?? 0,
      resetKey: replay?.gameId ?? selectedGameId,
    })
  const replayState =
    !replay
      ? null
      : appliedMoveCount === replay.moves.length
        ? replay.finalState
        : serializeGameState(buildReplayState(replay.moves, appliedMoveCount))
  const moveGroups = groupMovesByTurn(replay?.moves ?? [])

  if (!replay || !replayState) {
    return (
      <section className={`${surfacePanel} grid min-h-[38rem] place-items-center rounded-[1.7rem] p-5 max-[720px]:min-h-[20rem] max-[720px]:rounded-[1.35rem]`}>
        <EmptyPanel
          action={
            <Link className={secondaryButton} to="/history">
              Back to history
            </Link>
          }
          title="This game is not available to this guest."
          body="Only finished games you played on this guest session can be replayed here."
        />
      </section>
    )
  }

  return (
    <ReplayPanel
      appliedMoveCount={appliedMoveCount}
      goToEnd={goToEnd}
      goToNext={goToNext}
      goToPrevious={goToPrevious}
      goToStart={goToStart}
      hasGuestToken={true}
      isPlaying={isPlaying}
      jumpTo={jumpTo}
      moveGroups={moveGroups}
      replay={replay}
      replayState={replayState}
      selectedGameId={selectedGameId}
      togglePlayback={togglePlayback}
    />
  )
}

function ReplayPanel({
  appliedMoveCount,
  goToEnd,
  goToNext,
  goToPrevious,
  goToStart,
  hasGuestToken,
  isPlaying,
  jumpTo,
  moveGroups,
  replay,
  replayState,
  selectedGameId,
  togglePlayback,
}: {
  appliedMoveCount: number
  goToEnd: () => void
  goToNext: () => void
  goToPrevious: () => void
  goToStart: () => void
  hasGuestToken: boolean
  isPlaying: boolean
  jumpTo: (moveCount: number) => void
  moveGroups: Array<{ turnNumber: number; moves: GameReplayMove[] }>
  replay: GameReplayData | null
  replayState: GameReplayData['finalState'] | null
  selectedGameId: string | null
  togglePlayback: () => void
}) {

  return (
    <section className={`${surfacePanel} grid content-start gap-3 rounded-[1.55rem] p-4 max-[720px]:rounded-[1.25rem] max-[720px]:p-3`}>
      <div className="grid gap-1">
          <p className={eyebrow}>Replay</p>
          <h2 className="m-0 text-[1.25rem] leading-[1.2]">
            {replay.players.one.displayName} vs {replay.players.two.displayName}
          </h2>
          <p className="m-0 text-[0.86rem] leading-[1.55] text-[var(--sea-ink-soft)]">
            {describeReplayResult(replay)} · {describeFinishReason(replay.finishReason)} ·{' '}
            {replay.mode === 'private' ? 'Private' : 'Matchmaking'} ·{' '}
            {formatTimeControl(replay.timeControl)} · {formatFinishedAt(replay.finishedAt)}
          </p>
      </div>

      <HexBoard
        canPlay={false}
        disabled
        onSelect={() => {}}
        state={replayState}
      />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[var(--line)] pt-3">
        <strong className="text-[0.88rem] text-[var(--sea-ink)]">
          Position {appliedMoveCount} / {replay.moves.length}
        </strong>
        <span className="text-[0.8rem] text-[var(--sea-ink-soft)]">
          {appliedMoveCount === 0
            ? 'Start position'
            : formatMoveLabel(replay.moves[appliedMoveCount - 1] ?? null)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <ControlButton
          disabled={appliedMoveCount === 0}
          icon={<ChevronsLeft size={14} strokeWidth={2.2} />}
          label="Start"
          onClick={goToStart}
        />
        <ControlButton
          disabled={appliedMoveCount === 0}
          icon={<ChevronLeft size={14} strokeWidth={2.2} />}
          label="Prev"
          onClick={goToPrevious}
        />
        <button
          className={cn(primaryButton, 'min-h-[2.35rem] rounded-xl px-3 py-2 text-[0.88rem]')}
          onClick={togglePlayback}
          type="button"
        >
          {isPlaying ? <Pause size={14} strokeWidth={2.2} /> : <Play size={14} strokeWidth={2.2} />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <ControlButton
          disabled={appliedMoveCount === replay.moves.length}
          icon={<ChevronRight size={14} strokeWidth={2.2} />}
          label="Next"
          onClick={goToNext}
        />
        <ControlButton
          disabled={appliedMoveCount === replay.moves.length}
          icon={<ChevronsRight size={14} strokeWidth={2.2} />}
          label="End"
          onClick={goToEnd}
        />
      </div>

      <section className="grid gap-2 border-t border-[var(--line)] pt-3">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-[0.92rem] text-[var(--sea-ink)]">Moves</strong>
          <span className="text-[0.78rem] text-[var(--sea-ink-soft)]">Jump to move</span>
        </div>
        <div className="grid max-h-[16rem] content-start gap-2 overflow-y-auto pr-1">
          <div className="grid gap-1">
            <span className="text-[0.68rem] font-bold uppercase tracking-[0.11em] text-[var(--sea-ink-soft)]">
              Start
            </span>
            <div>
              <MoveChip
                active={appliedMoveCount === 0}
                label="Position 0"
                onClick={() => jumpTo(0)}
              />
            </div>
          </div>
          {moveGroups.map((group) => (
            <div
              className="grid gap-1 border-t border-[color:color-mix(in_oklab,var(--line)_78%,transparent)] pt-2 first:border-t-0 first:pt-0"
              key={group.turnNumber}
            >
              <div className="grid gap-1 min-[700px]:grid-cols-[3.75rem_minmax(0,1fr)] min-[700px]:items-start">
                <span className="pt-[0.35rem] text-[0.68rem] font-bold uppercase tracking-[0.11em] text-[var(--sea-ink-soft)]">
                  T{group.turnNumber}
                </span>
                <div className="flex flex-wrap gap-2">
                {group.moves.map((move) => {
                  const moveCount = move.moveIndex + 1

                  return (
                    <MoveChip
                      key={move.moveIndex}
                      active={appliedMoveCount === moveCount}
                      label={`${moveCount}. ${formatMoveLabel(move)}`}
                      onClick={() => jumpTo(moveCount)}
                    />
                  )
                })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  )
}

function EmptyPanel({
  action,
  body,
  title,
}: {
  action?: ReactNode
  body: string
  title: string
}) {
  return (
    <div className="grid max-w-[28rem] justify-items-start gap-3 text-left">
      <h2 className="m-0 text-[1.25rem] text-[var(--sea-ink)]">{title}</h2>
      <p className="m-0 leading-[1.65] text-[var(--sea-ink-soft)]">{body}</p>
      {action}
    </div>
  )
}

function ControlButton({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        secondaryButton,
        'min-h-[2.35rem] rounded-xl px-3 py-2 text-[0.88rem]',
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  )
}

function MoveChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        'rounded-md border px-2.5 py-1.5 text-left text-[0.8rem] transition-[border-color,background-color,color] duration-[180ms]',
        active
          ? 'border-[color-mix(in_oklab,var(--lagoon)_34%,var(--line))] bg-[color-mix(in_oklab,var(--surface-strong)_94%,transparent_6%)] text-[var(--sea-ink)]'
          : 'border-[color:color-mix(in_oklab,var(--line)_82%,transparent)] bg-transparent text-[var(--sea-ink-soft)] hover:border-[color-mix(in_oklab,var(--lagoon)_24%,var(--line))] hover:bg-[color-mix(in_oklab,var(--surface)_45%,transparent_55%)] hover:text-[var(--sea-ink)]',
      )}
      onClick={onClick}
      type="button"
    >
      <span className="block leading-[1.25]">{label}</span>
    </button>
  )
}

function ResultBadge({ result }: { result: GameHistoryResult }) {
  const palette =
    result === 'win'
      ? 'border-[rgba(76,168,112,0.18)] bg-[rgba(93,176,124,0.12)] text-[#1d6b36]'
      : result === 'loss'
        ? 'border-[rgba(214,118,95,0.2)] bg-[rgba(214,118,95,0.1)] text-[#9b4b33]'
        : 'border-[rgba(85,135,160,0.18)] bg-[rgba(85,135,160,0.1)] text-[#28556b]'

  return (
    <span
      className={`inline-flex min-h-[1.9rem] shrink-0 items-center justify-center self-start whitespace-nowrap rounded-full border px-3 text-[0.78rem] font-bold uppercase tracking-[0.08em] ${palette}`}
    >
      {result}
    </span>
  )
}

function groupMovesByTurn(moves: GameReplayMove[]) {
  const grouped = new Map<number, GameReplayMove[]>()

  for (const move of moves) {
    const group = grouped.get(move.turnNumber)
    if (group) {
      group.push(move)
    } else {
      grouped.set(move.turnNumber, [move])
    }
  }

  return Array.from(grouped.entries()).map(([turnNumber, groupedMoves]) => ({
    turnNumber,
    moves: groupedMoves,
  }))
}

function formatMoveLabel(move: GameReplayMove | null) {
  if (!move) {
    return 'Start position'
  }

  return `${PLAYER_MARKS[move.slot]} · (${move.coord.q}, ${move.coord.r})`
}

function describeReplayResult(replay: GameReplayData) {
  if (replay.finishReason === 'drawAgreement' || replay.winnerSlot === null) {
    return 'Draw'
  }

  return replay.winnerSlot === replay.viewerSlot ? 'You won' : 'You lost'
}

function describeFinishReason(finishReason: GameReplayData['finishReason']) {
  if (finishReason === 'drawAgreement') {
    return 'Draw agreed'
  }
  if (finishReason === 'forfeit') {
    return 'Ended by forfeit'
  }
  if (finishReason === 'timeout') {
    return 'Ended on time'
  }
  if (finishReason === 'line') {
    return 'Won by line'
  }

  return 'Finished game'
}

function formatFinishedAt(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}

function formatTimeControl(timeControl: GameHistoryEntry['timeControl']) {
  return timeControl === 'unlimited' ? 'Unlimited' : timeControl
}
