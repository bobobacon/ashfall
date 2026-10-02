<script lang="ts">
  import type { CardInstanceInfo, CardMeta } from "../stores/game.svelte.js";
  import { gameStore } from "../stores/game.svelte.js";
  import { cardArt } from "../assets.js";

  let {
    info,
    meta,
    selected = false,
    playable = true,
    onclick,
  }: {
    info: CardInstanceInfo;
    meta?: CardMeta;
    selected?: boolean;
    playable?: boolean;
    onclick?: () => void;
  } = $props();

  const SUITS: Record<string, string> = { spade: "♠", heart: "♥", club: "♣", diamond: "♦" };
  const RANK: Record<number, string> = { 1: "A", 11: "J", 12: "Q", 13: "K" };
  const suit = $derived(SUITS[info.suit] ?? "?");
  const rank = $derived(RANK[info.number] ?? String(info.number));
  const red = $derived(info.suit === "heart" || info.suit === "diamond");
  const lang = $derived(gameStore.lang);
  const name = $derived(meta ? meta.name[lang] : info.defId);
  const catColor = $derived(
    meta?.category === "basic"
      ? "var(--text-bone)"
      : meta?.category === "tactic"
        ? "var(--syndicate)"
        : meta?.category === "delay"
          ? "var(--ascendant)"
          : "var(--verdant)",
  );
</script>

<button
  class="card"
  class:selected
  class:unplayable={!playable}
  onclick={onclick}
  title={meta ? meta.text[lang] : info.defId}
>
  <div class="corner" class:red>{suit}{rank}</div>
  <div class="art" data-def={info.defId}>
    {#if cardArt(info.defId)}
      <img src={cardArt(info.defId)} alt={name} class="pixel-art-img" />
    {:else}
      <span class="art-glyph">{meta?.category === "equipment" ? "⚙" : meta?.category === "delay" ? "⏳" : "✦"}</span>
    {/if}
  </div>
  <div class="cname" style:color={catColor}>{name}</div>
  {#if meta?.range}<div class="range">⌖{meta.range}</div>{/if}
</button>

<style>
  .card {
    width: 72px;
    height: 100px;
    background: var(--bg-panel);
    border: 2px solid #4a4034;
    color: var(--text-bone);
    font-family: inherit;
    display: flex;
    flex-direction: column;
    padding: 0.25rem;
    gap: 0.15rem;
    cursor: pointer;
    position: relative;
    flex-shrink: 0;
    transition: transform 0.08s;
  }
  .card:hover:not(.unplayable) { transform: translateY(-8px); border-color: var(--sovereign); }
  .card.selected { transform: translateY(-12px); border-color: var(--sovereign); box-shadow: 0 0 12px rgba(232, 197, 71, 0.4); }
  .card.unplayable { opacity: 0.55; cursor: default; }
  .corner { font-size: 0.7rem; text-align: left; line-height: 1; }
  .corner.red { color: #d94f3d; }
  .art {
    flex: 1;
    background: #191510;
    border: 1px solid #3a3226;
    display: flex;
    align-items: center;
    justify-content: center;
    image-rendering: pixelated;
  }
  .art-glyph { font-size: 1.4rem; color: var(--text-dim); }
  .pixel-art-img { width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }
  .cname { font-size: 0.55rem; line-height: 1.15; text-align: center; overflow: hidden; }
  .range { position: absolute; top: 2px; right: 4px; font-size: 0.6rem; color: var(--text-dim); }
</style>
