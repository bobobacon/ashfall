// M1 exit gate / SIT E-01: 1,000 random-legal bot games, zero crashes,
// conservation invariant holds, all games terminate under the turn cap.
import { describe, expect, it } from "vitest";
import { playRandomGame, type SimResult } from "./index.js";

const GAME_COUNT = 1_000;

describe("E-01: 1000 bot-vs-bot games", () => {
  const results: SimResult[] = [];

  it("complete without crashes, with conservation, and terminate", () => {
    for (let i = 0; i < GAME_COUNT; i++) {
      const playerCount = 3 + (i % 8); // rotate 3..10
      const seed = (i * 2654435761) % 2147483647;
      const players = Array.from({ length: playerCount }, (_, j) => ({
        id: `p${j}`,
        name: `Bot ${j}`,
        isBot: true,
      }));
      results.push(playRandomGame({ roomId: `sim${i}`, seed, players }, 1500));
    }

    const crashed = results.filter((r) => r.crashed);
    if (crashed.length > 0) {
      console.error("first crashes:", crashed.slice(0, 5));
    }
    expect(crashed, `${crashed.length} games crashed`).toHaveLength(0);

    const ended = results.filter((r) => r.winner);
    expect(ended.length).toBe(GAME_COUNT);

    const conservationFails = results.filter((r) => !r.conservationOk);
    expect(conservationFails).toHaveLength(0);
  }, 120_000);

  it("win distribution covers all factions", () => {
    const winners = new Set(results.map((r) => r.winner));
    // sovereign, raider, phantom should all win sometimes over 1000 games
    expect(winners.has("sovereign")).toBe(true);
    expect(winners.has("raider")).toBe(true);
    expect(winners.has("phantom")).toBe(true);
  });
});
