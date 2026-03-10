import { internal } from './_generated/api'
import { ConvexError, type GenericId } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import type { DatabaseReader, DatabaseWriter, MutationCtx } from './_generated/server'
import {
  PLAYER_LABELS,
  createInitialGameState,
  deserializeGameState,
  isValidHexCoord,
  opponentOf,
  serializeGameState,
  type GameState,
  type HexCoord,
  type PlayerSlot,
  type SerializedGameState,
  type TurnCommitMode,
} from '../shared/hexGame'
import type {
  DrawOfferState,
  GameClockSnapshot,
  GameHistoryEntry,
  GameHistoryResult,
  GameFinishReason,
  GameMode,
  GameReplayData,
  GameStatus,
  GuestProfile,
  LobbyStatusSnapshot,
  LiveGameCoreSnapshot,
  LiveGameSnapshot,
  LiveGameRoomSnapshot,
  ParticipantRole,
  PresenceAccessSnapshot,
  PrivateLobbyParticipant,
  PrivateLobbySnapshot,
  PlayerPresence,
} from '../shared/contracts'
import {
  getInitialClockMs,
  type TimeControlPreset,
  type TimedTimeControlPreset,
} from '../shared/timeControl'
import { DISCONNECT_VERIFIER_MS } from '../shared/presence'

const ADJECTIVES = [
  'Amber',
  'Brisk',
  'Clever',
  'Daring',
  'Fable',
  'Golden',
  'Ivy',
  'Lively',
  'Mellow',
  'Nova',
  'Pine',
  'Quartz',
  'River',
  'Solar',
  'Topaz',
  'Velvet',
] as const

const ANIMALS = [
  'Badger',
  'Crane',
  'Falcon',
  'Fox',
  'Gecko',
  'Heron',
  'Lynx',
  'Otter',
  'Panda',
  'Raven',
  'Seal',
  'Tiger',
  'Viper',
  'Wolf',
] as const

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const DISCONNECT_FORFEIT_MS = 90_000
export const DRAW_OFFER_COOLDOWN_MOVES = 8
export const MATCHMAKING_RETENTION_MS = 24 * 60 * 60 * 1000
export const WAITING_PRIVATE_ROOM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const FINISHED_GAME_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const GUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const GUEST_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type GuestDoc = Doc<'guests'>
export type GameDoc = Doc<'games'>
export type GameStateDoc = Doc<'gameStates'>
export type GuestLiveStatusDoc = Doc<'guestLiveStatus'>
export type ParticipantDoc = Doc<'gameParticipants'>
export type PlayerParticipantDoc = ParticipantDoc & {
  role: 'playerOne' | 'playerTwo'
}
export type ResolvedTimedClock = GameClockSnapshot
export type StoredStateDoc = NonNullable<GameDoc['serializedState']>
export type GameStateFields = {
  serializedState: StoredStateDoc
  winnerSlot?: GameStateDoc['winnerSlot']
  finishReason?: GameStateDoc['finishReason']
  turnCommitMode?: GameStateDoc['turnCommitMode']
  playerOneTimeRemainingMs?: GameStateDoc['playerOneTimeRemainingMs']
  playerTwoTimeRemainingMs?: GameStateDoc['playerTwoTimeRemainingMs']
  turnStartedAt?: GameStateDoc['turnStartedAt']
  clockTimeoutGeneration?: GameStateDoc['clockTimeoutGeneration']
  clockTimeoutJobId?: GameStateDoc['clockTimeoutJobId']
  drawOfferedBy?: GameStateDoc['drawOfferedBy']
  drawOfferedAtMoveIndex?: GameStateDoc['drawOfferedAtMoveIndex']
  nextDrawOfferMoveIndexPlayerOne?: GameStateDoc['nextDrawOfferMoveIndexPlayerOne']
  nextDrawOfferMoveIndexPlayerTwo?: GameStateDoc['nextDrawOfferMoveIndexPlayerTwo']
  updatedAt: number
}

export function now() {
  return Date.now()
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`)
}

export function toStoredState(state: SerializedGameState) {
  return {
    ...state,
    board: state.board.map(([key, player]) => ({ key, player })),
  }
}

export function fromStoredState(
  state: StoredStateDoc,
): SerializedGameState {
  return {
    ...state,
    board: state.board.map(({ key, player }) => [key, player] as const),
    lastTurnMoves: state.lastTurnMoves ?? (state.lastMove ? [state.lastMove] : []),
  }
}

export function createStoredInitialState() {
  return toStoredState(serializeGameState(createInitialGameState()))
}

export function loadGameState(game: GameDoc): GameState {
  if (!game.serializedState) {
    throw new Error(`Game ${game._id as GenericId<'games'>} is missing legacy state.`)
  }

  return deserializeGameState(fromStoredState(game.serializedState))
}

export function loadSerializedGameState(
  stateFields: Pick<GameStateFields, 'serializedState'>,
): GameState {
  return deserializeGameState(fromStoredState(stateFields.serializedState))
}

export function getLegacyGameStateFields(game: GameDoc): GameStateFields | null {
  if (!game.serializedState) {
    return null
  }

  return {
    serializedState: game.serializedState,
    winnerSlot: game.winnerSlot,
    finishReason: game.finishReason,
    turnCommitMode: game.turnCommitMode,
    playerOneTimeRemainingMs: game.playerOneTimeRemainingMs,
    playerTwoTimeRemainingMs: game.playerTwoTimeRemainingMs,
    turnStartedAt: game.turnStartedAt,
    clockTimeoutGeneration: game.clockTimeoutGeneration,
    clockTimeoutJobId: game.clockTimeoutJobId,
    drawOfferedBy: game.drawOfferedBy,
    drawOfferedAtMoveIndex: game.drawOfferedAtMoveIndex,
    nextDrawOfferMoveIndexPlayerOne: game.nextDrawOfferMoveIndexPlayerOne,
    nextDrawOfferMoveIndexPlayerTwo: game.nextDrawOfferMoveIndexPlayerTwo,
    updatedAt: game.updatedAt,
  }
}

export async function getGameState(
  db: DatabaseReader | DatabaseWriter,
  gameId: Id<'games'>,
) {
  return db
    .query('gameStates')
    .withIndex('by_gameId', (query) => query.eq('gameId', gameId))
    .unique()
}

export async function resolveGameStateFields(
  db: DatabaseReader | DatabaseWriter,
  game: GameDoc,
): Promise<GameStateFields | GameStateDoc | null> {
  return (await getGameState(db, game._id)) ?? getLegacyGameStateFields(game)
}

export async function requireGameStateFields(
  db: DatabaseReader | DatabaseWriter,
  game: GameDoc,
): Promise<GameStateFields | GameStateDoc> {
  const stateFields = await resolveGameStateFields(db, game)
  if (!stateFields) {
    throw new Error(`Game ${game._id as GenericId<'games'>} is missing state.`)
  }

  return stateFields
}

export async function ensureGameStateRecord(
  db: DatabaseWriter,
  game: GameDoc,
): Promise<GameStateDoc> {
  const existing = await getGameState(db, game._id)
  if (existing) {
    const legacy = getLegacyGameStateFields(game)
    const repairPatch: Partial<GameStateDoc> = {}

    if (!(existing as { serializedState?: StoredStateDoc }).serializedState) {
      if (!legacy?.serializedState) {
        throw new Error(`Game ${game._id as GenericId<'games'>} is missing state.`)
      }
      repairPatch.serializedState = legacy.serializedState
    }

    if (!(existing as { turnCommitMode?: TurnCommitMode }).turnCommitMode) {
      repairPatch.turnCommitMode = legacy?.turnCommitMode ?? 'instant'
    }

    if ((existing as { updatedAt?: number }).updatedAt === undefined) {
      repairPatch.updatedAt = legacy?.updatedAt ?? game.updatedAt
    }

    if (Object.keys(repairPatch).length === 0) {
      return existing
    }

    await db.patch(existing._id, repairPatch)
    return {
      ...existing,
      ...repairPatch,
    } as GameStateDoc
  }

  const legacy = getLegacyGameStateFields(game)
  if (!legacy) {
    throw new Error(`Game ${game._id as GenericId<'games'>} is missing state.`)
  }

  const gameStateId = await db.insert('gameStates', {
    gameId: game._id,
    ...legacy,
    turnCommitMode: legacy.turnCommitMode ?? 'instant',
  })

  return (await db.get(gameStateId))!
}

export async function hashGuestToken(guestToken: string) {
  assertValidGuestToken(guestToken)
  const encoded = new TextEncoder().encode(guestToken)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('')
}

export function getGuestRetentionExpiresAt(timestamp: number) {
  return timestamp + GUEST_RETENTION_MS
}

export async function getGuestByToken(
  db: DatabaseReader | DatabaseWriter,
  guestToken: string,
) {
  const guestTokenHash = await hashGuestToken(guestToken)
  return db
    .query('guests')
    .withIndex('by_guestTokenHash', (query) =>
      query.eq('guestTokenHash', guestTokenHash),
    )
    .unique()
}

export async function ensureGuest(
  ctx: MutationCtx,
  guestToken: string,
): Promise<GuestDoc> {
  assertValidGuestToken(guestToken)
  const existing = await getGuestByToken(ctx.db, guestToken)
  const seenAt = now()

  if (existing) {
    await ctx.db.patch(existing._id, {
      retentionExpiresAt: getGuestRetentionExpiresAt(seenAt),
      state: 'active',
    })
    const refreshedGuest: GuestDoc = {
      ...existing,
      retentionExpiresAt: getGuestRetentionExpiresAt(seenAt),
      state: 'active',
    }
    await refreshGuestLiveStatus(ctx.db, refreshedGuest)
    return refreshedGuest
  }

  const displayName = createGuestName(guestToken)
  const guestId = await ctx.db.insert('guests', {
    guestTokenHash: await hashGuestToken(guestToken),
    displayName,
    state: 'active',
    createdAt: seenAt,
    retentionExpiresAt: getGuestRetentionExpiresAt(seenAt),
  })

  const guest = (await ctx.db.get(guestId))!
  await refreshGuestLiveStatus(ctx.db, guest)
  return guest
}

export async function requireGuest(
  db: DatabaseReader | DatabaseWriter,
  guestToken: string,
) {
  const guest = await getGuestByToken(db, guestToken)
  if (guest?.state === 'active') {
    return guest
  }

  throw new ConvexError({
    code: 'INVALID_GUEST_SESSION',
    message: 'Guest session not found. Refresh to create a new guest session.',
  })
}

export async function getParticipant(
  db: DatabaseReader | DatabaseWriter,
  gameId: Id<'games'>,
  guestId: Id<'guests'>,
) {
  return db
    .query('gameParticipants')
    .withIndex('by_gameId_guestId', (query) =>
      query.eq('gameId', gameId).eq('guestId', guestId),
    )
    .unique()
}

export async function listGuestParticipants(
  db: DatabaseReader | DatabaseWriter,
  guestId: Id<'guests'>,
) {
  return db
    .query('gameParticipants')
    .withIndex('by_guestId', (query) => query.eq('guestId', guestId))
    .collect()
}

export async function listParticipants(
  db: DatabaseReader | DatabaseWriter,
  gameId: Id<'games'>,
) {
  return db
    .query('gameParticipants')
    .withIndex('by_gameId', (query) => query.eq('gameId', gameId))
    .collect()
}

export async function getQueueEntry(
  db: DatabaseReader | DatabaseWriter,
  guestId: Id<'guests'>,
) {
  return db
    .query('matchmakingQueue')
    .withIndex('by_guestId', (query) => query.eq('guestId', guestId))
    .unique()
}

export async function getGuestLiveStatus(
  db: DatabaseReader | DatabaseWriter,
  guestId: Id<'guests'>,
) {
  return db
    .query('guestLiveStatus')
    .withIndex('by_guestId', (query) => query.eq('guestId', guestId))
    .unique()
}

export async function findLatestActiveParticipation(
  db: DatabaseReader | DatabaseWriter,
  guestId: Id<'guests'>,
) {
  const participations = await db
    .query('gameParticipants')
    .withIndex('by_guestId', (query) => query.eq('guestId', guestId))
    .collect()
  const ordered = participations.sort((left, right) => right.joinedAt - left.joinedAt)

  for (const participant of ordered) {
    const game = await db.get(participant.gameId)
    if (game && (game.status === 'waiting' || game.status === 'active')) {
      return { participant, game }
    }
  }

  return null
}

export async function refreshGuestLiveStatus(
  db: DatabaseWriter,
  guest: GuestDoc,
) {
  const [liveStatusRow, queueEntry, activeParticipation] = await Promise.all([
    getGuestLiveStatus(db, guest._id),
    getQueueEntry(db, guest._id),
    findLatestActiveParticipation(db, guest._id),
  ])

  const snapshot = {
    guestId: guest._id,
    displayName: guest.displayName,
    activeGameId: activeParticipation?.game._id,
    activeRole: activeParticipation?.participant.role as ParticipantRole | undefined,
    matchmakingState: activeParticipation
      ? 'matched'
      : queueEntry
        ? 'queued'
        : 'idle',
    queuedAt: queueEntry?.queuedAt,
  } as const

  if (liveStatusRow) {
    await db.patch(liveStatusRow._id, snapshot)
    return
  }

  await db.insert('guestLiveStatus', snapshot)
}

export async function resolveGuestProfile(
  db: DatabaseReader | DatabaseWriter,
  guestToken: string,
): Promise<GuestProfile | null> {
  const guest = await getGuestByToken(db, guestToken)
  if (!guest) {
    return null
  }

  const liveStatus = await getGuestLiveStatus(db, guest._id)
  return {
    displayName: liveStatus?.displayName ?? guest.displayName,
  }
}

export async function resolveLobbyStatus(
  db: DatabaseReader | DatabaseWriter,
  guestToken: string,
): Promise<LobbyStatusSnapshot | null> {
  const guest = await getGuestByToken(db, guestToken)
  if (!guest) {
    return null
  }

  const liveStatus = await getGuestLiveStatus(db, guest._id)
  if (liveStatus) {
    return {
      displayName: liveStatus.displayName,
      activeGameId: liveStatus.activeGameId ?? null,
      activeRole: (liveStatus.activeRole as ParticipantRole | undefined) ?? null,
      matchmakingState: liveStatus.matchmakingState,
      queuedAt: liveStatus.queuedAt ?? null,
    }
  }

  const queueEntry = await getQueueEntry(db, guest._id)
  const activeParticipation = await findLatestActiveParticipation(db, guest._id)

  return {
    displayName: guest.displayName,
    activeGameId: activeParticipation?.game._id ?? null,
    activeRole:
      (activeParticipation?.participant.role as ParticipantRole | undefined) ?? null,
    matchmakingState: activeParticipation ? 'matched' : queueEntry ? 'queued' : 'idle',
    queuedAt: queueEntry?.queuedAt ?? null,
  }
}

export async function findAvailableMatchmakingOpponent(
  db: DatabaseReader | DatabaseWriter,
  currentGuestId: Id<'guests'>,
  onStaleQueueEntry?: (entry: Doc<'matchmakingQueue'>) => Promise<void>,
) {
  const queuedEntries = await db
    .query('matchmakingQueue')
    .withIndex('by_queuedAt')
    .collect()

  for (const entry of queuedEntries) {
    if (entry.guestId === currentGuestId) {
      continue
    }

    const activeGame = await findActivePlayerGameParticipant(db, entry.guestId)
    if (activeGame) {
      await onStaleQueueEntry?.(entry)
      continue
    }

    return entry
  }

  return null
}

export async function findActivePlayerGameParticipant(
  db: DatabaseReader | DatabaseWriter,
  guestId: Id<'guests'>,
) {
  const participations = await db
    .query('gameParticipants')
    .withIndex('by_guestId', (query) => query.eq('guestId', guestId))
    .collect()

  const playerParticipations = participations
    .filter(
      (participant) =>
        participant.role === 'playerOne' || participant.role === 'playerTwo',
    )
    .sort((left, right) => right.joinedAt - left.joinedAt)

  for (const participant of playerParticipations) {
    const game = await db.get(participant.gameId)
    if (game && (game.status === 'waiting' || game.status === 'active')) {
      return { participant, game }
    }
  }

  return null
}

export function requirePlayerRole(role: ParticipantRole | null): PlayerSlot {
  if (role === 'playerOne') {
    return 'one'
  }

  if (role === 'playerTwo') {
    return 'two'
  }

  throw new ConvexError({
    code: 'NOT_A_PLAYER',
    message: 'Only players can perform this action.',
  })
}

export function isPlayedHistoryRole(
  role: ParticipantRole | null | undefined,
): role is 'playerOne' | 'playerTwo' {
  return role === 'playerOne' || role === 'playerTwo'
}

export function resolveHistoryResult(
  viewerSlot: PlayerSlot,
  winnerSlot: PlayerSlot | null,
  finishReason: GameFinishReason | null,
): GameHistoryResult {
  if (finishReason === 'drawAgreement' || winnerSlot === null) {
    return 'draw'
  }

  return viewerSlot === winnerSlot ? 'win' : 'loss'
}

export function compareHistoryEntries(
  left: Pick<GameHistoryEntry, 'finishedAt' | 'updatedAt'>,
  right: Pick<GameHistoryEntry, 'finishedAt' | 'updatedAt'>,
) {
  return right.finishedAt - left.finishedAt || right.updatedAt - left.updatedAt
}

export function isPlayerParticipant(
  participant: ParticipantDoc | null,
): participant is PlayerParticipantDoc {
  return participant?.role === 'playerOne' || participant?.role === 'playerTwo'
}

export function normalizeGameTimeControl(game: Pick<GameDoc, 'timeControl'>): TimeControlPreset {
  return game.timeControl ?? 'unlimited'
}

export function normalizeTurnCommitMode(
  game: Pick<GameStateFields, 'turnCommitMode'>,
): TurnCommitMode {
  return game.turnCommitMode ?? 'instant'
}

export function resolveTimedGameClock(
  game: Pick<
    GameDoc,
    | 'status'
    | 'timeControl'
  > &
    Pick<
      GameStateFields,
      | 'playerOneTimeRemainingMs'
      | 'playerTwoTimeRemainingMs'
      | 'turnStartedAt'
    >,
  currentPlayer: PlayerSlot,
  timestamp: number,
): ResolvedTimedClock | null {
  const timeControl = normalizeGameTimeControl(game)
  const initialTimeMs = getInitialClockMs(timeControl)

  if (initialTimeMs === null) {
    return null
  }

  const activePlayer =
    game.status === 'active' && game.turnStartedAt !== undefined ? currentPlayer : null
  const elapsedMs =
    activePlayer !== null && game.turnStartedAt !== undefined
      ? Math.max(0, timestamp - game.turnStartedAt)
      : 0

  const remainingMs = {
    one:
      activePlayer === 'one'
        ? Math.max(0, (game.playerOneTimeRemainingMs ?? initialTimeMs) - elapsedMs)
        : game.playerOneTimeRemainingMs ?? initialTimeMs,
    two:
      activePlayer === 'two'
        ? Math.max(0, (game.playerTwoTimeRemainingMs ?? initialTimeMs) - elapsedMs)
        : game.playerTwoTimeRemainingMs ?? initialTimeMs,
  } satisfies Record<PlayerSlot, number>

  return {
    preset: timeControl as TimedTimeControlPreset,
    initialTimeMs,
    remainingMs,
    activePlayer,
    serverNow: timestamp,
  }
}

export function buildClockStateFields(
  game: Pick<GameDoc, 'status' | 'timeControl'>,
  stateFields: Pick<
    GameStateFields,
    'playerOneTimeRemainingMs' | 'playerTwoTimeRemainingMs' | 'turnStartedAt'
  >,
) {
  return {
    status: game.status,
    timeControl: game.timeControl,
    playerOneTimeRemainingMs: stateFields.playerOneTimeRemainingMs,
    playerTwoTimeRemainingMs: stateFields.playerTwoTimeRemainingMs,
    turnStartedAt: stateFields.turnStartedAt,
  }
}

export function buildResolvedClockPatch(
  clock: ResolvedTimedClock | null,
  nextActivePlayer: PlayerSlot | null,
  timestamp: number,
) {
  if (!clock) {
    return {}
  }

  return {
    playerOneTimeRemainingMs: clock.remainingMs.one,
    playerTwoTimeRemainingMs: clock.remainingMs.two,
    turnStartedAt: nextActivePlayer ? timestamp : undefined,
  }
}

export function buildForfeitGamePatch(slot: PlayerSlot, timestamp: number) {
  return {
    winnerSlot: opponentOf(slot),
    finishReason: 'forfeit' as const,
    status: 'finished' as const,
    finishedAt: timestamp,
    updatedAt: timestamp,
    ...clearDrawOfferFields(),
  }
}

export function buildTimeoutGamePatch(
  slot: PlayerSlot,
  timestamp: number,
  remainingMs: Record<PlayerSlot, number>,
) {
  return {
    winnerSlot: opponentOf(slot),
    finishReason: 'timeout' as const,
    status: 'finished' as const,
    finishedAt: timestamp,
    updatedAt: timestamp,
    playerOneTimeRemainingMs: remainingMs.one,
    playerTwoTimeRemainingMs: remainingMs.two,
    turnStartedAt: undefined,
    clockTimeoutJobId: undefined,
    ...clearDrawOfferFields(),
  }
}

export function clearDrawOfferFields() {
  return {
    drawOfferedBy: undefined,
    drawOfferedAtMoveIndex: undefined,
  }
}

export function clearLegacyGameStateFields() {
  return {
    playerOneTimeRemainingMs: undefined,
    playerTwoTimeRemainingMs: undefined,
    turnStartedAt: undefined,
    clockTimeoutGeneration: undefined,
    clockTimeoutJobId: undefined,
    turnCommitMode: undefined,
    serializedState: undefined,
    winnerSlot: undefined,
    finishReason: undefined,
    drawOfferedBy: undefined,
    drawOfferedAtMoveIndex: undefined,
    nextDrawOfferMoveIndexPlayerOne: undefined,
    nextDrawOfferMoveIndexPlayerTwo: undefined,
  }
}

export function drawOfferCooldownPatch(
  slot: PlayerSlot,
  fromMoveIndex: number,
) {
  const nextMoveIndex = fromMoveIndex + DRAW_OFFER_COOLDOWN_MOVES

  return slot === 'one'
    ? { nextDrawOfferMoveIndexPlayerOne: nextMoveIndex }
    : { nextDrawOfferMoveIndexPlayerTwo: nextMoveIndex }
}

export async function refreshClockTimeout(
  ctx: MutationCtx,
  game: Pick<GameDoc, '_id'> &
    Partial<Pick<GameDoc, 'clockTimeoutGeneration' | 'clockTimeoutJobId'>>,
  clock: ResolvedTimedClock | null,
) {
  const gameState = await getGameState(ctx.db, game._id)
  const currentGeneration =
    gameState?.clockTimeoutGeneration ?? game.clockTimeoutGeneration ?? 0
  const currentJobId = gameState?.clockTimeoutJobId ?? game.clockTimeoutJobId
  const nextGeneration = currentGeneration + 1

  if (currentJobId) {
    try {
      await ctx.scheduler.cancel(currentJobId)
    } catch {
      // The previous timeout may already have completed or been canceled.
    }
  }

  if (!clock || clock.activePlayer === null) {
    const clearedPatch = {
      clockTimeoutGeneration: nextGeneration,
      clockTimeoutJobId: undefined,
    }
    if (gameState) {
      await ctx.db.patch(gameState._id, clearedPatch)
    } else {
      await ctx.db.patch(game._id, clearedPatch)
    }
    return
  }

  const timeoutDelayMs = clock.remainingMs[clock.activePlayer]
  const clockTimeoutJobId = await ctx.scheduler.runAfter(
    timeoutDelayMs,
    internal.games.timeoutActivePlayer,
    {
      gameId: game._id,
      generation: nextGeneration,
    },
  )

  if (gameState) {
    await ctx.db.patch(gameState._id, {
      clockTimeoutGeneration: nextGeneration,
      clockTimeoutJobId,
    })
  } else {
    await ctx.db.patch(game._id, {
      clockTimeoutGeneration: nextGeneration,
      clockTimeoutJobId,
    })
  }
}

export async function refreshDisconnectForfeit(
  ctx: MutationCtx,
  gameId: Id<'games'>,
) {
  const game = await ctx.db.get(gameId)
  if (!game) {
    return
  }

  const players = (await listParticipants(ctx.db, gameId)).filter(isPlayerParticipant)
  const stateFields = await resolveGameStateFields(ctx.db, game)
  const activeSlot =
    game.status === 'active' && stateFields
      ? loadSerializedGameState(stateFields).currentPlayer
      : null
  const timestamp = now()

  for (const participant of players) {
    const nextGeneration = (participant.disconnectForfeitGeneration ?? 0) + 1

    if (participant.disconnectForfeitJobId) {
      try {
        await ctx.scheduler.cancel(participant.disconnectForfeitJobId)
      } catch {
        // The previous timeout may already have completed or been canceled.
      }
    }

    const shouldTrack =
      activeSlot !== null && requirePlayerRole(participant.role) === activeSlot

    if (!shouldTrack) {
      await ctx.db.patch(participant._id, {
        disconnectDeadlineAt: undefined,
        disconnectForfeitGeneration: nextGeneration,
        disconnectForfeitJobId: undefined,
      })
      continue
    }

    const disconnectForfeitJobId = await ctx.scheduler.runAfter(
      DISCONNECT_VERIFIER_MS,
      internal.presence.verifyActivePlayerPresence,
      {
        gameId,
        generation: nextGeneration,
      },
    )

    await ctx.db.patch(participant._id, {
      disconnectDeadlineAt: timestamp + DISCONNECT_FORFEIT_MS,
      disconnectForfeitGeneration: nextGeneration,
      disconnectForfeitJobId,
    })
  }
}

export function chooseOpeningOrder(
  firstGuestId: Id<'guests'>,
  secondGuestId: Id<'guests'>,
  seed: string,
) {
  const hash = hashString(`${firstGuestId}:${secondGuestId}:${seed}`)
  return hash % 2 === 0
    ? {
        playerOneGuestId: firstGuestId,
        playerTwoGuestId: secondGuestId,
      }
    : {
        playerOneGuestId: secondGuestId,
        playerTwoGuestId: firstGuestId,
      }
}

export async function createUniqueRoomCode(
  db: DatabaseReader | DatabaseWriter,
  seed: string,
) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = generateRoomCode(seed, attempt)
    const existing = await db
      .query('games')
      .withIndex('by_roomCode', (query) => query.eq('roomCode', code))
      .unique()

    if (!existing) {
      return code
    }
  }

  throw new Error('Failed to generate a unique room code.')
}

export async function buildLiveGameCoreSnapshot(
  db: DatabaseReader,
  guest: GuestDoc,
  game: GameDoc,
): Promise<LiveGameCoreSnapshot | null> {
  const participants = await listParticipants(db, game._id)
  const viewer = participants.find((participant) => participant.guestId === guest._id) ?? null

  if (!viewer) {
    return null
  }

  const stateFields = await requireGameStateFields(db, game)
  const snapshotTime = now()
  const state = fromStoredState(stateFields.serializedState)
  const clock = resolveTimedGameClock(
    buildClockStateFields(game, stateFields),
    state.currentPlayer,
    snapshotTime,
  )
  const viewerCanMove =
    game.status === 'active' &&
    ((viewer.role === 'playerOne' && state.currentPlayer === 'one') ||
      (viewer.role === 'playerTwo' && state.currentPlayer === 'two'))

  return {
    gameId: game._id,
    status: game.status as GameStatus,
    finishReason: (stateFields.finishReason as GameFinishReason | undefined) ?? null,
    winnerSlot: stateFields.winnerSlot ?? null,
    nextGameId: game.nextGameId ?? null,
    viewerRole: viewer.role as ParticipantRole,
    viewerCanMove,
    turnCommitMode: normalizeTurnCommitMode(stateFields),
    state,
    clock,
    rematch: {
      requestedByPlayerOne: game.rematchRequestedByPlayerOne,
      requestedByPlayerTwo: game.rematchRequestedByPlayerTwo,
      nextGameId: game.nextGameId ?? null,
    },
    drawOffer: {
      offeredBy: stateFields.drawOfferedBy ?? null,
      offeredAtMoveIndex: stateFields.drawOfferedAtMoveIndex ?? null,
      minMoveIndexForPlayerOne: stateFields.nextDrawOfferMoveIndexPlayerOne ?? 0,
      minMoveIndexForPlayerTwo: stateFields.nextDrawOfferMoveIndexPlayerTwo ?? 0,
    } satisfies DrawOfferState,
  }
}

export async function buildLiveGameRoomSnapshot(
  db: DatabaseReader,
  guest: GuestDoc,
  game: GameDoc,
): Promise<LiveGameRoomSnapshot | null> {
  const participants = await listParticipants(db, game._id)
  const viewer = participants.find((participant) => participant.guestId === guest._id) ?? null

  if (!viewer) {
    return null
  }

  const playerOneParticipant =
    participants.find((participant) => participant.role === 'playerOne') ?? null
  const playerTwoParticipant =
    participants.find((participant) => participant.role === 'playerTwo') ?? null
  const spectatorCount = participants.filter(
    (participant) => participant.role === 'spectator',
  ).length

  const [playerOne, playerTwo] = await Promise.all([
    playerOneParticipant ? buildPlayerPresence(db, playerOneParticipant) : Promise.resolve(null),
    playerTwoParticipant ? buildPlayerPresence(db, playerTwoParticipant) : Promise.resolve(null),
  ])

  return {
    gameId: game._id,
    mode: game.mode as GameMode,
    roomCode: game.roomCode ?? null,
    players: {
      one: playerOne,
      two: playerTwo,
    },
    spectatorCount,
    canDeleteRoom: canDeletePrivateRoom(game, participants, guest._id),
  }
}

export async function buildLivePrivateLobbySnapshot(
  db: DatabaseReader,
  guest: GuestDoc,
  game: GameDoc,
): Promise<PrivateLobbySnapshot | null> {
  const participants = await listParticipants(db, game._id)
  const viewer = participants.find((participant) => participant.guestId === guest._id) ?? null

  if (!viewer || game.mode !== 'private' || game.status !== 'waiting') {
    return null
  }

  return buildPrivateLobbySnapshot(db, game, participants, guest._id)
}

export async function buildLiveGameSnapshot(
  db: DatabaseReader,
  guest: GuestDoc,
  game: GameDoc,
): Promise<LiveGameSnapshot | null> {
  const [core, room] = await Promise.all([
    buildLiveGameCoreSnapshot(db, guest, game),
    buildLiveGameRoomSnapshot(db, guest, game),
  ])

  if (!core || !room) {
    return null
  }

  return {
    ...core,
    ...room,
    privateLobby:
      game.mode === 'private' && game.status === 'waiting'
        ? await buildLivePrivateLobbySnapshot(db, guest, game)
        : null,
  }
}

export async function buildPresenceAccessSnapshot(
  db: DatabaseReader,
  guest: GuestDoc,
  game: GameDoc,
): Promise<PresenceAccessSnapshot | null> {
  const participant = await getParticipant(db, game._id, guest._id)
  if (!participant || !isPlayerParticipant(participant)) {
    return null
  }

  return {
    gameId: game._id,
    slot: requirePlayerRole(participant.role),
  }
}

export async function buildHistoryEntry(
  db: DatabaseReader,
  guestId: Id<'guests'>,
  game: GameDoc,
  participant: ParticipantDoc,
): Promise<GameHistoryEntry | null> {
  if (game.status !== 'finished' || participant.guestId !== guestId) {
    return null
  }
  if (!isPlayedHistoryRole(participant.role)) {
    return null
  }

  const viewerSlot = requirePlayerRole(participant.role)
  const opponentSlot = opponentOf(viewerSlot)
  const stateFields = await requireGameStateFields(db, game)
  const opponentGuestId =
    opponentSlot === 'one' ? game.playerOneGuestId : game.playerTwoGuestId
  const opponentGuest = opponentGuestId ? await db.get(opponentGuestId) : null
  const finishReason = (stateFields.finishReason as GameFinishReason | undefined) ?? null

  return {
    gameId: game._id,
    seriesId: game.seriesId ?? null,
    mode: game.mode as GameMode,
    timeControl: normalizeGameTimeControl(game),
    finishReason,
    result: resolveHistoryResult(viewerSlot, stateFields.winnerSlot ?? null, finishReason),
    viewerSlot,
    opponent: opponentGuestId
      ? {
          displayName: opponentGuest?.displayName ?? PLAYER_LABELS[opponentSlot],
          slot: opponentSlot,
        }
      : null,
    finishedAt: game.finishedAt ?? game.updatedAt,
    updatedAt: game.updatedAt,
    totalMoves: stateFields.serializedState.totalMoves,
  }
}

export async function buildReplayData(
  db: DatabaseReader,
  guestId: Id<'guests'>,
  game: GameDoc,
  participant: ParticipantDoc,
): Promise<GameReplayData | null> {
  if (game.status !== 'finished' || participant.guestId !== guestId) {
    return null
  }
  if (!isPlayedHistoryRole(participant.role)) {
    return null
  }

  const viewerSlot = requirePlayerRole(participant.role)
  const [stateFields, playerOneGuest, playerTwoGuest, moves] = await Promise.all([
    requireGameStateFields(db, game),
    game.playerOneGuestId ? db.get(game.playerOneGuestId) : Promise.resolve(null),
    game.playerTwoGuestId ? db.get(game.playerTwoGuestId) : Promise.resolve(null),
    db
      .query('gameMoves')
      .withIndex('by_gameId_moveIndex', (query) => query.eq('gameId', game._id))
      .collect(),
  ])

  return {
    gameId: game._id,
    seriesId: game.seriesId ?? null,
    mode: game.mode as GameMode,
    timeControl: normalizeGameTimeControl(game),
    finishReason: (stateFields.finishReason as GameFinishReason | undefined) ?? null,
    winnerSlot: stateFields.winnerSlot ?? null,
    viewerSlot,
    finishedAt: game.finishedAt ?? game.updatedAt,
    updatedAt: game.updatedAt,
    turnCommitMode: normalizeTurnCommitMode(stateFields),
    players: {
      one: {
        displayName: playerOneGuest?.displayName ?? PLAYER_LABELS.one,
      },
      two: {
        displayName: playerTwoGuest?.displayName ?? PLAYER_LABELS.two,
      },
    },
    finalState: fromStoredState(stateFields.serializedState),
    moves: moves.map((move) => ({
      moveIndex: move.moveIndex,
      turnNumber: move.turnNumber,
      slot: move.slot,
      coord: {
        q: move.q,
        r: move.r,
      },
      createdAt: move.createdAt,
    })),
  }
}

export async function assertCanJoinAsPlayer(
  db: DatabaseReader | DatabaseWriter,
  guestId: Id<'guests'>,
  currentGameId?: Id<'games'>,
) {
  const active = await findActivePlayerGameParticipant(db, guestId)

  if (active && active.game._id !== currentGameId) {
    throw new ConvexError({
      code: 'ALREADY_IN_GAME',
      message: 'You are already playing in another active game.',
    })
  }
}

export function canDeletePrivateRoom(
  game: GameDoc,
  participants: ParticipantDoc[],
  guestId: Id<'guests'>,
) {
  if (game.mode !== 'private' || game.status !== 'waiting') {
    return false
  }

  if (game.createdByGuestId !== guestId || participants.length !== 1) {
    return false
  }

  const [creatorParticipant] = participants

  return (
    creatorParticipant?.guestId === guestId && creatorParticipant.role === 'playerOne'
  )
}

export function canCreatePrivateRoom(isQueuedForMatchmaking: boolean) {
  return !isQueuedForMatchmaking
}

export function throwGameError(
  code:
    | 'GAME_NOT_FOUND'
    | 'ROOM_FULL'
    | 'ROOM_DELETE_NOT_ALLOWED'
    | 'PRIVATE_ROOM_LEAVE_NOT_ALLOWED'
    | 'PRIVATE_ROOM_START_NOT_ALLOWED'
    | 'PRIVATE_ROOM_SWAP_NOT_ALLOWED'
    | 'PRIVATE_ROOM_OPPONENT_REQUIRED'
    | 'NOT_A_PLAYER'
    | 'NOT_YOUR_TURN'
    | 'CELL_OCCUPIED'
    | 'GAME_FINISHED'
    | 'ALREADY_IN_GAME'
    | 'REMATCH_NOT_ALLOWED'
    | 'REMATCH_ALREADY_EXISTS'
    | 'DRAW_NOT_ALLOWED'
    | 'DRAW_ALREADY_PENDING'
    | 'DRAW_NOT_PENDING'
    | 'INVALID_COORD'
    | 'MATCHMAKING_ACTIVE'
    | 'TURN_CONFIRM_REQUIRED'
    | 'INSTANT_MOVE_GAME'
    | 'INVALID_TURN_SIZE'
    | 'DUPLICATE_MOVE',
  message: string,
): never {
  throw new ConvexError({ code, message })
}

export function isValidGuestToken(guestToken: string) {
  return GUEST_TOKEN_PATTERN.test(guestToken)
}

export function assertValidGuestToken(guestToken: string) {
  if (isValidGuestToken(guestToken)) {
    return
  }

  throw new ConvexError({
    code: 'INVALID_GUEST_TOKEN',
    message: 'Invalid guest token.',
  })
}

export function assertValidMoveCoord(coord: HexCoord) {
  if (isValidHexCoord(coord)) {
    return
  }

  throwGameError('INVALID_COORD', 'Move coordinates are invalid.')
}

export function createGuestName(guestToken: string) {
  const firstHash = hashString(guestToken)
  const secondHash = hashString(`${guestToken}:suffix`)
  const adjective = ADJECTIVES[firstHash % ADJECTIVES.length]
  const animal = ANIMALS[secondHash % ANIMALS.length]
  const number = String((firstHash + secondHash) % 100).padStart(2, '0')

  return `${adjective} ${animal} ${number}`
}

export function generateRoomCode(seed: string, attempt: number) {
  let value = hashString(`${seed}:${attempt}`)
  let code = ''

  for (let index = 0; index < 6; index += 1) {
    code += ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]
    value = Math.floor(value / ROOM_CODE_ALPHABET.length)
  }

  return code
}

function hashString(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

async function buildPlayerPresence(
  db: DatabaseReader,
  participant: ParticipantDoc,
): Promise<PlayerPresence> {
  const guest = await db.get(participant.guestId)

  if (!guest) {
    throw new Error(`Missing guest ${participant.guestId as GenericId<'guests'>}`)
  }

  return {
    displayName: guest.displayName,
    role: participant.role === 'playerTwo' ? 'playerTwo' : 'playerOne',
  }
}

async function buildPrivateLobbySnapshot(
  db: DatabaseReader,
  game: GameDoc,
  participants: ParticipantDoc[],
  viewerGuestId: Id<'guests'>,
): Promise<PrivateLobbySnapshot> {
  const creatorParticipant = participants.find(
    (participant) => participant.guestId === game.createdByGuestId,
  )

  if (!creatorParticipant) {
    throw new Error('Private room is missing its creator participant.')
  }

  const opponentParticipant =
    participants.find((participant) => participant.role === 'playerTwo') ?? null
  const spectatorParticipants = participants
    .filter((participant) => participant.role === 'spectator')
    .sort((left, right) => left.joinedAt - right.joinedAt)

  const [creator, opponent, spectators] = await Promise.all([
    buildPrivateLobbyParticipant(db, creatorParticipant),
    opponentParticipant ? buildPrivateLobbyParticipant(db, opponentParticipant) : null,
    Promise.all(
      spectatorParticipants.map((participant) =>
        buildPrivateLobbyParticipant(db, participant),
      ),
    ),
  ])

  return {
    creator,
    opponent,
    spectators,
    viewerIsCreator: game.createdByGuestId === viewerGuestId,
    canStart: opponent !== null && game.createdByGuestId === viewerGuestId,
  }
}

async function buildPrivateLobbyParticipant(
  db: DatabaseReader,
  participant: ParticipantDoc,
): Promise<PrivateLobbyParticipant> {
  const guest = await db.get(participant.guestId)

  if (!guest) {
    throw new Error(`Missing guest ${participant.guestId as GenericId<'guests'>}`)
  }

  return {
    guestId: participant.guestId,
    displayName: guest.displayName,
  }
}
