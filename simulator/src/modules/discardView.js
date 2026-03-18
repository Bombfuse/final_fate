import * as PIXI from "pixi.js";
import { roundedRectPath, clamp, makeTextStyle } from "./utils.js";

/**
 * Discard pile module
 *
 * Responsibilities:
 * - Own discard pile state (array of flipped/discarded cards; top = last element)
 * - Render a discard pile sprite next to the deck
 * - Allow clicking the pile to open a simple browser overlay to look through it
 *
 * This module is intentionally UI-focused and does not enforce game rules
 * (e.g. when flipping is allowed). It exposes `discard(card)`/`discardMany(cards)`
 * and lets the app call those at the right times.
 *
 * Card shape expectation (matches deck/hand modules):
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

function makeDiscardSprite(w, h) {
  const g = new PIXI.Graphics();

  const layers = 4;
  for (let i = layers - 1; i >= 0; i--) {
    const dx = i * 2.5;
    const dy = i * 2.5;

    g.beginFill(0x111827, 0.92);
    g.lineStyle({ width: 2, color: 0xffffff, alpha: 0.10 });
    roundedRectPath(g, dx, dy, w, h, 10);
    g.endFill();

    const inner = new PIXI.Graphics();
    inner.beginFill(0xf97316, 0.18); // orange accent
    inner.drawRoundedRect(dx + 10, dy + 10, w - 20, h - 20, 10);
    inner.endFill();
    g.addChild(inner);
  }

  const t = new PIXI.Text(
    "DISCARD",
    makeTextStyle({
      fontSize: 14,
      fill: 0xffffff,
      fontWeight: "800",
      letterSpacing: 1.5,
    }),
  );
  t.anchor.set(0.5, 0.5);
  t.position.set(w / 2 + 6, h / 2 + 6);
  t.alpha = 0.9;
  g.addChild(t);

  g.eventMode = "static";
  g.cursor = "pointer";
  g.hitArea = new PIXI.Rectangle(0, 0, w + 10, h + 10);

  return g;
}

function formatCardLine(card, idxFromTop) {
  const c = card ?? {};
  const label = c.isJoker ? "JOKER" : c.label ?? "?";
  const suit = c.isJoker ? (c.color === "red" ? "(R)" : "(B)") : c.suit ?? "";
  const color = c.color === "red" ? "R" : "B";
  const n = idxFromTop + 1;
  return `${n}. ${label} ${suit} [${color}]`;
}

/**
 * @param {{w:number,h:number}} size
 */
function makeBrowserOverlay(size) {
  const overlay = new PIXI.Container();
  overlay.visible = false;

  const dim = new PIXI.Graphics();
  dim.beginFill(0x000000, 0.55);
  dim.drawRect(0, 0, size.w, size.h);
  dim.endFill();
  dim.eventMode = "static";
  dim.cursor = "default";
  overlay.addChild(dim);

  const panel = new PIXI.Container();
  overlay.addChild(panel);

  const bg = new PIXI.Graphics();
  panel.addChild(bg);

  const title = new PIXI.Text(
    "Discard Pile",
    makeTextStyle({ fontSize: 18, fill: 0xffffff, fontWeight: "800" }),
  );
  title.anchor.set(0, 0);
  panel.addChild(title);

  const help = new PIXI.Text(
    "Click outside to close • Mouse wheel to scroll",
    makeTextStyle({ fontSize: 12, fill: 0xffffff, fontWeight: "600" }),
  );
  help.alpha = 0.8;
  help.anchor.set(0, 0);
  panel.addChild(help);

  // Scrollable list viewport
  const viewport = new PIXI.Container();
  panel.addChild(viewport);

  const viewportMask = new PIXI.Graphics();
  viewport.addChild(viewportMask);

  const listContainer = new PIXI.Container();
  viewport.addChild(listContainer);

  const emptyText = new PIXI.Text(
    "No discarded cards yet.",
    makeTextStyle({ fontSize: 14, fill: 0xffffff, fontWeight: "700" }),
  );
  emptyText.alpha = 0.9;
  listContainer.addChild(emptyText);

  // Close button
  const closeBtn = new PIXI.Container();
  panel.addChild(closeBtn);

  const closeBg = new PIXI.Graphics();
  closeBtn.addChild(closeBg);

  const closeTxt = new PIXI.Text(
    "Close",
    makeTextStyle({ fontSize: 12, fill: 0xffffff, fontWeight: "800" }),
  );
  closeTxt.anchor.set(0.5, 0.5);
  closeBtn.addChild(closeTxt);

  closeBtn.eventMode = "static";
  closeBtn.cursor = "pointer";

  // Internal layout state
  const st = {
    // panel rect
    x: 0,
    y: 0,
    w: 0,
    h: 0,

    // viewport rect (inside panel)
    vx: 0,
    vy: 0,
    vw: 0,
    vh: 0,

    scrollY: 0,
    contentH: 0,
  };

  function layoutOverlay(newSize) {
    dim.clear();
    dim.beginFill(0x000000, 0.55);
    dim.drawRect(0, 0, newSize.w, newSize.h);
    dim.endFill();

    const pad = 18;
    const panelW = clamp(Math.floor(newSize.w * 0.6), 360, 720);
    const panelH = clamp(Math.floor(newSize.h * 0.65), 300, 700);

    st.w = panelW;
    st.h = panelH;
    st.x = Math.floor((newSize.w - panelW) / 2);
    st.y = Math.floor((newSize.h - panelH) / 2);

    panel.position.set(st.x, st.y);

    bg.clear();
    bg.beginFill(0x0b1020, 0.92);
    bg.lineStyle({ width: 1, color: 0xffffff, alpha: 0.14 });
    bg.drawRoundedRect(0, 0, st.w, st.h, 14);
    bg.endFill();

    title.position.set(pad, pad);
    help.position.set(pad, pad + 28);

    // Close button
    const btnW = 86;
    const btnH = 28;
    closeBtn.position.set(st.w - pad - btnW, pad);

    closeBg.clear();
    closeBg.beginFill(0x111827, 0.95);
    closeBg.lineStyle({ width: 1, color: 0xffffff, alpha: 0.18 });
    closeBg.drawRoundedRect(0, 0, btnW, btnH, 10);
    closeBg.endFill();

    closeTxt.position.set(btnW / 2, btnH / 2);

    // Viewport area
    st.vx = pad;
    st.vy = pad + 56;
    st.vw = st.w - pad * 2;
    st.vh = st.h - st.vy - pad;

    viewport.position.set(st.vx, st.vy);

    viewportMask.clear();
    viewportMask.beginFill(0xffffff, 1);
    viewportMask.drawRect(0, 0, st.vw, st.vh);
    viewportMask.endFill();
    listContainer.mask = viewportMask;

    // Also position empty text baseline (actual text updated on render)
    emptyText.position.set(0, 0);

    // Clamp current scroll
    setScrollY(st.scrollY);
  }

  function setScrollY(y) {
    const maxScroll = Math.max(0, st.contentH - st.vh);
    st.scrollY = clamp(y, 0, maxScroll);
    listContainer.position.set(0, -st.scrollY);
  }

  /**
   * Render discard list into overlay.
   * @param {any[]} cardsTopLast
   */
  function renderList(cardsTopLast) {
    // Remove all list children except emptyText; easiest is to clear and recreate
    listContainer.removeChildren();
    listContainer.addChild(emptyText);

    const cards = Array.isArray(cardsTopLast) ? cardsTopLast : [];
    if (cards.length === 0) {
      emptyText.text = "No discarded cards yet.";
      emptyText.position.set(0, 0);
      st.contentH = emptyText.height;
      setScrollY(0);
      return;
    }

    // Show top card first (reverse order)
    const lines = [];
    for (let i = cards.length - 1; i >= 0; i--) {
      const idxFromTop = cards.length - 1 - i;
      lines.push(formatCardLine(cards[i], idxFromTop));
    }

    const lineStyle = makeTextStyle({
      fontSize: 13,
      fill: 0xffffff,
      fontWeight: "650",
    });

    const monoStyle = makeTextStyle({
      fontSize: 12,
      fill: 0xffffff,
      fontWeight: "650",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    });

    // Render as a single Text for perf and simpler layout
    const txt = new PIXI.Text(lines.join("\n"), monoStyle);
    txt.alpha = 0.95;
    txt.position.set(0, 0);

    // If very long, keep it readable with a slightly smaller font.
    if (cards.length > 60) {
      txt.style = lineStyle;
    }

    listContainer.addChild(txt);

    st.contentH = txt.height;
    setScrollY(0);
  }

  // Close behaviors
  function open() {
    overlay.visible = true;
  }

  function close() {
    overlay.visible = false;
  }

  closeBtn.on("pointerdown", () => close());

  // Clicking on dim closes; clicking panel should not close
  dim.on("pointerdown", () => close());
  panel.eventMode = "static";
  panel.on("pointerdown", (e) => e.stopPropagation?.());

  // Scroll handling (wheel)
  overlay.eventMode = "static";
  overlay.on("wheel", (e) => {
    // Pixi wheel event: e.deltaY in most environments
    const dy = e?.deltaY ?? 0;
    if (!overlay.visible) return;
    if (!Number.isFinite(dy) || dy === 0) return;
    setScrollY(st.scrollY + dy);
  });

  return {
    overlay,
    layoutOverlay,
    renderList,
    open,
    close,
    isOpen: () => overlay.visible,
  };
}

/**
 * Create a discard pile module.
 *
 * @param {{
 *  layer: PIXI.Container,
 *  overlayLayer?: PIXI.Container|null,
 *  deckArea: ()=>Rect,
 *  onChange?: (info:{count:number, topCard:any|null})=>void,
 *  spriteSize?: {w:number,h:number},
 *  offsetFromDeckPx?: number,
 *  screenSize?: ()=>{w:number,h:number},
 * }} opts
 */
export function createDiscardView(opts) {
  const {
    layer,
    overlayLayer = null,
    deckArea,
    onChange = () => {},
    spriteSize = { w: 88, h: 124 },
    offsetFromDeckPx = 14,
    screenSize = () => ({ w: 0, h: 0 }),
  } = opts ?? {};

  if (!layer) throw new Error("createDiscardView: missing `layer`");
  if (typeof deckArea !== "function")
    throw new Error("createDiscardView: missing `deckArea()`");

  /** @type {any[]} */
  let discard = [];

  const discardSprite = makeDiscardSprite(spriteSize.w, spriteSize.h);
  layer.addChild(discardSprite);

  let browser = null;
  if (overlayLayer) {
    browser = makeBrowserOverlay(screenSize());
    overlayLayer.addChild(browser.overlay);
    browser.layoutOverlay(screenSize());
  }

  function emitChange() {
    onChange({ count: discard.length, topCard: top() });
  }

  function layout() {
    const area = deckArea();

    // Place discard pile to the right of deck, aligned to deck top padding line.
    // This matches "next to the deck" without needing the deck module itself.
    discardSprite.position.set(
      area.x + (area.w - spriteSize.w) / 2 + spriteSize.w + offsetFromDeckPx,
      area.y + 18,
    );

    if (browser) browser.layoutOverlay(screenSize());
  }

  /**
   * Top card (public information).
   * @returns {any|null}
   */
  function top() {
    return discard.length ? discard[discard.length - 1] : null;
  }

  /**
   * @returns {number}
   */
  function count() {
    return discard.length;
  }

  /**
   * Read-only snapshot (top is last element).
   * @returns {any[]}
   */
  function getDiscard() {
    return [...discard];
  }

  /**
   * Replace discard contents.
   * @param {any[]} cards
   */
  function setDiscard(cards) {
    discard = Array.isArray(cards) ? [...cards] : [];
    emitChange();
  }

  /**
   * Put a single card on top of discard pile.
   * @param {any} card
   */
  function discardCard(card) {
    if (!card) return;
    discard.push(card);
    emitChange();
  }

  /**
   * Put multiple cards on top of discard pile, preserving order in `cards`
   * such that the last element of `cards` becomes the new top.
   * @param {any[]} cards
   */
  function discardMany(cards) {
    if (!Array.isArray(cards) || cards.length === 0) return;
    discard.push(...cards);
    emitChange();
  }

  function clear() {
    discard = [];
    emitChange();
  }

  function openBrowser() {
    if (!browser) return;
    browser.renderList(discard);
    browser.open();
  }

  function closeBrowser() {
    if (!browser) return;
    browser.close();
  }

  function isBrowserOpen() {
    return browser ? browser.isOpen() : false;
  }

  // Click to open browser
  discardSprite.on("pointerdown", () => openBrowser());

  function destroy() {
    discardSprite.destroy({ children: true });
    if (browser) browser.overlay.destroy({ children: true });
    discard = [];
  }

  return {
    // state
    count,
    top,
    getDiscard,
    setDiscard,
    discard: discardCard,
    discardMany,
    clear,

    // UI
    layout,
    openBrowser,
    closeBrowser,
    isBrowserOpen,
    destroy,

    // advanced usage
    sprite: discardSprite,
  };
}
