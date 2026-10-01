// M2 card system tests — SIT A2 (strike limit), A4 (damage/evade), A5 (dying saves),
// A7 (fate checks & delayed cards), A8 (tactics + jam chains).
import { describe, expect, it } from "vitest";
import {
  createGame,
  autoPick,
  endTurn,
  playCard,
  respond,
  defIdOf,
  placeDelayed,
  dealDamage,
  type RespondAction,
  type Game as GameT,
} from "./index.js";

function makePlayers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    isBot: i > 0,
  }));
}

/** Start a playing-phase game, deterministic seed. */
function startedGame(n = 5, seed = 101): GameT {
  const game = createGame({ roomId: "m2", seed, players: makePlayers(n) });
  for (const p of Object.values(game.state.players)) autoPick(game, p.id);
  settle(game);
  return game;
}

/** Drain non-game-critical prompts (draw-skill choice, fate hack) by declining. */
function settle(game: GameT): void {
  let guard = 0;
  while (game.state.pendingPrompts.length > 0 && guard++ < 50) {
    const pr = game.state.pendingPrompts[0]!;
    if (pr.context.mode === "draw_skill_choice" || pr.kind === "fate_hack" || pr.kind === "reorder_deck") {
      respond(game, pr.playerId, pr.id, { kind: "decline" });
    } else {
      break;
    }
  }
}

/** Find a card of a given defId in a player's hand; inject from deck if missing. */
function ensureCard(game: GameT, playerId: string, defId: string): string {
  const p = game.state.players[playerId]!;
  const existing = p.hand.find((c) => defIdOf(game, c) === defId);
  if (existing) return existing;
  const idx = game.state.deck.findIndex((c) => game.cards.get(c)!.defId === defId);
  if (idx < 0) throw new Error(`no ${defId} in deck`);
  const [cardId] = game.state.deck.splice(idx, 1);
  p.hand.push(cardId!);
  return cardId!;
}

/** Remove all cards of a defId from a player's hand. */
function stripCards(game: GameT, playerId: string, defId: string): void {
  const p = game.state.players[playerId]!;
  p.hand = p.hand.filter((c) => defIdOf(game, c) !== defId);
}

/** Auto-answer one pending prompt with a computed legal action (or decline). */
function answerPrompt(game: GameT, action?: RespondAction | "decline"): void {
  const pr = game.state.pendingPrompts[0]!;
  respond(game, pr.playerId, pr.id, action === "decline" || action === undefined ? { kind: "decline" } : action);
}

/** Decline every pending prompt until the stack is empty. */
function drainAll(game: GameT): void {
  let guard = 0;
  while (game.state.pendingPrompts.length > 0 && guard++ < 100) answerPrompt(game, "decline");
}

function cur(game: GameT) {
  return game.state.currentPlayerId!;
}

function nextPlayer(game: GameT, fromId?: string): string {
  const order = game.state.turnOrder;
  const idx = order.indexOf(fromId ?? cur(game));
  for (let i = 1; i <= order.length; i++) {
    const cand = order[(idx + i) % order.length]!;
    if (game.state.players[cand]!.alive) return cand;
  }
  throw new Error("no next player");
}

describe("A2/A4 Strike & Evade", () => {
  it("strike with no evade → 1 damage, no prompt (A4-01)", () => {
    const game = startedGame();
    const attacker = cur(game);
    const target = nextPlayer(game);
    stripCards(game, target, "evade");
    // ensure target isn't Wraith (strike↔evade conversion would let them evade)
    game.state.players[target]!.survivorId = "baron_howl";
    const strike = ensureCard(game, attacker, "strike");
    const hpBefore = game.state.players[target]!.hp;

    playCard(game, { playerId: attacker, cardId: strike, targets: [target] });
    // no evade possible → damage applies without prompting
    expect(game.state.pendingPrompts).toHaveLength(0);
    expect(game.state.players[target]!.hp).toBe(hpBefore - 1);
  });

  it("strike cancelled by evade response (A4-02)", () => {
    const game = startedGame();
    const attacker = cur(game);
    const target = nextPlayer(game);
    const strike = ensureCard(game, attacker, "strike");
    const evade = ensureCard(game, target, "evade");
    const hpBefore = game.state.players[target]!.hp;

    playCard(game, { playerId: attacker, cardId: strike, targets: [target] });
    answerPrompt(game, { kind: "discard", cardIds: [evade] });

    expect(game.state.players[target]!.hp).toBe(hpBefore);
    expect(game.state.discard).toContain(evade);
  });

  it("second strike in same turn rejected (A2-03)", () => {
    const game = startedGame();
    const attacker = cur(game);
    const target = nextPlayer(game);
    stripCards(game, target, "evade");
    game.state.players[target]!.survivorId = "baron_howl";
    game.state.players[target]!.hp = 99; // keep alive through both strikes
    game.state.players[target]!.maxHp = 99;
    const s1 = ensureCard(game, attacker, "strike");
    playCard(game, { playerId: attacker, cardId: s1, targets: [target] });

    const s2 = ensureCard(game, attacker, "strike");
    try {
      playCard(game, { playerId: attacker, cardId: s2, targets: [target] });
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_STRIKE_LIMIT");
    }
  });

  it("strike out of range rejected (A4/range)", () => {
    const game = startedGame(8);
    const attacker = cur(game);
    // seat distance 3+ with no weapon → out of range
    const far = game.state.turnOrder[(game.state.turnOrder.indexOf(attacker) + 3) % 8]!;
    const strike = ensureCard(game, attacker, "strike");
    try {
      playCard(game, { playerId: attacker, cardId: strike, targets: [far] });
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_OUT_OF_RANGE");
    }
  });

  it("playing card out of turn rejected (B-06 primitive)", () => {
    const game = startedGame();
    const other = nextPlayer(game);
    const strike = ensureCard(game, other, "strike");
    try {
      playCard(game, { playerId: other, cardId: strike, targets: [cur(game)] });
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_NOT_YOUR_TURN");
    }
  });

  it("card not in hand rejected (B-06)", () => {
    const game = startedGame();
    const attacker = cur(game);
    const notMine = game.state.deck.find((c) => game.cards.get(c)!.defId === "strike")!;
    try {
      playCard(game, { playerId: attacker, cardId: notMine, targets: [nextPlayer(game)] });
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_NOT_IN_HAND");
    }
  });

  it("evade/signal jam cannot be played as turn actions (response-only)", () => {
    const game = startedGame();
    const attacker = cur(game);
    const evade = ensureCard(game, attacker, "evade");
    try {
      playCard(game, { playerId: attacker, cardId: evade });
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_RESPONSE_ONLY");
    }
  });
});

describe("A5 dying & saves", () => {
  it("cross-player stim save in turn order (A5-01)", () => {
    const game = startedGame();
    const victim = nextPlayer(game);
    // no self-save cards
    stripCards(game, victim, "stim");
    stripCards(game, victim, "chem_brew");
    // give NEXT player after victim a stim
    const saver = nextPlayer(game, victim);
    stripCards(game, saver, "stim");
    const stim = ensureCard(game, saver, "stim");

    dealDamage(game, { targetId: victim, amount: game.state.players[victim]!.hp, damageKind: "direct" });

    // dying prompt chain: victim has no saves → first prompt is the saver's
    expect(game.state.pendingPrompts).toHaveLength(1);
    expect(game.state.pendingPrompts[0]!.playerId).toBe(saver);
    answerPrompt(game, { kind: "discard", cardIds: [stim] });

    expect(game.state.players[victim]!.alive).toBe(true);
    expect(game.state.players[victim]!.hp).toBe(1);
  });

  it("chem brew self-save only (A5-03)", () => {
    const game = startedGame();
    const victim = nextPlayer(game);
    stripCards(game, victim, "stim");
    const brew = ensureCard(game, victim, "chem_brew");
    const saver = nextPlayer(game, victim);
    // brew in saver's hand must NOT be usable to save victim
    const brew2 = ensureCard(game, saver, "chem_brew");

    dealDamage(game, { targetId: victim, amount: game.state.players[victim]!.hp, damageKind: "direct" });
    // victim's own prompt first (self can use brew)
    const pr = game.state.pendingPrompts[0]!;
    expect(pr.playerId).toBe(victim);
    expect(pr.context.self).toBe(true);
    answerPrompt(game, { kind: "discard", cardIds: [brew] });
    expect(game.state.players[victim]!.hp).toBe(1);

    // now verify saver cannot use chem brew on someone else's dying:
    const victim2 = nextPlayer(game, saver);
    stripCards(game, victim2, "stim");
    dealDamage(game, { targetId: victim2, amount: game.state.players[victim2]!.hp, damageKind: "direct" });
    // drain: victim2 (no saves), then saver's prompt (if any) — validate rejects brew
    let guard = 0;
    while (game.state.pendingPrompts.length > 0 && guard++ < 10) {
      const p2 = game.state.pendingPrompts[0]!;
      if (p2.playerId === saver && p2.context.self !== true) {
        // attempting brew must fail validation
        try {
          respond(game, saver, p2.id, { kind: "discard", cardIds: [brew2] });
          expect.unreachable("brew should not save others");
        } catch (e) {
          expect((e as { code: string }).code).toBe("E_NOT_SAVE_CARD");
        }
        respond(game, saver, p2.id, { kind: "decline" });
      } else {
        respond(game, p2.playerId, p2.id, { kind: "decline" });
      }
    }
    expect(game.state.players[victim2]!.alive).toBe(false);
  });
});

describe("A7 fate checks & delayed cards", () => {
  /** Rig the top card of the deck (next fate flip) to a specific suit/number. */
  function rigTopFate(game: GameT, suit: "spade" | "heart" | "club" | "diamond", number: number): void {
    const top = game.state.deck[game.state.deck.length - 1]!;
    game.cards.get(top)!.suit = suit;
    game.cards.get(top)!.number = number;
  }

  function drain(game: GameT): void {
    let guard = 0;
    while (game.state.pendingPrompts.length > 0 && guard++ < 60) answerPrompt(game, "decline");
  }

  it("ion storm spade 2-9 triggers 3 ion damage at holder's turn start (A7-01)", () => {
    const game = startedGame(4);
    const holder = nextPlayer(game); // becomes current after cur ends turn
    stripCards(game, holder, "stim");
    stripCards(game, holder, "chem_brew");
    const storm = game.state.deck.find((c) => defIdOf(game, c) === "ion_storm")!;
    game.state.deck.splice(game.state.deck.indexOf(storm), 1);
    placeDelayed(game, holder, storm, "ion_storm", cur(game));
    rigTopFate(game, "spade", 7); // trigger window

    const hpBefore = game.state.players[holder]!.hp;
    endTurn(game, cur(game));
    drain(game); // jam prompts (nobody has jam) + dying prompts if lethal

    const p = game.state.players[holder]!;
    const fateEvents = game.log.events.filter((e) => e.type === "fate_check");
    expect(fateEvents.length).toBeGreaterThan(0);
    // 3 damage taken (or died from it)
    expect(p.hp === hpBefore - 3 || p.alive === false).toBe(true);
    // storm card consumed to discard on trigger
    expect(game.state.discard).toContain(storm);
  });

  it("ion storm safe fate → passes to next alive player (A7-02)", () => {
    const game = startedGame(4);
    const holder = nextPlayer(game);
    const storm = game.state.deck.find((c) => defIdOf(game, c) === "ion_storm")!;
    game.state.deck.splice(game.state.deck.indexOf(storm), 1);
    placeDelayed(game, holder, storm, "ion_storm", cur(game));
    rigTopFate(game, "heart", 9); // safe (not spade 2-9)

    endTurn(game, cur(game));
    drain(game);

    const after = nextPlayer(game, holder);
    expect(game.state.players[holder]!.delayed).toHaveLength(0);
    expect(game.state.players[after]!.delayed.some((d) => d.cardId === storm)).toBe(true);
    // card not in discard — it's back in play
    expect(game.state.discard).not.toContain(storm);
  });

  it("ion storm boundaries: spade A and spade 10+ are safe; spade 2 and 9 trigger (A7-03)", () => {
    const cases: { suit: "spade"; number: number; triggers: boolean }[] = [
      { suit: "spade", number: 1, triggers: false },
      { suit: "spade", number: 2, triggers: true },
      { suit: "spade", number: 9, triggers: true },
      { suit: "spade", number: 10, triggers: false },
      { suit: "spade", number: 13, triggers: false },
    ];
    for (const c of cases) {
      const game = startedGame(4);
      const holder = nextPlayer(game);
      stripCards(game, holder, "stim");
      const storm = game.state.deck.find((cd) => defIdOf(game, cd) === "ion_storm")!;
      game.state.deck.splice(game.state.deck.indexOf(storm), 1);
      placeDelayed(game, holder, storm, "ion_storm", cur(game));
      rigTopFate(game, c.suit, c.number);
      const hpBefore = game.state.players[holder]!.hp;

      endTurn(game, cur(game));
      drain(game);

      const p = game.state.players[holder]!;
      if (c.triggers) {
        expect(p.hp === hpBefore - 3 || !p.alive, `${c.number} should trigger`).toBe(true);
      } else {
        expect(p.hp, `${c.number} should be safe`).toBe(hpBefore);
      }
    }
  });

  it("lockdown safe (heart) → play phase NOT skipped", () => {
    const game = startedGame();
    const victim = nextPlayer(game);
    const lockCard = game.state.deck.find((c) => defIdOf(game, c) === "lockdown")!;
    game.state.deck.splice(game.state.deck.indexOf(lockCard), 1);
    placeDelayed(game, victim, lockCard, "lockdown", cur(game));
    rigTopFate(game, "heart", 8); // safe

    endTurn(game, cur(game));
    drain(game);
    // victim is now current and in play phase (not skipped)
    expect(game.state.currentPlayerId).toBe(victim);
    expect(game.state.turnPhase).toBe("play");
    endTurn(game, victim);
  });

  it("lockdown fail → play phase skipped, turn auto-ends (A2-08)", () => {
    const game = startedGame();
    const victim = nextPlayer(game);
    const lockCard = game.state.deck.find((c) => defIdOf(game, c) === "lockdown")!;
    game.state.deck.splice(game.state.deck.indexOf(lockCard), 1);
    placeDelayed(game, victim, lockCard, "lockdown", cur(game));
    rigTopFate(game, "spade", 12); // non-heart → fail

    endTurn(game, cur(game));
    drain(game);

    // play phase skipped → turn auto-ended, victim is no longer current
    expect(game.state.currentPlayerId).not.toBe(victim);
    expect(game.state.discard).toContain(lockCard);
  });

  it("ration cut fail → draw skipped (A2-09)", () => {
    const game = startedGame();
    const victim = nextPlayer(game);
    const handBefore = game.state.players[victim]!.hand.length;
    const rationCard = game.state.deck.find((c) => defIdOf(game, c) === "ration_cut")!;
    game.state.deck.splice(game.state.deck.indexOf(rationCard), 1);
    placeDelayed(game, victim, rationCard, "ration_cut", cur(game));
    rigTopFate(game, "heart", 3); // non-club → fail

    endTurn(game, cur(game));
    drain(game);

    // victim drew nothing this turn
    expect(game.state.players[victim]!.hand.length).toBe(handBefore);
    if (game.state.currentPlayerId === victim) endTurn(game, victim);
  });

  it("ration cut safe (club) → draw happens normally", () => {
    const game = startedGame();
    const victim = nextPlayer(game);
    const handBefore = game.state.players[victim]!.hand.length;
    const rationCard = game.state.deck.find((c) => defIdOf(game, c) === "ration_cut")!;
    game.state.deck.splice(game.state.deck.indexOf(rationCard), 1);
    placeDelayed(game, victim, rationCard, "ration_cut", cur(game));
    rigTopFate(game, "club", 10); // club → safe

    endTurn(game, cur(game));
    drain(game);
    expect(game.state.players[victim]!.hand.length).toBe(handBefore + 2);
    if (game.state.currentPlayerId === victim) endTurn(game, victim);
  });
});

describe("A8 tactics", () => {
  it("mortar rain: others discard evade or take 1 (A8-06)", () => {
    const game = startedGame(4);
    const user = cur(game);
    const mortar = ensureCard(game, user, "mortar_rain");
    // strip evades FIRST so damage is deterministic (no evade prompts)
    for (const p of Object.values(game.state.players)) stripCards(game, p.id, "evade");
    const hps = new Map(
      Object.values(game.state.players)
        .filter((p) => p.id !== user)
        .map((p) => [p.id, p.hp] as const),
    );

    playCard(game, { playerId: user, cardId: mortar });
    drainAll(game);

    for (const [id, hpBefore] of hps) {
      const p = game.state.players[id]!;
      if (p.alive) {
        expect(p.hp, `${id} should have taken 1`).toBeLessThanOrEqual(hpBefore - 1);
      }
      // dead players went through the dying pipeline (declined saves in drainAll)
    }
  });

  it("field clinic heals all injured by 1, capped at max (A8-08)", () => {
    const game = startedGame(4);
    const user = cur(game);
    // injure two players
    const p1 = game.state.turnOrder[1]!;
    const p2 = game.state.turnOrder[2]!;
    game.state.players[p1]!.hp -= 2;
    game.state.players[p2]!.hp -= 1;
    const clinic = ensureCard(game, user, "field_clinic");

    playCard(game, { playerId: user, cardId: clinic });
    let guard = 0;
    while (game.state.pendingPrompts.length > 0 && guard++ < 40) answerPrompt(game, "decline");

    expect(game.state.players[p1]!.hp).toBe(game.state.players[p1]!.maxHp - 1);
    expect(game.state.players[p2]!.hp).toBe(game.state.players[p2]!.maxHp);
  });

  it("standoff: loser takes 1 damage (A8-04)", () => {
    const game = startedGame(4);
    const user = cur(game);
    const foe = nextPlayer(game);
    stripCards(game, user, "strike");
    stripCards(game, foe, "strike");
    const duel = ensureCard(game, user, "standoff");
    const foeHp = game.state.players[foe]!.hp;

    // with no strikes: user (challenger) declines first → user takes damage
    stripCards(game, user, "stim");
    stripCards(game, user, "chem_brew");
    playCard(game, { playerId: user, cardId: duel, targets: [foe] });
    let guard = 0;
    while (game.state.pendingPrompts.length > 0 && guard++ < 60) answerPrompt(game, "decline");

    // challenger (user) had no strike → took 1 damage
    expect(game.state.players[user]!.hp).toBe(game.state.players[user]!.maxHp - 1);
    expect(game.state.players[foe]!.hp).toBe(foeHp);
  });

  it("signal jam cancels a tactic (A8-09)", () => {
    const game = startedGame(4);
    const user = cur(game);
    const jammer = nextPlayer(game);
    const clinic = ensureCard(game, user, "field_clinic");
    const jam = ensureCard(game, jammer, "signal_jam");
    // injure someone so clinic would visibly heal
    const injured = nextPlayer(game, jammer);
    game.state.players[injured]!.hp -= 1;
    const hpBefore = game.state.players[injured]!.hp;

    playCard(game, { playerId: user, cardId: clinic });
    // jammer's jam prompt (others may have prompts too — answer decline unless jammer)
    let guard = 0;
    while (game.state.pendingPrompts.length > 0 && guard++ < 40) {
      const pr = game.state.pendingPrompts[0]!;
      if (pr.playerId === jammer && !pr.context.__done) {
        respond(game, jammer, pr.id, { kind: "discard", cardIds: [jam] });
      } else {
        answerPrompt(game, "decline");
      }
    }
    // clinic was jammed → no heal
    expect(game.state.players[injured]!.hp).toBe(hpBefore);
    expect(game.state.discard).toContain(jam);
  });
});

describe("equipment install (M3 preview)", () => {
  it("installs into correct slot; replaces same-type", () => {
    const game = startedGame();
    const user = cur(game);
    const rifle = ensureCard(game, user, "auto_rifle");
    playCard(game, { playerId: user, cardId: rifle });
    expect(game.state.players[user]!.equipment.weapon).toBe(rifle);

    const cutter = ensureCard(game, user, "plasma_cutter");
    playCard(game, { playerId: user, cardId: cutter });
    expect(game.state.players[user]!.equipment.weapon).toBe(cutter);
    expect(game.state.discard).toContain(rifle);
  });

  it("auto-rifle lifts strike limit (A9-02)", () => {
    const game = startedGame();
    const user = cur(game);
    const target = nextPlayer(game);
    stripCards(game, target, "evade");
    game.state.players[target]!.survivorId = "baron_howl";
    game.state.players[target]!.hp = 99;
    game.state.players[target]!.maxHp = 99;
    const rifle = ensureCard(game, user, "auto_rifle");
    playCard(game, { playerId: user, cardId: rifle });

    const s1 = ensureCard(game, user, "strike");
    playCard(game, { playerId: user, cardId: s1, targets: [target] });
    const s2 = ensureCard(game, user, "strike");
    playCard(game, { playerId: user, cardId: s2, targets: [target] }); // second strike legal
    expect(game.state.players[user]!.strikeCountThisTurn).toBe(2);
  });
});
