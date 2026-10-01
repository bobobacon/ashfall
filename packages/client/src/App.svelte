<script lang="ts">
  import { onMount } from "svelte";

  let health: { ok: boolean; version: string; ws: boolean } | null = $state(null);
  let wsStatus: string = $state("connecting…");

  onMount(async () => {
    try {
      const res = await fetch("/api/health");
      health = await res.json();
    } catch {
      health = { ok: false, version: "?", ws: false };
    }

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => (wsStatus = "open");
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "hello") wsStatus = `open (server v${msg.version})`;
    };
    ws.onerror = () => (wsStatus = "error");
    ws.onclose = () => (wsStatus = "closed");
  });
</script>

<main>
  <h1>⚠ ASHFALL</h1>
  <p class="subtitle">THE LAST BASTION — ป้อมสุดท้าย</p>

  <div class="panel">
    <p>
      M0 scaffold — engine + server + client boot check.
    </p>
    <p>
      API: <span class={health?.ok ? "ok" : "bad"}>{health ? (health.ok ? "OK v" + health.version : "DOWN") : "checking…"}</span>
    </p>
    <p>
      WS: <span class={wsStatus.startsWith("open") ? "ok" : "bad"}>{wsStatus}</span>
    </p>
  </div>

  <div class="demo-pixel" title="pixel scaling demo"></div>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem 1rem;
    text-align: center;
  }
  h1 {
    color: var(--sovereign);
    letter-spacing: 0.3em;
    text-shadow: 0 0 12px rgba(232, 197, 71, 0.4);
    margin-bottom: 0;
  }
  .subtitle {
    color: var(--text-dim);
    margin-top: 0.25rem;
  }
  .panel {
    background: var(--bg-panel);
    border: 2px solid #3a3226;
    padding: 1rem 2rem;
    max-width: 420px;
  }
  .ok {
    color: var(--accent-glow);
  }
  .bad {
    color: var(--raider);
  }
  .demo-pixel {
    width: 64px;
    height: 64px;
    background: linear-gradient(135deg, var(--tide), var(--ascendant));
    transform: scale(1);
  }
</style>
