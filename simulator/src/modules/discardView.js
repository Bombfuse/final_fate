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
  const root = new PIXI.Container();

  // Card back stack (visual pile)
  const pile = new PIXI.Graphics();
  root.addChild(pile);

  const layers = 4;
  for (let i = layers - 1; i >= 0; i--) {
    const dx = i * 2.5;
    const dy = i * 2.5;

    pile.beginFill(0x111827, 0.92);
    pile.lineStyle({ width: 2, color: 0xffffff, alpha: 0.1 });
    roundedRectPath(pile, dx, dy, w, h, 10);
    pile.endFill();

    const inner = new PIXI.Graphics();
    inner.beginFill(0xf97316, 0.18); // orange accent
    inner.drawRoundedRect(dx + 10, dy + 10, w - 20, h - 20, 10);
    inner.endFill();
    root.addChild(inner);
  }

  // Label ABOVE the pile
  const label = new PIXI.Text(
    "Discard",
    makeTextStyle({
      fontSize: 13,
      fill: 0xffffff,
      fontWeight: "800",
      letterSpacing: 0.5,
    }),
  );
  label.anchor.set(0.5, 1);
  label.position.set(w / 2 + 6, -6);
  label.alpha = 0.9;
  root.addChild(label);

  // Top card face (last discarded) goes on top of pile
  const topCardContainer = new PIXI.Container();
  topCardContainer.position.set(0, 0);
  root.addChild(topCardContainer);

  // Interaction
  root.eventMode = "static";
  root.cursor = "pointer";
  root.hitArea = new PIXI.Rectangle(0, -28, w + 10, h + 38);

  // Expose subnodes for updates
  root._ff = { w, h, label, topCardContainer };

  return root;
}

function isRed(card) {
  return card?.color === "red";
}

function makeCardFaceSprite(card, w, h) {
  const c = card ?? {};
  const g = new PIXI.Graphics();

  // Card face
  g.beginFill(0xffffff, 0.96);
  g.lineStyle({ width: 2, color: 0x0b1020, alpha: 0.5 });
  roundedRectPath(g, 0, 0, w, h, 10);
  g.endFill();

  const color = isRed(c) ? 0xd61f45 : 0x111827;

  const cornerStyle = makeTextStyle({
    fontSize: 16,
    fill: color,
    fontWeight: "800",
  });

  const cornerSmall = makeTextStyle({
    fontSize: 11,
    fill: color,
    fontWeight: "800",
  });

  const label = c.isJoker ? "🃏" : (c.label ?? "?");

  const tl = new PIXI.Text(label, cornerStyle);
  tl.position.set(10, 8);
  g.addChild(tl);

  const br = new PIXI.Text(label, cornerStyle);
  br.anchor.set(1, 1);
  br.position.set(w - 10, h - 8);
  g.addChild(br);

  const centerStyle = makeTextStyle({
    fontSize: c.isJoker ? 30 : 42,
    fill: color,
    fontWeight: "900",
  });

  const centerText = c.isJoker ? "JOKER" : (c.suit ?? "");
  const center = new PIXI.Text(centerText, centerStyle);
  center.anchor.set(0.5, 0.5);
  center.position.set(w / 2, h / 2 + (c.isJoker ? 0 : 2));

  if (c.isJoker) {
    center.style = cornerSmall;
    center.text = isRed(c) ? "JOKER (R)" : "JOKER (B)";
    center.scale.set(2.0, 2.0);
  }

  g.addChild(center);

  const gloss = new PIXI.Graphics();
  gloss.beginFill(0xffffff, 0.25);
  gloss.drawRoundedRect(6, 6, w - 12, h * 0.35, 10);
  gloss.endFill();
  gloss.alpha = 0.35;
  g.addChild(gloss);

  return g;
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

  // Scrollable viewport (cards grid)
  const viewport = new PIXI.Container();
  panel.addChild(viewport);

  const viewportMask = new PIXI.Graphics();
  viewport.addChild(viewportMask);

  const content = new PIXI.Container();
  viewport.addChild(content);

  const emptyText = new PIXI.Text(
    "No discarded cards yet.",
    makeTextStyle({ fontSize: 14, fill: 0xffffff, fontWeight: "700" }),
  );
  emptyText.alpha = 0.9;
  content.addChild(emptyText);

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

  const st = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,

    vx: 0,
    vy: 0,
    vw: 0,
    vh: 0,

    scrollY: 0,
    contentH: 0,

    // grid layout
    cardW: 84,
    cardH: 120,
    gap: 12,
    cols: 1,
  };

  function layoutOverlay(newSize) {
    dim.clear();
    dim.beginFill(0x000000, 0.55);
    dim.drawRect(0, 0, newSize.w, newSize.h);
    dim.endFill();

    const pad = 18;
    const panelW = clamp(Math.floor(newSize.w * 0.78), 420, 980);
    const panelH = clamp(Math.floor(newSize.h * 0.72), 320, 820);

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
    content.mask = viewportMask;

    // Card sizing responsive-ish
    st.cardH = clamp(Math.floor(st.vh * 0.42), 96, 148);
    st.cardW = Math.floor(st.cardH * 0.7);
    st.gap = 12;

    st.cols = Math.max(1, Math.floor((st.vw + st.gap) / (st.cardW + st.gap)));

    // Clamp current scroll
    setScrollY(st.scrollY);
  }

  function setScrollY(y) {
    const maxScroll = Math.max(0, st.contentH - st.vh);
    st.scrollY = clamp(y, 0, maxScroll);
    content.position.set(0, -st.scrollY);
  }

  /**
   * Render discard cards into overlay as sprites.
   * @param {any[]} cardsTopLast
   */
  function renderList(cardsTopLast) {
    content.removeChildren();
    content.addChild(emptyText);

    const cards = Array.isArray(cardsTopLast) ? cardsTopLast : [];
    if (cards.length === 0) {
      emptyText.text = "No discarded cards yet.";
      emptyText.position.set(0, 0);
      st.contentH = emptyText.height;
      setScrollY(0);
      return;
    }

    // Top card first (reverse order)
    const ordered = [];
    for (let i = cards.length - 1; i >= 0; i--) ordered.push(cards[i]);

    // Create a simple card grid
    let x = 0;
    let y = 0;
    let col = 0;

    for (let i = 0; i < ordered.length; i++) {
      const card = ordered[i];
      const sprite = makeCardFaceSprite(card, st.cardW, st.cardH);
      sprite.position.set(x, y);
      content.addChild(sprite);

      col++;
      if (col >= st.cols) {
        col = 0;
        x = 0;
        y += st.cardH + st.gap;
      } else {
        x += st.cardW + st.gap;
      }
    }

    // Content height is last row bottom
    const rows = Math.ceil(ordered.length / st.cols);
    st.contentH = rows * st.cardH + Math.max(0, rows - 1) * st.gap;

    setScrollY(0);
  }

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

  function renderTopCard() {
    const ff = discardSprite?._ff;
    if (!ff || !ff.topCardContainer) return;

    ff.topCardContainer.removeChildren();

    const topCard = top();
    if (!topCard) return;

    // Render the last discarded card as the visible top card.
    // Slight inset so it sits nicely on the pile.
    const inset = 6;
    const face = makeCardFaceSprite(
      topCard,
      spriteSize.w - inset * 2,
      spriteSize.h - inset * 2,
    );
    face.position.set(inset, inset);
    ff.topCardContainer.addChild(face);
  }

  let browser = null;
  if (overlayLayer) {
    browser = makeBrowserOverlay(screenSize());
    overlayLayer.addChild(browser.overlay);
    browser.layoutOverlay(screenSize());
  }

  function emitChange() {
    renderTopCard();
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
