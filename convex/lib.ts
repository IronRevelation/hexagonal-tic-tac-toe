import { internal } from './_generated/api'
import { ConvexError, type GenericId } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import type { DatabaseReader, DatabaseWriter, MutationCtx } from './_generated/server'
import {
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
  GameFinishReason,
  GameMode,
  GameSnapshot,
  GameStatus,
  GuestSession,
  ParticipantRole,
  PlayerPresence,
} from '../shared/contracts'

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
const GUEST_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type GuestDoc = Doc<'guests'>
export type GameDoc = Doc<'games'>
export type ParticipantDoc = Doc<'gameParticipants'>
export type PlayerParticipantDoc = ParticipantDoc & {
  role: 'playerOne' | 'playerTwo'
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

export async function getGuestByToken(
  db: DatabaseReader | DatabaseWriter,
  guestToken: string,
) {
  return db
    .query('guests')
    .withIndex('by_guestToken', (query) => query.eq('guestToken', guestToken))
    .unique()
}

export async function ensureGuest(
  ctx: MutationCtx,
  guestToken: string,
) {
  assertValidGuestToken(guestToken)
  const existing = await getGuestByToken(ctx.db, guestToken)
  const seenAt = now()

  if (existing) {
    await ctx.db.patch(existing._id, { lastSeenAt: seenAt })
    return {
      ...existing,
      lastSeenAt: seenAt,
    }
  }

  const displayName = createGuestName(guestToken)
  const guestId = await ctx.db.insert('guests', {
    guestToken,
    displayName,
    createdAt: seenAt,
    lastSeenAt: seenAt,
  })

  return (await ctx.db.get(guestId))!
}

export async function requireGuest(
  db: DatabaseReader | DatabaseWriter,
  guestToken: string,
) {
  assertValidGuestToken(guestToken)
  const guest = await getGuestByToken(db, guestToken)
  if (guest) {
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

export function isPlayerParticipant(
  participant: ParticipantDoc | null,
): participant is PlayerParticipantDoc {
  return participant?.role === 'playerOne' || participant?.role === 'playerTwo'
}

export function isOnline(lastSeenAt: number) {
  return now() - lastSeenAt < ONLINE_WINDOW_MS
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
  const state = fromStoredState(game.serializedState)
  const viewerCanMove =
    game.status === 'active' &&
    ((viewer.role === 'playerOne' && state.currentPlayer === 'one') ||
      (viewer.role === 'playerTwo' && state.currentPlayer === 'two'))

  return {
    gameId: game._id,
    mode: game.mode as GameMode,
    status: game.status as GameStatus,
    finishReason: (game.finishReason as GameFinishReason | undefined) ?? null,
    winnerSlot: game.winnerSlot ?? null,
    roomCode: game.roomCode ?? null,
    seriesId: game.seriesId ?? null,
    previousGameId: game.previousGameId ?? null,
    nextGameId: game.nextGameId ?? null,
    playerOneGuestId: game.playerOneGuestId ?? null,
    playerTwoGuestId: game.playerTwoGuestId ?? null,
    viewerRole: viewer.role as ParticipantRole,
    viewerCanMove,
    state,
    players: {
      one: playerOne,
      two: playerTwo,
    },
    spectatorCount,
    canDeleteRoom: canDeletePrivateRoom(game, participants, guest._id),
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

export async function buildGuestSession(
  db: DatabaseReader,
  guest: GuestDoc,
): Promise<GuestSession> {
  const active = await findLatestAccessibleGameParticipant(db, guest._id)

  return {
    guestToken: guest.guestToken,
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
    guestId: participant.guestId,
    displayName: guest.displayName,
    role: participant.role === 'playerTwo' ? 'playerTwo' : 'playerOne',
    isOnline: isOnline(participant.lastSeenAt),
  }
}
