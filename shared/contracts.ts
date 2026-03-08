import type {
  HexCoord,
  PlayerSlot,
  SerializedGameState,
  TurnCommitMode,
} from './hexGame'
import type { TimeControlPreset, TimedTimeControlPreset } from './timeControl'

export type GameMode = 'matchmaking' | 'private'
export type GameStatus = 'waiting' | 'active' | 'finished'
export type ParticipantRole = 'playerOne' | 'playerTwo' | 'spectator'
export type GameFinishReason = 'line' | 'forfeit' | 'drawAgreement' | 'timeout'

export type GuestSession = {
  displayName: string
  activeGameId: string | null
  activeRole: ParticipantRole | null
}

export type RematchState = {
  requestedByPlayerOne: boolean
  requestedByPlayerTwo: boolean
  nextGameId: string | null
}

export type DrawOfferState = {
  offeredBy: PlayerSlot | null
  offeredAtMoveIndex: number | null
  minMoveIndexForPlayerOne: number
  minMoveIndexForPlayerTwo: number
}

export type PlayerPresence = {
  displayName: string
  role: 'playerOne' | 'playerTwo'
  isOnline: boolean
}

export type GameClockSnapshot = {
  preset: TimedTimeControlPreset
  initialTimeMs: number
  remainingMs: Record<PlayerSlot, number>
  activePlayer: PlayerSlot | null
  serverNow: number
}

export type GameSnapshot = {
  gameId: string
  mode: GameMode
  status: GameStatus
  finishReason: GameFinishReason | null
  timeControl: TimeControlPreset
  winnerSlot: PlayerSlot | null
  roomCode: string | null
  seriesId: string | null
  previousGameId: string | null
  nextGameId: string | null
  viewerRole: ParticipantRole | null
  viewerCanMove: boolean
  turnCommitMode: TurnCommitMode
  state: SerializedGameState
  players: Record<PlayerSlot, PlayerPresence | null>
  spectatorCount: number
  canDeleteRoom: boolean
  clock: GameClockSnapshot | null
  rematch: RematchState
  drawOffer: DrawOfferState
  updatedAt: number
}

export type MatchmakingStatus =
  | {
      state: 'idle'
    }
  | {
      state: 'queued'
      queuedAt: number
    }
  | {
      state: 'matched'
      gameId: string
    }

export type RoomJoinResult = {
  gameId: string
  role: ParticipantRole
}

export type MovePayload = {
  coord: HexCoord
}

export type GameHistoryResult = 'win' | 'loss' | 'draw'

export type GameHistoryEntry = {
  gameId: string
  seriesId: string | null
  mode: GameMode
  timeControl: TimeControlPreset
  finishReason: GameFinishReason | null
  result: GameHistoryResult
  viewerSlot: PlayerSlot
  opponent: {
    displayName: string
    slot: PlayerSlot
  } | null
  finishedAt: number
  updatedAt: number
  totalMoves: number
}

export type GameReplayMove = {
  moveIndex: number
  turnNumber: number
  slot: PlayerSlot
  coord: HexCoord
  createdAt: number
}

export type GameReplayData = {
  gameId: string
  seriesId: string | null
  mode: GameMode
  timeControl: TimeControlPreset
  finishReason: GameFinishReason | null
  winnerSlot: PlayerSlot | null
  viewerSlot: PlayerSlot
  finishedAt: number
  updatedAt: number
  players: Record<PlayerSlot, { displayName: string }>
  turnCommitMode: TurnCommitMode
  finalState: SerializedGameState
  moves: GameReplayMove[]
}

export type PrivacyProcessor = {
  name: string
  purpose: string
  location: string
}

export type PrivacyRetentionRule = {
  key: 'queue' | 'waitingRooms' | 'finishedGames' | 'guestProfiles'
  label: string
  duration: string
  details: string
}

export type PrivacyInfo = {
  siteName: string
  controllerName: string
  contactEmail: string
  controllerLocation: string
  minimumAge: number
  effectiveDate: string
  legalBases: string[]
  dataCategories: string[]
  purposes: string[]
  rights: string[]
  processors: PrivacyProcessor[]
  internationalTransfers: string[]
  retention: PrivacyRetentionRule[]
  complaintText: string
  analyticsEnabled: boolean
}

export type PrivacyExport = {
  exportedAt: number
  contactEmail: string
  guest: {
    id: string
    displayName: string
    state: 'active' | 'erased'
    createdAt: number
    lastSeenAt: number
    erasedAt: number | null
    retentionExpiresAt: number
  }
  queueEntry: {
    id: string
    queuedAt: number
  } | null
  participants: Array<{
    id: string
    gameId: string
    role: ParticipantRole
    joinedAt: number
    lastSeenAt: number
    disconnectDeadlineAt: number | null
  }>
  games: Array<{
    id: string
    mode: GameMode
    status: GameStatus
    timeControl: TimeControlPreset
    roomCode: string | null
    createdAt: number | null
    startedAt: number | null
    finishedAt: number | null
    updatedAt: number
    finishReason: GameFinishReason | null
    winnerSlot: PlayerSlot | null
  }>
  moves: Array<{
    id: string
    gameId: string
    moveIndex: number
    turnNumber: number
    slot: PlayerSlot
    q: number
    r: number
    createdAt: number
  }>
}
