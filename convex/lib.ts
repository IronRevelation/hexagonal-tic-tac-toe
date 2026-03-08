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
} from '../shared/hexGame'
import type {
  DrawOfferState,
  GameClockSnapshot,
  GameHistoryEntry,
  GameHistoryResult,
  GameFinishReason,
  GameMode,
  GameReplayData,
  GameSnapshot,
  GameStatus,
  GuestSession,
  ParticipantRole,
  PlayerPresence,
} from '../shared/contracts'
import {
  getInitialClockMs,
  type TimeControlPreset,
  type TimedTimeControlPreset,
} from '../shared/timeControl'

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
const ONLINE_WINDOW_MS = 45_000
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
export type ParticipantDoc = Doc<'gameParticipants'>
export type PlayerParticipantDoc = ParticipantDoc & {
  role: 'playerOne' | 'playerTwo'
}
export type ResolvedTimedClock = GameClockSnapshot

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
  state: GameDoc['serializedState'],
): SerializedGameState {
  return {
    ...state,
    board: state.board.map(({ key, player }) => [key, player] as const),
  }
}

export function createStoredInitialState() {
  return toStoredState(serializeGameState(createInitialGameState()))
}

export function loadGameState(game: GameDoc): GameState {
  return deserializeGameState(fromStoredState(game.serializedState))
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
      lastSeenAt: seenAt,
      retentionExpiresAt: getGuestRetentionExpiresAt(seenAt),
      state: 'active',
    })
    const refreshedGuest: GuestDoc = {
      ...existing,
      lastSeenAt: seenAt,
      retentionExpiresAt: getGuestRetentionExpiresAt(seenAt),
      state: 'active',
    }
    return refreshedGuest
  }

  const displayName = createGuestName(guestToken)
  const guestId = await ctx.db.insert('guests', {
    guestTokenHash: await hashGuestToken(guestToken),
    displayName,
    state: 'active',
    createdAt: seenAt,
    lastSeenAt: seenAt,
    retentionExpiresAt: getGuestRetentionExpiresAt(seenAt),
  })

  return (await ctx.db.get(guestId))!
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

export async function findLatestAccessibleGameParticipant(
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

export function isOnline(lastSeenAt: number) {
  return now() - lastSeenAt < ONLINE_WINDOW_MS
}

export function normalizeGameTimeControl(game: Pick<GameDoc, 'timeControl'>): TimeControlPreset {
  return game.timeControl ?? 'unlimited'
}

export function resolveTimedGameClock(
  game: Pick<
    GameDoc,
    | 'status'
    | 'timeControl'
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

  const activePlayer = game.status === 'active' ? currentPlayer : null
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
  game: Pick<GameDoc, '_id' | 'clockTimeoutGeneration' | 'clockTimeoutJobId'>,
  clock: ResolvedTimedClock | null,
) {
  const nextGeneration = (game.clockTimeoutGeneration ?? 0) + 1

  if (game.clockTimeoutJobId) {
    try {
      await ctx.scheduler.cancel(game.clockTimeoutJobId)
    } catch {
      // The previous timeout may already have completed or been canceled.
    }
  }

  if (!clock || clock.activePlayer === null) {
    await ctx.db.patch(game._id, {
      clockTimeoutGeneration: nextGeneration,
      clockTimeoutJobId: undefined,
    })
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

  await ctx.db.patch(game._id, {
    clockTimeoutGeneration: nextGeneration,
    clockTimeoutJobId,
  })
}

export async function refreshDisconnectForfeit(
  ctx: MutationCtx,
  gameId: Id<'games'>,
  participant: PlayerParticipantDoc,
  seenAt: number,
) {
  const nextGeneration = (participant.disconnectForfeitGeneration ?? 0) + 1

  if (participant.disconnectForfeitJobId) {
    try {
      await ctx.scheduler.cancel(participant.disconnectForfeitJobId)
    } catch {
      // The previous timeout may already have completed or been canceled.
    }
  }

  const disconnectForfeitJobId = await ctx.scheduler.runAfter(
    DISCONNECT_FORFEIT_MS,
    internal.games.forfeitDisconnectedPlayer,
    {
      gameId,
      participantId: participant._id,
      generation: nextGeneration,
    },
  )

  await ctx.db.patch(participant._id, {
    lastSeenAt: seenAt,
    disconnectDeadlineAt: seenAt + DISCONNECT_FORFEIT_MS,
    disconnectForfeitGeneration: nextGeneration,
    disconnectForfeitJobId,
  })
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

export async function buildGameSnapshot(
  db: DatabaseReader,
  guest: GuestDoc,
  game: GameDoc,
): Promise<GameSnapshot | null> {
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

  const playerOne = playerOneParticipant
    ? await buildPlayerPresence(db, playerOneParticipant)
    : null
  const playerTwo = playerTwoParticipant
    ? await buildPlayerPresence(db, playerTwoParticipant)
    : null
  const snapshotTime = now()
  const state = fromStoredState(game.serializedState)
  const clock = resolveTimedGameClock(game, state.currentPlayer, snapshotTime)
  const viewerCanMove =
    game.status === 'active' &&
    ((viewer.role === 'playerOne' && state.currentPlayer === 'one') ||
      (viewer.role === 'playerTwo' && state.currentPlayer === 'two'))

  return {
    gameId: game._id,
    mode: game.mode as GameMode,
    status: game.status as GameStatus,
    finishReason: (game.finishReason as GameFinishReason | undefined) ?? null,
    timeControl: normalizeGameTimeControl(game),
    winnerSlot: game.winnerSlot ?? null,
    roomCode: game.roomCode ?? null,
    seriesId: game.seriesId ?? null,
    previousGameId: game.previousGameId ?? null,
    nextGameId: game.nextGameId ?? null,
    viewerRole: viewer.role as ParticipantRole,
    viewerCanMove,
    state,
    players: {
      one: playerOne,
      two: playerTwo,
    },
    spectatorCount,
    canDeleteRoom: canDeletePrivateRoom(game, participants, guest._id),
    clock,
    rematch: {
      requestedByPlayerOne: game.rematchRequestedByPlayerOne,
      requestedByPlayerTwo: game.rematchRequestedByPlayerTwo,
      nextGameId: game.nextGameId ?? null,
    },
    drawOffer: {
      offeredBy: game.drawOfferedBy ?? null,
      offeredAtMoveIndex: game.drawOfferedAtMoveIndex ?? null,
      minMoveIndexForPlayerOne: game.nextDrawOfferMoveIndexPlayerOne ?? 0,
      minMoveIndexForPlayerTwo: game.nextDrawOfferMoveIndexPlayerTwo ?? 0,
    } satisfies DrawOfferState,
    updatedAt: game.updatedAt,
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
  const opponentGuestId =
    opponentSlot === 'one' ? game.playerOneGuestId : game.playerTwoGuestId
  const opponentGuest = opponentGuestId ? await db.get(opponentGuestId) : null
  const finishReason = (game.finishReason as GameFinishReason | undefined) ?? null

  return {
    gameId: game._id,
    seriesId: game.seriesId ?? null,
    mode: game.mode as GameMode,
    timeControl: normalizeGameTimeControl(game),
    finishReason,
    result: resolveHistoryResult(viewerSlot, game.winnerSlot ?? null, finishReason),
    viewerSlot,
    opponent: opponentGuestId
      ? {
          displayName: opponentGuest?.displayName ?? PLAYER_LABELS[opponentSlot],
          slot: opponentSlot,
        }
      : null,
    finishedAt: game.finishedAt ?? game.updatedAt,
    updatedAt: game.updatedAt,
    totalMoves: game.serializedState.totalMoves,
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
  const [playerOneGuest, playerTwoGuest, moves] = await Promise.all([
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
    finishReason: (game.finishReason as GameFinishReason | undefined) ?? null,
    winnerSlot: game.winnerSlot ?? null,
    viewerSlot,
    finishedAt: game.finishedAt ?? game.updatedAt,
    updatedAt: game.updatedAt,
    players: {
      one: {
        displayName: playerOneGuest?.displayName ?? PLAYER_LABELS.one,
      },
      two: {
        displayName: playerTwoGuest?.displayName ?? PLAYER_LABELS.two,
      },
    },
    finalState: fromStoredState(game.serializedState),
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

export async function buildGuestSession(
  db: DatabaseReader,
  guest: GuestDoc,
): Promise<GuestSession> {
  const active = await findLatestAccessibleGameParticipant(db, guest._id)

  return {
    displayName: guest.displayName,
    activeGameId: active?.game._id ?? null,
    activeRole: (active?.participant.role as ParticipantRole | undefined) ?? null,
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
    | 'MATCHMAKING_ACTIVE',
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
    isOnline: isOnline(participant.lastSeenAt),
  }
}
