import * as PIXI from "pixi.js";
import { makeDeck54 } from "./deck.js";

function colToLabel(col) {
  // Columns A-Z (cap at Z)
  const code = "A".charCodeAt(0) + Math.max(0, Math.min(25, col));
  return String.fromCharCode(code);
}

function rowToLabel(row) {
  // Rows 1-100 (cap at 100)
  return String(Math.max(1, Math.min(100, row + 1)));
}

function tileToLabel(col, row) {
  return `${colToLabel(col)}${rowToLabel(row)}`;
}

/**
 * Simulator main entry (Vite).
 *
 * Responsibilities:
 * - Boot Pixi onto the existing <canvas id="game">
 * - Create and render:
 *   - centered 21x21 pointy-top odd-r hex grid
 *   - deck area on the left (54-card deck)
 *   - player hand in the foreground at the bottom
 * - Gameplay:
 *   - shuffle + draw 2 cards at start
 *   - click deck to draw 1
 *   - click a hand card to select
 *   - hover grid highlights hex
 */

// -----------------------------
// Utilities
// -----------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function roundedRectPath(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.roundRect(x, y, w, h, rr);
}

function nowMs() {
  return performance.now();
}

// Seeded shuffle using an LCG (good enough for prototyping).
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// -----------------------------
// Hex grid math (pointy-top, odd-r row-offset)
// Grid is 21×21 in offset coords: col in [0..20], row in [0..20]
// Odd rows are shifted right by half a hex width.
// -----------------------------
function offsetToPixel(col, row, size) {
  const hexW = Math.sqrt(3) * size;
  const hexH = 2 * size;

  const x = hexW * (col + (row % 2) * 0.5);
  const y = ((hexH * 3) / 4) * row;
  return { x, y };
}

function hexPolygonPoints(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30); // pointy-top
    pts.push(cx + size * Math.cos(angle), cy + size * Math.sin(angle));
  }
  return pts;
}

function pointInPoly(px, py, pts) {
  // Ray casting
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i],
      yi = pts[i + 1];
    const xj = pts[j],
      yj = pts[j + 1];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// -----------------------------
// Constants / Layout state
// -----------------------------
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
// Game state
// -----------------------------
const state = {
  deck: [],
  hand: [],
  selectedHandIndex: -1,
  hoveredHex: null, // {col,row,pts,cx,cy}
  hexes: [], // {col,row,cx,cy,pts}
};

// -----------------------------
// HUD helpers (optional)
// -----------------------------
function getHudEl(id) {
  const el = document.getElementById(id);
  return el instanceof HTMLElement ? el : null;
}

const deckCountEl = getHudEl("deckCount");
const handCountEl = getHudEl("handCount");
const selectedCardEl = getHudEl("selectedCard");

function updateHud() {
  if (deckCountEl) deckCountEl.textContent = String(state.deck.length);
  if (handCountEl) handCountEl.textContent = String(state.hand.length);
  if (selectedCardEl) {
    selectedCardEl.textContent =
      state.selectedHandIndex >= 0
        ? (state.hand[state.selectedHandIndex]?.label ?? "—")
        : "—";
  }
}

// -----------------------------
// Rendering helpers (Pixi)
// -----------------------------
function drawPanelBackground(g, x, y, w, h) {
  g.clear();
  g.beginFill(0x0b1020, 0.25);
  g.drawRoundedRect(x, y, w, h, 14);
  g.endFill();

  g.lineStyle({ width: 1, color: 0xffffff, alpha: 0.12 });
  g.drawRoundedRect(x, y, w, h, 14);
}

function makeCardSprite(card, w, h) {
  const g = new PIXI.Graphics();

  g.beginFill(0xffffff, 0.95);
  g.lineStyle({ width: 2, color: 0x0b1020, alpha: 0.5 });
  roundedRectPath(g, 0, 0, w, h, 10);
  g.endFill();

  const isRed = card.color === "red";
  const color = isRed ? 0xd61f45 : 0x111827;

  const style = new PIXI.TextStyle({
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
    fontSize: 18,
    fill: color,
    fontWeight: "700",
  });

  const styleSmall = new PIXI.TextStyle({
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
    fontSize: 12,
    fill: color,
    fontWeight: "700",
  });

  const tl = new PIXI.Text(card.isJoker ? "🃏" : card.label, style);
  tl.position.set(10, 8);
  g.addChild(tl);

  const br = new PIXI.Text(card.isJoker ? "🃏" : card.label, style);
  br.anchor.set(1, 1);
  br.position.set(w - 10, h - 8);
  g.addChild(br);

  const centerStyle = new PIXI.TextStyle({
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
    fontSize: card.isJoker ? 36 : 44,
    fill: color,
    fontWeight: "800",
  });

  const center = new PIXI.Text(card.isJoker ? "JOKER" : card.suit, centerStyle);
  center.anchor.set(0.5, 0.5);
  center.position.set(w / 2, h / 2 + (card.isJoker ? 0 : 2));
  if (card.isJoker) {
    center.style = styleSmall;
    center.text = card.color === "red" ? "JOKER (R)" : "JOKER (B)";
    center.scale.set(2.0, 2.0);
  }
  g.addChild(center);

  const gloss = new PIXI.Graphics();
  gloss.beginFill(0xffffff, 0.25);
  gloss.drawRoundedRect(6, 6, w - 12, h * 0.35, 10);
  gloss.endFill();
  gloss.alpha = 0.35;
  g.addChild(gloss);

  g.eventMode = "static";
  g.cursor = "pointer";
  g.hitArea = new PIXI.Rectangle(0, 0, w, h);

  return g;
}

function makeDeckSprite(w, h) {
  const g = new PIXI.Graphics();

  const layers = 5;
  for (let i = layers - 1; i >= 0; i--) {
    const dx = i * 3;
    const dy = i * 3;

    g.beginFill(0x0f172a, 0.95);
    g.lineStyle({ width: 2, color: 0xffffff, alpha: 0.12 });
    roundedRectPath(g, dx, dy, w, h, 10);
    g.endFill();

    const inner = new PIXI.Graphics();
    inner.beginFill(0x1d4ed8, 0.28);
    inner.drawRoundedRect(dx + 10, dy + 10, w - 20, h - 20, 10);
    inner.endFill();
    g.addChild(inner);
  }

  const t = new PIXI.Text("DECK", {
    fontFamily: "ui-sans-serif, system-ui",
    fontSize: 18,
    fill: 0xffffff,
    fontWeight: "800",
    letterSpacing: 2,
  });
  t.anchor.set(0.5, 0.5);
  t.position.set(w / 2 + 6, h / 2 + 6);
  g.addChild(t);

  g.eventMode = "static";
  g.cursor = "pointer";
  g.hitArea = new PIXI.Rectangle(0, 0, w + 12, h + 12);

  return g;
}

// -----------------------------
// Boot + Scene
// -----------------------------
export async function startSimulator() {
  const root = document.getElementById("app");
  if (!(root instanceof HTMLElement))
    throw new Error("Missing root element: `#app`");

  const canvas = document.getElementById("game");
  if (!(canvas instanceof HTMLCanvasElement))
    throw new Error("Missing canvas element: `#game`");

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

  // Panel backgrounds
  const deckPanelBg = new PIXI.Graphics();
  const handPanelBg = new PIXI.Graphics();
  const boardPanelBg = new PIXI.Graphics();
  deckLayer.addChild(deckPanelBg);
  handLayer.addChild(handPanelBg);
  boardLayer.addChildAt(boardPanelBg, 0);

  // Grid
  const gridGfx = new PIXI.Graphics();
  boardGridLayer.addChild(gridGfx);

  // Hover
  const hoverHexGfx = new PIXI.Graphics();
  boardHoverLayer.addChild(hoverHexGfx);

  // Tile details popup (follows mouse while hovering a tile)
  const tileDetails = new PIXI.Container();
  tileDetails.visible = false;
  overlayLayer.addChild(tileDetails);

  const tileDetailsBg = new PIXI.Graphics();
  tileDetails.addChild(tileDetailsBg);

  const tileDetailsText = new PIXI.Text("", {
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
    fontSize: 12,
    fill: 0xffffff,
    fontWeight: "700",
  });
  tileDetailsText.anchor.set(0, 0);
  tileDetailsText.position.set(8, 6);
  tileDetails.addChild(tileDetailsText);

  // Deck sprite
  const deckSprite = makeDeckSprite(88, 124);
  deckLayer.addChild(deckSprite);

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

    const gridW = maxX - minX;
    const gridH = maxY - minY;

    layout.gridOriginX =
      layout.boardArea.x + (layout.boardArea.w - gridW) / 2 - minX;
    layout.gridOriginY =
      layout.boardArea.y + (layout.boardArea.h - gridH) / 2 - minY;

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

    deckSprite.position.set(
      layout.deckArea.x + (layout.deckArea.w - 88) / 2,
      layout.deckArea.y + 18,
    );

    rebuildGrid();
    layoutHand();
  }

  function rebuildGrid() {
    state.hexes = [];
    gridGfx.clear();

    // Contrast vs background
    gridGfx.lineStyle({ width: 1.5, color: 0x22d3ee, alpha: 0.35 });

    const tileSize = Math.max(1, layout.hexSize - 0.5);

    // Recreate axis label layers each rebuild so they track resizing/centering.
    // (We attach them under `gridGfx` so `gridGfx.clear()` doesn't remove them; `clear()`
    // only clears drawn geometry, not children, so we explicitly remove children here.)
    gridGfx.removeChildren();

    const axisLabelStyle = new PIXI.TextStyle({
      fontFamily:
        "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
      fontSize: Math.max(10, Math.floor(tileSize * 0.55)),
      fill: 0xffffff,
      fontWeight: "800",
      align: "center",
      stroke: 0x0b1020,
      strokeThickness: 3,
    });

    // Draw tiles + store geometry
    for (let row = 0; row < GRID_H; row++) {
      for (let col = 0; col < GRID_W; col++) {
        const p = offsetToPixel(col, row, layout.hexSize);
        const cx = layout.gridOriginX + p.x;
        const cy = layout.gridOriginY + p.y;

        // Render tiles slightly smaller than their spacing to create a ~1px gap between neighbors.
        const pts = hexPolygonPoints(cx, cy, tileSize);

        gridGfx.beginFill(0x0ea5e9, 0.06);
        gridGfx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2)
          gridGfx.lineTo(pts[i], pts[i + 1]);
        gridGfx.lineTo(pts[0], pts[1]);
        gridGfx.endFill();

        state.hexes.push({ col, row, cx, cy, pts });
      }
    }

    // Axis labels: columns on top, rows on left
    // Use existing computed hex centers so labels align with the first row/col.
    const topRow = 0;
    const leftCol = 0;

    // Top labels (A..)
    for (let col = 0; col < GRID_W; col++) {
      const p = offsetToPixel(col, topRow, layout.hexSize);
      const cx = layout.gridOriginX + p.x;
      const cy = layout.gridOriginY + p.y;

      const t = new PIXI.Text(colToLabel(col), axisLabelStyle);
      t.anchor.set(0.5, 1);
      t.position.set(cx, cy - tileSize - 4);
      t.alpha = 0.85;
      gridGfx.addChild(t);
    }

    // Left labels (1..)
    for (let row = 0; row < GRID_H; row++) {
      const p = offsetToPixel(leftCol, row, layout.hexSize);
      const cx = layout.gridOriginX + p.x;
      const cy = layout.gridOriginY + p.y;

      const t = new PIXI.Text(rowToLabel(row), axisLabelStyle);
      t.anchor.set(1, 0.5);
      t.position.set(cx - tileSize - 6, cy);
      t.alpha = 0.85;
      gridGfx.addChild(t);
    }
  }

  function layoutHand() {
    // Remove all children except background
    const keep = new Set([handPanelBg]);
    for (let i = handLayer.children.length - 1; i >= 0; i--) {
      const child = handLayer.children[i];
      if (!keep.has(child)) handLayer.removeChild(child);
    }

    const n = state.hand.length;
    if (n === 0) return;

    const cardW = layout.cardW;
    const cardH = layout.cardH;

    const maxVisibleW = layout.handArea.w - 24;
    const overlap = clamp(Math.floor(cardW * 0.35), 18, 36);
    const naturalW = n * cardW - (n - 1) * overlap;
    const scale = naturalW > maxVisibleW ? maxVisibleW / naturalW : 1;

    const drawW = cardW * scale;
    const drawH = cardH * scale;
    const drawOverlap = overlap * scale;

    const totalW = n * drawW - (n - 1) * drawOverlap;
    const startX = layout.handArea.x + (layout.handArea.w - totalW) / 2;
    const baseY = layout.handArea.y + layout.handArea.h - drawH - 16;

    state.hand.forEach((card, idx) => {
      const sprite = makeCardSprite(card, drawW, drawH);
      sprite.position.set(startX + idx * (drawW - drawOverlap), baseY);

      if (idx === state.selectedHandIndex) sprite.position.y -= 14;

      sprite.on("pointerdown", () => {
        state.selectedHandIndex = idx === state.selectedHandIndex ? -1 : idx;
        updateHud();
        layoutHand();
      });

      handLayer.addChild(sprite);
    });
  }

  function drawHoverHex() {
    hoverHexGfx.clear();
    if (!state.hoveredHex) return;

    const { pts } = state.hoveredHex;
    hoverHexGfx.beginFill(0x67e8f9, 0.12);
    hoverHexGfx.lineStyle({ width: 2, color: 0x67e8f9, alpha: 0.65 });
    hoverHexGfx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2)
      hoverHexGfx.lineTo(pts[i], pts[i + 1]);
    hoverHexGfx.lineTo(pts[0], pts[1]);
    hoverHexGfx.endFill();
  }

  function hideTileDetails() {
    tileDetails.visible = false;
  }

  function showTileDetailsAt(screenX, screenY, col, row) {
    tileDetailsText.text = tileToLabel(col, row);

    // Layout background around text
    const padX = 8;
    const padY = 6;
    const w = Math.max(40, tileDetailsText.width + padX * 2);
    const h = Math.max(24, tileDetailsText.height + padY * 2);

    tileDetailsBg.clear();
    tileDetailsBg.beginFill(0x0b1020, 0.85);
    tileDetailsBg.lineStyle({ width: 1, color: 0xffffff, alpha: 0.16 });
    tileDetailsBg.drawRoundedRect(0, 0, w, h, 8);
    tileDetailsBg.endFill();

    // Keep text positioned inside padding (in case width changed)
    tileDetailsText.position.set(padX, padY);

    // Follow mouse with a small offset, clamped to screen bounds
    const offsetX = 14;
    const offsetY = 14;

    const margin = 8;
    const x = Math.max(
      margin,
      Math.min(app.screen.width - w - margin, screenX + offsetX),
    );
    const y = Math.max(
      margin,
      Math.min(app.screen.height - h - margin, screenY + offsetY),
    );

    tileDetails.position.set(x, y);
    tileDetails.visible = true;
  }

  function drawCardToHand(count) {
    for (let i = 0; i < count; i++) {
      const c = state.deck.pop();
      if (!c) break;
      state.hand.push(c);
    }
    updateHud();
    layoutHand();
  }

  function resetGame() {
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    const rand = makeRng(seed);

    state.deck = shuffleInPlace(makeDeck54(), rand);
    state.hand = [];
    state.selectedHandIndex = -1;
    state.hoveredHex = null;

    drawCardToHand(2); // draw 2 on start
    updateHud();
    layoutHand();
    drawHoverHex();
    hideTileDetails();
  }

  // Input
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;

  app.stage.on("pointermove", (e) => {
    const p = e.global;

    // Quick reject outside board area
    if (
      p.x < layout.boardArea.x ||
      p.x > layout.boardArea.x + layout.boardArea.w ||
      p.y < layout.boardArea.y ||
      p.y > layout.boardArea.y + layout.boardArea.h
    ) {
      if (state.hoveredHex) {
        state.hoveredHex = null;
        drawHoverHex();
        hideTileDetails();
      }
      return;
    }

    let found = null;
    for (const h of state.hexes) {
      if (pointInPoly(p.x, p.y, h.pts)) {
        found = h;
        break;
      }
    }

    const changed =
      (found && !state.hoveredHex) ||
      (!found && state.hoveredHex) ||
      (found &&
        state.hoveredHex &&
        (found.col !== state.hoveredHex.col ||
          found.row !== state.hoveredHex.row));

    if (changed) {
      state.hoveredHex = found;
      drawHoverHex();
    }

    if (state.hoveredHex) {
      showTileDetailsAt(p.x, p.y, state.hoveredHex.col, state.hoveredHex.row);
    } else {
      hideTileDetails();
    }
  });

  deckSprite.on("pointerdown", () => drawCardToHand(1));

  // Layout + start
  const onResize = () => rebuildLayout();
  window.addEventListener("resize", onResize, { passive: true });

  rebuildLayout();
  resetGame();

  // Ambient hover pulse
  let t0 = nowMs();
  app.ticker.add(() => {
    const t = (nowMs() - t0) / 1000;
    hoverHexGfx.alpha = state.hoveredHex ? 0.55 + 0.25 * Math.sin(t * 3.2) : 1;
  });

  return { app };
}

// Auto-start when imported by Vite entry
startSimulator();
