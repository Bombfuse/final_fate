import { describe, it, expect } from "vitest";
import { createNewScenario, createGameState } from "./gameState.js";

describe("gameState scenario start", () => {
  it("createNewScenario() starts with 2 cards in hand and 52 cards in deck", () => {
    const s = createNewScenario(12345);

    expect(s).toBeTruthy();
    expect(Array.isArray(s.hand)).toBe(true);
    expect(Array.isArray(s.deck)).toBe(true);
    expect(Array.isArray(s.discard)).toBe(true);

    expect(s.hand).toHaveLength(2);
    expect(s.deck).toHaveLength(52);
    expect(s.discard).toHaveLength(0);
  });

  it("createGameState() starts with 2 cards in hand and 52 cards in deck", () => {
    const gs = createGameState({ seed: 12345 });
    const snap = gs.snapshot();

    expect(snap.hand).toHaveLength(2);
    expect(snap.deck).toHaveLength(52);
    expect(snap.discard).toHaveLength(0);

    expect(gs.handCount()).toBe(2);
    expect(gs.deckCount()).toBe(52);
    expect(gs.discardCount()).toBe(0);
    expect(gs.discardTop()).toBe(null);
  });

  it("scenario start cards are unique across hand + deck (no duplicates)", () => {
    const gs = createGameState({ seed: 999 });
    const snap = gs.snapshot();

    const ids = [...snap.hand, ...snap.deck].map((c) => c?.id);
    expect(ids).toHaveLength(54);

    const setSize = new Set(ids).size;
    expect(setSize).toBe(54);
  });

  it("when flipping from hand and auto-drawing, the drawn card replaces the flipped slot", () => {
    const gs = createGameState({ seed: 1337 });

    const before = gs.snapshot();
    expect(before.hand).toHaveLength(2);
    expect(before.deck).toHaveLength(52);

    const rightCardIdBefore = before.hand[1].id;

    // Flip the left card (index 0). Rule: flipped card is discarded, then auto-draw 1.
    gs.flipFromHand(0);

    const after = gs.snapshot();
    expect(after.hand).toHaveLength(2);
    expect(after.deck).toHaveLength(51);
    expect(after.discard).toHaveLength(1);

    // The right card should stay in the same slot (index 1), meaning we replaced index 0.
    expect(after.hand[1].id).toBe(rightCardIdBefore);

    // And the new left card should not be the same as the old right card.
    expect(after.hand[0].id).not.toBe(rightCardIdBefore);
  });
});
