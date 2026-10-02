<script lang="ts">
  import type { ViewPlayerOther, ViewYou } from "../stores/game.svelte.js";
  import { gameStore } from "../stores/game.svelte.js";
  import { survivorPortrait } from "../assets.js";

  let {
    other,
    isCurrent,
    compact = false,
  }: { other: ViewPlayerOther; isCurrent: boolean; compact?: boolean } = $props();

  const lang = $derived(gameStore.lang);
  const surv = $derived(other.survivorId ? gameStore.survivors[other.survivorId] : undefined);
  const roleIcon = $derived(
    other.role === "sovereign" ? "👑" : other.role === "warden" ? "🛡" : other.role === "raider" ? "⚔" : other.role === "phantom" ? "🎭" : "",
  );
  const factionColor = $derived(
    surv ? `var(--${surv.faction === "syndicate" ? "syndicate" : surv.faction === "verdant" ? "verdant" : surv.faction === "tide" ? "tide" : surv.faction === "ascendant" ? "ascendant" : "walker"})` : "#4a4034",
  );
  const portrait = $derived(other.survivorId ? survivorPortrait(other.survivorId) : undefined);
</script>

<div class="seat" class:current={isCurrent} class:dead={!other.alive} class:compact class:offline={!other.connected}>
  <div class="portrait" style:border-color={factionColor}>
    {#if portrait}
      <img src={portrait} alt={surv?.name.en ?? other.survivorId ?? ""} class="pixel-art-img" />
    {:else}
      <span class="initials">{surv ? surv.name.en.slice(0, 2).toUpperCase() : "??"}</span>
    {/if}
    {#if other.flipped}<span class="flipped-tag">💤</span>{/if}
    {#if other.tethered}<span class="tether-tag">⛓</span>{/if}
  </div>
  <div class="info">
    <div class="name-row">
      <span class="pname" title={other.name}>{other.name}</span>
      {#if roleIcon}<span class="role">{roleIcon}</span>{/if}
      {#if isCurrent}<span class="turn-dot" title="current turn">▶</span>{/if}
    </div>
    <div class="survivor-name">{surv ? surv.name[lang] : ""}</div>
    <div class="hp-row" aria-label="HP {other.hp}/{other.maxHp}">
      {#each Array(other.maxHp) as _, i (i)}
        <span class="pip" class:filled={i < other.hp}></span>
      {/each}
      <span class="hp-num">{other.hp}/{other.maxHp}</span>
    </div>
    <div class="meta-row">
      <span class="hand-count" title="cards in hand">🂠 {other.handCount}</span>
      {#each Object.entries(other.equipment).filter(([, v]) => v) as [slot] (slot)}
        <span class="eq" title={slot}>{slot === "weapon" ? "🗡" : slot === "armor" ? "🛡" : slot === "rig_plus" ? "🛞+" : "🛞−"}</span>
      {/each}
      {#each other.delayed as d, i (i)}
        <span class="delayed" title={d.defId}>{d.defId === "ion_storm" ? "⚡" : d.defId === "ration_cut" ? "🍞" : "🔒"}</span>
      {/each}
    </div>
  </div>
</div>

<style>
  .seat {
    background: var(--bg-panel);
    border: 2px solid #3a3226;
    padding: 0.5rem;
    display: flex;
    gap: 0.5rem;
    min-width: 150px;
  }
  .seat.current { border-color: var(--sovereign); box-shadow: 0 0 10px rgba(232, 197, 71, 0.25); }
  .seat.dead { opacity: 0.4; filter: grayscale(0.8); }
  .seat.offline .pname { text-decoration: line-through; }
  .seat.compact { min-width: 120px; padding: 0.35rem; }
  .portrait {
    width: 44px; height: 44px;
    border: 2px solid #4a4034;
    display: flex; align-items: center; justify-content: center;
    background: #191510;
    position: relative;
    flex-shrink: 0;
  }
  .compact .portrait { width: 34px; height: 34px; }
  .initials { font-size: 0.85rem; color: var(--text-dim); font-weight: bold; }
  .pixel-art-img { width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }
  .flipped-tag, .tether-tag { position: absolute; font-size: 0.7rem; top: -6px; right: -6px; }
  .tether-tag { top: auto; bottom: -6px; }
  .info { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
  .name-row { display: flex; align-items: center; gap: 0.3rem; }
  .pname { font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90px; }
  .role { font-size: 0.75rem; }
  .turn-dot { color: var(--sovereign); font-size: 0.65rem; animation: pulse 1.2s infinite; }
  @keyframes pulse { 50% { opacity: 0.3; } }
  .survivor-name { font-size: 0.65rem; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hp-row { display: flex; align-items: center; gap: 2px; }
  .pip { width: 7px; height: 7px; border: 1px solid #5a3030; background: #241512; display: inline-block; }
  .pip.filled { background: #d94f3d; border-color: #ff7a66; }
  .hp-num { font-size: 0.6rem; color: var(--text-dim); margin-left: 3px; }
  .meta-row { display: flex; gap: 0.3rem; font-size: 0.7rem; color: var(--text-dim); align-items: center; }
  .eq { font-size: 0.65rem; }
  .delayed { font-size: 0.65rem; }
</style>
