import { makeDeck54 } from "./deck.js";

/**
 * NOTE: This file must stay free of Pixi/DOM imports so it can be tested in jsdom
 * without requiring canvas/WebGL implementations.
 *
 * We intentionally duplicate a couple tiny helpers here instead of importing
 * `./modules/utils.js`, because `utils.js` imports `pixi.js` for text styles.
 */

// Seeded RNG using an LCG (good enough for prototyping).
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

/**
 * Game state (pure-ish, no Pixi).
 *
 * This centralizes the rules you described so UI modules (deck/hand/discard views)
 * are just views/controllers that call into this object.
 *
 * Rules captured:
 * - Scenario start: shuffle a fresh 54-card deck and draw 2 into hand
 * - Flip from deck or hand discards the flipped card(s)
 * - Flipping from hand auto-draws 1 if deck not empty
 * - IMPORTANT UX: when flipping from hand and auto-drawing, the drawn card replaces
 *   the flipped slot (so the hand doesn't "shift left" visually).
 * - Players may not draw except:
 *   - scenario start draw(2)
 *   - auto-draw after flipping from hand
 * - Reshuffle when deck is empty AND hand is empty (discard remains as history)
 *
 * Card conventions:
 * - Deck "top" is the end of the array (pop)
 * - Discard "top" is the end of the array (push)
 */

/**
 * @typedef {object} Card
 * @property {string} id
 * @property {string} label
 * @property {string} suit
 * @property {"red"|"black"} color
 * @property {boolean} isJoker
 */

/**
 * @typedef {object} GameStateSnapshot
 * @property {Card[]} deck
 * @property {Card[]} hand
 * @property {Card[]} discard
 * @property {number} seed
 */

/**
 * @typedef {object} FlipResult
 * @property {"deck"|"hand"} from
 * @property {Card[]} flipped
 * @property {Card[]} autoDrawn
 * @property {boolean} reshuffled
 */

/**
 * @param {number} [seed]
 * @returns {GameStateSnapshot}
 */
export function createNewScenario(seed) {
  const s =
    typeof seed === "number" && Number.isFinite(seed)
      ? seed >>> 0
      : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;

  const rand = makeRng(s);
  const deck = shuffleInPlace(makeDeck54(), rand);

  /** @type {Card[]} */
  const hand = [];

  /** @type {Card[]} */
  const discard = [];

  // Opening hand: draw 2 from top (end) of deck.
  for (let i = 0; i < 2; i++) {
    const c = deck.pop();
    if (!c) break;
    hand.push(c);
  }

  return { deck, hand, discard, seed: s };
}

/**
 * Create a mutable game state object.
 *
 * @param {{seed?:number, snapshot?:GameStateSnapshot}} [opts]
 */
export function createGameState(opts = {}) {
  /** @type {GameStateSnapshot} */
  let s =
    opts.snapshot ??
    createNewScenario(
      typeof opts.seed === "number" ? opts.seed >>> 0 : undefined,
    );

  /**
   * @returns {GameStateSnapshot}
   */
  function snapshot() {
    // Defensive copies so tests/callers can't mutate internals.
    return {
      deck: [...s.deck],
      hand: [...s.hand],
      discard: [...s.discard],
      seed: s.seed,
    };
  }

  function deckCount() {
    return s.deck.length;
  }

  function handCount() {
    return s.hand.length;
  }

  function discardCount() {
    return s.discard.length;
  }

  /**
   * @returns {Card|null}
   */
  function discardTop() {
    return s.discard.length ? s.discard[s.discard.length - 1] : null;
  }

  /**
   * Reshuffle condition:
   * - deck is empty AND hand is empty
   *
   * Reshuffling means: create a fresh shuffled deck and draw 2 to hand.
   * Discard pile is preserved as public history.
   *
   * @returns {boolean} whether reshuffle occurred
   */
  function maybeReshuffle() {
    if (s.deck.length !== 0) return false;
    if (s.hand.length !== 0) return false;

    const next = createNewScenario(); // new seed each reshuffle
    s.deck = next.deck;
    s.hand = next.hand;
    s.seed = next.seed;
    // keep s.discard as-is
    return true;
  }

  /**
   * Flip from deck:
   * - remove 1 from deck top
   * - place it on discard top
   * - check reshuffle condition
   *
   * @returns {FlipResult}
   */
  function flipFromDeck() {
    /** @type {Card[]} */
    const flipped = [];
    /** @type {Card[]} */
    const autoDrawn = [];

    const c = s.deck.pop();
    if (c) {
      flipped.push(c);
      s.discard.push(c);
    }

    const reshuffled = maybeReshuffle();

    return { from: "deck", flipped, autoDrawn, reshuffled };
  }

  /**
   * Flip a specific hand card by index:
   * - remove that card from hand
   * - discard it
   * - auto-draw 1 if deck not empty
   * - check reshuffle condition
   *
   * @param {number} index
   * @returns {FlipResult}
   */
  function flipFromHand(index) {
    /** @type {Card[]} */
    const flipped = [];
    /** @type {Card[]} */
    const autoDrawn = [];

    const i = index | 0;
    let flippedIndex = -1;

    if (i >= 0 && i < s.hand.length) {
      const [card] = s.hand.splice(i, 1);
      if (card) {
        flipped.push(card);
        s.discard.push(card);
        flippedIndex = i;
      }
    }

    // Auto-draw exactly 1 if possible.
    // IMPORTANT: insert the drawn card back into the same slot that was flipped,
    // so the remaining cards don't shift left.
    if (flippedIndex !== -1 && s.deck.length > 0) {
      const drawn = s.deck.pop();
      if (drawn) {
        s.hand.splice(flippedIndex, 0, drawn);
        autoDrawn.push(drawn);
      }
    } else if (flippedIndex === -1 && s.deck.length > 0) {
      // If nothing was flipped (bad index), preserve prior behavior (draw to end)
      // though callers shouldn't rely on this.
      const drawn = s.deck.pop();
      if (drawn) {
        s.hand.push(drawn);
        autoDrawn.push(drawn);
      }
    }

    const reshuffled = maybeReshuffle();

    return { from: "hand", flipped, autoDrawn, reshuffled };
  }

  /**
   * Explicitly start a fresh scenario right now.
   * Discard pile is preserved (public history).
   *
   * @param {number} [seed]
   */
  function restartScenario(seed) {
    const next = createNewScenario(seed);
    s.deck = next.deck;
    s.hand = next.hand;
    s.seed = next.seed;
    // keep s.discard
  }

  return {
    // state
    snapshot,
    deckCount,
    handCount,
    discardCount,
    discardTop,

    // actions
    flipFromDeck,
    flipFromHand,
    maybeReshuffle,
    restartScenario,
  };
}
