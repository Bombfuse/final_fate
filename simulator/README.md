# Simulator

A small web app prototype rendered with **PixiJS**, now using **Vite** for dev/build and **Vitest** for tests.

## What you get

- A **21×21 pointy-top hex grid** centered on the canvas (odd-r row-offset layout)
- A **54-card deck** (52 standard + 2 jokers) on the left
- On game start, the player **draws 2 cards**
- The player’s **hand is shown in the foreground at the bottom**

## Prereqs

- Node.js (recommended: current LTS)
- npm (or pnpm/yarn — commands below use npm)

## Install

```/dev/null/bash#L1-2
cd final_fate/simulator
npm install
```

## Run (Vite dev server)

```/dev/null/bash#L1-2
cd final_fate/simulator
npm run dev
```

Vite will print the local URL (typically `http://localhost:5173`).

## Build + preview

```/dev/null/bash#L1-3
cd final_fate/simulator
npm run build
npm run preview
```

## Tests (Vitest)

Run in watch mode:

```/dev/null/bash#L1-2
cd final_fate/simulator
npm test
```

Run once (CI-style):

```/dev/null/bash#L1-2
cd final_fate/simulator
npm run test:run
```

Coverage:

```/dev/null/bash#L1-2
cd final_fate/simulator
npm run test:coverage
```

## Controls

- Click the **deck** to draw a card (if any are left)
- Click a **card in hand** to select/deselect it
- Hover the **grid** to highlight a hex