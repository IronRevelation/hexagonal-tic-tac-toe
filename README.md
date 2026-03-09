# Hexagonal Tic-Tac-Toe Online

Real-time multiplayer hexagonal tic-tac-toe built with TanStack Start, React 19, Tailwind CSS v4, and Convex.

The app supports anonymous guest play, public matchmaking, private rooms, spectators, rematches, draw offers, chess-style room clocks, and Upstash-backed disconnect detection for active turns.

## Game Rules

- The board is infinite.
- Player 1 opens with exactly one move.
- Player 2 responds with two consecutive moves.
- Every turn after that also contains two moves.
- The first player to connect 6 hexagons on a single axis wins.

## Features

- No account required. Guests are created only when a user starts or joins a game and are then persisted in `localStorage`.
- Public matchmaking with queue status and cancellation.
- Private rooms with shareable 6-character room codes, optional time controls, and a creator-controlled pre-start lobby.
- Direct join links at `/join/<ROOM_CODE>`.
- Spectator support for full private rooms.
- Resume flow for the latest active game tied to the current guest.
- Real-time board state, move history, and turn state through Convex, plus Upstash-backed disconnect detection for the active player.
- Chess-style clocks for timed private rooms.
- Pannable, zoomable infinite hex board.
- Draw offers with cooldown enforcement.
- Manual forfeits and automatic disconnect forfeits.
- Timeout losses when a player runs out of room clock time.
- Rematches that create a linked follow-up game and swap the opener.
- Private-room rematches that carry spectators forward.

## Important App Rules

- A guest can only be an active player in one game at a time.
- Private rooms start in `waiting`, reserve the first joiner as opponent, and become `active` only when the creator starts the game.
- Matchmaking games always use unlimited time.
- Timed private-room clocks start only after the first move is made.
- The room creator is not guaranteed to open as Player 1 once the game starts.
- Joining a full private room makes the guest a spectator.
- The creator can swap the reserved opponent with a spectator before the game starts.
- Finished private rooms do not accept new spectators.
- Games can end by line completion, forfeit, timeout, or draw agreement.
- Active-player disconnect detection is tracked outside Convex to avoid database churn.
- An active player may forfeit after 90 seconds if they stop actively viewing the game during their turn.

## Tech Stack

- TanStack Start and TanStack Router
- React 19
- Convex
- Tailwind CSS v4
- Vitest and Testing Library

## Project Layout

```text
src/                 App routes, UI, guest session, and client-side hooks
src/components/      Shared interface components, including the hex board
convex/              Backend schema, queries, mutations, and matchmaking logic
shared/              Shared game rules and contract types
public/              Static assets
```

## Routes

- `/` lobby for matchmaking, room creation, resume, and join-by-code
- `/about` game rules
- `/privacy` privacy notice, export, and erasure tools
- `/terms` service terms
- `/join/:roomCode` room join handoff
- `/games/:gameId` live game view

## Local Development

### Prerequisites

- Node.js
- `pnpm`
- A Convex project

### Install dependencies

```bash
pnpm install
```

### Start Convex

```bash
npx convex dev
```

This uploads backend functions, regenerates `convex/_generated/*`, and writes `.env.local` with the Convex variables used by the app.

Expected local environment variables:

```bash
CONVEX_DEPLOYMENT=...
VITE_CONVEX_URL=...
VITE_CONVEX_SITE_URL=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
PRESENCE_TOKEN_SECRET=...
```

### Start the app

```bash
pnpm dev
```

The dev server runs on `http://localhost:3000`.

## Scripts

```bash
pnpm dev
pnpm build
pnpm preview
pnpm test
```

## Testing

Current tests cover:

- shared hex game rules
- backend helper behavior
- shared presence state helpers

## Backend Notes

- [`convex/schema.ts`](./convex/schema.ts) defines guests, games, moves, participants, and the matchmaking queue.
- [`convex/matchmaking.ts`](./convex/matchmaking.ts) handles public queueing and match creation.
- [`convex/privateGames.ts`](./convex/privateGames.ts) handles private room creation, joining, spectators, and room deletion.
- [`convex/games.ts`](./convex/games.ts) handles moves, draws, forfeits, resume logic, and rematches.
- [`convex/guests.ts`](./convex/guests.ts) manages guest identities, sessions, and cleanup for finished games.
- [`convex/presence.ts`](./convex/presence.ts) verifies active-player presence loss before auto-forfeits.

## Notes

- [`convex/README.md`](./convex/README.md) is still the default Convex template and is not project-specific documentation.
