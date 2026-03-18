import * as PIXI from "pixi.js";
import { makeDeck54 } from "./deck.js";

import {
  clamp,
  nowMs,
  drawPanelBackground,
  getHudEl,
  makeRng,
} from "./modules/utils.js";
import { createGrid } from "./modules/grid.js";
import { createDeckView } from "./modules/deckView.js";
import { createHandView } from "./modules/handView.js";

/**
 * Simulator main entry (Vite).
 *
 * Responsibilities (after refactor):
 * - Boot Pixi onto the existing <canvas id="game">
 * - Own global layout (panel rects, sizing)
 * - Compose modules:
 *   - grid (render + hover/tooltip)
 *   - deck (state + render + click-to-draw)
 *   - hand (state + render + click-to-select)
 * - Wire inputs + HUD
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

  // Layers
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

  // Panel backgrounds (owned by main; passed into modules when needed)
  const deckPanelBg = new PIXI.Graphics();
  const handPanelBg = new PIXI.Graphics();
  const boardPanelBg = new PIXI.Graphics();
  deckLayer.addChild(deckPanelBg);
  handLayer.addChild(handPanelBg);
  boardLayer.addChildAt(boardPanelBg, 0);

  // -----------------------------
  // Modules
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

  const handView = createHandView({
    layer: handLayer,
    handArea: () => layout.handArea,
    getCardSize: () => ({ cardW: layout.cardW, cardH: layout.cardH }),
    background: handPanelBg,
    onChange: ({ count, selectedCard }) => {
      updateHud({
        deckCount: deckView.count(),
        handCount: count,
        selectedCardLabel: selectedCard?.label ?? "—",
      });
    },
  });

  const deckView = createDeckView({
    layer: deckLayer,
    deckArea: () => layout.deckArea,
    onDraw: (cards) => {
      handView.addCards(cards);
      handView.layout();
      updateHud({
        deckCount: deckView.count(),
        handCount: handView.count(),
        selectedCardLabel: handView.getSelectedCard()?.label ?? "—",
      });
    },
    onChange: ({ count }) => {
      updateHud({
        deckCount: count,
        handCount: handView.count(),
        selectedCardLabel: handView.getSelectedCard()?.label ?? "—",
      });
    },
  });

  deckView.enableClickToDraw(1);

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

    // Compute grid origin to center within board area.
    // We use the same offset->pixel math (mirrors previous code) but inline to keep main as layout owner.
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

    deckView.layout();
    grid.rebuild();
    handView.layout();
  }

  // -----------------------------
  // Game reset
  // -----------------------------
  function resetGame() {
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    const rand = makeRng(seed);

    handView.clear();
    deckView.reset({ makeDeck: makeDeck54, rand });

    // Draw 2 on start (same behavior as before)
    deckView.draw(2);
    handView.layout();

    updateHud({
      deckCount: deckView.count(),
      handCount: handView.count(),
      selectedCardLabel: handView.getSelectedCard()?.label ?? "—",
    });
  }

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
  resetGame();

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
