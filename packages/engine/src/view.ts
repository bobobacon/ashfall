// Fog-of-war filter (doc 01 §7.1 / SIT B-05): builds the per-player view.
// NEVER leak: other players' hand contents, hidden roles, deck order.
import type { CardInstance, GameState, PlayerState, Role } from "@ashfall/shared";

export interface PlayerView {
  you: {
    id: string;
    name: string;
    seat: number;
    role: Role;
    survivorId?: string;
    /** draft offers — present only for the viewer, only during the draft */
    draftOffer?: string[];
    hp: number;
    maxHp: number;
    hand: string[];
    equipment: PlayerState["equipment"];
    delayed: PlayerState["delayed"];
    tethered: boolean;
    flipped: boolean;
    buffs: PlayerState["buffs"];
  };
  /** full details of the viewer's OWN hand cards (+ own equipment/delayed),
   *  keyed by instance id — safe because they're already visible to the viewer */
  cardDetails?: Record<string, CardInstance>;
  others: {
    id: string;
    name: string;
    seat: number;
    alive: boolean;
    connected: boolean;
    handCount: number;
    role?: Role; // only if revealed (sovereign public, or dead)
    survivorId?: string; // public after draft
    hp: number;
    maxHp: number;
    equipment: PlayerState["equipment"];
    delayed: { defId: string; placedBy: string }[];
    tethered: boolean;
    flipped: boolean;
  }[];
  phase: GameState["phase"];
  turnPhase?: GameState["turnPhase"];
  currentPlayerId?: string;
  turnNumber: number;
  turnOrder: { id: string; seat: number; alive: boolean }[];
  deckCount: number;
  discardCount: number;
  topDiscardId?: string;
  pendingPrompts: GameState["pendingPrompts"];
  winner?: GameState["winner"];
  settings: GameState["settings"];
  seq: number;
}

export function viewFor(
  state: GameState,
  viewerId: string,
  draftOffer?: string[],
  cards?: ReadonlyMap<string, CardInstance>,
): PlayerView {
  const you = state.players[viewerId];
  if (!you) {
    // unknown/spectator viewer → public-only view
    return viewForSpectator(state);
  }
  const view = viewForPlayer(state, you, viewerId);
  if (draftOffer && draftOffer.length > 0) {
    view.you.draftOffer = [...draftOffer];
  }
  // Include details of the viewer's OWN visible cards (hand + equipment + delayed).
  // Safe: these are already known to the viewer. Enables suit/number rendering
  // for conversion skills (Ronan red→strike, etc.).
  if (cards) {
    const details: Record<string, CardInstance> = {};
    const own = [
      ...you.hand,
      ...Object.values(you.equipment).filter((x): x is string => !!x),
      ...you.delayed.map((d) => d.cardId),
      ...(state.discard.slice(-1) as string[]), // top discard is public
    ];
    for (const id of own) {
      const inst = cards.get(id);
      if (inst) details[id] = inst;
    }
    view.cardDetails = details;
  }
  return view;
}

/** Public-only view for spectators: no hands, only revealed roles. */
export function viewForSpectator(state: GameState): PlayerView {
  const draftDone = state.phase === "playing" || state.phase === "ended";
  const others = state.turnOrder.map((id) => {
    const p = state.players[id]!;
    return {
      id: p.id,
      name: p.name,
      seat: p.seat,
      alive: p.alive,
      connected: p.connected,
      handCount: p.hand.length,
      ...(p.roleRevealed ? { role: p.role } : {}),
      ...(draftDone && p.survivorId ? { survivorId: p.survivorId } : {}),
      hp: p.hp,
      maxHp: p.maxHp,
      equipment: p.equipment,
      delayed: p.delayed.map((d) => ({ defId: d.defId, placedBy: d.placedBy })),
      tethered: p.tethered,
      flipped: p.flipped,
    };
  });

  return {
    // `you` is required by the shape; spectators get an inert placeholder
    you: {
      id: "__spectator__",
      name: "Spectator",
      seat: -1,
      role: "warden", // never displayed for spectators (client checks id)
      hp: 0,
      maxHp: 0,
      hand: [],
      equipment: {},
      delayed: [],
      tethered: false,
      flipped: false,
      buffs: { chemBrewNext: false, barehideMode: false },
    },
    others,
    phase: state.phase,
    ...(state.turnPhase ? { turnPhase: state.turnPhase } : {}),
    ...(state.currentPlayerId ? { currentPlayerId: state.currentPlayerId } : {}),
    turnNumber: state.turnNumber,
    turnOrder: state.turnOrder.map((id) => ({
      id,
      seat: state.players[id]!.seat,
      alive: state.players[id]!.alive,
    })),
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    ...(state.discard.length > 0 ? { topDiscardId: state.discard[state.discard.length - 1] } : {}),
    // spectators see only that a prompt exists, never its content
    pendingPrompts: state.pendingPrompts.map((pr) => ({ ...pr, context: {} })),
    ...(state.winner ? { winner: state.winner } : {}),
    settings: state.settings,
    seq: state.seq,
  };
}

function viewForPlayer(state: GameState, you: PlayerState, viewerId: string): PlayerView {
  const draftDone = state.phase === "playing" || state.phase === "ended";

  const others = state.turnOrder
    .filter((id) => id !== viewerId)
    .map((id) => {
      const p = state.players[id]!;
      return {
        id: p.id,
        name: p.name,
        seat: p.seat,
        alive: p.alive,
        connected: p.connected,
        handCount: p.hand.length,
        // role visible only when revealed (sovereign from setup, anyone on death)
        ...(p.roleRevealed ? { role: p.role } : {}),
        // survivors public after the draft reveal
        ...(draftDone && p.survivorId ? { survivorId: p.survivorId } : {}),
        hp: p.hp,
        maxHp: p.maxHp,
        equipment: p.equipment,
        delayed: p.delayed.map((d) => ({ defId: d.defId, placedBy: d.placedBy })),
        tethered: p.tethered,
        flipped: p.flipped,
      };
    });

  return {
    you: {
      id: you.id,
      name: you.name,
      seat: you.seat,
      role: you.role,
      ...(you.survivorId ? { survivorId: you.survivorId } : {}),
      hp: you.hp,
      maxHp: you.maxHp,
      hand: [...you.hand],
      equipment: you.equipment,
      delayed: you.delayed,
      tethered: you.tethered,
      flipped: you.flipped,
      buffs: you.buffs,
    },
    others,
    phase: state.phase,
    ...(state.turnPhase ? { turnPhase: state.turnPhase } : {}),
    ...(state.currentPlayerId ? { currentPlayerId: state.currentPlayerId } : {}),
    turnNumber: state.turnNumber,
    turnOrder: state.turnOrder.map((id) => ({
      id,
      seat: state.players[id]!.seat,
      alive: state.players[id]!.alive,
    })),
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    ...(state.discard.length > 0 ? { topDiscardId: state.discard[state.discard.length - 1] } : {}),
    // prompts: full detail only for the addressee; others see that a prompt exists
    pendingPrompts: state.pendingPrompts.map((pr) =>
      pr.playerId === viewerId
        ? pr
        : { ...pr, kind: pr.kind, context: {} } as typeof pr,
    ),
    ...(state.winner ? { winner: state.winner } : {}),
    settings: state.settings,
    seq: state.seq,
  };
}
