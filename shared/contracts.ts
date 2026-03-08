import type { HexCoord, PlayerSlot, SerializedGameState } from './hexGame'

export type GameMode = 'matchmaking' | 'private'
export type GameStatus = 'waiting' | 'active' | 'finished'
export type ParticipantRole = 'playerOne' | 'playerTwo' | 'spectator'
export type GameFinishReason = 'line' | 'forfeit' | 'drawAgreement'

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

export type GameSnapshot = {
  gameId: string
  mode: GameMode
  status: GameStatus
  finishReason: GameFinishReason | null
  winnerSlot: PlayerSlot | null
  roomCode: string | null
  seriesId: string | null
  previousGameId: string | null
  nextGameId: string | null
  viewerRole: ParticipantRole | null
  viewerCanMove: boolean
  state: SerializedGameState
  players: Record<PlayerSlot, PlayerPresence | null>
  spectatorCount: number
  canDeleteRoom: boolean
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
