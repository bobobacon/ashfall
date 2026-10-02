<script lang="ts">
  /** Event log drawer — view what happened each turn/phase during the game. */
  import { gameStore } from "../stores/game.svelte.js";
  import { send } from "../stores/connection.js";
  import type { ViewPlayerOther, ViewYou } from "../stores/game.svelte.js";

  let { onClose }: { onClose: () => void } = $props();

  const history = $derived(gameStore.history);
  const lang = $derived(gameStore.lang);
  const view = $derived(gameStore.view);
  const you = $derived(view?.you);

  // Request the full history on open; retry briefly if the first response
  // didn't arrive (e.g. connection hiccup right as the drawer opens).
  $effect(() => {
    send({ type: "log:history" });
    if (gameStore.history.length === 0) {
      const tries = [300, 800, 1500];
      for (const t of tries) {
        setTimeout(() => {
          if (gameStore.history.length === 0) send({ type: "log:history" });
        }, t);
      }
    }
  });

  const SUITS: Record<string, string> = { spade: "♠", heart: "♥", club: "♣", diamond: "♦" };
  const RANK: Record<string, string> = { card_back: "?" };

  /** Group history into turns for readable rendering. */
  const turns = $derived.by(() => {
    const groups: { turn: number; playerId?: string; events: { type: string; [k: string]: unknown }[] }[] = [];
    let cur: (typeof groups)[number] | null = null;
    for (const ev of history) {
      if (ev.type === "turn_started") {
        cur = { turn: (ev.turnNumber as number) ?? 0, playerId: ev.playerId as string, events: [] };
        groups.push(cur);
      } else if (cur) {
        cur.events.push(ev);
      }
    }
    // any events before first turn (setup) → a "setup" bucket
    if (groups.length === 0 && history.length > 0) {
      groups.push({ turn: 0, events: history });
    } else {
      const setup = history.filter((e) => e.type === "game_created" || e.type === "roles_dealt" || e.type === "draft_revealed" || e.type === "game_started");
      if (setup.length > 0) groups.unshift({ turn: 0, events: setup });
    }
    return groups;
  });

  function nameOf(pid: unknown): string {
    if (typeof pid !== "string") return "?";
    if (you && pid === you.id) return lang === "en" ? "you" : "คุณ";
    const o = view?.others.find((x) => x.id === pid);
    return o?.name ?? pid.slice(0, 6);
  }

  function cardName(cid: unknown): string {
    if (typeof cid !== "string") return "?";
    const info = view?.cardDetails?.[cid];
    if (info) return gameStore.cardName(info.defId);
    return cid.slice(0, 10);
  }

  function phaseLabel(p: unknown): string {
    const map: Record<string, { en: string; th: string }> = {
      start: { en: "Start of Turn", th: "เริ่มเทิร์น" },
      draw: { en: "Draw Phase", th: "เฟสจั่ว" },
      play: { en: "Play Phase", th: "เฟสใช้การ์ด" },
      end: { en: "End of Turn", th: "จบเทิร์น" },
    };
    const m = map[String(p)];
    return m ? m[lang] : String(p);
  }

  function describe(ev: { type: string; [k: string]: unknown }): { icon: string; text: string } {
    const e = ev as { [k: string]: unknown };
    const icon = (i: string) => i;
    switch (ev.type) {
      case "game_created": return { icon: "⚙", text: lang === "en" ? `Game created — ${e.playerCount} players` : `เริ่มเกม — ผู้เล่น ${e.playerCount} คน` };
      case "roles_dealt": return { icon: "🎭", text: lang === "en" ? "Secret roles dealt" : "แจกบทบาทลับ" };
      case "draft_revealed": return { icon: "👥", text: lang === "en" ? "Survivors revealed" : "เปิดเผยตัวละคร" };
      case "game_started": return { icon: "⚔", text: lang === "en" ? "The battle begins" : "สงครามเริ่ม" };
      case "turn_started": return { icon: "▶", text: `${nameOf(e.playerId)} — ${lang === "en" ? "turn" : "เทิร์น"} ${e.turnNumber}` };
      case "phase_changed": return { icon: "⏱", text: `${nameOf(e.playerId)} — ${phaseLabel(e.phase)}` };
      case "cards_drawn": return { icon: "🂠", text: `${nameOf(e.playerId)} +${e.count} cards` };
      case "card_played":
        return { icon: "🎴", text: `${nameOf(e.playerId)} plays ${cardName(e.cardId)}${Array.isArray(e.targets) && e.targets.length ? ` → ${(e.targets as string[]).map((t) => nameOf(t)).join(", ")}` : ""}` };
      case "card_discarded": return { icon: "🗑", text: `${nameOf(e.playerId)} discards ${cardName(e.cardId)} (${String(e.reason)})` };
      case "cards_discarded": return { icon: "🗑", text: `${nameOf(e.playerId)} discards ${(e.cardIds as string[]).map((c) => cardName(c)).join(", ")}` };
      case "equipment_installed": return { icon: "⚙", text: `${nameOf(e.playerId)} equips ${cardName(e.cardId)}` };
      case "equipment_replaced": return { icon: "⚙", text: `${nameOf(e.playerId)} replaces ${cardName(e.oldCardId)} → ${cardName(e.newCardId)}` };
      case "equipment_removed": return { icon: "⚙", text: `${nameOf(e.playerId)} loses ${cardName(e.cardId)} (${String(e.reason)})` };
      case "delayed_placed": return { icon: "⏳", text: `${cardName(e.cardId)} placed on ${nameOf(e.targetId)} by ${nameOf(e.placedBy)}` };
      case "fate_check": return { icon: "🎴", text: `Fate: ${SUITS[String(e.suit)] ?? "?"}${e.number} → ${String(e.outcome)}${e.forPlayerId ? ` (${nameOf(e.forPlayerId)})` : ""}` };
      case "damage": return { icon: "💥", text: `${nameOf(e.targetId)} takes ${e.amount} ${String(e.element) !== "none" ? String(e.element) : ""} damage${e.sourcePlayerId ? ` from ${nameOf(e.sourcePlayerId)}` : ""}` };
      case "damage_blocked": return { icon: "🛡", text: `${nameOf(e.targetId)} blocked ${e.amount} by ${String(e.by)}` };
      case "heal": return { icon: "💚", text: `${nameOf(e.targetId)} heals ${e.amount}` };
      case "dying": return { icon: "🆘", text: `${nameOf(e.playerId)} is dying!` };
      case "saved": return { icon: "✨", text: `${nameOf(e.playerId)} is saved` };
      case "death": return { icon: "☠", text: `${nameOf(e.playerId)} dies (${String(e.role)})${e.killerId ? ` — killed by ${nameOf(e.killerId)}` : ""}` };
      case "kill_reward": return { icon: "🎁", text: `${nameOf(e.killerId)} draws ${e.cardsDrawn} (Raider bounty)` };
      case "sovereign_penalty": return { icon: "👑", text: `${nameOf(e.playerId)} (Sovereign) discards everything` };
      case "skill_activated": return { icon: "⚡", text: `${nameOf(e.playerId)}: ${String(e.skillId)}` };
      case "reshuffle": return { icon: "♻", text: lang === "en" ? "Deck reshuffled" : "สับกองใหม่" };
      case "game_ended": return { icon: "🏁", text: `${String(e.winner)} ${lang === "en" ? "wins" : "ชนะ"} (${String(e.reason)})` };
      default: return { icon: "·", text: `${ev.type} ${JSON.stringify({ ...ev, type: undefined }).slice(0, 60)}` };
    }
  }
</script>

<div class="drawer-overlay" onclick={onClose}>
  <div class="drawer" onclick={(e) => e.stopPropagation()}>
    <header>
      <h3>📜 {lang === "en" ? "Game History" : "ประวัติการเล่น"}</h3>
      <button class="close" onclick={onClose} aria-label="close">✕</button>
    </header>
    <p class="hint">{lang === "en" ? "What happened each turn & phase" : "สิ่งที่เกิดขึ้นในแต่ละเทิร์นและเฟส"}</p>

    <div class="scroll">
      {#if turns.length === 0}
        <p class="empty">{lang === "en" ? "No events yet." : "ยังไม่มีเหตุการณ์"}</p>
      {/if}

      {#each turns as grp, gi (gi)}
        <div class="turn-block">
          <div class="turn-head">
            {grp.turn === 0
              ? (lang === "en" ? "Setup" : "การเตรียมเกม")
              : `${lang === "en" ? "Turn" : "เทิร์น"} ${grp.turn} — ${grp.playerId ? nameOf(grp.playerId) : "?"}`}
          </div>
          {#each grp.events as ev, ei (gi + ":" + ei)}
            {@const d = describe(ev)}
            <div class="log-line">
              <span class="l-icon">{d.icon}</span>
              <span class="l-text">{d.text}</span>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .drawer-overlay {
    position: fixed; inset: 0; z-index: 90;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    justify-content: flex-end;
  }
  .drawer {
    background: var(--bg-panel);
    border-left: 2px solid var(--sovereign);
    width: min(440px, 94vw);
    height: 100%;
    display: flex;
    flex-direction: column;
    box-shadow: -8px 0 32px rgba(0, 0, 0, 0.5);
  }
  header {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.7rem 1rem;
    background: #191510;
    border-bottom: 1px solid #3a3226;
  }
  h3 { margin: 0; flex: 1; color: var(--sovereign); letter-spacing: 0.08em; font-size: 1rem; }
  .close { background: none; border: 1px solid #4a4034; color: var(--text-bone); font-family: inherit; cursor: pointer; width: 26px; height: 26px; }
  .hint { margin: 0; padding: 0.4rem 1rem 0; font-size: 0.7rem; color: var(--text-dim); }
  .scroll { flex: 1; overflow-y: auto; padding: 0.6rem 1rem 1.5rem; display: flex; flex-direction: column; gap: 0.7rem; }
  .empty { color: var(--text-dim); font-size: 0.85rem; }
  .turn-block { border: 1px solid #2a2218; background: #191510; }
  .turn-head {
    padding: 0.35rem 0.6rem;
    color: var(--sovereign);
    font-size: 0.75rem;
    letter-spacing: 0.1em;
    background: rgba(232, 197, 71, 0.06);
    border-bottom: 1px solid #2a2218;
  }
  .log-line {
    display: flex; gap: 0.45rem;
    padding: 0.22rem 0.6rem;
    font-size: 0.73rem;
    color: var(--text-bone);
    border-bottom: 1px solid #14100c;
    line-height: 1.45;
  }
  .log-line:last-child { border-bottom: none; }
  .l-icon { width: 18px; flex-shrink: 0; text-align: center; }
  .l-text { word-break: break-word; }
</style>