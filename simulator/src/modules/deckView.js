import * as PIXI from "pixi.js";
import { roundedRectPath } from "./utils.js";

/**
 * Deck view module
 *
 * Responsibilities:
 * - Own deck state (array of cards)
 * - Render a clickable deck sprite
 * - Provide draw/shuffle/reset helpers
 *
 * This module does NOT own hand state. The caller provides an `onDraw(cards)`
 * callback to receive drawn cards.
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

/**
 * @param {number} w
 * @param {number} h
 */
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

/**
 * Create a deck module.
 *
 * @param {{
 *  layer: PIXI.Container,
 *  deckArea: ()=>Rect,
 *  onDraw?: (cards:any[])=>void,
 *  onChange?: (info:{count:number})=>void,
 *  spriteSize?: {w:number,h:number},
 *  spriteTopPadding?: number,
 * }} opts
 */
export function createDeckView(opts) {
  const {
    layer,
    deckArea,
    onDraw = () => {},
    onChange = () => {},
    spriteSize = { w: 88, h: 124 },
    spriteTopPadding = 18,
  } = opts;

  if (!layer) throw new Error("createDeckView: missing `layer`");
  if (typeof deckArea !== "function")
    throw new Error("createDeckView: missing `deckArea()`");

  /** @type {any[]} */
  let deck = [];

  const deckSprite = makeDeckSprite(spriteSize.w, spriteSize.h);
  layer.addChild(deckSprite);

  function emitChange() {
    onChange({ count: deck.length });
  }

  function layout() {
    const area = deckArea();
    deckSprite.position.set(
      area.x + (area.w - spriteSize.w) / 2,
      area.y + spriteTopPadding,
    );
  }

  /**
   * Replace deck contents (no shuffle).
   * @param {any[]} cards
   */
  function setDeck(cards) {
    deck = Array.isArray(cards) ? [...cards] : [];
    emitChange();
  }

  /**
   * @returns {any[]}
   */
  function getDeck() {
    return deck;
  }

  /**
   * @returns {number}
   */
  function count() {
    return deck.length;
  }

  /**
   * Draw up to `n` cards from the top (end) of the deck.
   * Calls `onDraw(drawn)` with the drawn cards (in draw order).
   *
   * @param {number} n
   * @returns {any[]} drawn cards
   */
  function draw(n = 1) {
    const want = Math.max(0, n | 0);
    if (want === 0) return [];

    const drawn = [];
    for (let i = 0; i < want; i++) {
      const c = deck.pop();
      if (!c) break;
      drawn.push(c);
    }

    if (drawn.length) {
      onDraw(drawn);
      emitChange();
    }

    return drawn;
  }

  /**
   * Shuffle in-place using the supplied RNG.
   * RNG signature: ()=>number in [0,1).
   *
   * @param {()=>number} rand
   */
  function shuffle(rand) {
    if (typeof rand !== "function")
      throw new Error("deckView.shuffle: `rand` must be a function");

    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    emitChange();
  }

  /**
   * Convenience reset: create a new deck from a factory, optionally shuffle.
   *
   * @param {{
   *  makeDeck: ()=>any[],
   *  rand?: ()=>number,
   * }} p
   */
  function reset({ makeDeck, rand } = {}) {
    if (typeof makeDeck !== "function")
      throw new Error("deckView.reset: missing `makeDeck` factory");
    deck = [...makeDeck()];
    if (rand) shuffle(rand);
    emitChange();
  }

  /**
   * Attach click handler to draw one card on click.
   * You can override by not calling this and wiring `deckSprite` yourself.
   *
   * @param {number} n
   */
  function enableClickToDraw(n = 1) {
    deckSprite.removeAllListeners?.("pointerdown");
    deckSprite.on("pointerdown", () => draw(n));
  }

  function destroy() {
    deckSprite.destroy({ children: true });
    deck = [];
  }

  return {
    // state
    setDeck,
    getDeck,
    count,
    draw,
    shuffle,
    reset,

    // rendering / integration
    layout,
    enableClickToDraw,
    destroy,

    // advanced usage
    sprite: deckSprite,
  };
}
