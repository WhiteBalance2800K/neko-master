import { createHash } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayCollector } from "./gateway.collector.js";

function createSilentWebSocketServer() {
  const sockets = new Set<Socket>();
  let connections = 0;

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.once("data", (data) => {
      const request = data.toString("utf8");
      const key = request.match(/sec-websocket-key:\s*(.+)\r?\n/i)?.[1]?.trim();
      if (!key) {
        socket.destroy();
        return;
      }

      const accept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");

      socket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${accept}`,
          "\r\n",
        ].join("\r\n"),
      );
      connections += 1;
    });
  });

  return {
    server,
    sockets,
    get connections() {
      return connections;
    },
  };
}

function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for condition"));
      }
    }, 10);
  });
}

describe("GatewayCollector", () => {
  let collector: GatewayCollector | undefined;
  let server: Server | undefined;
  let sockets: Set<Socket> | undefined;

  afterEach(async () => {
    collector?.disconnect();
    collector = undefined;
    for (const socket of sockets ?? []) {
      socket.destroy();
    }
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
    }
    server = undefined;
    sockets = undefined;
  });

  it("reconnects when a half-open websocket stops answering heartbeat pings", async () => {
    const silentServer = createSilentWebSocketServer();
    server = silentServer.server;
    sockets = silentServer.sockets;

    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;

    collector = new GatewayCollector(7, {
      url: `ws://127.0.0.1:${port}/connections`,
      reconnectInterval: 20,
      heartbeatInterval: 10,
      heartbeatTimeout: 30,
    });

    collector.connect();

    await waitFor(() => silentServer.connections >= 1);
    await waitFor(() => silentServer.connections >= 2, 1000);

    expect(silentServer.connections).toBeGreaterThanOrEqual(2);
  });
});
