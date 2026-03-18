import * as PIXI from "pixi.js";

import {
  clamp,
  nowMs,
  drawPanelBackground,
  getHudEl,
} from "./modules/utils.js";
import { createGrid } from "./modules/grid.js";
import { createDeckView } from "./modules/deckView.js";
import { createHandView } from "./modules/handView.js";
import { createDiscardView } from "./modules/discardView.js";

import { createGameState } from "./gameState.js";

/**
 * Simulator main entry (Vite).
 *
 * Refactor goals:
 * - Centralize rules + cards in a single game state object (`gameState.js`)
 * - UI modules become dumb views/controllers:
 *   - They render based on current game state (deck/hand/discard)
 *   - They emit user intents (flip-from-deck, flip-from-hand, browse discard)
 * - `main.js` orchestrates: apply intent -> update game state -> sync views + HUD
 *
 * Rules (implemented in gameState):
 * - Scenario start: shuffle fresh 54 card deck, draw 2 to hand
 * - Flip from deck or hand discards the flipped card(s)
 * - Flipping from hand auto-draws 1 if deck not empty
 * - Players may not draw except scenario-start draw(2) and auto-draw after hand flip
 * - Reshuffle when deck empty AND hand empty (discard stays as public history)
 */

const GRID_W = 21;
const GRID_H = 21;

const layout = {
  w: 0,
  h: 0,

  deckArea: { x: 0, y: 0, w: 0, h: 0 },
  handArea: { x: 0, y: 0, w: 0, h: 0 },
  boardArea: { x: 0, y: 0, w: 0, h: 0 },

  hexSize: 18,
  gridOriginX: 0,
  gridOriginY: 0,

  cardW: 84,
  cardH: 120,
};

// -----------------------------
// HUD (optional)
// -----------------------------
const deckCountEl = getHudEl("deckCount");
const handCountEl = getHudEl("handCount");
const selectedCardEl = getHudEl("selectedCard");

/**
 * @param {{deckCount:number, handCount:number, selectedCardLabel:string}} info
 */
function updateHud(info) {
  if (deckCountEl) deckCountEl.textContent = String(info.deckCount);
  if (handCountEl) handCountEl.textContent = String(info.handCount);
  if (selectedCardEl)
    selectedCardEl.textContent = info.selectedCardLabel ?? "—";
}

// -----------------------------
// Boot + Scene
// -----------------------------
export async function startSimulator() {
  const root = document.getElementById("app");
  if (!(root instanceof HTMLElement)) {
    throw new Error("Missing root element: `#app`");
  }

  const canvas = document.getElementById("game");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Missing canvas element: `#game`");
  }

  const app = new PIXI.Application();
  await app.init({
    canvas,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
    resizeTo: root,
  });

  // -----------------------------
  // Layers
  // -----------------------------
  const stageRoot = new PIXI.Container();
  const boardLayer = new PIXI.Container();
  const boardGridLayer = new PIXI.Container();
  const boardHoverLayer = new PIXI.Container();
  const deckLayer = new PIXI.Container();
  const handLayer = new PIXI.Container();
  const overlayLayer = new PIXI.Container();

  stageRoot.addChild(boardLayer, deckLayer, handLayer, overlayLayer);
  boardLayer.addChild(boardGridLayer, boardHoverLayer);
  app.stage.addChild(stageRoot);

  // -----------------------------
  // Panel backgrounds (owned by main)
  // -----------------------------
  const deckPanelBg = new PIXI.Graphics();
  const handPanelBg = new PIXI.Graphics();
  const boardPanelBg = new PIXI.Graphics();
  deckLayer.addChild(deckPanelBg);
  handLayer.addChild(handPanelBg);
  boardLayer.addChildAt(boardPanelBg, 0);

  // -----------------------------
  // Central game state (single source of truth)
  // -----------------------------
  const gs = createGameState();

  // -----------------------------
  // Modules (views/controllers)
  // -----------------------------
  const grid = createGrid({
    gridW: GRID_W,
    gridH: GRID_H,
    gridLayer: boardGridLayer,
    hoverLayer: boardHoverLayer,
    overlayLayer,
    getLayout: () => ({
      boardArea: layout.boardArea,
      hexSize: layout.hexSize,
      gridOriginX: layout.gridOriginX,
      gridOriginY: layout.gridOriginY,
    }),
    screenSize: () => ({ w: app.screen.width, h: app.screen.height }),
  });

  const discardView = createDiscardView({
    layer: deckLayer,
    overlayLayer,
    deckArea: () => layout.deckArea,
    screenSize: () => ({ w: app.screen.width, h: app.screen.height }),
  });

  // Deck view: we use its sprite for click handling + layout.
  // We do NOT use its internal deck state; it is driven from `gs`.
  const deckView = createDeckView({
    layer: deckLayer,
    deckArea: () => layout.deckArea,
    onFlip: () => {
      // Deck click -> flip from deck in game state.
      gs.flipFromDeck();
      syncFromGameState();
    },
  });

  // Hand view: render from `gs`; use Shift-click flip intent -> `gs.flipFromHand`.
  // We also use handView for selection display (selected card label).
  const handView = createHandView({
    layer: handLayer,
    handArea: () => layout.handArea,
    getCardSize: () => ({ cardW: layout.cardW, cardH: layout.cardH }),
    background: handPanelBg,
    onChange: () => {
      // Selection changed; update HUD only (cards come from gs)
      syncHudOnly();
    },
    onFlip: ({ index }) => {
      gs.flipFromHand(index);
      syncFromGameState();
    },
  });

  // Enforce deck interaction: click flips, never draws.
  deckView.enableClickToFlip(1);

  // -----------------------------
  // Sync helpers
  // -----------------------------
  function syncHudOnly() {
    updateHud({
      deckCount: gs.deckCount(),
      handCount: gs.handCount(),
      selectedCardLabel: handView.getSelectedCard()?.label ?? "—",
    });
  }

  function syncFromGameState() {
    const snap = gs.snapshot();

    // Drive views from state (source of truth)
    deckView.setDeck(snap.deck);
    discardView.setDiscard(snap.discard);
    handView.setHand(snap.hand);

    // Render
    deckView.layout();
    discardView.layout();
    handView.layout();

    // HUD
    syncHudOnly();
  }

  // -----------------------------
  // Layout
  // -----------------------------
  function rebuildLayout() {
    layout.w = app.renderer.width;
    layout.h = app.renderer.height;

    const pad = 14;
    const handH = clamp(Math.floor(layout.h * 0.22), 150, 220);
    const leftW = clamp(Math.floor(layout.w * 0.22), 220, 320);

    layout.handArea = {
      x: pad,
      y: layout.h - handH - pad,
      w: layout.w - pad * 2,
      h: handH,
    };

    layout.deckArea = {
      x: pad,
      y: pad + 64,
      w: leftW - pad,
      h: layout.h - handH - pad * 3 - 64,
    };

    layout.boardArea = {
      x: leftW + pad,
      y: pad,
      w: layout.w - leftW - pad * 2,
      h: layout.h - handH - pad * 2,
    };

    layout.cardH = clamp(Math.floor(layout.handArea.h * 0.78), 96, 148);
    layout.cardW = Math.floor(layout.cardH * 0.7);

    // Choose hex size to fit the board area (odd-r offset layout)
    const hexW_unit = Math.sqrt(3) * 1;
    const hexH_unit = 2 * 1;

    const sizeByW =
      (layout.boardArea.w * 0.88) / (hexW_unit * (GRID_W + 0.5) + 2);
    const sizeByH =
      (layout.boardArea.h * 0.88) /
      (hexH_unit * 0.75 * (GRID_H - 1) + hexH_unit + 2);

    layout.hexSize = clamp(Math.floor(Math.min(sizeByW, sizeByH)), 10, 28);

    // Compute grid origin to center within board area (pointy-top odd-r offset)
    const offsetToPixel = (col, row, size) => {
      const hexW = Math.sqrt(3) * size;
      const hexH = 2 * size;
      const x = hexW * (col + (row % 2) * 0.5);
      const y = ((hexH * 3) / 4) * row;
      return { x, y };
    };

    const p00 = offsetToPixel(0, 0, layout.hexSize);
    const pW0 = offsetToPixel(GRID_W - 1, 0, layout.hexSize);
    const p0H = offsetToPixel(0, GRID_H - 1, layout.hexSize);
    const pWH = offsetToPixel(GRID_W - 1, GRID_H - 1, layout.hexSize);

    const hexWpx = Math.sqrt(3) * layout.hexSize;
    const hexHpx = 2 * layout.hexSize;

    const minX = Math.min(p00.x, pW0.x, p0H.x, pWH.x) - hexWpx / 2;
    const maxX = Math.max(p00.x, pW0.x, p0H.x, pWH.x) + hexWpx / 2;
    const minY = Math.min(p00.y, pW0.y, p0H.y, pWH.y) - hexHpx / 2;
    const maxY = Math.max(p00.y, pW0.y, p0H.y, pWH.y) + hexHpx / 2;

    const gridWpx = maxX - minX;
    const gridHpx = maxY - minY;

    layout.gridOriginX =
      layout.boardArea.x + (layout.boardArea.w - gridWpx) / 2 - minX;
    layout.gridOriginY =
      layout.boardArea.y + (layout.boardArea.h - gridHpx) / 2 - minY;

    drawPanelBackground(
      deckPanelBg,
      layout.deckArea.x,
      layout.deckArea.y,
      layout.deckArea.w,
      layout.deckArea.h,
    );
    drawPanelBackground(
      handPanelBg,
      layout.handArea.x,
      layout.handArea.y,
      layout.handArea.w,
      layout.handArea.h,
    );
    drawPanelBackground(
      boardPanelBg,
      layout.boardArea.x,
      layout.boardArea.y,
      layout.boardArea.w,
      layout.boardArea.h,
    );

    // Views that depend on rects
    deckView.layout();
    discardView.layout();
    grid.rebuild();
    handView.layout();
  }

  // -----------------------------
  // Scenario start / reshuffle
  // -----------------------------
  function startNewScenario() {
    // Preserve discard pile as public history by design.
    gs.restartScenario();
    syncFromGameState();
  }

  // Initial sync
  syncFromGameState();

  // -----------------------------
  // Input wiring
  // -----------------------------
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;

  app.stage.on("pointermove", (e) => {
    grid.onPointerMove(e.global);
  });

  // -----------------------------
  // Start
  // -----------------------------
  const onResize = () => rebuildLayout();
  window.addEventListener("resize", onResize, { passive: true });

  rebuildLayout();

  // If `createGameState()` ever starts empty in the future,
  // this ensures we have a valid scenario.
  if (gs.deckCount() === 0 && gs.handCount() === 0) {
    startNewScenario();
  } else {
    syncFromGameState();
  }

  // Ambient hover pulse (main drives alpha; grid owns drawing)
  let t0 = nowMs();
  app.ticker.add(() => {
    const t = (nowMs() - t0) / 1000;
    grid.setHoverAlpha(
      grid.getHoveredHex() ? 0.55 + 0.25 * Math.sin(t * 3.2) : 1,
    );
  });

  return { app };
}

// Auto-start when imported by Vite entry
startSimulator();
