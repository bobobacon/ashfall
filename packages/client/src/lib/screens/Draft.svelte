<script lang="ts">
  import { gameStore } from "../stores/game.svelte.js";
  import { survivorPortrait } from "../assets.js";

  let { onPick }: { onPick: (survivorId: string) => void } = $props();

  const view = $derived(gameStore.view);
  const offer = $derived(view?.you?.draftOffer ?? []);
  const picked = $derived(!!view?.you?.survivorId);
  const lang = $derived(gameStore.lang);

  const FACTION_COLORS: Record<string, string> = {
    syndicate: "var(--syndicate)",
    verdant: "var(--verdant)",
    tide: "var(--tide)",
    walker: "var(--walker)",
    ascendant: "var(--ascendant)",
  };
  const FACTION_NAMES: Record<string, { en: string; th: string }> = {
    syndicate: { en: "Iron Syndicate", th: "สหภาพเหล็ก" },
    verdant: { en: "Verdant Kin", th: "เผ่าพงไพร" },
    tide: { en: "Ember Tide", th: "คลื่นเพลิง" },
    walker: { en: "Ashwalkers", th: "ผู้เถ้าธุลี" },
    ascendant: { en: "Ascendant", th: "เทพเถ้า" },
  };
</script>

<div class="draft">
  <h2>{lang === "en" ? "CHOOSE YOUR SURVIVOR" : "เลือกผู้รอดชีวิตของคุณ"}</h2>
  <p class="sub">
    {picked
      ? (lang === "en" ? "Waiting for other players to reveal…" : "รอผู้เล่นคนอื่นเปิดเผย…")
      : (lang === "en" ? "30 seconds — or fate chooses for you." : "30 วินาที — หรือชะตาจะเลือกให้คุณ")}
  </p>

  <div class="offers">
    {#each offer as sid (sid)}
      {@const s = gameStore.survivors[sid]}
      {#if s}
        <button class="card" style:border-color={FACTION_COLORS[s.faction] ?? "#4a4034"}
                disabled={picked} onclick={() => onPick(sid)}>
          <div class="portrait" style:background={FACTION_COLORS[s.faction] ?? "#333"}>
            {#if survivorPortrait(sid)}
              <img src={survivorPortrait(sid)} alt={s.name.en} class="pixel-art-img" />
            {:else}
              <span class="initials">{s.name.en.slice(0, 2).toUpperCase()}</span>
            {/if}
          </div>
          <div class="cname">{s.name[lang]}</div>
          <div class="faction" style:color={FACTION_COLORS[s.faction]}>
            {FACTION_NAMES[s.faction]?.[lang] ?? s.faction}
          </div>
          <div class="hp">HP {s.maxHp}{view?.you?.role === "sovereign" && offer.includes(sid) ? "" : ""}</div>
          <div class="skills">
            {#each s.skills as sk (sk.id)}
              <div class="skill">
                <b>{sk.name[lang]}</b>
                <span>{sk.description[lang]}</span>
              </div>
            {/each}
          </div>
        </button>
      {/if}
    {/each}
  </div>

  {#if view?.you?.role === "sovereign"}
    <p class="sovereign-note">👑 {lang === "en" ? "You are the SOVEREIGN — your identity is public. +1 Max HP and a Sovereign skill." : "คุณคืออธิราช — ตัวตนเปิดเผยสาธารณะ +1 HP สูงสุด และสกิลอธิราช"}</p>
  {/if}
</div>

<style>
  .draft {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8rem;
    padding: 2rem 1rem;
  }
  h2 { color: var(--sovereign); letter-spacing: 0.2em; margin: 0; text-align: center; }
  .sub { color: var(--text-dim); margin: 0; font-size: 0.9rem; }
  .offers {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.8rem;
    width: min(980px, 96vw);
  }
  .card {
    background: var(--bg-panel);
    border: 2px solid #4a4034;
    color: var(--text-bone);
    padding: 0.8rem;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    transition: transform 0.1s;
  }
  .card:hover:not(:disabled) { transform: translateY(-4px); }
  .card:disabled { opacity: 0.55; cursor: default; }
  .portrait {
    height: 84px;
    display: flex;
    align-items: center;
    justify-content: center;
    image-rendering: pixelated;
    border: 2px solid #000;
  }
  .initials { font-size: 1.6rem; color: #0d0b08; font-weight: bold; letter-spacing: 0.1em; }
  .pixel-art-img { width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }
  .cname { font-size: 0.95rem; font-weight: bold; }
  .faction { font-size: 0.7rem; letter-spacing: 0.12em; text-transform: uppercase; }
  .hp { font-size: 0.8rem; color: var(--verdant); }
  .skills { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.2rem; }
  .skill { font-size: 0.72rem; line-height: 1.4; color: var(--text-dim); }
  .skill b { color: var(--text-bone); display: block; }
  .sovereign-note { color: var(--sovereign); font-size: 0.85rem; text-align: center; }
</style>
