<script lang="ts">
  import { connect, onConnection, send, setReconnectInfo, onMessage, type ConnectionState } from "./lib/stores/connection.js";
  import { gameStore } from "./lib/stores/game.svelte.js";
  import Home from "./lib/screens/Home.svelte";
  import Lobby from "./lib/screens/Lobby.svelte";
  import Draft from "./lib/screens/Draft.svelte";
  import GameTable from "./lib/screens/GameTable.svelte";
  import Winner from "./lib/screens/Winner.svelte";
  import MetaProvider from "./lib/components/MetaProvider.svelte";

  let conn = $state<ConnectionState>({ status: "connecting" });
  onConnection((s) => (conn = s));

  onMessage((m) => {
    if (m.type === "room:joined" && m.reconnectToken) {
      setReconnectInfo(m.roomId, m.reconnectToken);
    }
  });

  connect();

  const screen = $derived(gameStore.screen);
</script>

<MetaProvider />

<div class="frame">
  {#if conn.status !== "open"}
    <div class="conn-bar">
      ⚡ {conn.status === "reconnecting" ? "waking the wasteland…" : conn.status === "closed" ? "connection lost — retrying…" : "connecting…"}
    </div>
  {/if}

  {#if screen === "home"}
    <Home onCreate={() => send({ type: "room:create", name: gameStore.playerName() })}
          onJoin={(id) => send({ type: "room:join", roomId: id, playerName: gameStore.playerName() })} />
  {:else if screen === "lobby"}
    <Lobby onAddBot={() => send({ type: "room:addBot" })}
           onStart={() => send({ type: "room:start" })}
           onLeave={() => { send({ type: "room:leave" }); gameStore.reset(); }} />
  {:else if screen === "draft"}
    <Draft onPick={(id) => send({ type: "draft:pick", survivorId: id })} />
  {:else if screen === "game"}
    <GameTable onSend={send} />
  {:else if screen === "winner"}
    <Winner onHome={() => gameStore.reset()} />
  {/if}
</div>

<style>
  .frame {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .conn-bar {
    background: #2a1f14;
    color: var(--ascendant);
    text-align: center;
    padding: 0.4rem;
    font-size: 0.85rem;
    letter-spacing: 0.1em;
  }
</style>
