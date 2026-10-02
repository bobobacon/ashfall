<script lang="ts">
  import { gameStore } from "../stores/game.svelte.js";
  import { ROLE_DISTRIBUTION } from "@ashfall/shared";

  let { onAddBot, onStart, onLeave }: { onAddBot: () => void; onStart: () => void; onLeave: () => void } = $props();

  const room = $derived(gameStore.room);
  const isHost = $derived(room?.hostId === gameStore.myPlayerId);
  const playerCount = $derived(room?.players.length ?? 0);
  const canStart = $derived(isHost && playerCount >= 3);
  const dist = $derived(playerCount >= 3 && playerCount <= 10 ? ROLE_DISTRIBUTION[playerCount] : null);

  function copyCode() {
    if (!room) return;
    navigator.clipboard?.writeText(room.roomId).catch(() => undefined);
  }
</script>

<div class="lobby">
  {#if room}
    <div class="room-code" role="button" tabindex="0" onclick={copyCode} onkeydown={(e) => e.key === "Enter" && copyCode()} title="click to copy">
      <span class="label">{gameStore.lang === "en" ? "ROOM CODE" : "รหัสห้อง"}</span>
      <span class="code">{room.roomId}</span>
    </div>

    <div class="seats">
      {#each room.players as p (p.id)}
        <div class="seat" class:bot={p.isBot} class:offline={!p.connected} class:me={p.id === gameStore.myPlayerId}>
          <span class="seat-no">{p.seat + 1}</span>
          <span class="pname">{p.name}{p.id === gameStore.myPlayerId ? " (you)" : ""}</span>
          {#if p.isBot}<span class="tag">BOT</span>{/if}
          {#if !p.connected}<span class="tag offline-tag">offline</span>{/if}
          {#if p.id === room.hostId}<span class="tag host">HOST</span>{/if}
        </div>
      {/each}
      {#each Array(Math.max(0, 3 - playerCount)) as _, i (i)}
        <div class="seat empty"><span class="seat-no">+</span><span class="pname">waiting…</span></div>
      {/each}
    </div>

    {#if dist}
      <div class="roles-hint">
        {gameStore.lang === "en" ? "Roles at this count" : "บทบาทที่จำนวนนี้"}:
        👑{dist.sovereign} 🛡{dist.warden} ⚔{dist.raider} 🎭{dist.phantom}
      </div>
    {/if}

    <div class="actions">
      <button class="btn" onclick={onAddBot} disabled={playerCount >= 10}>
        {gameStore.lang === "en" ? "+ Add bot" : "+ เพิ่มบอท"}
      </button>
      {#if isHost}
        <button class="btn primary" onclick={onStart} disabled={!canStart}>
          {gameStore.lang === "en" ? "▶ Start game" : "▶ เริ่มเกม"}
        </button>
      {:else}
        <div class="waiting">{gameStore.lang === "en" ? "Waiting for host to start…" : "รอโฮสต์เริ่มเกม…"}</div>
      {/if}
      <button class="btn ghost" onclick={onLeave}>
        {gameStore.lang === "en" ? "Leave" : "ออกจากห้อง"}
      </button>
    </div>
  {/if}
</div>

<style>
  .lobby {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.2rem;
    padding: 2rem 1rem;
  }
  .room-code {
    background: var(--bg-panel);
    border: 2px dashed var(--sovereign);
    padding: 0.8rem 2rem;
    text-align: center;
    cursor: pointer;
  }
  .room-code .label { display: block; font-size: 0.7rem; color: var(--text-dim); letter-spacing: 0.2em; }
  .room-code .code { font-size: 2rem; letter-spacing: 0.4em; color: var(--sovereign); }
  .seats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.6rem;
    width: min(640px, 94vw);
  }
  .seat {
    background: var(--bg-panel);
    border: 2px solid #3a3226;
    padding: 0.6rem 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 48px;
  }
  .seat.me { border-color: var(--verdant); }
  .seat.bot { opacity: 0.85; }
  .seat.empty { border-style: dashed; opacity: 0.45; }
  .seat.offline .pname { text-decoration: line-through; opacity: 0.6; }
  .seat-no {
    width: 24px; height: 24px;
    display: inline-flex; align-items: center; justify-content: center;
    background: #2f2820; border: 1px solid #4a4034; font-size: 0.8rem;
  }
  .pname { flex: 1; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { font-size: 0.6rem; padding: 0.1rem 0.35rem; border: 1px solid #4a4034; color: var(--text-dim); letter-spacing: 0.05em; }
  .tag.host { border-color: var(--sovereign); color: var(--sovereign); }
  .tag.offline-tag { border-color: var(--raider); color: var(--raider); }
  .roles-hint { color: var(--text-dim); font-size: 0.85rem; }
  .actions { display: flex; gap: 0.6rem; flex-wrap: wrap; justify-content: center; }
  .btn {
    background: #2f2820; border: 2px solid #4a4034; color: var(--text-bone);
    padding: 0.6rem 1.1rem; font-family: inherit; font-size: 0.95rem; cursor: pointer;
  }
  .btn:hover:not(:disabled) { border-color: var(--sovereign); color: var(--sovereign); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn.primary { background: #3a2c14; border-color: var(--sovereign); color: var(--sovereign); }
  .btn.ghost { background: transparent; color: var(--text-dim); }
  .waiting { color: var(--text-dim); font-size: 0.9rem; align-self: center; }
</style>
