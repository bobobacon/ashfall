<script lang="ts">
  import { gameStore, type CardInstanceInfo, type ViewPlayerOther } from "../stores/game.svelte.js";
  import { assetUrl, backgroundArt, cardArt } from "../assets.js";
  import PlayerSeat from "../components/PlayerSeat.svelte";
  import CardBack from "../components/CardBack.svelte";
  import CardPile from "../components/CardPile.svelte";
  import CardComponent from "../components/Card.svelte";
  import PromptModal from "../components/PromptModal.svelte";
  import IdentityModal from "../components/IdentityModal.svelte";

  let {
    onSend,
  }: {
    onSend: (intent: import("@ashfall/shared").ClientIntentT) => void;
  } = $props();

  const view = $derived(gameStore.view);
  const you = $derived(view?.you);
  const lang = $derived(gameStore.lang);
  const prompt = $derived(gameStore.prompt);
  const tableBg = backgroundArt("table");

  // --- interaction state ---
  let selectedCard = $state<string | null>(null);
  let targetingFor = $state<{ cardId: string; asDefId?: string; needs: number } | null>(null);
  let chosenTargets = $state<string[]>([]);
  // identity modal
  let identityFor = $state<"me" | string | null>(null); // "me" or other player id

  const SUITS: Record<string, string> = { spade: "♠", heart: "♥", club: "♣", diamond: "♦" };

  function cardInfo(id: string): CardInstanceInfo | undefined {
    return view?.cardDetails?.[id];
  }

  function isMyTurn(): boolean {
    return !!view && view.currentPlayerId === you?.id && view.turnPhase === "play" && !prompt;
  }

  function targetRuleOf(defId: string): { needs: number } {
    switch (defId) {
      case "strike": return { needs: 1 };
      case "stim": return { needs: 1 };
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

    if (defId === "evade" || defId === "signal_jam") return;
    const rule = targetRuleOf(defId);
    selectedCard = id;
    if (rule.needs > 0) {
      targetingFor = { cardId: id, asDefId, needs: rule.needs };
      chosenTargets = [];
    } else {
      onSend({ type: "game:play", cardId: id, asDefId });
      selectedCard = null;
      targetingFor = null;
    }
  }

  function clickSeat(pid: string) {
    if (targetingFor) {
      // targeting mode → selecting a target
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
      return;
    }
    // view identity card
    identityFor = pid === you?.id ? "me" : pid;
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

  // --- table layout ----------------------------------------------------------
  // Distribute seats along an ellipse: "me" pinned at bottom-center, others
  // along the top arc. x/y are percentages of the table area.
  type SeatPos = { id: string; left: number; top: number; align: string };
  const seats = $derived.by((): SeatPos[] => {
    const others = view?.others ?? [];
    const n = others.length;
    const positions: SeatPos[] = [];
    if (n === 1) {
      positions.push({ id: others[0]!.id, left: 50, top: 14, align: "center" });
    } else {
      others.forEach((o, i) => {
        const theta = Math.PI - (i * Math.PI) / (n - 1); // π → 0 (left→right)
        const rx = 44;
        const ry = n > 6 ? 34 : 27;
        const left = 50 + rx * Math.cos(theta);
        const top = 34 - ry * Math.sin(theta);
        positions.push({ id: o.id, left, top, align: left < 45 ? "left" : left > 55 ? "right" : "center" });
      });
    }
    return positions;
  });

  const identityMember = $derived.by(() => {
    if (!identityFor || !view) return null;
    if (identityFor === "me") {
      const y = view.you;
      return { ...y, alive: true, connected: true } as const;
    }
    return view.others.find((o) => o.id === identityFor) ?? null;
  });

  const eventFeed = $derived(
    gameStore.events.slice(-5).map((e) => describeEvent(e)).filter(Boolean) as string[],
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
      case "dying": return `🆘 ${nm(e.playerId)} ${lang === "en" ? "dying!" : "ปางตาย!"}`;
      case "saved": return `✨ ${nm(e.playerId)} ${lang === "en" ? "survived" : "รอด"}`;
      case "fate_check": return `🎴 ${lang === "en" ? "Fate" : "ชะตา"}: ${SUITS[String(e.suit)] ?? "?"}${e.number}`;
      case "cards_drawn": return `${nm(e.playerId)} +${e.count}🂠`;
      case "turn_started": return `— ${nm(e.playerId)}'s turn —`;
      case "kill_reward": return `🎁 ${nm(e.killerId)} +${e.cardsDrawn}`;
      case "skill_activated": return `⚡ ${nm(e.playerId)}: ${String(e.skillId)}`;
      case "reshuffle": return `♻ ${lang === "en" ? "deck reshuffled" : "สับกองใหม่"}`;
      default: return "";
    }
  }

  /** Placeholder art for ungenerated card slots in specific zones (fallback). */
  const zoneArt = (defId: string): string | undefined => cardArt(defId);

  /** Other-player equipment art: use public equipDefs (no instance-id leak). */
  const gearArtOf = (other: ViewPlayerOther, slot: string): string | undefined => {
    const def = other.equipDefs?.[slot as keyof typeof other.equipDefs];
    return def ? zoneArt(def) : undefined;
  };
</script>

<div class="table-screen">
  {#if view && you}
    <header class="top-bar">
      <div class="room-id">#{gameStore.room?.roomId ?? ""}</div>
      <div class="turn-info">
        {lang === "en" ? "Turn" : "เทิร์น"} {view.turnNumber}
        {#if view.turnPhase}· {view.turnPhase}{/if}
        {#if view.currentPlayerId}
          · {view.currentPlayerId === you.id ? (lang === "en" ? "YOUR TURN" : "ตาคุณ") : (view.others.find((o) => o.id === view.currentPlayerId)?.name ?? "")}
        {/if}
      </div>
      <div class="counts">
        <span title="deck">{view.deckCount}🂠</span>
        <span title="discard">{view.discardCount}♻</span>
      </div>
      <button class="lang-btn" onclick={() => (gameStore.lang = lang === "en" ? "th" : "en")}>
        {lang === "en" ? "TH" : "EN"}
      </button>
    </header>

    <div class="table" style:background-image={tableBg ? `url(${tableBg})` : undefined}>
      <div class="table-scrim"></div>

      <!-- deck + discard piles on the table -->
      <div class="piles">
        <CardPile count={view.deckCount} label={lang === "en" ? "DECK" : "กองจั่ว"} kind="deck" />
        <CardPile count={view.discardCount} label={lang === "en" ? "DISCARD" : "กองทิ้ง"} kind="discard" />
      </div>

      <!-- players around the table -->
      <div class="seats">
        {#each seats as seat (seat.id)}
          {@const other = view.others.find((o) => o.id === seat.id)}
          {#if other}
            <div class="seat-position" style:left="{seat.left}%" style:top="{seat.top}%"
                 class:current={view.currentPlayerId === seat.id}
                 class:targetable={!!targetingFor}
                 class:chosen={chosenTargets.includes(seat.id)}>
              <button class="seat-btn" onclick={() => clickSeat(seat.id)}
                      title={lang === "en" ? "view identity card" : "ดูการ์ดตัวตน"}>
                <PlayerSeat {other} isCurrent={view.currentPlayerId === seat.id} />
              </button>
              <!-- hand representation: card backs = cards in hand -->
              <div class="hand-backs">
                {#each Array(Math.min(other.handCount, 8)) as _, i (i)}
                  <CardBack size="sm" />
                {/each}
                {#if other.handCount > 8}
                  <span class="more">+{other.handCount - 8}</span>
                {/if}
                {#if other.handCount === 0}
                  <span class="no-cards">—</span>
                {/if}
              </div>
              <!-- equipment/mounts visible on table -->
              <div class="table-gear">
                {#each Object.entries(other.equipment).filter(([, v]) => v) as [slot, cardId] (slot)}
                  {#if gearArtOf(other, slot)}
                    <img class="gear-art" src={gearArtOf(other, slot)} alt={slot} title={`${slot}: ${gameStore.cardName(other.equipDefs?.[slot as keyof typeof other.equipDefs] ?? "")}`} />
                  {:else}
                    <span class="gear-icon" title={slot}>{slot === "weapon" ? "🗡" : slot === "armor" ? "🛡" : slot === "rig_plus" ? "🛞+" : "🛞−"}</span>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}
        {/each}
      </div>

      <!-- my seat pinned bottom-center -->
      <div class="me-zone">
        <div class="hand-backs me-spread">
          {#each you.hand as cid, i (cid)}
            {@const info = cardInfo(cid)}
            <span class="hand-card" style:margin-left={i === 0 ? "0" : "-14px"}>
              {#if info}
                <CardComponent {info} meta={gameStore.cards[info.defId]} selected={selectedCard === cid}
                               playable={isMyTurn()} onclick={() => clickCard(cid)} />
              {:else}
                <CardBack size="md" />
              {/if}
            </span>
          {/each}
          {#if you.hand.length === 0}
            <span class="no-cards">{lang === "en" ? "no cards in hand" : "ไม่มีไพ่ในมือ"}</span>
          {/if}
        </div>

        <div class="me-bar">
          <button class="seat-btn me-btn" onclick={() => clickSeat(you.id)} title={lang === "en" ? "view your identity card" : "ดูการ์ดตัวตนของคุณ"}>
            <PlayerSeat
              other={{
                id: you.id, name: you.name, seat: you.seat, alive: true, connected: true,
                handCount: you.hand.length, role: you.role, survivorId: you.survivorId,
                hp: you.hp, maxHp: you.maxHp, equipment: you.equipment, delayed: you.delayed,
                equipDefs: {}, tethered: you.tethered, flipped: you.flipped,
              }}
              isCurrent={view.currentPlayerId === you.id}
            />
          </button>
          <button class="btn end-turn" disabled={!isMyTurn()} onclick={endTurn}>
            {lang === "en" ? "END TURN ▶" : "จบเทิร์น ▶"}
          </button>
        </div>
      </div>

      <!-- event feed overlay -->
      <div class="feed">
        {#each eventFeed as line, i (i)}
          <div class="feed-line">{line}</div>
        {/each}
      </div>

      {#if targetingFor}
        <div class="targeting-bar">
          <span>🎯 {lang === "en" ? `choose ${targetingFor.needs} target(s)` : `เลือกเป้าหมาย ${targetingFor.needs}`} ({chosenTargets.length}/{targetingFor.needs})</span>
          <button class="btn small" onclick={cancelTargeting}>{lang === "en" ? "cancel" : "ยกเลิก"}</button>
        </div>
      {/if}
    </div>

    {#if prompt && prompt.playerId === you.id}
      <PromptModal {prompt} view={view} onSend={onSend} />
    {/if}

    {#if identityFor && identityMember}
      <IdentityModal
        member={identityMember}
        cardDetails={view.cardDetails}
        onClose={() => (identityFor = null)}
      />
    {/if}
  {/if}
</div>

<style>
  .table-screen {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background: var(--bg-ash);
  }
  .top-bar {
    display: flex; align-items: center; gap: 1rem;
    padding: 0.4rem 0.8rem;
    background: #14100c;
    border-bottom: 2px solid #3a3226;
    font-size: 0.8rem;
    z-index: 5;
  }
  .room-id { color: var(--text-dim); }
  .turn-info { flex: 1; color: var(--sovereign); letter-spacing: 0.05em; }
  .counts { display: flex; gap: 0.5rem; color: var(--text-dim); font-variant-numeric: tabular-nums; }
  .lang-btn { background: #2f2820; border: 1px solid #4a4034; color: var(--text-bone); font-family: inherit; padding: 0.2rem 0.5rem; cursor: pointer; }

  .table {
    position: relative;
    flex: 1;
    min-height: 620px;
    background-size: cover;
    background-position: center;
    overflow: hidden;
  }
  .table-scrim {
    position: absolute; inset: 0;
    background: radial-gradient(ellipse at 50% 40%, rgba(22, 19, 15, 0.15), rgba(22, 19, 15, 0.82));
    pointer-events: none;
  }

  .piles {
    position: absolute;
    left: 50%;
    top: 32%;
    transform: translate(-50%, -50%);
    display: flex;
    gap: 1.2rem;
    z-index: 2;
    pointer-events: auto;
  }

  .seats .seat-position {
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 3;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
  }
  .seat-position.current { z-index: 4; }
  .seat-position.targetable .seat-btn { border-color: rgba(232, 197, 71, 0.5); cursor: crosshair; }
  .seat-position.chosen .seat-btn { border-color: var(--raider); box-shadow: 0 0 8px rgba(200, 64, 47, 0.6); }
  .seat-btn {
    background: rgba(20, 16, 12, 0.85);
    border: 2px solid #3a3226;
    padding: 0.15rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 4px;
  }
  .seat-btn:hover { border-color: var(--sovereign); }
  .hand-backs {
    display: flex;
    gap: 1px;
    align-items: center;
    background: rgba(13, 11, 8, 0.55);
    padding: 1px 4px;
    border-radius: 3px;
    border: 1px solid rgba(58, 50, 38, 0.5);
  }
  .hand-backs .cardback { margin-left: -7px; }
  .hand-backs .cardback:first-child { margin-left: 0; }
  .more { font-size: 0.6rem; color: var(--text-dim); margin-left: 2px; }
  .no-cards { font-size: 0.65rem; color: var(--text-dim); padding: 0 4px; }
  .table-gear { display: flex; gap: 2px; }
  .gear-art { width: 20px; height: 20px; image-rendering: pixelated; border: 1px solid #0d0b08; }
  .gear-icon { font-size: 0.75rem; background: rgba(13,11,8,.6); padding: 1px 3px; border: 1px solid #3a3226; }

  .me-zone {
    position: absolute;
    left: 50%;
    bottom: 2%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    z-index: 4;
    max-width: 96vw;
  }
  .me-spread { background: none; border: none; padding: 0; }
  .hand-card { display: inline-flex; transition: transform 0.08s; }
  .hand-card:hover { z-index: 5; }
  .hand-card .card:hover { transform: translateY(-10px); }
  .me-bar { display: flex; align-items: center; gap: 0.8rem; }
  .me-btn { pointer-events: auto; }

  .feed {
    position: absolute;
    right: 0.5rem;
    top: 3.2rem;
    background: rgba(13, 11, 8, 0.8);
    border: 1px solid #3a3226;
    padding: 0.3rem 0.5rem;
    font-size: 0.68rem;
    color: var(--text-dim);
    max-width: 240px;
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .feed-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .targeting-bar {
    position: absolute;
    left: 50%;
    bottom: 30%;
    transform: translateX(-50%);
    z-index: 6;
    display: flex; gap: 0.8rem; align-items: center;
    padding: 0.4rem 1rem;
    background: rgba(232, 197, 71, 0.12);
    border: 1px solid var(--sovereign);
    color: var(--sovereign);
    font-size: 0.85rem;
  }

  .btn {
    background: #2f2820; border: 2px solid #4a4034; color: var(--text-bone);
    padding: 0.5rem 1rem; font-family: inherit; cursor: pointer;
  }
  .btn.small { padding: 0.2rem 0.6rem; font-size: 0.8rem; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .end-turn { border-color: var(--sovereign); color: var(--sovereign); letter-spacing: 0.1em; }
  .end-turn:hover:not(:disabled) { background: #3a2c14; }

  @media (max-width: 640px) {
    .feed { display: none; }
    .piles { top: 26%; gap: 0.6rem; }
    .table { min-height: 540px; }
  }
</style>