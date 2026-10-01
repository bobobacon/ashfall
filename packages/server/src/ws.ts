// WebSocket gateway — M0 echo skeleton; grows into room/prompt protocol in M5.
import type { Server } from "node:http";
import { WebSocketServer } from "ws";

export function websocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "hello", version: "0.1.0" }));

    ws.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        ws.send(JSON.stringify({ type: "error", code: "E_BAD_JSON" }));
        return;
      }
      // M0: echo back for smoke tests. Replaced by intent dispatch in M5.
      ws.send(JSON.stringify({ type: "echo", payload: msg }));
    });
  });

  return wss;
}
