<script lang="ts">
  import { gameStore, type CardInstanceInfo, type GameView, type PromptInfo } from "../stores/game.svelte.js";
  import type { ClientIntentT } from "@ashfall/shared";

  let {
    prompt,
    view,
    onSend,
  }: {
    prompt: PromptInfo;
    view: GameView;
    onSend: (intent: ClientIntentT) => void;
  } = $props();

  const lang = $derived(gameStore.lang);
  const ctx = $derived(prompt.context as Record<string, unknown>);
  const mode = $derived((ctx.mode as string | undefined) ?? "");
  const you = $derived(view.you);

  let selectedCards = $state<string[]>([]);
  let selectedChoice = $state<string | null>(null);
  let misdirectTo = $state<string | null>(null);

  const remainingMs = $derived(Math.max(0, prompt.deadlineMs - Date.now()));

  const KIND_LABELS: Record<string, { en: string; th: string }> = {
    discard_evade: { en: "Discard Evade to block the Strike?", th: "ทิ้งการ์ดหลบหลีกเพื่อบล็อกจู่โจม?" },
    discard_strike: { en: "Discard a Strike?", th: "ทิ้งการ์ดจู่โจม?" },
    use_stim: { en: ctx.self ? "Use Stim/Chem Brew to save yourself?" : "Use a Stim to save them?", th: ctx.self ? "ใช้สเตม/เคมีคลั่งช่วยตัวเอง?" : "ใช้สเตมช่วยเขา?" },
    jam: { en: ctx.active ? "Jam this effect?" : "Counter-jam (restore the effect)?", th: ctx.active ? "รบกวนสัญญาณยกเลิกเอฟเฟกต์?" : "แจมกลับ (คืนเอฟเฟกต์)?" },
    blood_debt: { en: "Blood Debt: discard 1 card or lose 1 HP", th: "หนี้เลือด: ทิ้งการ์ด 1 ใบหรือเสีย 1 HP" },
    fate_hack: { en: "Fate Hack: replace the Fate Card with a hand card?", th: "แฮ็คลิขิต: เปลี่ยนการ์ดชะตาด้วยการ์ดบนมือ?" },
    proxy_war: { en: "Proxy War: Strike the target, or lose your weapon", th: "สงครามตัวแทน: โจมตีเป้าหมาย หรือเสียอาวุธ" },
    choose_hand_card: { en: mode === "railgun_followup" ? "Railgun: discard 2 to Strike another target" : mode === "launcher_cost" ? "Launcher: discard 2 cards as a Strike" : "Choose cards", th: "เลือกการ์ด" },
    reorder_deck: { en: "Drone Scout: reorder the top cards (first = top of deck)", th: "โดรนสอดแนม: เรียงการ์ดใบบน (ใบแรก = บนสุด)" },
  };

  const label = $derived(KIND_LABELS[prompt.kind]?.[lang] ?? prompt.kind);

  function cardInfo(id: string): CardInstanceInfo | undefined {
    return view.cardDetails?.[id];
  }

  function toggleCard(id: string, max: number) {
    if (selectedCards.includes(id)) {
      selectedCards = selectedCards.filter((c) => c !== id);
    } else if (selectedCards.length < max) {
      selectedCards = [...selectedCards, id];
    }
  }

  function neededCount(): number {
    if (prompt.kind === "discard_evade") return (ctx.required as number) ?? 1;
    if (prompt.kind === "choose_hand_card") return (ctx.count as number) ?? 1;
    if (prompt.kind === "give_cards") return (ctx.count as number) ?? 1;
    return 1;
  }

  function submitDiscard() {
    onSend({ type: "game:respond", promptId: prompt.id, action: { kind: "discard", cardIds: selectedCards } });
    selectedCards = [];
  }

  function submitChoose(choice: string) {
    onSend({ type: "game:respond", promptId: prompt.id, action: { kind: "choose", choice } });
    selectedChoice = null;
  }

  function decline() {
    onSend({ type: "game:respond", promptId: prompt.id, action: { kind: "decline" } });
    selectedCards = [];
  }

  const eligibleCards = $derived.by(() => {
    const hand = you.hand;
    switch (prompt.kind) {
      case "discard_evade":
        return hand.filter((c) => {
          const i = cardInfo(c);
          if (!i) return false;
          if (i.defId === "evade") return true;
          return you.survivorId === "wraith_white_ghost" && i.defId === "strike";
        });
      case "discard_strike":
        return hand.filter((c) => {
          const i = cardInfo(c);
          if (!i) return false;
          if (i.defId === "strike") return true;
          if (you.survivorId === "ronan_crimson_blade" && (i.suit === "heart" || i.suit === "diamond")) return true;
          return you.survivorId === "wraith_white_ghost" && i.defId === "evade";
        });
      case "use_stim":
        return hand.filter((c) => {
          const i = cardInfo(c);
          if (!i) return false;
          if (i.defId === "stim") return true;
          if (ctx.self && i.defId === "chem_brew") return true;
          return you.survivorId === "doc_mort" && (i.suit === "heart" || i.suit === "diamond");
        });
      case "jam":
        return hand.filter((c) => cardInfo(c)?.defId === "signal_jam");
      case "fate_hack":
        return hand;
      case "proxy_war":
        return hand.filter((c) => cardInfo(c)?.defId === "strike");
      case "blood_debt":
        return hand;
      case "choose_hand_card":
      case "give_cards":
        return hand;
      default:
        return hand;
    }
  });
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label={label}>
  <div class="modal">
    <div class="header">
      <span class="kind">{prompt.kind}</span>
      <span class="timer" class:urgent={remainingMs < 8000}>{Math.ceil(remainingMs / 1000)}s</span>
    </div>
    <p class="label">{label}</p>

    {#if prompt.kind === "choose" && mode === "misdirect"}
      <div class="choice-list">
        <p class="hint">{lang === "en" ? "Redirect damage to:" : "โอนดาเมจไปที่:"}</p>
        {#each (ctx.candidates as string[]) ?? [] as pid (pid)}
          {@const o = view.others.find((x) => x.id === pid)}
          <button class="btn small" class:selected={misdirectTo === pid} onclick={() => (misdirectTo = pid)}>
            {o?.name ?? pid.slice(0, 6)}
          </button>
        {/each}
        <button class="btn primary" disabled={!misdirectTo || selectedCards.length !== 1}
          onclick={() => submitChoose(JSON.stringify({ spade: selectedCards[0], toId: misdirectTo }))}>
          {lang === "en" ? "Redirect" : "โอน"}
        </button>
      </div>
      <p class="hint">{lang === "en" ? "Pick a spade card:" : "เลือกการ์ดโพดำ:"}</p>
      <div class="card-strip">
        {#each (ctx.spades as string[]) ?? [] as cid (cid)}
          {@const i = cardInfo(cid)}
          <button class="mini-card" class:selected={selectedCards.includes(cid)} onclick={() => toggleCard(cid, 1)}>
            {i ? `${i.suit[0]}${i.number}` : cid}
          </button>
        {/each}
      </div>
    {:else if prompt.kind === "choose" && (mode === "scavenge" || mode === "sabotage")}
      <div class="choice-list">
        {#each (ctx.zones as string[]) ?? [] as zone (zone)}
          <button class="btn" onclick={() => submitChoose(zone)}>{zone}</button>
        {/each}
      </div>
    {:else if prompt.kind === "choose" && mode === "highwayman_targets"}
      <div class="choice-list">
        <p class="hint">{lang === "en" ? "Steal from 1–2 players:" : "ขโมยจากผู้เล่น 1–2 คน:"}</p>
        {#each (ctx.options as string[]) ?? [] as pid (pid)}
          {@const o = view.others.find((x) => x.id === pid)}
          <button class="btn small" class:selected={selectedCards.includes(pid)}
            onclick={() => toggleCard(pid, 2)}>{o?.name ?? pid.slice(0, 6)}</button>
        {/each}
        <button class="btn primary" disabled={selectedCards.length < 1}
          onclick={() => submitChoose(JSON.stringify(selectedCards))}>
          {lang === "en" ? "Steal" : "ขโมย"}
        </button>
      </div>
    {:else if prompt.kind === "choose" && mode === "draw_skill_choice"}
      <div class="choice-list">
        {#each (ctx.options as string[]) ?? [] as skillId (skillId)}
          <button class="btn" onclick={() => submitChoose(skillId)}>⚡ {skillId}</button>
        {/each}
      </div>
    {:else if prompt.kind === "choose" && mode === "scrap_reclaim"}
      <div class="choice-list">
        <button class="btn primary" onclick={() => submitChoose(String(ctx.cardId))}>
          {lang === "en" ? "Reclaim card" : "เก็บการ์ด"}
        </button>
      </div>
    {:else if prompt.kind === "reorder_deck"}
      <div class="choice-list">
        <p class="hint">{lang === "en" ? "Click cards in the order you want (first = top of deck):" : "คลิกการ์ดตามลำดับที่ต้องการ (ใบแรก = บนสุด):"}</p>
        <div class="card-strip">
          {#each (ctx.topCards as string[]) ?? [] as cid (cid)}
            {@const i = cardInfo(cid)}
            <button class="mini-card" class:selected={selectedCards.includes(cid)} onclick={() => toggleCard(cid, (ctx.count as number) ?? 5)}>
              {selectedCards.includes(cid) ? `${selectedCards.indexOf(cid) + 1}. ` : ""}{i ? `${i.suit[0]}${i.number}` : "?"}
            </button>
          {/each}
        </div>
        <button class="btn primary" disabled={selectedCards.length !== ((ctx.count as number) ?? 0)}
          onclick={() => submitChoose(JSON.stringify(selectedCards))}>
          {lang === "en" ? "Confirm order" : "ยืนยันลำดับ"}
        </button>
      </div>
    {:else if prompt.kind === "choose_hand_card" && mode === "railgun_followup"}
      <div class="choice-list">
        <p class="hint">{lang === "en" ? "Discard 2 cards, then pick a new target:" : "ทิ้งการ์ด 2 ใบ แล้วเลือกเป้าหมายใหม่:"}</p>
        <div class="card-strip">
          {#each you.hand as cid (cid)}
            {@const i = cardInfo(cid)}
            <button class="mini-card" class:selected={selectedCards.includes(cid)} onclick={() => toggleCard(cid, 2)}>
              {i ? `${i.suit[0]}${i.number}` : "?"}
            </button>
          {/each}
        </div>
        <div class="choice-list">
          {#each view.others.filter((o) => o.alive && o.id !== ctx.evadedTargetId) as o (o.id)}
            <button class="btn small" class:selected={selectedChoice === o.id} onclick={() => (selectedChoice = o.id)}>
              🎯 {o.name}
            </button>
          {/each}
        </div>
        <button class="btn primary" disabled={selectedCards.length !== 2 || !selectedChoice}
          onclick={() => submitChoose(JSON.stringify({ cardIds: selectedCards, targetId: selectedChoice }))}>
          {lang === "en" ? "Fire" : "ยิง"}
        </button>
      </div>
    {:else if prompt.kind === "give_cards" && mode === "foresight"}
      <div class="choice-list">
        <p class="hint">{lang === "en" ? "Give drawn cards to players (optional):" : "แจกการ์ดให้ผู้เล่น (ไม่บังคับ):"}</p>
        <div class="card-strip">
          {#each you.hand as cid (cid)}
            {@const i = cardInfo(cid)}
            <button class="mini-card" onclick={() => {
              const picked = selectedChoice;
              if (!picked) return;
              void i;
              submitChoose(JSON.stringify([{ cardId: cid, targetId: picked }]));
            }}>
              {i ? `${i.suit[0]}${i.number}` : "?"} →
            </button>
          {/each}
        </div>
        <div class="choice-list">
          {#each view.others.filter((o) => o.alive) as o (o.id)}
            <button class="btn small" class:selected={selectedChoice === o.id} onclick={() => (selectedChoice = o.id)}>{o.name}</button>
          {/each}
        </div>
      </div>
    {:else}
      <!-- generic discard-N prompts: evade/strike/stim/jam/blood_debt/proxy_war/launcher/honey/triage/ration_share -->
      <div class="card-strip">
        {#each eligibleCards as cid (cid)}
          {@const i = cardInfo(cid)}
          <button class="mini-card" class:selected={selectedCards.includes(cid)}
                  onclick={() => toggleCard(cid, neededCount())}>
            {i ? `${i.suit[0]}${i.number} ${gameStore.cardName(i.defId)}` : cid.slice(0, 8)}
          </button>
        {/each}
      </div>
      <button class="btn primary" disabled={selectedCards.length !== neededCount()} onclick={submitDiscard}>
        {lang === "en" ? "Confirm" : "ยืนยัน"}
      </button>
    {/if}

    <button class="btn ghost" onclick={decline}>
      {lang === "en" ? "Decline / Pass" : "ผ่าน"}
    </button>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex; align-items: center; justify-content: center;
    z-index: 50;
    padding: 1rem;
  }
  .modal {
    background: var(--bg-panel);
    border: 2px solid var(--sovereign);
    box-shadow: 0 0 0 4px #0d0b08, 0 0 32px rgba(232, 197, 71, 0.2);
    padding: 1.2rem;
    width: min(480px, 94vw);
    max-height: 86vh;
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 0.8rem;
  }
  .header { display: flex; justify-content: space-between; align-items: center; }
  .kind { font-size: 0.7rem; letter-spacing: 0.15em; color: var(--text-dim); text-transform: uppercase; }
  .timer { font-size: 1.1rem; color: var(--verdant); font-variant-numeric: tabular-nums; }
  .timer.urgent { color: var(--raider); animation: blink 0.6s infinite; }
  @keyframes blink { 50% { opacity: 0.4; } }
  .label { margin: 0; font-size: 0.95rem; color: var(--text-bone); line-height: 1.4; }
  .hint { margin: 0; font-size: 0.8rem; color: var(--text-dim); }
  .choice-list { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
  .card-strip { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .mini-card {
    background: #191510; border: 2px solid #4a4034; color: var(--text-bone);
    font-family: inherit; padding: 0.35rem 0.55rem; cursor: pointer; font-size: 0.8rem;
  }
  .mini-card.selected { border-color: var(--sovereign); color: var(--sovereign); }
  .mini-card:hover { border-color: var(--sovereign); }
  .btn {
    background: #2f2820; border: 2px solid #4a4034; color: var(--text-bone);
    padding: 0.5rem 1rem; font-family: inherit; cursor: pointer; font-size: 0.9rem;
  }
  .btn.small { padding: 0.3rem 0.6rem; font-size: 0.8rem; }
  .btn.selected { border-color: var(--sovereign); color: var(--sovereign); }
  .btn.primary { border-color: var(--sovereign); color: var(--sovereign); background: #3a2c14; }
  .btn.primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn.ghost { background: transparent; color: var(--text-dim); border-color: #3a3226; }
  .btn:hover:not(:disabled) { border-color: var(--sovereign); }
</style>
