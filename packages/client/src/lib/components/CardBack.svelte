<script lang="ts">
  /** Small card-back miniature — represents a card in hand without revealing it. */
  import { assetUrl } from "../assets.js";

  let { size = "sm", count }: { size?: "sm" | "md" | "lg"; count?: number } = $props();

  const back = assetUrl("props/card_back.png");
  const dims = { sm: 22, md: 30, lg: 40 };
  const w = dims[size];
</script>

<div class="cardback" style:width="{w}px" style:height="{Math.round(w * 1.33)}px" title="cards in hand">
  {#if back}
    <img src={back} alt="card back" />
  {:else}
    <span class="placeholder">🂠</span>
  {/if}
  {#if count !== undefined && count > 0}
    <span class="count-badge">{count}</span>
  {/if}
</div>

<style>
  .cardback {
    position: relative;
    display: inline-block;
    flex-shrink: 0;
    image-rendering: pixelated;
    border: 1px solid #000;
    border-radius: 2px;
  }
  .cardback img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    image-rendering: pixelated;
  }
  .placeholder {
    width: 100%;
    height: 100%;
    background: #2a241c;
    color: var(--text-dim);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
  }
  .count-badge {
    position: absolute;
    top: -5px;
    right: -5px;
    background: var(--sovereign);
    color: #0d0b08;
    font-size: 0.55rem;
    font-weight: bold;
    border-radius: 8px;
    min-width: 12px;
    height: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 2px;
    line-height: 1;
  }
</style>