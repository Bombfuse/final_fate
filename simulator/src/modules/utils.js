// Shared math + drawing utilities for the simulator.
// Keep this module DOM-free so it can be reused by rendering/state modules.

import * as PIXI from "pixi.js";

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function nowMs() {
  return performance.now();
}

export function roundedRectPath(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.roundRect(x, y, w, h, rr);
}

// Seeded RNG using an LCG (good enough for prototyping).
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// -----------------------------
// Hex grid math (pointy-top, odd-r row-offset)
// -----------------------------
export function offsetToPixel(col, row, size) {
  const hexW = Math.sqrt(3) * size;
  const hexH = 2 * size;

  const x = hexW * (col + (row % 2) * 0.5);
  const y = ((hexH * 3) / 4) * row;
  return { x, y };
}

export function hexPolygonPoints(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30); // pointy-top
    pts.push(cx + size * Math.cos(angle), cy + size * Math.sin(angle));
  }
  return pts;
}

export function pointInPoly(px, py, pts) {
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
// UI / rendering helpers
// -----------------------------
export function drawPanelBackground(g, x, y, w, h) {
  g.clear();
  g.beginFill(0x0b1020, 0.25);
  g.drawRoundedRect(x, y, w, h, 14);
  g.endFill();

  g.lineStyle({ width: 1, color: 0xffffff, alpha: 0.12 });
  g.drawRoundedRect(x, y, w, h, 14);
}

export function getHudEl(id) {
  const el = document.getElementById(id);
  return el instanceof HTMLElement ? el : null;
}

export function makeTextStyle(opts = {}) {
  return new PIXI.TextStyle({
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
    ...opts,
  });
}
