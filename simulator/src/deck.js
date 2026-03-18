/**
 * 54-card poker deck module.
 *
 * Deck contents:
 * - 52 standard cards: ranks A..K across suits ♠ ♥ ♦ ♣
 * - 2 jokers: one red, one black
 *
 * The shape is intentionally simple and stable for testability.
 */

export const SUITS = /** @type {const} */ (["♠", "♥", "♦", "♣"]);

export const RANKS = /** @type {const} */ ([
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
]);

/**
 * @typedef {"red"|"black"} CardColor
 */

/**
 * @typedef {Object} Card
 * @property {string} id
 * @property {string} rank
 * @property {string} suit
 * @property {boolean} isJoker
 * @property {string} label
 * @property {CardColor} color
 */

/**
 * Create a new ordered 54-card deck (unshuffled).
 * @returns {Card[]}
 */
export function makeDeck54() {
  /** @type {Card[]} */
  const deck = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const isRed = suit === "♥" || suit === "♦";
      deck.push({
        id: `${rank}${suit}`,
        rank,
        suit,
        isJoker: false,
        label: `${rank}${suit}`,
        color: isRed ? "red" : "black",
      });
    }
  }

  deck.push({
    id: "JOKER-R",
    rank: "JOKER",
    suit: "🃏",
    isJoker: true,
    label: "JOKER",
    color: "red",
  });

  deck.push({
    id: "JOKER-B",
    rank: "JOKER",
    suit: "🃏",
    isJoker: true,
    label: "JOKER",
    color: "black",
  });

  return deck;
}
