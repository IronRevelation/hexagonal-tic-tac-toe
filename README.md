# Hexagonal Tic-Tac-Toe Online

Online multiplayer hexagonal tic-tac-toe built with TanStack Start, React 19, Tailwind CSS v4, and Convex.

## Overview

This project is a real-time web implementation of an infinite-board hexagonal tic-tac-toe variant:

- Player 1 opens with exactly one move.
- Player 2 answers with two consecutive moves.
- Every turn after that also contains two moves.
- The first player to connect 6 hexagons on one axis wins.

The app supports public matchmaking, private rooms, spectators, rematches, draw offers, and disconnect-aware presence.

## Current Features

- Auto-created guest identities stored in `localStorage`
- Resume flow for the latest active game tied to the current guest
- Public matchmaking with queue status and cancellation
- Private rooms with deterministic 6-character share codes
- Direct join links at `/join/<ROOM_CODE>`
- Spectator support for private rooms once both player slots are filled
- Real-time board state, turn state, and player presence via Convex
- Pannable and zoomable infinite hex board
- Draw offers with per-player cooldowns
- Manual forfeits
- Automatic disconnect forfeits for active players
- Rematches that create a linked follow-up game and swap the opener
- Private-room rematches that carry spectators forward into the next game

## Important Game And App Rules

- A guest can only be an active player in one game at a time.
- Private rooms start in `waiting` and become `active` when the second player joins.
- In both matchmaking and private games, the opening assignment is chosen when the match is created, so the room creator is not guaranteed to stay Player 1.
- Joining a full private room makes the guest a spectator.
- Finished private rooms do not accept new spectators.
- Games can end by line completion, forfeit, or draw agreement.
- Draw offers are limited by a cooldown of 8 total moves per player between offers.
- The client sends a presence heartbeat every 10 seconds while the page is visible.
- A player who stays disconnected for 90 seconds during an active game loses by forfeit.
- Presence is shown as online/offline from recent heartbeats.

## Tech Stack

- TanStack Start + TanStack Router
- React 19
- Convex for database, sync, mutations, and scheduled disconnect handling
- Tailwind CSS v4
- Vitest + Testing Library

## Project Structure

```text
src/                 Frontend routes, UI, guest session, presence hooks
convex/              Backend schema, queries, mutations, matchmaking, rooms
shared/              Shared game rules and contract types
public/              Static assets
```

## Local Development

### Prerequisites

- Node.js
- `pnpm`
- A Convex project

### Install

```bash
pnpm install
```

### Start Convex

```bash
npx convex dev
```

This does three important things:

- uploads the Convex functions
- regenerates `convex/_generated/*`
- writes `.env.local` with the required Convex variables

Current local env shape:

```bash
CONVEX_DEPLOYMENT=...
VITE_CONVEX_URL=...
VITE_CONVEX_SITE_URL=...
```

### Start the app

```bash
pnpm dev
```

The Vite dev server runs on `http://localhost:3000`.

## Testing

```bash
pnpm test
```

Current test coverage includes:

- shared hex game rules
- draw/forfeit helper behavior
- visible-tab heartbeat behavior

## Production Build

```bash
pnpm build
pnpm preview
```

## Backend Notes

- `convex/schema.ts` defines guests, games, moves, participants, and matchmaking queue tables.
- `convex/matchmaking.ts` handles public queueing and match creation.
- `convex/privateGames.ts` handles room creation, room joins, player assignment, and spectators.
- `convex/games.ts` handles moves, draw offers, forfeits, and rematches.
- `convex/guests.ts` handles guest creation, sessions, heartbeats, and leaving finished games.

## User Flows

### Lobby

- Resume an active game
- Enter public matchmaking
- Create a private room
- Join a room with a code

### In Game

- Place moves when it is your turn
- Pan and zoom the board
- See the latest move and winning line highlights
- Offer or respond to draws
- Forfeit
- Request or cancel a rematch after the game ends
