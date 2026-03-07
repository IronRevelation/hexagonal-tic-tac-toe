import type { HexCoord, PlayerSlot, SerializedGameState } from './hexGame'

export type GameMode = 'matchmaking' | 'private'
export type GameStatus = 'waiting' | 'active' | 'finished'
export type ParticipantRole = 'playerOne' | 'playerTwo' | 'spectator'

export type GuestSession = {
  guestToken: string
  displayName: string
  activeGameId: string | null
  activeRole: ParticipantRole | null
}

export type RematchState = {
  requestedByPlayerOne: boolean
  requestedByPlayerTwo: boolean
  nextGameId: string | null
}

export type PlayerPresence = {
  guestId: string
  displayName: string
  role: 'playerOne' | 'playerTwo'
  isOnline: boolean
}

export type GameSnapshot = {
  gameId: string
  mode: GameMode
  status: GameStatus
  roomCode: string | null
  seriesId: string | null
  previousGameId: string | null
  nextGameId: string | null
  playerOneGuestId: string | null
  playerTwoGuestId: string | null
  viewerRole: ParticipantRole | null
  viewerCanMove: boolean
  state: SerializedGameState
  players: Record<PlayerSlot, PlayerPresence | null>
  spectatorCount: number
  rematch: RematchState
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
