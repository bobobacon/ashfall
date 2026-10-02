// Shared data loaders + re-exports. Single source of truth for cards/survivors/deck.
import { z } from "zod";

import cardsRaw from "./data/cards.json" with { type: "json" };
import deckRaw from "./data/deck.json" with { type: "json" };
import survivorsRaw from "./data/survivors.json" with { type: "json" };

import type { CardDef, SurvivorDef } from "./types.js";

export * from "./types.js";
export * from "./protocol.js";

const LocalizedText = z.object({ en: z.string(), th: z.string() });

const CardDefSchema = z.object({
  defId: z.string(),
  name: LocalizedText,
  category: z.enum(["basic", "tactic", "delay", "equipment"]),
  subtype: z.enum(["weapon", "armor", "rig_plus", "rig_minus"]).optional(),
  range: z.number().int().positive().optional(),
  element: z.enum(["none", "burn", "ion"]),
  targets: z.object({ kind: z.string() }).passthrough(),
  text: LocalizedText,
});

const SkillDefSchema = z.object({
  id: z.string(),
  name: LocalizedText,
  description: LocalizedText,
  kind: z.enum(["passive", "active", "sovereign", "awaken"]),
  oncePerTurn: z.boolean().optional(),
});

const SurvivorDefSchema = z.object({
  id: z.string(),
  name: LocalizedText,
  faction: z.enum(["syndicate", "verdant", "tide", "walker", "ascendant"]),
  gender: z.enum(["male", "female"]),
  maxHp: z.number().int().positive(),
  isLeader: z.boolean().optional(),
  expansion: z.boolean().optional(),
  skills: z.array(SkillDefSchema),
});

/** Validated card definitions, keyed by defId. */
export const CARD_DEFS: Record<string, CardDef> = Object.fromEntries(
  (cardsRaw as unknown[]).map((c) => {
    const card = CardDefSchema.parse(c);
    return [card.defId, card as unknown as CardDef];
  }),
);

/** Validated survivor definitions, keyed by id. */
export const SURVIVOR_DEFS: Record<string, SurvivorDef> = Object.fromEntries(
  (survivorsRaw as unknown[]).map((s) => {
    const parsed = SurvivorDefSchema.parse(s);
    return [parsed.id, parsed as unknown as SurvivorDef];
  }),
);

/** Deck composition: defId → count. `__filler_*` keys map to their base card. */
export const DECK_COMPOSITION: Record<string, number> = deckRaw as Record<string, number>;

/** Total cards in the deck (should be 108). */
export const DECK_SIZE = Object.values(DECK_COMPOSITION).reduce((a, b) => a + b, 0);

/** Standard (non-expansion) survivor pool ids. */
export const STANDARD_SURVIVOR_IDS = Object.values(SURVIVOR_DEFS)
  .filter((s) => !(s as unknown as { expansion?: boolean }).expansion)
  .map((s) => s.id);

/** The three faction leaders offered as extra picks to the Sovereign. */
export const LEADER_IDS = Object.values(SURVIVOR_DEFS)
  .filter((s) => s.isLeader)
  .map((s) => s.id);

/** Card category helpers used by the engine. */
export const isRed = (suit: string): boolean => suit === "heart" || suit === "diamond";
export const isBlack = (suit: string): boolean => suit === "spade" || suit === "club";
