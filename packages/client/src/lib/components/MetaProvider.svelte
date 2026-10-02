<script lang="ts">
  import { onMount } from "svelte";
  import { gameStore } from "../stores/game.svelte.js";

  onMount(() => {
    gameStore.loadName();
    void gameStore.loadMeta();
  });
</script>

<!-- MetaProvider: loads card/survivor metadata once; renders nothing -->
