# Simulator

A tiny, no-build web app prototype rendered with **PixiJS**.

## What you get

- A **21×21 pointy-top hex grid** centered on the canvas
- A **54-card deck** (52 standard + 2 jokers) on the left
- On game start, the player **draws 2 cards**
- The player’s **hand is shown in the foreground at the bottom**

## Run locally

Because browsers often restrict features when opening files directly, run a local static server from the `final_fate/simulator` folder.

### Option 1: Python

```/dev/null/bash#L1-2
cd final_fate/simulator
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000`

### Option 2: Node

If you have `npx` available:

```/dev/null/bash#L1-2
cd final_fate/simulator
npx serve .
```

## Controls

- Click the **deck** to draw a card (if any are left)
- Click a **card in hand** to select/deselect it
- Hover the **grid** to highlight a hex