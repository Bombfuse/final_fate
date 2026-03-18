import { describe, it, expect } from "vitest";

/**
 * Initial deck unit tests.
 *
 * Note: this test expects a module `src/deck.js` exporting `makeDeck54()`.
 * If you haven't extracted it yet, move the deck creation logic out of
 * `src/main.js` into `src/deck.js` and export it.
 */
import { makeDeck54 } from "./deck.js";

describe("makeDeck54", () => {
  it("creates a 54-card deck", () => {
    const deck = makeDeck54();
    expect(Array.isArray(deck)).toBe(true);
    expect(deck).toHaveLength(54);
  });

  it("includes two jokers (one red, one black)", () => {
    const deck = makeDeck54();

    const jokers = deck.filter((c) => c && c.isJoker === true);
    expect(jokers).toHaveLength(2);

    const ids = jokers.map((c) => c.id).sort();
    expect(ids).toEqual(["JOKER-B", "JOKER-R"]);

    const colors = jokers.map((c) => c.color).sort();
    expect(colors).toEqual(["black", "red"]);
  });

  it("has unique ids across the whole deck", () => {
    const deck = makeDeck54();
    const ids = deck.map((c) => c.id);
    expect(new Set(ids).size).toBe(54);
  });
});
