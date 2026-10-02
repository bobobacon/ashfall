<script lang="ts">
  /** Deck / discard pile visual — stacked card backs with a count badge. */
  import { assetUrl } from "../assets.js";

  let {
    count,
    label,
    kind,
    onclick,
  }: { count: number; label: string; kind: "deck" | "discard"; onclick?: () => void } = $props();

  const back = assetUrl("props/card_back.png");
  // discard pile uses a more scattered stack (unique prop)
  const discardArt = assetUrl("props/discard_pile.png");
  const isBtn = !!onclick;
</script>

<button class="pile" class:clickable={isBtn} onclick={onclick} title={`${label} (${count})`}>
  <div class="stack" class:scattered={kind === "discard"}>
    <div class="card c1"></div>
    <div class="card c2"></div>
    <div class="card c3"></div>
    {#if kind === "deck"}
      <img class="face" src={back} alt="deck" />
    {:else if discardArt}
      <img class="face" src={discardArt} alt="discard" />
    {:else}
      <div class="face fallback">♻</div>
    {/if}
  </div>
  <span class="pile-label">{label}</span>
  <span class="pile-count">{count}</span>
</button>

<style>
  .pile {
    background: none;
    border: none;
    padding: 0;
    font-family: inherit;
    color: inherit;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    cursor: default;
    width: 72px;
  }
  .pile.clickable { cursor: pointer; }
  .stack {
    position: relative;
    width: 56px;
    height: 74px;
  }
  .card {
    position: absolute;
    inset: 0;
    background: #241d15;
    border: 2px solid #0d0b08;
    border-radius: 3px;
    image-rendering: pixelated;
  }
  .c1 { transform: translate(3px, 3px); }
  .c2 { transform: translate(1px, 1px); }
  .c3 { transform: translate(-2px, -2px); }
  .scattered .c1 { transform: translate(4px, -2px) rotate(4deg); }
  .scattered .c2 { transform: translate(-2px, 2px) rotate(-3deg); }
  .scattered .c3 { transform: translate(0, 6px) rotate(2deg); }
  .face {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    image-rendering: pixelated;
    border: 2px solid #0d0b08;
    border-radius: 3px;
  }
  .fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #2a241c;
    color: var(--text-dim);
    font-size: 1.2rem;
  }
  .pile-label { font-size: 0.6rem; color: var(--text-dim); letter-spacing: 0.1em; }
  .pile-count { font-size: 0.75rem; color: var(--sovereign); font-variant-numeric: tabular-nums; }
</style>