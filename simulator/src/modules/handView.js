import * as PIXI from "pixi.js";
import { roundedRectPath, makeTextStyle, clamp } from "./utils.js";

/**
 * Hand view module
 *
 * Responsibilities:
 * - Own hand state (array of cards) + selected index
 * - Render the hand into a Pixi container within a given hand area
 * - Handle click-to-select behavior
 *
 * This module does NOT own deck state. The caller adds cards via `addCards()`.
 *
 * Card shape expectation (same as existing simulator):
 * {
 *   label: string,
 *   suit: string,
 *   color: "red" | "black",
 *   isJoker: boolean
 * }
 */

/**
 * @typedef {{x:number,y:number,w:number,h:number}} Rect
 */

function makeCardSprite(card, w, h) {
  const g = new PIXI.Graphics();

  g.beginFill(0xffffff, 0.95);
  g.lineStyle({ width: 2, color: 0x0b1020, alpha: 0.5 });
  roundedRectPath(g, 0, 0, w, h, 10);
  g.endFill();

  const isRed = card?.color === "red";
  const color = isRed ? 0xd61f45 : 0x111827;

  const style = makeTextStyle({
    fontSize: 18,
    fill: color,
    fontWeight: "700",
  });

  const styleSmall = makeTextStyle({
    fontSize: 12,
    fill: color,
    fontWeight: "700",
  });

  const label = card?.isJoker ? "🃏" : card?.label ?? "?";

  const tl = new PIXI.Text(label, style);
  tl.position.set(10, 8);
  g.addChild(tl);

  const br = new PIXI.Text(label, style);
  br.anchor.set(1, 1);
  br.position.set(w - 10, h - 8);
  g.addChild(br);

  const centerStyle = makeTextStyle({
    fontSize: card?.isJoker ? 36 : 44,
    fill: color,
    fontWeight: "800",
  });

  const centerText = card?.isJoker ? "JOKER" : card?.suit ?? "";
  const center = new PIXI.Text(centerText, centerStyle);
  center.anchor.set(0.5, 0.5);
  center.position.set(w / 2, h / 2 + (card?.isJoker ? 0 : 2));

  if (card?.isJoker) {
    center.style = styleSmall;
    center.text = isRed ? "JOKER (R)" : "JOKER (B)";
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

/**
 * @param {{
 *  layer: PIXI.Container,
 *  handArea: ()=>Rect,
 *  getCardSize: ()=>{cardW:number, cardH:number},
 *  background?: PIXI.DisplayObject|null,
 *  onChange?: (info:{count:number, selectedIndex:number, selectedCard:any|null})=>void,
 *  overlapPx?: number | null,
 *  selectedLiftPx?: number,
 *  bottomPaddingPx?: number,
 * }} opts
 */
export function createHandView(opts) {
  const {
    layer,
    handArea,
    getCardSize,
    background = null,
    onChange = () => {},
    overlapPx = null,
    selectedLiftPx = 14,
    bottomPaddingPx = 16,
  } = opts ?? {};

  if (!layer) throw new Error("createHandView: missing `layer`");
  if (typeof handArea !== "function")
    throw new Error("createHandView: missing `handArea()`");
  if (typeof getCardSize !== "function")
    throw new Error("createHandView: missing `getCardSize()`");

  /** @type {any[]} */
  let hand = [];

  /** @type {number} */
  let selectedIndex = -1;

  function emitChange() {
    const selectedCard =
      selectedIndex >= 0 ? hand[selectedIndex] ?? null : null;
    onChange({ count: hand.length, selectedIndex, selectedCard });
  }

  function clearRenderChildrenExceptBackground() {
    if (!background) {
      layer.removeChildren();
      return;
    }

    const keep = new Set([background]);
    for (let i = layer.children.length - 1; i >= 0; i--) {
      const child = layer.children[i];
      if (!keep.has(child)) layer.removeChild(child);
    }
  }

  function layout() {
    clearRenderChildrenExceptBackground();

    const n = hand.length;
    if (n === 0) return;

    const area = handArea();
    const { cardW, cardH } = getCardSize();

    const maxVisibleW = area.w - 24;
    const overlap =
      overlapPx ?? clamp(Math.floor(cardW * 0.35), 18, 36);

    const naturalW = n * cardW - (n - 1) * overlap;
    const scale = naturalW > maxVisibleW ? maxVisibleW / naturalW : 1;

    const drawW = cardW * scale;
    const drawH = cardH * scale;
    const drawOverlap = overlap * scale;

    const totalW = n * drawW - (n - 1) * drawOverlap;
    const startX = area.x + (area.w - totalW) / 2;
    const baseY = area.y + area.h - drawH - bottomPaddingPx;

    hand.forEach((card, idx) => {
      const sprite = makeCardSprite(card, drawW, drawH);
      sprite.position.set(startX + idx * (drawW - drawOverlap), baseY);

      if (idx === selectedIndex) sprite.position.y -= selectedLiftPx;

      sprite.on("pointerdown", () => {
        selectedIndex = idx === selectedIndex ? -1 : idx;
        emitChange();
        layout();
      });

      layer.addChild(sprite);
    });
  }

  /**
   * @param {any[]} cards
   */
  function setHand(cards) {
    hand = Array.isArray(cards) ? [...cards] : [];
    selectedIndex = -1;
    emitChange();
  }

  /**
   * @returns {any[]}
   */
  function getHand() {
    return hand;
  }

  function count() {
    return hand.length;
  }

  /**
   * @param {any[]} cards
   */
  function addCards(cards) {
    if (!Array.isArray(cards) || cards.length === 0) return;
    hand.push(...cards);
    emitChange();
  }

  /**
   * @param {number} idx
   */
  function removeAt(idx) {
    const i = idx | 0;
    if (i < 0 || i >= hand.length) return null;

    const removed = hand.splice(i, 1)[0] ?? null;

    if (selectedIndex === i) selectedIndex = -1;
    else if (selectedIndex > i) selectedIndex -= 1;

    emitChange();
    return removed;
  }

  function clear() {
    hand = [];
    selectedIndex = -1;
    emitChange();
  }

  function getSelectedIndex() {
    return selectedIndex;
  }

  function getSelectedCard() {
    return selectedIndex >= 0 ? hand[selectedIndex] ?? null : null;
  }

  /**
   * @param {number} idx
   */
  function setSelectedIndex(idx) {
    const i = idx | 0;
    selectedIndex = i >= 0 && i < hand.length ? i : -1;
    emitChange();
  }

  function destroy() {
    layer.removeChildren();
    hand = [];
    selectedIndex = -1;
  }

  return {
    // state
    setHand,
    getHand,
    count,
    addCards,
    removeAt,
    clear,

    // selection
    getSelectedIndex,
    setSelectedIndex,
    getSelectedCard,

    // rendering
    layout,
    destroy,
  };
}
