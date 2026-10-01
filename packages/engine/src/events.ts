// Engine event log — the backbone of determinism, replay, and testing.
import type { CardInstance, GameState, PlayerState, Prompt, Role } from "@ashfall/shared";

export type GameEvent =
  | { type: "game_created"; roomId: string; seed: number; playerCount: number }
  | { type: "roles_dealt"; sovereignSeat: number }
  | { type: "draft_offered"; playerId: string; survivorIds: string[] }
  | { type: "draft_picked"; playerId: string; survivorId: string }
  | { type: "draft_revealed" }
  | { type: "game_started"; turnOrder: string[] }
  | { type: "turn_started"; playerId: string; turnNumber: number }
  | { type: "phase_changed"; playerId: string; phase: GameState["turnPhase"] }
  | { type: "cards_drawn"; playerId: string; count: number }
  | { type: "card_played"; playerId: string; cardId: string; defId: string; targets?: string[] }
  | { type: "card_discarded"; playerId: string; cardId: string; reason: string }
  | { type: "cards_discarded"; playerId: string; cardIds: string[]; reason: string }
  | { type: "equipment_installed"; playerId: string; cardId: string; slot: string }
  | { type: "equipment_replaced"; playerId: string; oldCardId: string; newCardId: string; slot: string }
  | { type: "equipment_removed"; playerId: string; cardId: string; slot: string; reason: string }
  | { type: "delayed_placed"; targetId: string; cardId: string; defId: string; placedBy: string }
  | { type: "fate_check"; forCardId?: string; forPlayerId?: string; cardId: string; suit: string; number: number; outcome: string }
  | { type: "damage"; targetId: string; amount: number; element: string; sourcePlayerId?: string; sourceCardId?: string }
  | { type: "damage_blocked"; targetId: string; amount: number; by: string }
  | { type: "heal"; targetId: string; amount: number; sourcePlayerId?: string; sourceCardId?: string }
  | { type: "dying"; playerId: string }
  | { type: "saved"; playerId: string }
  | { type: "death"; playerId: string; role: Role; killerId?: string }
  | { type: "kill_reward"; killerId: string; cardsDrawn: number }
  | { type: "sovereign_penalty"; playerId: string }
  | { type: "prompt_issued"; prompt: Prompt }
  | { type: "prompt_resolved"; promptId: string; playerId: string; action: string }
  | { type: "prompt_timeout"; promptId: string; playerId: string }
  | { type: "skill_activated"; playerId: string; skillId: string }
  | { type: "turn_ended"; playerId: string }
  | { type: "reshuffle" }
  | { type: "game_ended"; winner: Role; reason: string }
  | { type: "illegal_intent"; playerId: string; intent: string; code: string };

/**
 * The engine is synchronous & pure: every mutation appends events here.
 * The server layer drains this queue to broadcast to clients.
 */
export class EventLog {
  readonly events: GameEvent[] = [];

  push(event: GameEvent): void {
    this.events.push(event);
  }

  drain(): GameEvent[] {
    const out = this.events.splice(0, this.events.length);
    return out;
  }
}

export type { CardInstance, PlayerState };
