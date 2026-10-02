<script lang="ts">
  /** Identity card modal — click a player's character card to view full detail
   *  (portrait, faction, HP, equipment, delayed cards). Symmetric for self/others. */
  import type { ViewPlayerOther, ViewYou } from "../stores/game.svelte.js";
  import { gameStore, type CardInstanceInfo } from "../stores/game.svelte.js";
  import { survivorPortrait, roleBadge, factionCrest } from "../assets.js";

  let {
    member,
    cardDetails,
    onClose,
  }: {
    member: (ViewYou & { alive: boolean; connected: boolean }) | ViewPlayerOther;
    cardDetails?: Record<string, CardInstanceInfo>;
    onClose: () => void;
  } = $props();

  const lang = $derived(gameStore.lang);
  const surv = $derived(member.survivorId ? gameStore.survivors[member.survivorId] : undefined);
  const portrait = $derived(member.survivorId ? survivorPortrait(member.survivorId) : undefined);
  const FACTION_NAMES: Record<string, { en: string; th: string }> = {
    syndicate: { en: "Iron Syndicate", th: "สหภาพเหล็ก" },
    verdant: { en: "Verdant Kin", th: "เผ่าพงไพร" },
    tide: { en: "Ember Tide", th: "คลื่นเพลิง" },
    walker: { en: "Ashwalkers", th: "ผู้เถ้าธุลี" },
    ascendant: { en: "Ascendant", th: "เทพเถ้า" },
  };
  const ROLE_META: Record<string, { en: string; th: string; icon: string }> = {
    sovereign: { en: "Sovereign", th: "อธิราช", icon: "👑" },
    warden: { en: "Warden", th: "ผู้พิทักษ์", icon: "🛡" },
    raider: { en: "Raider", th: "ผู้บุกปล้น", icon: "⚔" },
    phantom: { en: "Phantom", th: "แฟนท่อม", icon: "🎭" },
  };
  const roleMeta = $derived(member.role ? ROLE_META[member.role] : undefined);
  const SLOT_LABELS: Record<string, { en: string; th: string }> = {
    weapon: { en: "Weapon", th: "อาวุธ" },
    armor: { en: "Armor", th: "เกราะ" },
    rig_plus: { en: "+1 Vehicle", th: "ยาน +1" },
    rig_minus: { en: "−1 Vehicle", th: "ยาน −1" },
  };
  const eqSlotIcon: Record<string, string> = { weapon: "🗡", armor: "🛡", rig_plus: "🛞+", rig_minus: "🛞−" };
</script>

<div class="overlay" role="dialog" aria-modal="true" onclick={onClose}>
  <div class="idcard" onclick={(e) => e.stopPropagation()}>
    <header>
      <div class="p-name">{member.name}</div>
      {#if roleMeta}<div class="p-role">{roleMeta.icon} {roleMeta[lang]}</div>{/if}
      <button class="close" onclick={onClose} aria-label="close">✕</button>
    </header>

    <div class="body">
      <div class="portrait-wrap">
        {#if portrait}
          <img class="portrait" src={portrait} alt={surv?.name.en ?? "?"} />
        {:else}
          <div class="portrait fallback">{surv ? surv.name.en.slice(0, 2) : "??"}</div>
        {/if}
        {#if member.survivorId && factionCrest(surv?.faction ?? "")}
          <img class="crest" src={factionCrest(surv?.faction ?? "")} alt={surv?.faction ?? ""} />
        {/if}
      </div>

      <div class="info">
        <div class="s-name">{surv ? surv.name[lang] : "—"}</div>
        <div class="s-faction" style:color={`var(--${surv?.faction ?? "walker"})`}>
          {FACTION_NAMES[surv?.faction as keyof typeof FACTION_NAMES]?.[lang] ?? surv?.faction ?? ""}
        </div>

        <div class="hp-block">
          <span class="hp-label">{lang === "en" ? "HP" : "พลังชีวิต"}</span>
          <div class="hp-pips">
            {#each Array(member.maxHp) as _, i (i)}
              <span class="pip" class:filled={i < member.hp}></span>
            {/each}
          </div>
          <span class="hp-num">{member.hp}/{member.maxHp}</span>
        </div>

        <div class="slots">
          {#each Object.entries(member.equipment).filter(([, v]) => v) as [slot, cardId] (slot)}
            {@const inst = cardId ? cardDetails?.[cardId] : undefined}
            {@const slotKey = slot as keyof typeof eqSlotIcon}
            <div class="slot" title={gameStore.cardName(inst?.defId ?? "")}>
              <span class="slot-icon">{eqSlotIcon[slotKey] ?? "⚙"}</span>
              <span class="slot-name">{SLOT_LABELS[slotKey]?.[lang] ?? slot}</span>
              <span class="slot-card">{gameStore.cardName(inst?.defId ?? "")}</span>
            </div>
          {/each}
          {#if !Object.values(member.equipment).some(Boolean)}
            <div class="slot empty">{lang === "en" ? "no equipment" : "ไม่มีอุปกรณ์"}</div>
          {/if}
        </div>

        {#if member.delayed.length > 0}
          <div class="delayed-row">
            {#each member.delayed as d, i (i)}
              <span class="delayed-chip">{d.defId === "ion_storm" ? "⚡" : d.defId === "ration_cut" ? "🍞" : "🔒"} {gameStore.cardName(d.defId)}</span>
            {/each}
          </div>
        {/if}

        {#if surv}
          <div class="skills">
            {#each surv.skills as sk (sk.id)}
              <div class="skill">
                <b>{sk.name[lang]}</b>
                <span>{sk.description[lang]}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 100;
    background: rgba(0, 0, 0, 0.72);
    display: flex; align-items: center; justify-content: center;
    padding: 1rem;
  }
  .idcard {
    background: var(--bg-panel);
    border: 2px solid var(--sovereign);
    box-shadow: 0 0 0 4px #0d0b08, 0 0 40px rgba(232, 197, 71, 0.25);
    width: min(560px, 94vw);
    max-height: 88vh;
    overflow-y: auto;
  }
  header {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.5rem 0.8rem;
    background: #191510;
    border-bottom: 1px solid #3a3226;
  }
  .p-name { font-size: 1.05rem; font-weight: bold; }
  .p-role { font-size: 0.75rem; color: var(--text-dim); flex: 1; }
  .close { background: none; border: 1px solid #4a4034; color: var(--text-bone); font-family: inherit; cursor: pointer; width: 26px; height: 26px; }
  .body { display: flex; gap: 1rem; padding: 1rem; }
  .portrait-wrap { position: relative; flex-shrink: 0; }
  .portrait { width: 128px; height: 128px; image-rendering: pixelated; border: 2px solid #0d0b08; display: block; }
  .portrait.fallback { display: flex; align-items: center; justify-content: center; background: #1c1712; color: var(--text-dim); font-size: 2rem; }
  .crest { position: absolute; bottom: -8px; right: -8px; width: 40px; height: 40px; image-rendering: pixelated; border: 2px solid #0d0b08; }
  .info { flex: 1; display: flex; flex-direction: column; gap: 0.7rem; }
  .s-name { font-size: 1rem; font-weight: bold; }
  .s-faction { font-size: 0.7rem; letter-spacing: 0.12em; text-transform: uppercase; }
  .hp-block { display: flex; align-items: center; gap: 0.4rem; }
  .hp-label { font-size: 0.7rem; color: var(--text-dim); }
  .hp-pips { display: flex; gap: 3px; }
  .pip { width: 12px; height: 12px; border: 1px solid #5a3030; background: #241512; }
  .pip.filled { background: #d94f3d; border-color: #ff7a66; }
  .hp-num { font-size: 0.85rem; }
  .slots { display: flex; flex-direction: column; gap: 0.3rem; }
  .slot { display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; background: #191510; padding: 0.25rem 0.5rem; border: 1px solid #2a2218; }
  .slot-icon { width: 18px; text-align: center; }
  .slot-name { color: var(--text-dim); font-size: 0.65rem; width: 80px; }
  .slot-card { flex: 1; }
  .slot.empty { color: var(--text-dim); font-style: italic; }
  .delayed-row { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .delayed-chip { font-size: 0.7rem; background: #191510; border: 1px solid var(--ascendant); color: var(--ascendant); padding: 0.15rem 0.45rem; }
  .skills { display: flex; flex-direction: column; gap: 0.4rem; border-top: 1px solid #2a2218; padding-top: 0.6rem; }
  .skill { font-size: 0.72rem; line-height: 1.4; color: var(--text-dim); }
  .skill b { color: var(--text-bone); display: block; }
  @media (max-width: 560px) { .body { flex-direction: column; align-items: center; } .info { width: 100%; } }
</style>