<script lang="ts">
  import { gameStore } from "../stores/game.svelte.js";

  let { onCreate, onJoin }: { onCreate: () => void; onJoin: (roomId: string) => void } = $props();

  let name = $state("");
  let roomId = $state("");

  $effect(() => {
    name = gameStore.playerName();
  });

  function saveName() {
    gameStore.setPlayerName(name.trim().slice(0, 24));
  }

  function toggleLang() {
    gameStore.lang = gameStore.lang === "en" ? "th" : "en";
  }
</script>

<div class="home">
  <div class="title-block">
    <h1>ASHFALL</h1>
    <p class="tagline">THE LAST BASTION · เถ้าธุลี: ป้อมสุดท้าย</p>
  </div>

  <div class="panel">
    <label class="field">
      <span>{gameStore.lang === "en" ? "Your name" : "ชื่อของคุณ"}</span>
      <input
        type="text"
        maxlength="24"
        bind:value={name}
        onchange={saveName}
        placeholder={gameStore.lang === "en" ? "Wastelander" : "ผู้รอดชีวิต"}
      />
    </label>

    <button class="btn primary" disabled={name.trim().length === 0} onclick={() => { saveName(); onCreate(); }}>
      {gameStore.lang === "en" ? "⚔ Create room" : "⚔ สร้างห้อง"}
    </button>

    <div class="join-row">
      <input
        type="text"
        maxlength="6"
        bind:value={roomId}
        placeholder="ROOM CODE"
        class="code-input"
      />
      <button class="btn" disabled={name.trim().length === 0 || roomId.trim().length !== 6}
        onclick={() => { saveName(); onJoin(roomId.trim().toUpperCase()); }}>
        {gameStore.lang === "en" ? "Join" : "เข้าร่วม"}
      </button>
    </div>

    <button class="btn ghost lang" onclick={toggleLang}>
      {gameStore.lang === "en" ? "เปลี่ยนเป็นภาษาไทย" : "Switch to English"}
    </button>
  </div>

  <div class="lore">
    <p>
      {gameStore.lang === "en"
        ? "Two hundred years after the Collapse, four powers circle Bastion Zero. Hidden roles. 108 cards. One survivor stands last — or none."
        : "สองร้อยปีหลังมหาวิบัติ สี่ขั้วอำนาจล้อมป้อมศูนย์ บทบาทลับ การ์ด 108 ใบ ผู้รอดคนสุดท้ายจะยืนหยัด — หรือไม่มีใครเลย"}
    </p>
  </div>
</div>

<style>
  .home {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    padding: 2rem 1rem;
    background:
      radial-gradient(ellipse at 50% 120%, rgba(217, 95, 43, 0.12), transparent 60%),
      var(--bg-ash);
  }
  .title-block { text-align: center; }
  h1 {
    font-size: clamp(2.5rem, 8vw, 4.5rem);
    letter-spacing: 0.35em;
    margin: 0;
    color: var(--sovereign);
    text-shadow: 0 0 24px rgba(232, 197, 71, 0.35), 4px 4px 0 #000;
  }
  .tagline {
    color: var(--text-dim);
    letter-spacing: 0.15em;
    margin-top: 0.5rem;
    font-size: 0.9rem;
  }
  .panel {
    background: var(--bg-panel);
    border: 2px solid #3a3226;
    padding: 1.5rem;
    width: min(380px, 92vw);
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    box-shadow: 0 0 0 4px #0d0b08, 8px 8px 0 rgba(0,0,0,0.5);
  }
  .field { display: flex; flex-direction: column; gap: 0.35rem; }
  .field span { font-size: 0.8rem; color: var(--text-dim); letter-spacing: 0.08em; }
  input {
    background: #14100c;
    border: 2px solid #3a3226;
    color: var(--text-bone);
    padding: 0.55rem 0.7rem;
    font-family: inherit;
    font-size: 1rem;
  }
  input:focus { outline: none; border-color: var(--sovereign); }
  .code-input { text-transform: uppercase; letter-spacing: 0.3em; text-align: center; }
  .btn {
    background: #2f2820;
    border: 2px solid #4a4034;
    color: var(--text-bone);
    padding: 0.6rem 1rem;
    font-family: inherit;
    font-size: 0.95rem;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) { border-color: var(--sovereign); color: var(--sovereign); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn.primary { background: #3a2c14; border-color: var(--sovereign); color: var(--sovereign); }
  .btn.ghost { background: transparent; border-color: #3a3226; color: var(--text-dim); font-size: 0.85rem; }
  .join-row { display: flex; gap: 0.5rem; }
  .join-row input { flex: 1; min-width: 0; }
  .lore { max-width: 480px; text-align: center; color: var(--text-dim); font-size: 0.85rem; line-height: 1.6; }
</style>
