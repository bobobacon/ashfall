import { describe, expect, it } from "vitest";
import {
  CARD_DEFS,
  DECK_COMPOSITION,
  DECK_SIZE,
  LEADER_IDS,
  STANDARD_SURVIVOR_IDS,
  SURVIVOR_DEFS,
  ROLE_DISTRIBUTION,
} from "./index.js";

describe("card data integrity (SIT A11)", () => {
  it("deck totals 108 cards", () => {
    expect(DECK_SIZE).toBe(108);
  });

  it("every deck entry references a known card def", () => {
    for (const [defId, count] of Object.entries(DECK_COMPOSITION)) {
      if (defId.startsWith("__filler_")) {
        const base = defId.replace("__filler_", "");
        expect(CARD_DEFS[base], `filler base ${base}`).toBeDefined();
        continue;
      }
      expect(CARD_DEFS[defId], `unknown defId ${defId}`).toBeDefined();
      expect(count).toBeGreaterThan(0);
    }
  });

  it("has all 24 card definitions with bilingual text", () => {
    expect(Object.keys(CARD_DEFS)).toHaveLength(24);
    for (const card of Object.values(CARD_DEFS)) {
      expect(card.name.en.length).toBeGreaterThan(0);
      expect(card.name.th.length).toBeGreaterThan(0);
      expect(card.text.en.length).toBeGreaterThan(0);
      expect(card.text.th.length).toBeGreaterThan(0);
    }
  });

  it("weapons declare a range; non-weapons do not", () => {
    for (const card of Object.values(CARD_DEFS)) {
      if (card.subtype === "weapon") {
        expect(card.range).toBeGreaterThan(0);
      } else {
        expect(card.range).toBeUndefined();
      }
    }
  });
});

describe("survivor roster integrity", () => {
  it("25 standard survivors + 2 ascendants (manual §6: 7+7+7+4)", () => {
    expect(STANDARD_SURVIVOR_IDS).toHaveLength(25);
    expect(Object.keys(SURVIVOR_DEFS)).toHaveLength(27);
  });

  it("exactly 3 faction leaders", () => {
    expect(LEADER_IDS.sort()).toEqual(["baron_kaine", "matriarch_vala", "tide_lord_soran"]);
  });

  it("faction counts match the manual (7/7/7/4 + 2 ascendants)", () => {
    const counts: Record<string, number> = {};
    for (const s of Object.values(SURVIVOR_DEFS)) {
      counts[s.faction] = (counts[s.faction] ?? 0) + 1;
    }
    expect(counts.syndicate).toBe(7);
    expect(counts.verdant).toBe(7);
    expect(counts.tide).toBe(7);
    expect(counts.walker).toBe(4);
    expect(counts.ascendant).toBe(2);
  });

  it("every survivor has at least one skill with bilingual text", () => {
    for (const s of Object.values(SURVIVOR_DEFS)) {
      expect(s.skills.length).toBeGreaterThan(0);
      for (const sk of s.skills) {
        expect(sk.name.th.length).toBeGreaterThan(0);
        expect(sk.description.en.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("role distribution table (SIT A1-01)", () => {
  it("covers 3..10 players and sums to player count", () => {
    for (let n = 3; n <= 10; n++) {
      const d = ROLE_DISTRIBUTION[n]!;
      const total = d.sovereign + d.warden + d.raider + d.phantom;
      expect(total, `n=${n}`).toBe(n);
      expect(d.sovereign).toBe(1);
      expect(d.phantom).toBe(n === 10 ? 2 : 1);
    }
  });
});
