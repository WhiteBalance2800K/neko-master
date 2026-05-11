import WebSocket from "ws";
import type { ConnectionsData } from "@neko-master/shared";
import { StatsDatabase } from "../db/db.js";
import { GeoIPService } from "../geo/geo.service.js";
import { TrafficWriteError } from "../clickhouse/clickhouse.writer.js";
import { realtimeStore } from "../realtime/realtime.store.js";
import { BatchBuffer } from "./batch-buffer.js";

// Stale connection cleanup constants
const STALE_CONNECTION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL = 2 * 60 * 1000; // 2 minutes
const DEFAULT_WS_HEARTBEAT_INTERVAL_MS = Math.max(
  5_000,
  Number.parseInt(process.env.GATEWAY_WS_HEARTBEAT_INTERVAL_MS || "15000", 10) || 15_000,
);
const DEFAULT_WS_HEARTBEAT_TIMEOUT_MS = Math.max(
  DEFAULT_WS_HEARTBEAT_INTERVAL_MS * 2,
  Number.parseInt(process.env.GATEWAY_WS_HEARTBEAT_TIMEOUT_MS || "45000", 10) || 45_000,
);

export interface CollectorOptions {
  url: string;
  token?: string;
  reconnectInterval?: number;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  onData?: (data: ConnectionsData) => void;
  onError?: (error: Error) => void;
}

export class GatewayCollector {
  private ws: WebSocket | null = null;
  private url: string;
  private token?: string;
  private reconnectInterval: number;
  private onData?: (data: ConnectionsData) => void;
  private onError?: (error: Error) => void;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isClosing = false;
  private backendId: number;
  private heartbeatInterval: number;
  private heartbeatTimeout: number;
  private lastPongAt = 0;
  private lastMessageAt = 0;

  constructor(backendId: number, options: CollectorOptions) {
    this.backendId = backendId;
    this.url = options.url;
    this.token = options.token;
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.heartbeatInterval = options.heartbeatInterval || DEFAULT_WS_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeout = options.heartbeatTimeout || DEFAULT_WS_HEARTBEAT_TIMEOUT_MS;
    this.onData = options.onData;
    this.onError = options.onError;
  }

  connect() {
    if (this.isClosing) return;

    console.log(`[Collector:${this.backendId}] Connecting to ${this.url}...`);

    const headers: Record<string, string> = {
      Origin: this.url
        .replace("ws://", "http://")
        .replace("wss://", "https://"),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const ws = new WebSocket(this.url, {
      headers,
      followRedirects: true,
    });
    this.ws = ws;

    ws.on("open", () => {
      console.log(`[Collector:${this.backendId}] WebSocket connected`);
      this.lastPongAt = Date.now();
      this.lastMessageAt = this.lastPongAt;
      this.startHeartbeat();
    });

    ws.on("message", (data: WebSocket.Data) => {
      this.lastMessageAt = Date.now();
      try {
        const json = JSON.parse(data.toString()) as ConnectionsData;
        this.onData?.(json);
      } catch (err) {
        console.error(
          `[Collector:${this.backendId}] Failed to parse message:`,
          err,
        );
      }
    });

    ws.on("pong", () => {
      this.lastPongAt = Date.now();
    });

    ws.on("error", (err) => {
      console.error(
        `[Collector:${this.backendId}] WebSocket error:`,
        err.message,
      );
      this.onError?.(err);
    });

    ws.on("close", (code, reason) => {
      console.log(
        `[Collector:${this.backendId}] WebSocket closed: ${code} ${reason}`,
      );
      this.stopHeartbeat();
      if (this.ws === ws) {
        this.ws = null;
      }
      if (!this.isClosing) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log(
      `[Collector:${this.backendId}] Reconnecting in ${this.reconnectInterval}ms...`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectInterval);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeat();
    }, this.heartbeatInterval);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private checkHeartbeat() {
    if (this.isClosing || !this.ws) return;

    const ws = this.ws;
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const now = Date.now();
    const lastSeenAt = Math.max(this.lastPongAt, this.lastMessageAt);
    if (now - lastSeenAt > this.heartbeatTimeout) {
      console.warn(
        `[Collector:${this.backendId}] WebSocket heartbeat timed out after ${now - lastSeenAt}ms; reconnecting`,
      );
      ws.terminate();
      return;
    }

    try {
      ws.ping();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[Collector:${this.backendId}] WebSocket heartbeat ping failed: ${error.message}`,
      );
      ws.terminate();
    }
  }

  disconnect() {
    this.isClosing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    console.log(`[Collector:${this.backendId}] Disconnected`);
  }
}

// Track connection state with their accumulated traffic
interface TrackedConnection {
  id: string;
  domain: string;
  ip: string;
  chains: string[];
  rule: string;
  rulePayload: string;
  lastUpload: number;
  lastDownload: number;
  totalUpload: number;
  totalDownload: number;
  counted: boolean;
  sourceIP?: string;
  process?: string;
  processPath?: string;
  lastSeen: number;
}

export function createCollector(
  db: StatsDatabase,
  url: string,
  token?: string,
  geoService?: GeoIPService,
  onTrafficUpdate?: () => void,
  backendId?: number, // Backend ID for data isolation
) {
  const id = backendId || 0;
  const activeConnections = new Map<string, TrackedConnection>();
  const batchBuffer = new BatchBuffer();
  let lastBroadcastTime = 0;
  const broadcastThrottleMs = 500;
  let flushInterval: NodeJS.Timeout | null = null;
  let cleanupInterval: NodeJS.Timeout | null = null;
  const FLUSH_INTERVAL_MS = parseInt(process.env.FLUSH_INTERVAL_MS || "30000");
  const FLUSH_MAX_BUFFER_SIZE = parseInt(
    process.env.FLUSH_MAX_BUFFER_SIZE || "5000",
  );
  let isFlushing = false;
  let lastPruneTime = 0;
  const PRUNE_INTERVAL_MS = 60_000; // Check memory bounds every 60s

  // Clean up stale connections that haven't been updated for a while
  const cleanupStaleConnections = () => {
    const now = Date.now();
    let cleaned = 0;
    for (const [connId, conn] of activeConnections) {
      if (now - conn.lastSeen > STALE_CONNECTION_TIMEOUT) {
        activeConnections.delete(connId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[Collector:${id}] Cleaned up ${cleaned} stale connections`);
    }
  };

  const flushBatch = async () => {
    if (isFlushing || !batchBuffer.hasPending()) {
      return;
    }

    isFlushing = true;
    try {
      const stats = batchBuffer.flush(db, geoService, id, "Collector");

      let trafficDetailOk = true;
      let trafficAggOk = true;
      if (stats.pendingTrafficWrite) {
        try {
          const outcome = await stats.pendingTrafficWrite;
          trafficDetailOk = outcome.detailOk;
          trafficAggOk = outcome.aggOk;
        } catch (err) {
          if (err instanceof TrafficWriteError) {
            trafficDetailOk = err.detailOk;
            trafficAggOk = err.aggOk;
          } else {
            trafficDetailOk = false;
            trafficAggOk = false;
          }
          console.warn(
            `[Collector:${id}] ClickHouse traffic write failed detail_ok=${trafficDetailOk} agg_ok=${trafficAggOk}`,
            err,
          );
        }
      }

      if (stats.hasTrafficUpdates && stats.trafficOk) {
        if (trafficDetailOk && trafficAggOk) {
          realtimeStore.clearTraffic(id);
        } else if (trafficDetailOk && !trafficAggOk) {
          // Detail committed, agg failed: clear detail-side realtime only.
          realtimeStore.clearTrafficDimensions(id);
        } else if (!trafficDetailOk && trafficAggOk) {
          // Agg committed, detail failed: clear summary-side realtime only.
          realtimeStore.clearTrafficSummary(id);
        }
      }

      let countryWriteOk = true;
      if (stats.pendingCountryWrite) {
        try {
          await stats.pendingCountryWrite;
        } catch (err) {
          countryWriteOk = false;
          console.warn(
            `[Collector:${id}] ClickHouse country write failed, keeping realtime country store`,
            err,
          );
        }
      }

      if (stats.hasCountryUpdates && stats.countryOk && countryWriteOk) {
        realtimeStore.clearCountries(id);
      }

      if (batchBuffer.shouldLog() && (stats.domains > 0 || stats.rules > 0)) {
        console.log(
          `[Collector:${id}] Active: ${activeConnections.size}, Domains: ${stats.domains}, Rules: ${stats.rules}`,
        );
      }
    } finally {
      isFlushing = false;
    }

    // Periodic memory bounds check on realtime store
    const now = Date.now();
    if (now - lastPruneTime > PRUNE_INTERVAL_MS) {
      lastPruneTime = now;
      realtimeStore.pruneIfNeeded(id);
    }
  };

  // Start batch flush interval
  flushInterval = setInterval(() => {
    flushBatch();
  }, FLUSH_INTERVAL_MS);

  // Start cleanup interval for stale connections
  cleanupInterval = setInterval(() => {
    cleanupStaleConnections();
  }, CLEANUP_INTERVAL);

  const collector = new GatewayCollector(id, {
    url,
    token,
    onData: (data) => {
      // Validate data format - be more lenient
      if (!data) {
        console.warn(`[Collector:${id}] Received null/undefined data`);
        return;
      }

      // Some backends send empty messages or keepalive packets
      if (!data.connections) {
        // Silently ignore - this is normal for some backends
        return;
      }

      if (!Array.isArray(data.connections)) {
        console.warn(
          `[Collector:${id}] Invalid connections format: ${typeof data.connections}`,
        );
        return;
      }

      const now = Date.now();
      const currentIds = new Set(
        data.connections.map((c) => c?.id).filter(Boolean),
      );
      let hasNewTraffic = false;
      const geoBatchByIp = new Map<
        string,
        { upload: number; download: number; connections: number }
      >();

      // Process all current connections
      for (const conn of data.connections) {
        // Skip invalid connection entries - be more lenient
        if (!conn || typeof conn !== "object") {
          continue;
        }

        // Some backends may not have all fields
        if (!conn.id) {
          continue;
        }

        // Ensure metadata exists with defaults
        const metadata = conn.metadata || {};
        const domain = metadata.host || metadata.sniffHost || "";
        const ip = metadata.destinationIP || "";
        const sourceIP = metadata.sourceIP || "";
        const processName = metadata.process || "";
        const processPath = metadata.processPath || "";
        const chains = Array.isArray(conn.chains) ? conn.chains : ["DIRECT"];
        const rule = conn.rule || "Match";
        const rulePayload = conn.rulePayload || "";

        const existing = activeConnections.get(conn.id);

        if (!existing) {
          // New connection - track it and record initial traffic
          const hasInitialTraffic = conn.upload > 0 || conn.download > 0;
          activeConnections.set(conn.id, {
            id: conn.id,
            domain,
            ip,
            chains,
            rule,
            rulePayload,
            lastUpload: conn.upload,
            lastDownload: conn.download,
            totalUpload: conn.upload,
            totalDownload: conn.download,
            counted: hasInitialTraffic,
            sourceIP,
            process: processName,
            processPath,
            lastSeen: now,
          });

          // Record initial traffic for new connection (add to batch buffer)
          if (hasInitialTraffic) {
            const connections = 1;
            batchBuffer.add(id, {
              domain,
              ip,
              chain: chains[0] || "DIRECT",
              chains,
              rule,
              rulePayload,
              upload: conn.upload,
              download: conn.download,
              connections,
              sourceIP,
              process: processName,
              processPath,
              timestampMs: now,
            });
            realtimeStore.recordTraffic(
              id,
              {
                domain,
                ip,
                sourceIP,
                chains,
                rule,
                rulePayload,
                upload: conn.upload,
                download: conn.download,
                process: processName,
                processPath,
              },
              connections,
              now
            );

            // Aggregate GeoIP lookup payload by destination IP per batch.
            if (geoService && ip) {
              const existingGeo = geoBatchByIp.get(ip) || {
                upload: 0,
                download: 0,
                connections: 0,
              };
              existingGeo.upload += conn.upload;
              existingGeo.download += conn.download;
              existingGeo.connections += connections;
              geoBatchByIp.set(ip, existingGeo);
            }

            hasNewTraffic = true;
          }
        } else {
          // Existing connection - calculate delta and add to batch
          const uploadDelta = Math.max(0, conn.upload - existing.lastUpload);
          const downloadDelta = Math.max(
            0,
            conn.download - existing.lastDownload,
          );

          if (uploadDelta > 0 || downloadDelta > 0) {
            const connections = existing.counted ? 0 : 1;
            if (connections > 0) {
              existing.counted = true;
            }
            // Update accumulated traffic for this connection
            existing.totalUpload += uploadDelta;
            existing.totalDownload += downloadDelta;

            // Add delta to batch buffer
            batchBuffer.add(id, {
              domain: existing.domain,
              ip: existing.ip,
              chain: existing.chains[0] || "DIRECT",
              chains: existing.chains,
              rule: existing.rule || "Match",
              rulePayload: existing.rulePayload || "",
              upload: uploadDelta,
              download: downloadDelta,
              connections,
              sourceIP: existing.sourceIP,
              process: existing.process,
              processPath: existing.processPath,
              timestampMs: now,
            });
            realtimeStore.recordTraffic(
              id,
              {
                domain: existing.domain,
                ip: existing.ip,
                sourceIP: existing.sourceIP,
                chains: existing.chains,
                rule: existing.rule || 'Match',
                rulePayload: existing.rulePayload || '',
                upload: uploadDelta,
                download: downloadDelta,
                process: existing.process,
                processPath: existing.processPath,
              },
              connections,
              now
            );

            // Aggregate GeoIP lookup payload by destination IP per batch.
            if (geoService && existing.ip) {
              const existingGeo = geoBatchByIp.get(existing.ip) || {
                upload: 0,
                download: 0,
                connections: 0,
              };
              existingGeo.upload += uploadDelta;
              existingGeo.download += downloadDelta;
              existingGeo.connections += connections;
              geoBatchByIp.set(existing.ip, existingGeo);
            }

            existing.lastUpload = conn.upload;
            existing.lastDownload = conn.download;
            existing.lastSeen = now;
            hasNewTraffic = true;
          }
        }
      }

      // Find closed connections and remove them
      for (const [connId] of activeConnections) {
        if (!currentIds.has(connId)) {
          // Connection closed - any remaining traffic was already counted
          activeConnections.delete(connId);
        }
      }

      if (geoService && geoBatchByIp.size > 0) {
        for (const [ip, traffic] of geoBatchByIp) {
          geoService
            .getGeoLocation(ip)
            .then((geo) => {
              if (geo) {
                batchBuffer.addGeoResult({
                  ip,
                  geo,
                  upload: traffic.upload,
                  download: traffic.download,
                  connections: traffic.connections,
                  timestampMs: now,
                });
                realtimeStore.recordCountryTraffic(
                  id,
                  geo,
                  traffic.upload,
                  traffic.download,
                  traffic.connections,
                  now,
                );
              }
            })
            .catch(() => {
              // Silently fail for GeoIP errors
            });
        }
      }

      if (batchBuffer.size() >= FLUSH_MAX_BUFFER_SIZE) {
        flushBatch();
      }

      // Broadcast to WebSocket clients if there's new traffic (with throttling)
      if (
        hasNewTraffic &&
        onTrafficUpdate &&
        now - lastBroadcastTime > broadcastThrottleMs
      ) {
        lastBroadcastTime = now;
        onTrafficUpdate();
      }
    },
    onError: (err) => {
      console.error(`[Collector:${id}] Error:`, err);
    },
  });

  // Override disconnect to clear intervals
  const originalDisconnect = collector.disconnect.bind(collector);
  const waitForFlushThenDisconnect = async () => {
    while (isFlushing) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await flushBatch();
  };
  collector.disconnect = () => {
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
    void waitForFlushThenDisconnect().finally(() => {
      originalDisconnect();
    });
  };

  const collectorWithReset = collector as GatewayCollector & {
    clearRuntimeState?: () => void;
  };
  collectorWithReset.clearRuntimeState = () => {
    // Keep active connection baselines to avoid replaying historical cumulative
    // counters after a DB/log wipe. Only clear pending in-memory deltas.
    batchBuffer.clear();
  };

  return collectorWithReset;
}
