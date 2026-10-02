<script lang="ts">
  import { gameStore } from "../stores/game.svelte.js";

  let { onHome }: { onHome: () => void } = $props();

  const ended = $derived(gameStore.ended);
  const view = $derived(gameStore.view);
  const lang = $derived(gameStore.lang);

  const ROLE_LABELS: Record<string, { en: string; th: string; icon: string; color: string }> = {
    sovereign: { en: "Sovereign", th: "อธิราช", icon: "👑", color: "var(--sovereign)" },
    warden: { en: "Warden", th: "ผู้พิทักษ์", icon: "🛡", color: "var(--warden)" },
    raider: { en: "Raider", th: "ผู้บุกปล้น", icon: "⚔", color: "var(--raider)" },
    phantom: { en: "Phantom", th: "แฟนท่อม", icon: "🎭", color: "var(--phantom)" },
  };

  const winner = $derived(ended ? ROLE_LABELS[ended.winner] : undefined);

  const REASONS: Record<string, { en: string; th: string }> = {
    sovereign_dead: { en: "The Sovereign has fallen — the Bastion burns.", th: "อธิราชสิ้นแล้ว — ป้อมปราการมอดไหม้" },
    all_raiders_and_phantoms_dead: { en: "All Raiders and Phantoms eliminated — the Citadel holds.", th: "กำจัดผู้บุกปล้นและแฟนท่อมหมดสิ้น — ป้อมยืนยง" },
    phantom_last_standing: { en: "The Phantom stands alone on the ashes.", th: "แฟนท่อมยืนหยัดเพียงผู้เดียวบนเถ้าธุลี" },
    phantom_last_standing_sovereign_dead: { en: "The Phantom outlived them all — Sovereign last.", th: "แฟนท่อมรอดเป็นคนสุดท้าย — อธิราชตายสุดท้าย" },
  };
  const reason = $derived(ended ? REASONS[ended.reason] : undefined);

  const roster = $derived.by(() => {
    if (!view || !ended) return [];
    const all = [
      { id: view.you.id, name: view.you.name, survivorId: view.you.survivorId, role: view.you.role },
      ...view.others.map((o) => ({
        id: o.id,
        name: o.name,
        survivorId: o.survivorId,
        role: (ended.roles[o.id] ?? o.role) as string | undefined,
      })),
    ];
    return all;
  });
</script>

<div class="winner-screen">
  {#if ended && winner}
    <div class="banner" style:border-color={winner.color}>
      <div class="icon">{winner.icon}</div>
      <h1 style:color={winner.color}>
        {lang === "en" ? `${winner.en.toUpperCase()} VICTORY` : `${winner.th}ชนะ`}
      </h1>
      <p class="reason">{reason ? reason[lang] : ended.reason}</p>
    </div>

    <div class="roster">
      {#each roster as p (p.id)}
        {@const role = p.role ? ROLE_LABELS[p.role] : undefined}
        <div class="roster-row">
          <span class="rname">{p.name}{p.id === view?.you.id ? " (you)" : ""}</span>
          <span class="rsurv">{gameStore.survivorName(p.survivorId)}</span>
          {#if role}
            <span class="rrole" style:color={role.color}>{role.icon} {role[lang]}</span>
          {/if}
        </div>
      {/each}
    </div>

    <div class="actions">
      <button class="btn primary" onclick={onHome}>
        {lang === "en" ? "↩ Back to menu" : "↩ กลับเมนูหลัก"}
      </button>
    </div>
  {/if}
</div>

<style>
  .winner-screen {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    padding: 2rem 1rem;
  }
  .banner {
    text-align: center;
    border: 2px solid;
    background: var(--bg-panel);
    padding: 2rem 3rem;
    box-shadow: 0 0 0 4px #0d0b08;
  }
  .icon { font-size: 3rem; }
  h1 { margin: 0.4rem 0; letter-spacing: 0.2em; font-size: clamp(1.4rem, 5vw, 2.4rem); }
  .reason { color: var(--text-dim); margin: 0; font-size: 0.95rem; }
  .roster {
    background: var(--bg-panel);
    border: 2px solid #3a3226;
    padding: 0.8rem 1.2rem;
    width: min(480px, 94vw);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .roster-row {
    display: flex;
    gap: 0.8rem;
    align-items: baseline;
    font-size: 0.85rem;
    border-bottom: 1px solid #241d15;
    padding-bottom: 0.3rem;
  }
  .rname { flex: 1; }
  .rsurv { color: var(--text-dim); font-size: 0.75rem; flex: 1; }
  .rrole { font-size: 0.8rem; white-space: nowrap; }
  .btn {
    background: #2f2820; border: 2px solid #4a4034; color: var(--text-bone);
    padding: 0.6rem 1.2rem; font-family: inherit; cursor: pointer; font-size: 0.95rem;
  }
  .btn.primary { border-color: var(--sovereign); color: var(--sovereign); background: #3a2c14; }
  .btn:hover { border-color: var(--sovereign); }
</style>
