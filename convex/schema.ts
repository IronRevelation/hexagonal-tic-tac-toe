import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

const playerSlot = v.union(v.literal('one'), v.literal('two'))
const gameMode = v.union(v.literal('matchmaking'), v.literal('private'))
const gameStatus = v.union(
  v.literal('waiting'),
  v.literal('active'),
  v.literal('finished'),
)
const gameFinishReason = v.union(
  v.literal('line'),
  v.literal('forfeit'),
  v.literal('drawAgreement'),
)
const participantRole = v.union(
  v.literal('playerOne'),
  v.literal('playerTwo'),
  v.literal('spectator'),
)

const hexCoord = v.object({
  q: v.number(),
  r: v.number(),
})

const storedGameState = v.object({
  board: v.array(
    v.object({
      key: v.string(),
      player: playerSlot,
    }),
  ),
  currentPlayer: playerSlot,
  movesRemaining: v.number(),
  turnNumber: v.number(),
  totalMoves: v.number(),
  lastMove: v.union(hexCoord, v.null()),
  winner: v.union(playerSlot, v.null()),
  winningLine: v.array(hexCoord),
})

export default defineSchema({
  guests: defineTable({
    guestToken: v.string(),
    displayName: v.string(),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  }).index('by_guestToken', ['guestToken']),

  games: defineTable({
    mode: gameMode,
    status: gameStatus,
    roomCode: v.optional(v.string()),
    createdByGuestId: v.id('guests'),
    playerOneGuestId: v.optional(v.id('guests')),
    playerTwoGuestId: v.optional(v.id('guests')),
    serializedState: storedGameState,
    winnerSlot: v.optional(playerSlot),
    finishReason: v.optional(gameFinishReason),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    updatedAt: v.number(),
    seriesId: v.optional(v.id('games')),
    previousGameId: v.optional(v.id('games')),
    nextGameId: v.optional(v.id('games')),
    rematchRequestedByPlayerOne: v.boolean(),
    rematchRequestedByPlayerTwo: v.boolean(),
    drawOfferedBy: v.optional(playerSlot),
    drawOfferedAtMoveIndex: v.optional(v.number()),
    nextDrawOfferMoveIndexPlayerOne: v.optional(v.number()),
    nextDrawOfferMoveIndexPlayerTwo: v.optional(v.number()),
  })
    .index('by_roomCode', ['roomCode'])
    .index('by_playerOneGuestId', ['playerOneGuestId'])
    .index('by_playerTwoGuestId', ['playerTwoGuestId'])
    .index('by_status', ['status'])
    .index('by_seriesId', ['seriesId'])
    .index('by_previousGameId', ['previousGameId'])
    .index('by_nextGameId', ['nextGameId']),

  gameMoves: defineTable({
    gameId: v.id('games'),
    moveIndex: v.number(),
    turnNumber: v.number(),
    slot: playerSlot,
    q: v.number(),
    r: v.number(),
    createdAt: v.number(),
  }).index('by_gameId_moveIndex', ['gameId', 'moveIndex']),

  gameParticipants: defineTable({
    gameId: v.id('games'),
    guestId: v.id('guests'),
    role: participantRole,
    joinedAt: v.number(),
    lastSeenAt: v.number(),
    disconnectDeadlineAt: v.optional(v.number()),
    disconnectForfeitGeneration: v.optional(v.number()),
    disconnectForfeitJobId: v.optional(v.id('_scheduled_functions')),
  })
    .index('by_gameId', ['gameId'])
    .index('by_gameId_guestId', ['gameId', 'guestId'])
    .index('by_guestId', ['guestId'])
    .index('by_gameId_role', ['gameId', 'role']),

  matchmakingQueue: defineTable({
    guestId: v.id('guests'),
    queuedAt: v.number(),
  })
    .index('by_guestId', ['guestId'])
    .index('by_queuedAt', ['queuedAt']),
})
