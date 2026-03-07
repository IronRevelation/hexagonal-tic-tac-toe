# Hexagonal Tic-Tac-Toe Online

Online multiplayer hexagonal tic-tac-toe built with TanStack Start, React 19, and Convex.

## Game Rules

- The game is played on an infinite hexagonal board.
- Player 1 opens with one move.
- Player 2 then plays two moves.
- Every turn after that also contains two moves.
- The first player to connect 6 hexagons in a straight line wins.

## Features

- Auto-assigned guest identities persisted in local storage
- Random public matchmaking
- Private rooms with shareable 6-character codes
- Spectators for full private rooms
- Live board state and presence via Convex
- Rematch flow that creates a new linked game and alternates the opener

## Development

```bash
pnpm install
npx convex dev
pnpm dev
```

`npx convex dev` uploads the functions, regenerates `convex/_generated/*`, and writes `.env.local` with `VITE_CONVEX_URL`.

## Testing

```bash
pnpm test
```

## Production Build

```bash
pnpm build
```
