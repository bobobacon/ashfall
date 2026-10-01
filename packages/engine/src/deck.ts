// Deck construction: expands DECK_COMPOSITION into 108 concrete CardInstances.
import {
  CARD_DEFS,
  DECK_COMPOSITION,
  DECK_SIZE,
  type CardInstance,
  type Suit,
} from "@ashfall/shared";
import { Rng } from "./rng.js";

const SUITS: Suit[] = ["spade", "heart", "club", "diamond"];

/** Fixed meta-seed: the printed deck's suit/number layout is stable across games;
 *  the room seed only shuffles ORDER. */
const DECK_LAYOUT_SEED = 0xa5fa11;

/**
 * Guarantees (SIT A11-03): every Fate-Check window is reachable —
 * Ion Storm spade 2–9 exists; Ration Cut has a non-club AND a club copy;
 * Lockdown has a non-heart AND a heart copy.
 */
export function buildDeck(): CardInstance[] {
  const rng = new Rng(DECK_LAYOUT_SEED);
  const cards: CardInstance[] = [];
  let counter = 0;

  for (const [defId, count] of Object.entries(DECK_COMPOSITION)) {
    const base = defId.startsWith("__filler_") ? defId.replace("__filler_", "") : defId;
    const def = CARD_DEFS[base];
    if (!def) throw new Error(`deck.json references unknown card def: ${base}`);
    for (let i = 0; i < count; i++) {
      counter++;
      cards.push({
        id: `${base}_${String(counter).padStart(3, "0")}`,
        defId: base,
        suit: SUITS[rng.int(4)]!,
        number: 1 + rng.int(13),
      });
    }
  }

  if (cards.length !== DECK_SIZE) {
    throw new Error(`deck size mismatch: built ${cards.length}, expected ${DECK_SIZE}`);
  }

  // Ion Storm: ensure at least one copy can trigger (spade 2..9)
  const ionStorms = cards.filter((c) => c.defId === "ion_storm");
  if (!ionStorms.some((c) => c.suit === "spade" && c.number >= 2 && c.number <= 9)) {
    ionStorms[0]!.suit = "spade";
    ionStorms[0]!.number = 5;
  }

  // Ration Cut: one guaranteed-fail (non-club) + one guaranteed-safe (club)
  const rations = cards.filter((c) => c.defId === "ration_cut");
  rations[0]!.suit = "spade";
  rations[1]!.suit = "club";

  // Lockdown: one guaranteed-fail (non-heart) + one guaranteed-safe (heart)
  const lockdowns = cards.filter((c) => c.defId === "lockdown");
  lockdowns[0]!.suit = "spade";
  lockdowns[1]!.suit = "heart";

  return cards;
}
