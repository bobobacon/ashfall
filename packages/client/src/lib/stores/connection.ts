// WS connection store — single socket, auto-reconnect, seq-based resync.
import type { ServerMsgT, ClientIntentT } from "@ashfall/shared";
import { gameStore } from "./game.svelte.js";

export interface ConnectionState {
  status: "connecting" | "open" | "reconnecting" | "closed";
  version?: string;
  sessionId?: string;
}

type Listener = (msg: ServerMsgT) => void;

const listeners = new Set<Listener>();
let ws: WebSocket | null = null;
let state: ConnectionState = { status: "connecting" };
const stateListeners = new Set<(s: ConnectionState) => void>();
let lastSeq = 0;
let reconnectAttempts = 0;
let reconnectToken: string | undefined;
let roomId: string | undefined;

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  // dev: vite proxies /ws; prod: same origin
  return `${proto}://${location.host}/ws`;
}

export function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  setState({ ...state, status: reconnectAttempts > 0 ? "reconnecting" : "connecting" });
  ws = new WebSocket(wsUrl());

  ws.onopen = () => {
    reconnectAttempts = 0;
    setState({ ...state, status: "open" });
    // rejoin room if we have a token (reconnect flow)
    if (reconnectToken && roomId) {
      send({ type: "room:join", roomId, playerName: "reconnect", reconnectToken });
      send({ type: "resync" });
    }
  };

  ws.onmessage = (ev) => {
    let msg: ServerMsgT;
    try {
      msg = JSON.parse(String(ev.data)) as ServerMsgT;
    } catch {
      return;
    }
    if (msg.type === "hello") {
      setState({ status: "open", version: msg.version, sessionId: msg.sessionId });
      return;
    }
    // seq tracking + gap → resync
    const seq = (msg as { seq?: number }).seq;
    if (typeof seq === "number") {
      if (lastSeq > 0 && seq > lastSeq + 1 && msg.type === "game:event") {
        send({ type: "resync" });
      }
      lastSeq = seq;
    }
    // feed the reactive game store
    gameStore.handle(msg);
    for (const l of listeners) l(msg);
  };

  ws.onclose = () => {
    setState({ ...state, status: "closed" });
    ws = null;
    if (reconnectAttempts < 8) {
      const delay = Math.min(8000, 500 * 2 ** reconnectAttempts);
      reconnectAttempts++;
      setTimeout(connect, delay);
    }
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function setState(s: ConnectionState): void {
  state = s;
  for (const l of stateListeners) l(s);
}

export function onConnection(fn: (s: ConnectionState) => void): () => void {
  stateListeners.add(fn);
  fn(state);
  return () => stateListeners.delete(fn);
}

export function onMessage(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function send(intent: ClientIntentT): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(intent));
  }
}

/** Remember the room for reconnect flow (set after room:joined). */
export function setReconnectInfo(rId: string, token?: string): void {
  roomId = rId;
  reconnectToken = token;
}

export function resetLastSeq(): void {
  lastSeq = 0;
}
