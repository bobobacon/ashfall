// M1 engine tests — SIT A1 (setup/roles), A2 (turn phases), A6 (win conditions),
// A11 (deck), determinism, fog-of-war.
import { describe, expect, it } from "vitest";
import { ROLE_DISTRIBUTION, SURVIVOR_DEFS } from "@ashfall/shared";
import {
  createGame,
  pickSurvivor,
  autoPick,
  endTurn,
  dealDamage,
  killPlayer,
  checkGameEnd,
  saveDying,
  buildDeck,
  viewFor,
  distance,
  type Game,
} from "./index.js";

function makePlayers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    isBot: i > 0, // p0 human, rest bots
  }));
}

function finishDraft(game: Game): void {
  for (const p of Object.values(game.state.players)) {
    autoPick(game, p.id);
  }
}

describe("A1 setup & roles", () => {
  for (let n = 3; n <= 10; n++) {
    it(`role distribution correct for ${n} players (A1-01)`, () => {
      const game = createGame({ roomId: `r${n}`, seed: n * 1000 + 7, players: makePlayers(n) });
      const counts: Record<string, number> = { sovereign: 0, warden: 0, raider: 0, phantom: 0 };
      for (const p of Object.values(game.state.players)) {
        counts[p.role] = (counts[p.role] ?? 0) + 1;
      }
      expect(counts).toEqual(ROLE_DISTRIBUTION[n]);
    });
  }

  it("rejects out-of-range player counts", () => {
    expect(() => createGame({ roomId: "r", seed: 1, players: makePlayers(2) })).toThrow();
    expect(() => createGame({ roomId: "r", seed: 1, players: makePlayers(11) })).toThrow();
  });

  it("sovereign is revealed immediately, others hidden (A1-02)", () => {
    const game = createGame({ roomId: "r", seed: 42, players: makePlayers(5) });
    const sovereign = Object.values(game.state.players).find((p) => p.role === "sovereign")!;
    expect(sovereign.roleRevealed).toBe(true);
    for (const p of Object.values(game.state.players)) {
      if (p.role !== "sovereign") expect(p.roleRevealed).toBe(false);
    }
  });

  it("sovereign draft offers 6 incl. all 3 leaders; others 3 (A1-03)", () => {
    const game = createGame({ roomId: "r", seed: 99, players: makePlayers(5) });
    for (const p of Object.values(game.state.players)) {
      const offer = game.draftOffers.get(p.id)!;
      if (p.role === "sovereign") {
        expect(offer).toHaveLength(6);
        expect(offer).toEqual(expect.arrayContaining(["baron_kaine", "matriarch_vala", "tide_lord_soran"]));
      } else {
        expect(offer).toHaveLength(3);
      }
    }
  });

  it("every player ends up with a unique survivor (pick conflicts redeal)", () => {
    const game = createGame({ roomId: "r", seed: 5, players: makePlayers(8) });
    for (const p of Object.values(game.state.players)) {
      autoPick(game, p.id);
    }
    const picked = Object.values(game.state.players).map((p) => p.survivorId);
    expect(picked.every((s) => s !== undefined)).toBe(true);
    expect(new Set(picked).size).toBe(8);
  });

  it("10-player draft: all offers non-empty, all picks unique", () => {
    const game = createGame({ roomId: "r10", seed: 6, players: makePlayers(10) });
    for (const p of Object.values(game.state.players)) {
      expect(game.draftOffers.get(p.id)!.length).toBeGreaterThanOrEqual(3);
    }
    for (const p of Object.values(game.state.players)) {
      autoPick(game, p.id);
    }
    const picked = Object.values(game.state.players).map((p) => p.survivorId!);
    expect(new Set(picked).size).toBe(10);
    expect(game.state.phase).toBe("playing");
  });

  it("picking a non-offered survivor is rejected", () => {
    const game = createGame({ roomId: "r", seed: 3, players: makePlayers(5) });
    const p = Object.values(game.state.players)[0]!;
    const offer = game.draftOffers.get(p.id)!;
    const notOffered = ["baron_kaine", "vex", "oracle", "grim_one_eye", "marauder_kesh", "brute_barehide", "bastion", "matriarch_vala", "ronan_crimson_blade", "grog_thunderlung", "wraith_white_ghost", "rider_kaan", "old_eye_hale", "sage_aldric", "tide_lord_soran", "ember_sage_ryn", "vesper_blade_dancer", "corsair_bell", "quartermaster_orlo", "siren_lyra", "nyx_the_veil", "warlord_karn", "femme_black_widow", "doc_mort", "baron_howl"].find((s) => !offer.includes(s))!;
    expect(() => pickSurvivor(game, p.id, notOffered)).toThrow(/not in your offer|E_NOT_OFFERED/);
  });

  it("sovereign gets +1 HP, others exact (A1-06)", () => {
    const game = createGame({ roomId: "r", seed: 77, players: makePlayers(5) });
    finishDraft(game);
    for (const p of Object.values(game.state.players)) {
      const def = SURVIVOR_DEFS[p.survivorId!]!;
      expect(p.maxHp).toBe(def.maxHp + (p.role === "sovereign" ? 1 : 0));
      expect(p.hp).toBe(p.maxHp);
    }
  });

  it("opening hands: 4 each; deck = 108 − 4N (A1-07)", () => {
    const n = 5;
    const game = createGame({ roomId: "r", seed: 11, players: makePlayers(n) });
    finishDraft(game);
    // game starts immediately: first player already drew +2 for their turn
    for (const p of Object.values(game.state.players)) {
      const expected = p.id === game.state.currentPlayerId ? 6 : 4;
      expect(p.hand, p.id).toHaveLength(expected);
    }
    expect(game.state.deck).toHaveLength(108 - 4 * n - 2);
  });

  it("turn order starts at the sovereign (A1-08)", () => {
    const game = createGame({ roomId: "r", seed: 13, players: makePlayers(6) });
    finishDraft(game);
    expect(game.state.phase).toBe("playing");
    const first = game.state.turnOrder[0]!;
    expect(game.state.players[first]!.role).toBe("sovereign");
    expect(game.state.currentPlayerId).toBe(first);
  });
});

describe("A1-09 determinism", () => {
  it("same seed → identical event logs across two runs", () => {
    const run = () => {
      const game = createGame({ roomId: "det", seed: 2026, players: makePlayers(5) });
      finishDraft(game);
      for (let i = 0; i < 10; i++) {
        endTurn(game, game.state.currentPlayerId!);
      }
      return game.log.events.map((e) => JSON.stringify(e)).join("\n");
    };
    expect(run()).toBe(run());
  });

  it("different seed → different deal", () => {
    const g1 = createGame({ roomId: "a", seed: 1, players: makePlayers(5) });
    const g2 = createGame({ roomId: "a", seed: 2, players: makePlayers(5) });
    expect(g1.state.deck).not.toEqual(g2.state.deck);
  });
});

describe("A2 turn phases", () => {
  function startedGame(n = 5, seed = 21) {
    const game = createGame({ roomId: "t", seed, players: makePlayers(n) });
    finishDraft(game);
    return game;
  }

  it("draw phase draws exactly 2 on first turn (A2-02)", () => {
    const game = startedGame();
    const first = game.state.currentPlayerId!;
    expect(game.state.players[first]!.hand).toHaveLength(6); // 4 opening + 2 draw
    expect(game.state.turnPhase).toBe("play");
  });

  it("endTurn passes to next alive player clockwise (A2-07)", () => {
    const game = startedGame();
    const order = [...game.state.turnOrder];
    endTurn(game, order[0]!);
    expect(game.state.currentPlayerId).toBe(order[1]);
    endTurn(game, order[1]!);
    expect(game.state.currentPlayerId).toBe(order[2]);
  });

  it("endTurn out of turn is rejected", () => {
    const game = startedGame();
    const notCurrent = game.state.turnOrder.find((id) => id !== game.state.currentPlayerId)!;
    try {
      endTurn(game, notCurrent);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_NOT_YOUR_TURN");
    }
  });

  it("discard down to HP at end of turn (A2-05)", () => {
    const game = startedGame();
    const cur = game.state.currentPlayerId!;
    const p = game.state.players[cur]!;
    // stuff hand to 10 cards
    while (p.hand.length < 10) {
      const cardId = game.state.deck.pop()!;
      p.hand.push(cardId);
    }
    endTurn(game, cur);
    // after discard: hand == hp (no damage taken, hp = maxHp ≥ hand)
    expect(p.hand.length).toBeLessThanOrEqual(p.hp);
  });

  it("chosen discards honored when valid (A2-05)", () => {
    const game = startedGame();
    const cur = game.state.currentPlayerId!;
    const p = game.state.players[cur]!;
    while (p.hand.length < p.hp + 2) p.hand.push(game.state.deck.pop()!);
    const chosen = p.hand.slice(0, 2);
    endTurn(game, cur, chosen);
    for (const c of chosen) expect(p.hand).not.toContain(c);
  });

  it("flipped player is skipped and unflipped (A2-10)", () => {
    const game = startedGame();
    const order = [...game.state.turnOrder];
    const next = order[1]!;
    game.state.players[next]!.flipped = true; // simulate Bunker Down
    endTurn(game, order[0]!);
    expect(game.state.currentPlayerId).toBe(order[2]); // skipped next
    expect(game.state.players[next]!.flipped).toBe(false);
  });

  it("turn counter increments each turn", () => {
    const game = startedGame();
    const t0 = game.state.turnNumber;
    endTurn(game, game.state.currentPlayerId!);
    expect(game.state.turnNumber).toBe(t0 + 1);
  });
});

describe("A11 deck integrity", () => {
  it("deck has 108 cards with valid refs", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(108);
    const ids = new Set(deck.map((c) => c.id));
    expect(ids.size).toBe(108);
  });

  it("ion storm can trigger (spade 2-9 present)", () => {
    const deck = buildDeck();
    const ion = deck.filter((c) => c.defId === "ion_storm");
    expect(ion.some((c) => c.suit === "spade" && c.number >= 2 && c.number <= 9)).toBe(true);
  });

  it("ration cut + lockdown have fail & safe windows", () => {
    const deck = buildDeck();
    const rations = deck.filter((c) => c.defId === "ration_cut");
    expect(rations.some((c) => c.suit !== "club")).toBe(true);
    expect(rations.some((c) => c.suit === "club")).toBe(true);
    const lockdowns = deck.filter((c) => c.defId === "lockdown");
    expect(lockdowns.some((c) => c.suit !== "heart")).toBe(true);
    expect(lockdowns.some((c) => c.suit === "heart")).toBe(true);
  });

  it("card conservation: deck+discard+hands+equipment = 108 through a game (A11-04)", () => {
    const game = createGame({ roomId: "cons", seed: 55, players: makePlayers(5) });
    finishDraft(game);
    const countAll = () => {
      let total = game.state.deck.length + game.state.discard.length;
      for (const p of Object.values(game.state.players)) {
        total += p.hand.length;
        for (const slot of ["weapon", "armor", "rig_plus", "rig_minus"] as const) {
          if (p.equipment[slot]) total++;
        }
        total += p.delayed.length;
      }
      return total;
    };
    expect(countAll()).toBe(108);
    for (let i = 0; i < 60; i++) {
      if (game.state.phase === "ended") break;
      endTurn(game, game.state.currentPlayerId!);
      expect(countAll()).toBe(108);
    }
  });

  it("reshuffle when deck exhausted (A11-02)", () => {
    const game = createGame({ roomId: "rs", seed: 56, players: makePlayers(5) });
    finishDraft(game);
    // empty the deck, fill discard
    game.state.discard.push(...game.state.deck.splice(0));
    const cur = game.state.currentPlayerId!;
    const before = game.state.players[cur]!.hand.length;
    // end turn → next player draws 2 from reshuffled discard
    endTurn(game, cur);
    const next = game.state.currentPlayerId!;
    expect(game.state.players[next]!.hand.length).toBeGreaterThanOrEqual(before - 4 + 2);
    const reshuffled = game.log.events.some((e) => e.type === "reshuffle");
    expect(reshuffled).toBe(true);
  });
});

describe("A3 distance", () => {
  function gameAt(n: number, seed = 31) {
    const game = createGame({ roomId: "d", seed, players: makePlayers(n) });
    finishDraft(game);
    return game;
  }

  it("seat distance circle n=5: adjacent 1, across 2 (A3-01)", () => {
    const game = gameAt(5);
    const ids = game.state.turnOrder;
    expect(distance(game.state, ids[0]!, ids[1]!)).toBe(1);
    expect(distance(game.state, ids[0]!, ids[2]!)).toBe(2);
    expect(distance(game.state, ids[0]!, ids[3]!)).toBe(2); // ccw shorter
    expect(distance(game.state, ids[0]!, ids[4]!)).toBe(1);
  });

  it("dead players compress the circle (A3-02)", () => {
    const game = gameAt(6);
    const ids = game.state.turnOrder;
    // kill the player sitting between ids[0] and ids[2]
    killPlayer(game, ids[1]!);
    expect(distance(game.state, ids[0]!, ids[2]!)).toBe(1);
  });

  it("rigs modify distance and clamp at 0 (A3-03/04/06)", () => {
    const game = gameAt(5);
    const ids = game.state.turnOrder;
    const a = ids[0]!;
    const b = ids[2]!; // seat dist 2
    const base = distance(game.state, a, b);
    expect(base).toBe(2);
    // b installs bulwark (+1 rig): others see b farther
    game.state.players[b]!.equipment.rig_plus = "bulwark_rig_001";
    expect(distance(game.state, a, b)).toBe(base + 1);
    // a installs scout (−1): a sees everyone closer
    game.state.players[a]!.equipment.rig_minus = "scout_bike_001";
    expect(distance(game.state, a, b)).toBe(base);
    // clamp: adjacent target with both mods can't go below 0
    const c = ids[1]!;
    expect(distance(game.state, a, c)).toBeGreaterThanOrEqual(0);
    expect(distance(game.state, a, a)).toBe(0);
  });

  it("rider kaan passive −1 (A3-05)", () => {
    const game = gameAt(5);
    const ids = game.state.turnOrder;
    const kaan = ids[0]!;
    const other = ids[2]!; // seat dist 2
    game.state.players[kaan]!.survivorId = "vex";
    const without = distance(game.state, kaan, other);
    game.state.players[kaan]!.survivorId = "rider_kaan";
    const withKaan = distance(game.state, kaan, other);
    expect(without).toBe(2);
    expect(withKaan).toBe(1);
  });
});

describe("A5/A6 dying, death, win conditions", () => {
  function playing(n = 5, seed = 61) {
    const game = createGame({ roomId: "w", seed, players: makePlayers(n) });
    finishDraft(game);
    return game;
  }

  it("damage to 0 HP → death pipeline, role revealed, cards to discard (A5-04)", () => {
    const game = playing();
    const victim = game.state.turnOrder[1]!;
    const p = game.state.players[victim]!;
    const handBefore = [...p.hand];
    dealDamage(game, { targetId: victim, amount: p.hp });
    expect(p.alive).toBe(false);
    expect(p.roleRevealed).toBe(true);
    expect(p.hand).toHaveLength(0);
    for (const c of handBefore) expect(game.state.discard).toContain(c);
  });

  it("saveDying raises HP to 1 (A5-02 primitive)", () => {
    const game = playing();
    const victim = game.state.turnOrder[2]!;
    const p = game.state.players[victim]!;
    p.hp = 0;
    saveDying(game, victim);
    expect(p.hp).toBe(1);
  });

  it("raider kill → killer draws 3 (A5-05)", () => {
    const game = playing();
    // find a raider victim & a killer
    const raider = Object.values(game.state.players).find((p) => p.role === "raider")!;
    const killer = Object.values(game.state.players).find((p) => p.id !== raider.id)!;
    const handBefore = killer.hand.length;
    killPlayer(game, raider.id, killer.id);
    expect(killer.hand.length).toBe(handBefore + 3);
    expect(game.log.events.some((e) => e.type === "kill_reward")).toBe(true);
  });

  it("sovereign killing own warden → discards everything (A5-06)", () => {
    const game = playing();
    const sovereign = Object.values(game.state.players).find((p) => p.role === "sovereign")!;
    const warden = Object.values(game.state.players).find((p) => p.role === "warden")!;
    expect(sovereign.hand.length).toBeGreaterThan(0);
    killPlayer(game, warden.id, sovereign.id);
    expect(sovereign.hand).toHaveLength(0);
    expect(game.log.events.some((e) => e.type === "sovereign_penalty")).toBe(true);
  });

  it("sovereign killing raider → reward, no penalty (A5-07)", () => {
    const game = playing();
    const sovereign = Object.values(game.state.players).find((p) => p.role === "sovereign")!;
    const raider = Object.values(game.state.players).find((p) => p.role === "raider")!;
    const before = sovereign.hand.length;
    killPlayer(game, raider.id, sovereign.id);
    expect(sovereign.hand.length).toBe(before + 3); // drew 3, kept them
    expect(game.log.events.some((e) => e.type === "sovereign_penalty")).toBe(false);
  });

  it("all raiders+phantoms dead → citadel wins (A6-01)", () => {
    const game = playing();
    for (const p of Object.values(game.state.players)) {
      if (p.role === "raider" || p.role === "phantom") killPlayer(game, p.id);
    }
    const w = checkGameEnd(game);
    expect(w?.faction).toBe("sovereign");
    expect(game.state.phase).toBe("ended");
  });

  it("sovereign dies with raider alive → raiders win (A6-02)", () => {
    const game = playing();
    const sovereign = Object.values(game.state.players).find((p) => p.role === "sovereign")!;
    killPlayer(game, sovereign.id);
    expect(checkGameEnd(game)?.faction).toBe("raider");
  });

  it("sovereign dies, phantom last alive → phantom wins (A6-03)", () => {
    const game = playing();
    const phantom = Object.values(game.state.players).find((p) => p.role === "phantom")!;
    const sovereign = Object.values(game.state.players).find((p) => p.role === "sovereign")!;
    for (const p of Object.values(game.state.players)) {
      if (p.id !== phantom.id && p.id !== sovereign.id) killPlayer(game, p.id);
    }
    killPlayer(game, sovereign.id); // sovereign dies LAST among non-phantoms
    expect(checkGameEnd(game)?.faction).toBe("phantom");
  });

  it("sovereign dies with phantom+raider alive → raiders win (A6-04)", () => {
    const game = playing(6);
    const sovereign = Object.values(game.state.players).find((p) => p.role === "sovereign")!;
    // kill everyone except sovereign, one raider, phantom
    const raider = Object.values(game.state.players).find((p) => p.role === "raider")!;
    const phantom = Object.values(game.state.players).find((p) => p.role === "phantom")!;
    for (const p of Object.values(game.state.players)) {
      if (p.id !== sovereign.id && p.id !== raider.id && p.id !== phantom.id) killPlayer(game, p.id);
    }
    killPlayer(game, sovereign.id);
    expect(checkGameEnd(game)?.faction).toBe("raider");
    expect(raider.alive).toBe(true);
    expect(phantom.alive).toBe(true);
  });

  it("after game end, further kills do not change winner (A6-06)", () => {
    const game = playing();
    const sovereign = Object.values(game.state.players).find((p) => p.role === "sovereign")!;
    killPlayer(game, sovereign.id);
    const winner = checkGameEnd(game)!;
    const raider = Object.values(game.state.players).find((p) => p.role === "raider" && p.alive);
    if (raider) killPlayer(game, raider.id);
    expect(checkGameEnd(game)).toEqual(winner);
  });
});

describe("B-05 fog of war (view filter)", () => {
  it("views never leak other hands or hidden roles", () => {
    const game = createGame({ roomId: "fog", seed: 71, players: makePlayers(5) });
    finishDraft(game);
    for (const viewerId of Object.keys(game.state.players)) {
      const view = viewFor(game.state, viewerId);
      const raw = JSON.stringify(view);
      for (const other of Object.values(game.state.players)) {
        if (other.id === viewerId) continue;
        // no hand cards of others anywhere in the view
        for (const cardId of other.hand) {
          expect(raw).not.toContain(`"${cardId}"`);
        }
        // no hidden roles
        if (!other.roleRevealed) {
          const otherView = view.others.find((o) => o.id === other.id)!;
          expect(otherView.role).toBeUndefined();
        }
        // hand count only
        const otherView = view.others.find((o) => o.id === other.id)!;
        expect(otherView.handCount).toBe(other.hand.length);
      }
      // no deck order leak
      expect(raw).not.toContain(game.state.deck[0] ?? "___");
    }
  });

  it("own view contains own full hand and role", () => {
    const game = createGame({ roomId: "fog2", seed: 72, players: makePlayers(4) });
    finishDraft(game);
    const p = Object.values(game.state.players)[0]!;
    const view = viewFor(game.state, p.id);
    expect(view.you.hand).toEqual(p.hand);
    expect(view.you.role).toBe(p.role);
  });
});
