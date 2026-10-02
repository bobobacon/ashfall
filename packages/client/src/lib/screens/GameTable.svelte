<script lang="ts">
  import { gameStore, type CardInstanceInfo, type ViewPlayerOther } from "../stores/game.svelte.js";
  import PlayerSeat from "../components/PlayerSeat.svelte";
  import PromptModal from "../components/PromptModal.svelte";
  import CardComponent from "../components/Card.svelte";

  let {
    onSend,
  }: {
    onSend: (intent: import("@ashfall/shared").ClientIntentT) => void;
  } = $props();

  const view = $derived(gameStore.view);
  const you = $derived(view?.you);
  const lang = $derived(gameStore.lang);
  const prompt = $derived(gameStore.prompt);

  // --- interaction state ---
  let selectedCard = $state<string | null>(null);
  let targetingFor = $state<{ cardId: string; asDefId?: string; needs: number } | null>(null);
  let chosenTargets = $state<string[]>([]);

  const SUITS: Record<string, string> = { spade: "♠", heart: "♥", club: "♣", diamond: "♦" };

  function cardInfo(id: string): CardInstanceInfo | undefined {
    return view?.cardDetails?.[id];
  }

  function isMyTurn(): boolean {
    return !!view && view.currentPlayerId === you?.id && view.turnPhase === "play" && !prompt;
  }

  function targetRuleOf(defId: string): { needs: number } {
    // mirrors engine targeting rules
    switch (defId) {
      case "strike": return { needs: 1 };
      case "stim": return { needs: 1 }; // can self-target
      case "scavenge": return { needs: 1 };
      case "sabotage": return { needs: 1 };
      case "standoff": return { needs: 1 };
      case "ration_cut": return { needs: 1 };
      case "lockdown": return { needs: 1 };
      case "proxy_war": return { needs: 2 };
      default: return { needs: 0 };
    }
  }

  function clickCard(id: string) {
    if (!isMyTurn()) return;
    const info = cardInfo(id);
    if (!info) return;
    let defId = info.defId;
    // conversion skills: let the server validate; offer asDefId when applicable
    let asDefId: string | undefined;
    const surv = you?.survivorId;
    if (surv === "ronan_crimson_blade" && (info.suit === "heart" || info.suit === "diamond") && defId !== "strike" && defId !== "evade") {
      asDefId = "strike"; defId = "strike";
    } else if (surv === "doc_mort" && (info.suit === "heart" || info.suit === "diamond") && defId !== "stim") {
      asDefId = "stim"; defId = "stim";
    } else if (surv === "wraith_white_ghost" && defId === "evade") {
      asDefId = "strike"; defId = "strike";
    } else if (surv === "corsair_bell" && (info.suit === "spade" || info.suit === "club") && defId !== "sabotage") {
      asDefId = "sabotage"; defId = "sabotage";
    } else if (surv === "siren_lyra" && info.suit === "diamond" && defId !== "lockdown") {
      asDefId = "lockdown"; defId = "lockdown";
    }

    if (defId === "evade" || defId === "signal_jam") return; // response-only
    const rule = targetRuleOf(defId);
    selectedCard = id;
    if (rule.needs > 0) {
      targetingFor = { cardId: id, asDefId, needs: rule.needs };
      chosenTargets = [];
    } else {
      // no target needed: play immediately (with confirm for AoE)
      onSend({ type: "game:play", cardId: id, asDefId });
      selectedCard = null;
      targetingFor = null;
    }
  }

  function clickPlayer(pid: string) {
    if (!targetingFor) return;
    if (pid === you?.id && targetingFor.needs === 1) {
      // self-target allowed for stim; others validated server-side
    }
    const idx = chosenTargets.indexOf(pid);
    if (idx >= 0) {
      chosenTargets = chosenTargets.filter((t) => t !== pid);
    } else if (chosenTargets.length < targetingFor.needs) {
      chosenTargets = [...chosenTargets, pid];
    }
    if (chosenTargets.length === targetingFor.needs) {
      onSend({
        type: "game:play",
        cardId: targetingFor.cardId,
        targets: chosenTargets,
        asDefId: targetingFor.asDefId,
      });
      targetingFor = null;
      chosenTargets = [];
      selectedCard = null;
    }
  }

  function cancelTargeting() {
    targetingFor = null;
    chosenTargets = [];
    selectedCard = null;
  }

  function endTurn() {
    if (!view || view.currentPlayerId !== you?.id || view.turnPhase !== "play") return;
    onSend({ type: "game:endTurn" });
  }

  const seatOrder = $derived.by(() => {
    if (!view) return { order: [] as { id: string; isYou: boolean }[], byId: new Map<string, ViewPlayerOther>() };
    const byId = new Map<string, ViewPlayerOther>(view.others.map((o) => [o.id, o]));
    const order = view.turnOrder
      .filter((t) => t.id !== you?.id)
      .map((t) => ({ id: t.id, isYou: false }));
    return { order, byId };
  });

  const eventFeed = $derived(
    gameStore.events.slice(-6).map((e) => describeEvent(e)).filter(Boolean) as string[],
  );

  function describeEvent(e: { type: string; [k: string]: unknown }): string {
    const nm = (pid: unknown) => {
      if (typeof pid !== "string") return "?";
      if (pid === you?.id) return lang === "en" ? "you" : "คุณ";
      const o = view?.others.find((x) => x.id === pid);
      return o?.name ?? pid.slice(0, 6);
    };
    const card = (cid: unknown) => {
      if (typeof cid !== "string") return "?";
      const info = cardInfo(cid);
      return info ? gameStore.cardName(info.defId) : cid;
    };
    switch (e.type) {
      case "card_played": return `${nm(e.playerId)} → ${card(e.cardId)}`;
      case "damage": return `💥 ${nm(e.targetId)} −${e.amount}`;
      case "heal": return `💚 ${nm(e.targetId)} +${e.amount}`;
      case "death": return `☠ ${nm(e.playerId)} (${String(e.role)})`;
      case "dying": return `🆘 ${nm(e.playerId)} ${lang === "en" ? "is dying!" : "ปางตาย!"}`;
      case "saved": return `✨ ${nm(e.playerId)} ${lang === "en" ? "survived" : "รอดชีวิต"}`;
      case "fate_check": return `🎴 ${lang === "en" ? "Fate" : "ชะตา"}: ${SUITS[String(e.suit)] ?? "?"}${e.number}`;
      case "cards_drawn": return `${nm(e.playerId)} +${e.count}🂠`;
      case "turn_started": return `— ${nm(e.playerId)}'s ${lang === "en" ? "turn" : "เทิร์น"} —`;
      case "kill_reward": return `🎁 ${nm(e.killerId)} +${e.cardsDrawn}`;
      case "skill_activated": return `⚡ ${nm(e.playerId)}: ${String(e.skillId)}`;
      case "reshuffle": return `♻ ${lang === "en" ? "deck reshuffled" : "สับกองใหม่"}`;
      case "game_started": return `⚔ ${lang === "en" ? "the battle begins" : "สงครามเริ่ม"}`;
      default: return "";
    }
  }
</script>

<div class="table-screen">
  {#if view && you}
    <header class="top-bar">
      <div class="room-id">#{view ? (gameStore.room?.roomId ?? "") : ""}</div>
      <div class="turn-info">
        {lang === "en" ? "Turn" : "เทิร์น"} {view.turnNumber}
        {#if view.turnPhase}· {view.turnPhase}{/if}
        {#if view.currentPlayerId}
          · {view.currentPlayerId === you.id ? (lang === "en" ? "YOUR TURN" : "ตาคุณ") : (view.others.find((o) => o.id === view.currentPlayerId)?.name ?? "")}
        {/if}
      </div>
      <div class="counts">🂠 {view.deckCount} · ♻ {view.discardCount}</div>
      <button class="lang-btn" onclick={() => (gameStore.lang = lang === "en" ? "th" : "en")}>
        {lang === "en" ? "TH" : "EN"}
      </button>
    </header>

    <div class="seats-area">
      {#each seatOrder.order.filter((o) => !o.isYou) as seat (seat.id)}
        {@const other = seatOrder.byId.get(seat.id)}
        {#if other}
          <button class="seat-btn" onclick={() => clickPlayer(seat.id)}
                  class:targetable={!!targetingFor}
                  class:chosen={chosenTargets.includes(seat.id)}>
            <PlayerSeat other={other} isCurrent={view.currentPlayerId === seat.id} />
          </button>
        {/if}
      {/each}
    </div>

    <div class="center-strip">
      <div class="you-plate">
        <PlayerSeat
          other={{
            id: you.id, name: you.name, seat: you.seat, alive: true,
            connected: true, handCount: you.hand.length, role: you.role,
            survivorId: you.survivorId, hp: you.hp, maxHp: you.maxHp,
            equipment: you.equipment, delayed: you.delayed,
            tethered: you.tethered, flipped: you.flipped,
          }}
          isCurrent={view.currentPlayerId === you.id}
        />
      </div>
      <div class="feed">
        {#each eventFeed as line, i (i)}
          <div class="feed-line">{line}</div>
        {/each}
      </div>
    </div>

    {#if targetingFor}
      <div class="targeting-bar">
        <span>
          🎯 {lang === "en" ? `choose ${targetingFor.needs} target(s)` : `เลือกเป้าหมาย ${targetingFor.needs}`}
          ({chosenTargets.length}/{targetingFor.needs})
        </span>
        <button class="btn small" onclick={cancelTargeting}>{lang === "en" ? "cancel" : "ยกเลิก"}</button>
      </div>
    {/if}

    <footer class="hand-area">
      <div class="hand">
        {#each you.hand as cid (cid)}
          {@const info = cardInfo(cid)}
          {#if info}
            <CardComponent
              {info}
              meta={gameStore.cards[info.defId]}
              selected={selectedCard === cid}
              playable={isMyTurn()}
              onclick={() => clickCard(cid)}
            />
          {:else}
            <div class="card unknown">?</div>
          {/if}
        {/each}
      </div>
      <button class="btn end-turn" disabled={!isMyTurn()} onclick={endTurn}>
        {lang === "en" ? "END TURN ▶" : "จบเทิร์น ▶"}
      </button>
    </footer>

    {#if prompt && prompt.playerId === you.id}
      <PromptModal {prompt} view={view} onSend={onSend} />
    {/if}
  {/if}
</div>

<style>
  .table-screen {
    flex: 1;
    display: flex;
    flex-direction: column;
    background:
      radial-gradient(ellipse at 50% 40%, rgba(90, 70, 45, 0.12), transparent 70%),
      var(--bg-ash);
    min-height: 100vh;
  }
  .top-bar {
    display: flex; align-items: center; gap: 1rem;
    padding: 0.4rem 0.8rem;
    background: #14100c;
    border-bottom: 2px solid #3a3226;
    font-size: 0.8rem;
  }
  .room-id { color: var(--text-dim); }
  .turn-info { flex: 1; color: var(--sovereign); letter-spacing: 0.05em; }
  .counts { color: var(--text-dim); }
  .lang-btn {
    background: #2f2820; border: 1px solid #4a4034; color: var(--text-bone);
    font-family: inherit; padding: 0.2rem 0.5rem; cursor: pointer;
  }
  .seats-area {
    display: flex; flex-wrap: wrap; gap: 0.5rem;
    justify-content: center;
    padding: 0.8rem;
  }
  .seat-btn {
    background: none; border: 2px solid transparent; padding: 0;
    cursor: default; font-family: inherit;
  }
  .seat-btn.targetable { cursor: crosshair; border-color: rgba(232, 197, 71, 0.4); }
  .seat-btn.targetable:hover { border-color: var(--sovereign); }
  .seat-btn.chosen { border-color: var(--raider); box-shadow: 0 0 8px rgba(200, 64, 47, 0.5); }
  .center-strip {
    display: flex; gap: 1rem; align-items: flex-start;
    padding: 0 0.8rem; justify-content: center; flex-wrap: wrap;
  }
  .feed {
    background: rgba(20, 16, 12, 0.8);
    border: 1px solid #3a3226;
    padding: 0.4rem 0.6rem;
    font-size: 0.72rem;
    color: var(--text-dim);
    min-width: 220px;
    max-width: 320px;
    display: flex; flex-direction: column; gap: 2px;
  }
  .feed-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .targeting-bar {
    display: flex; gap: 0.8rem; align-items: center; justify-content: center;
    padding: 0.4rem;
    background: rgba(232, 197, 71, 0.08);
    color: var(--sovereign);
    font-size: 0.85rem;
  }
  .hand-area {
    margin-top: auto;
    padding: 0.6rem 0.8rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: center;
    background: linear-gradient(transparent, rgba(0,0,0,0.5));
  }
  .hand {
    display: flex; gap: 0.4rem;
    overflow-x: auto;
    max-width: 96vw;
    padding: 0.4rem 0.2rem;
  }
  .card.unknown {
    width: 64px; height: 90px;
    background: #2a241c; border: 2px solid #3a3226;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-dim);
  }
  .btn {
    background: #2f2820; border: 2px solid #4a4034; color: var(--text-bone);
    padding: 0.5rem 1rem; font-family: inherit; cursor: pointer;
  }
  .btn.small { padding: 0.2rem 0.6rem; font-size: 0.8rem; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .end-turn { border-color: var(--sovereign); color: var(--sovereign); letter-spacing: 0.1em; }
  .end-turn:hover:not(:disabled) { background: #3a2c14; }
</style>
