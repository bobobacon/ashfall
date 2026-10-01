import { describe, expect, it } from "vitest";
import { Rng } from "./rng.js";

describe("Rng determinism (SIT A1-09 foundation)", () => {
  it("same seed produces identical sequences", () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds produce different sequences", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("shuffle is deterministic and lossless", () => {
    const items = Array.from({ length: 108 }, (_, i) => i);
    const s1 = new Rng(42).shuffle(items);
    const s2 = new Rng(42).shuffle(items);
    expect(s1).toEqual(s2);
    expect([...s1].sort((x, y) => x - y)).toEqual(items);
    // actually shuffled (overwhelmingly likely with 108 items)
    expect(s1).not.toEqual(items);
  });

  it("int(n) stays in range", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.int(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });
});
