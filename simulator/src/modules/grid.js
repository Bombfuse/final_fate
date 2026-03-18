import * as PIXI from "pixi.js";
import {
  offsetToPixel,
  hexPolygonPoints,
  pointInPoly,
  makeTextStyle,
} from "./utils.js";

const PERSON_ICON = "👤";
const ITEM_ICON = "🎒";

/**
 * Grid module
 *
 * Responsibilities:
 * - Tile labeling helpers (A1.. etc)
 * - Build + render a pointy-top odd-r offset hex grid
 * - Maintain tile geometry for hit-testing
 * - Render hover highlight + optional tile tooltip
 * - Optional per-tile payload + overlay icons (unit/item)
 *
 * This module does not own "game state" (deck/hand/etc). It owns grid-specific
 * render state and exposes a small API to integrate with the simulator loop.
 */

// -----------------------------
// Label helpers
// -----------------------------
export function colToLabel(col) {
  // Columns A-Z (cap at Z)
  const code = "A".charCodeAt(0) + Math.max(0, Math.min(25, col));
  return String.fromCharCode(code);
}

export function rowToLabel(row) {
  // Rows 1-100 (cap at 100)
  return String(Math.max(1, Math.min(100, row + 1)));
}

export function tileToLabel(col, row) {
  return `${colToLabel(col)}${rowToLabel(row)}`;
}

// -----------------------------
// Factory
// -----------------------------
/**
 * @typedef {{x:number,y:number,w:number,h:number}} Rect
 *
 * @typedef {object} GridLayout
 * @property {Rect} boardArea
 * @property {number} hexSize
 * @property {number} gridOriginX
 * @property {number} gridOriginY
 *
 * @typedef {object} HexTile
 * @property {number} col
 * @property {number} row
 * @property {number} cx
 * @property {number} cy
 * @property {number[]} pts
 */

/**
 * Create a grid renderer/controller.
 *
 * @param {{
 *  gridW:number,
 *  gridH:number,
 *  gridLayer:PIXI.Container,
 *  hoverLayer:PIXI.Container,
 *  overlayLayer?:PIXI.Container,
 *  getLayout:()=>GridLayout,
 *  screenSize?:()=>{w:number,h:number},
 * }} opts
 */
export function createGrid(opts) {
  const {
    gridW,
    gridH,
    gridLayer,
    hoverLayer,
    overlayLayer = null,
    getLayout,
    screenSize = () => ({
      w: gridLayer?.parent?.renderer?.width ?? 0,
      h: gridLayer?.parent?.renderer?.height ?? 0,
    }),
    onDropPayload = null,
  } = opts;

  if (!gridLayer) throw new Error("createGrid: missing `gridLayer`");
  if (!hoverLayer) throw new Error("createGrid: missing `hoverLayer`");
  if (typeof getLayout !== "function")
    throw new Error("createGrid: missing `getLayout()`");

  const gridGfx = new PIXI.Graphics();
  gridLayer.addChild(gridGfx);

  const hoverHexGfx = new PIXI.Graphics();
  hoverLayer.addChild(hoverHexGfx);

  // Icon overlay (units/items) lives above the grid but below hover.
  const iconLayer = new PIXI.Container();
  hoverLayer.addChildAt(iconLayer, 0);

  /** @type {HexTile[]} */
  let hexes = [];

  /** @type {HexTile|null} */
  let hoveredHex = null;

  /**
   * Per-tile associated data (set by drag+drop).
   * Key: "col,row"
   * Value: { unit?:{id,label}, item?:{id,label} }
   * @type {Map<string, {unit?:{id:string,label:string}, item?:{id:string,label:string}}>}
   */
  const tileData = new Map();

  /**
   * Per-tile icon sprites.
   * Key: "col,row"
   * Value: { unit?:PIXI.Text, item?:PIXI.Text }
   * @type {Map<string, {unit?:PIXI.Text, item?:PIXI.Text}>}
   */
  const tileIcons = new Map();

  // Optional tooltip that follows the mouse.
  let tileDetails = null;
  let tileDetailsBg = null;
  let tileDetailsText = null;

  if (overlayLayer) {
    tileDetails = new PIXI.Container();
    tileDetails.visible = false;
    overlayLayer.addChild(tileDetails);

    tileDetailsBg = new PIXI.Graphics();
    tileDetails.addChild(tileDetailsBg);

    tileDetailsText = new PIXI.Text(
      "",
      makeTextStyle({ fontSize: 12, fill: 0xffffff, fontWeight: "700" }),
    );
    tileDetailsText.anchor.set(0, 0);
    tileDetailsText.position.set(8, 6);
    tileDetails.addChild(tileDetailsText);
  }

  function rebuild() {
    const layout = getLayout();

    hexes = [];
    gridGfx.clear();

    // Contrast vs background
    gridGfx.lineStyle({ width: 1.5, color: 0x22d3ee, alpha: 0.35 });

    const tileSize = Math.max(1, layout.hexSize - 0.5);

    // Axis labels are children; `clear()` won't remove them, so we do:
    gridGfx.removeChildren();

    // Re-layout icon positions for new origin/size
    iconLayer.removeChildren();

    const axisLabelStyle = makeTextStyle({
      fontSize: Math.max(10, Math.floor(tileSize * 0.55)),
      fill: 0xffffff,
      fontWeight: "800",
      align: "center",
      stroke: 0x0b1020,
      strokeThickness: 3,
    });

    // Draw tiles + store geometry
    for (let row = 0; row < gridH; row++) {
      for (let col = 0; col < gridW; col++) {
        const p = offsetToPixel(col, row, layout.hexSize);
        const cx = layout.gridOriginX + p.x;
        const cy = layout.gridOriginY + p.y;

        // Slightly smaller than spacing to create a gap between neighbors
        const pts = hexPolygonPoints(cx, cy, tileSize);

        gridGfx.beginFill(0x0ea5e9, 0.06);
        gridGfx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2)
          gridGfx.lineTo(pts[i], pts[i + 1]);
        gridGfx.lineTo(pts[0], pts[1]);
        gridGfx.endFill();

        hexes.push({ col, row, cx, cy, pts });

        // If we already have icons/data for this tile, re-add them at new position.
        const key = `${col},${row}`;
        const icons = tileIcons.get(key);
        if (icons?.unit) iconLayer.addChild(icons.unit);
        if (icons?.item) iconLayer.addChild(icons.item);

        if (icons?.unit) {
          icons.unit.position.set(cx, cy - Math.floor(layout.hexSize * 0.05));
        }
        if (icons?.item) {
          icons.item.position.set(
            cx + Math.floor(layout.hexSize * 0.42),
            cy + Math.floor(layout.hexSize * 0.15),
          );
        }
      }
    }

    // Axis labels: columns on top, rows on left
    const topRow = 0;
    const leftCol = 0;

    for (let col = 0; col < gridW; col++) {
      const p = offsetToPixel(col, topRow, layout.hexSize);
      const cx = layout.gridOriginX + p.x;
      const cy = layout.gridOriginY + p.y;

      const t = new PIXI.Text(colToLabel(col), axisLabelStyle);
      t.anchor.set(0.5, 1);
      t.position.set(cx, cy - tileSize - 4);
      t.alpha = 0.85;
      gridGfx.addChild(t);
    }

    for (let row = 0; row < gridH; row++) {
      const p = offsetToPixel(leftCol, row, layout.hexSize);
      const cx = layout.gridOriginX + p.x;
      const cy = layout.gridOriginY + p.y;

      const t = new PIXI.Text(rowToLabel(row), axisLabelStyle);
      t.anchor.set(1, 0.5);
      t.position.set(cx - tileSize - 6, cy);
      t.alpha = 0.85;
      gridGfx.addChild(t);
    }

    // If layout changed, hover geometry may be stale; recompute hover
    // by clearing and requiring caller to run pointer move handler again.
    hoveredHex = null;
    drawHover();
    hideTileDetails();
  }

  function drawHover() {
    hoverHexGfx.clear();
    if (!hoveredHex) return;

    const { pts } = hoveredHex;
    hoverHexGfx.beginFill(0x67e8f9, 0.12);
    hoverHexGfx.lineStyle({ width: 2, color: 0x67e8f9, alpha: 0.65 });
    hoverHexGfx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2)
      hoverHexGfx.lineTo(pts[i], pts[i + 1]);
    hoverHexGfx.lineTo(pts[0], pts[1]);
    hoverHexGfx.endFill();
  }

  function hideTileDetails() {
    if (!tileDetails) return;
    tileDetails.visible = false;
  }

  function showTileDetailsAt(screenX, screenY, col, row) {
    if (!tileDetails || !tileDetailsBg || !tileDetailsText) return;

    tileDetailsText.text = tileToLabel(col, row);

    const padX = 8;
    const padY = 6;
    const w = Math.max(40, tileDetailsText.width + padX * 2);
    const h = Math.max(24, tileDetailsText.height + padY * 2);

    tileDetailsBg.clear();
    tileDetailsBg.beginFill(0x0b1020, 0.85);
    tileDetailsBg.lineStyle({ width: 1, color: 0xffffff, alpha: 0.16 });
    tileDetailsBg.drawRoundedRect(0, 0, w, h, 8);
    tileDetailsBg.endFill();

    tileDetailsText.position.set(padX, padY);

    const offsetX = 14;
    const offsetY = 14;

    const { w: sw, h: sh } = screenSize();
    const margin = 8;

    const x = Math.max(margin, Math.min(sw - w - margin, screenX + offsetX));
    const y = Math.max(margin, Math.min(sh - h - margin, screenY + offsetY));

    tileDetails.position.set(x, y);
    tileDetails.visible = true;
  }

  /**
   * Pointer-move integration: call this from your stage pointermove handler.
   * Returns whether hover changed.
   *
   * @param {{x:number,y:number}} globalPoint Pixi global point (e.global)
   */
  function onPointerMove(globalPoint) {
    const layout = getLayout();
    const p = globalPoint;

    // Quick reject outside board area
    const b = layout.boardArea;
    if (p.x < b.x || p.x > b.x + b.w || p.y < b.y || p.y > b.y + b.h) {
      if (hoveredHex) {
        hoveredHex = null;
        drawHover();
        hideTileDetails();
        return true;
      }
      return false;
    }

    /** @type {HexTile|null} */
    let found = null;
    for (const h of hexes) {
      if (pointInPoly(p.x, p.y, h.pts)) {
        found = h;
        break;
      }
    }

    const changed =
      (found && !hoveredHex) ||
      (!found && hoveredHex) ||
      (found &&
        hoveredHex &&
        (found.col !== hoveredHex.col || found.row !== hoveredHex.row));

    if (changed) {
      hoveredHex = found;
      drawHover();
    }

    if (hoveredHex) {
      const key = `${hoveredHex.col},${hoveredHex.row}`;
      const d = tileData.get(key);
      const extra =
        d?.unit?.label || d?.item?.label
          ? `\n${d?.unit?.label ? `Unit: ${d.unit.label}` : ""}${d?.unit?.label && d?.item?.label ? "\n" : ""}${d?.item?.label ? `Item: ${d.item.label}` : ""}`
          : "";
      showTileDetailsAt(p.x, p.y, hoveredHex.col, hoveredHex.row);
      if (tileDetailsText)
        tileDetailsText.text = `${tileToLabel(hoveredHex.col, hoveredHex.row)}${extra}`;
    } else {
      hideTileDetails();
    }

    return changed;
  }

  /**
   * @returns {HexTile|null}
   */
  function getHoveredHex() {
    return hoveredHex;
  }

  /**
   * Lets the main loop animate hover alpha if desired.
   * @param {number} a
   */
  function setHoverAlpha(a) {
    hoverHexGfx.alpha = a;
  }

  /**
   * Associate a unit or item with a tile and ensure icons render.
   *
   * @param {{col:number,row:number}} tile
   * @param {{kind:"unit"|"item", id:string, label:string}} payload
   */
  function setTilePayload(tile, payload) {
    const layout = getLayout();
    const key = `${tile.col},${tile.row}`;
    const prev = tileData.get(key) || {};

    if (payload.kind === "unit") {
      prev.unit = { id: payload.id, label: payload.label };
    } else {
      prev.item = { id: payload.id, label: payload.label };
    }
    tileData.set(key, prev);

    const hex = hexes.find((h) => h.col === tile.col && h.row === tile.row);
    const cx = hex?.cx ?? 0;
    const cy = hex?.cy ?? 0;

    const icons = tileIcons.get(key) || {};
    const iconStyle = makeTextStyle({
      fontSize: Math.max(12, Math.floor(layout.hexSize * 0.95)),
      fill: 0xffffff,
      fontWeight: "800",
      stroke: 0x0b1020,
      strokeThickness: 4,
      align: "center",
    });

    if (payload.kind === "unit") {
      if (!icons.unit) {
        icons.unit = new PIXI.Text(PERSON_ICON, iconStyle);
        icons.unit.anchor.set(0.5, 0.5);
      }
      icons.unit.position.set(cx, cy - Math.floor(layout.hexSize * 0.05));
      if (!icons.unit.parent) iconLayer.addChild(icons.unit);
    } else {
      if (!icons.item) {
        icons.item = new PIXI.Text(ITEM_ICON, iconStyle);
        icons.item.anchor.set(0.5, 0.5);
      }
      icons.item.position.set(
        cx + Math.floor(layout.hexSize * 0.42),
        cy + Math.floor(layout.hexSize * 0.15),
      );
      if (!icons.item.parent) iconLayer.addChild(icons.item);
    }

    tileIcons.set(key, icons);
  }

  /**
   * Find which tile contains a point (global screen coords).
   * @param {{x:number,y:number}} globalPoint
   * @returns {HexTile|null}
   */
  function getHexAtPoint(globalPoint) {
    const layout = getLayout();
    const p = globalPoint;
    const b = layout.boardArea;
    if (p.x < b.x || p.x > b.x + b.w || p.y < b.y || p.y > b.y + b.h) {
      return null;
    }
    for (const h of hexes) {
      if (pointInPoly(p.x, p.y, h.pts)) return h;
    }
    return null;
  }

  /**
   * Drop integration for DOM drag+drop.
   * Call this from your canvas `drop` handler.
   *
   * @param {{x:number,y:number}} globalPoint
   * @param {{kind:"unit"|"item", id:string, label:string}} payload
   * @returns {boolean} whether a tile was updated
   */
  function dropPalettePayloadAt(globalPoint, payload) {
    const h = getHexAtPoint(globalPoint);
    if (!h) return false;
    setTilePayload({ col: h.col, row: h.row }, payload);
    if (typeof onDropPayload === "function") {
      onDropPayload({ col: h.col, row: h.row }, payload);
    }
    return true;
  }

  function destroy() {
    gridGfx.destroy({ children: true });
    hoverHexGfx.destroy({ children: true });
    iconLayer.destroy({ children: true });
    if (tileDetails) tileDetails.destroy({ children: true });
    tileData.clear();
    tileIcons.clear();
    hexes = [];
    hoveredHex = null;
  }

  return {
    rebuild,
    onPointerMove,
    getHoveredHex,
    setHoverAlpha,
    dropPalettePayloadAt,
    setTilePayload,
    destroy,
    // expose for debugging/advanced uses
    _getHexes: () => hexes,
    _getTileData: () => tileData,
  };
}
