/**
 * Config Repository
 *
 * Handles database maintenance: retention configuration, data cleanup,
 * vacuum, and statistics about stored data.
 */
import type Database from 'better-sqlite3';
import * as fs from 'node:fs';
import path from 'node:path';
import { BaseRepository } from './base.repository.js';

interface DatabaseRetentionConfig {
  connectionLogsDays: number;
  hourlyStatsDays: number;
  autoCleanup: boolean;
}

export type GeoLookupProvider = 'online' | 'local';

export interface GeoLookupConfig {
  provider: GeoLookupProvider;
  mmdbDir: string;
  onlineApiUrl: string;
  localMmdbReady: boolean;
  missingMmdbFiles: string[];
}

export interface BarkNotificationConfig {
  enabled: boolean;
  backendId: number | null;
  serverUrl: string;
  totalThresholdBytes: number;
  uploadThresholdBytes: number;
  downloadThresholdBytes: number;
  cooldownMinutes: number;
  lastTotalNotifiedAt?: string;
  lastUploadNotifiedAt?: string;
  lastDownloadNotifiedAt?: string;
  lastTotalThresholdBytes: number;
  lastUploadThresholdBytes: number;
  lastDownloadThresholdBytes: number;
}

export class ConfigRepository extends BaseRepository {
  private dbPath: string;
  private mmdbStatusCache:
    | {
      dir: string;
      checkedAt: number;
      missingMmdbFiles: string[];
    }
    | null = null;
  public static readonly REQUIRED_MMDB_FILES = [
    'GeoLite2-City.mmdb',
    'GeoLite2-ASN.mmdb',
  ] as const;
  private static readonly DEFAULT_MMDB_DIR = '/app/data/geoip';
  private static readonly MMDB_STATUS_CACHE_TTL_MS = 5000;

  constructor(db: Database.Database, dbPath: string) {
    super(db);
    this.dbPath = dbPath;
  }

  // Retention config
  getRetentionConfig(): DatabaseRetentionConfig {
    const connectionLogsDays = this.db.prepare(
      `SELECT value FROM app_config WHERE key = 'retention.connection_logs_days'`,
    ).get() as { value: string } | undefined;

    const hourlyStatsDays = this.db.prepare(
      `SELECT value FROM app_config WHERE key = 'retention.hourly_stats_days'`,
    ).get() as { value: string } | undefined;

    const autoCleanup = this.db.prepare(
      `SELECT value FROM app_config WHERE key = 'retention.auto_cleanup'`,
    ).get() as { value: string } | undefined;

    return {
      connectionLogsDays: parseInt(connectionLogsDays?.value || '7', 10),
      hourlyStatsDays: parseInt(hourlyStatsDays?.value || '30', 10),
      // Default ON when no row exists; an explicit '0' disables it.
      autoCleanup: autoCleanup ? autoCleanup.value !== '0' : true,
    };
  }

  updateRetentionConfig(updates: {
    connectionLogsDays?: number;
    hourlyStatsDays?: number;
    autoCleanup?: boolean;
  }): DatabaseRetentionConfig {
    if (updates.connectionLogsDays !== undefined) {
      this.db.prepare(`
        INSERT INTO app_config (key, value) VALUES ('retention.connection_logs_days', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(updates.connectionLogsDays.toString());
    }
    if (updates.hourlyStatsDays !== undefined) {
      this.db.prepare(`
        INSERT INTO app_config (key, value) VALUES ('retention.hourly_stats_days', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(updates.hourlyStatsDays.toString());
    }
    if (updates.autoCleanup !== undefined) {
      this.db.prepare(`
        INSERT INTO app_config (key, value) VALUES ('retention.auto_cleanup', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(updates.autoCleanup ? '1' : '0');
    }
    return this.getRetentionConfig();
  }

  // Geo lookup config
  getGeoLookupConfig(): GeoLookupConfig {
    const providerRow = this.db.prepare(
      `SELECT value FROM app_config WHERE key = 'geoip.lookup_provider'`,
    ).get() as { value: string } | undefined;

    const onlineApiUrlRow = this.db.prepare(
      `SELECT value FROM app_config WHERE key = 'geoip.online_api_url'`,
    ).get() as { value: string } | undefined;

    const envProviderRaw = process.env.GEOIP_LOOKUP_PROVIDER?.trim();
    const envProvider =
      envProviderRaw === 'online' || envProviderRaw === 'local'
        ? envProviderRaw
        : undefined;
    const providerValue =
      envProvider ||
      (providerRow?.value === 'online' || providerRow?.value === 'local'
        ? (providerRow.value as GeoLookupProvider)
        : 'online');

    const mmdbDirValue = this.resolveMmdbDir();
    const missingMmdbFiles = this.getMissingMmdbFiles(mmdbDirValue);

    return {
      provider: providerValue,
      mmdbDir: mmdbDirValue,
      onlineApiUrl:
        process.env.GEOIP_ONLINE_API_URL?.trim() ||
        onlineApiUrlRow?.value ||
        'https://api.ipinfo.es/ipinfo',
      localMmdbReady: missingMmdbFiles.length === 0,
      missingMmdbFiles,
    };
  }

  private getMissingMmdbFiles(mmdbDir: string): string[] {
    const now = Date.now();
    const cached = this.mmdbStatusCache;
    if (
      cached &&
      cached.dir === mmdbDir &&
      now - cached.checkedAt < ConfigRepository.MMDB_STATUS_CACHE_TTL_MS
    ) {
      return cached.missingMmdbFiles;
    }

    const missingMmdbFiles = ConfigRepository.REQUIRED_MMDB_FILES.filter(
      (file) => !fs.existsSync(path.join(mmdbDir, file)),
    );

    this.mmdbStatusCache = {
      dir: mmdbDir,
      checkedAt: now,
      missingMmdbFiles,
    };

    return missingMmdbFiles;
  }

  private resolveMmdbDir(): string {
    const envMmdbDir = process.env.GEOIP_MMDB_DIR?.trim();
    const fallbackCandidates = [
      path.join(process.cwd(), 'geoip'),
      path.join(process.cwd(), 'geo'),
      path.resolve(process.cwd(), '..', 'geoip'),
      path.resolve(process.cwd(), '..', 'geo'),
      path.resolve(process.cwd(), '..', '..', 'geoip'),
      path.resolve(process.cwd(), '..', '..', 'geo'),
      ConfigRepository.DEFAULT_MMDB_DIR,
    ];

    const candidates = [envMmdbDir, ...fallbackCandidates]
      .filter((dir): dir is string => !!dir)
      .map((dir) => path.resolve(dir));
    const uniqueCandidates = Array.from(new Set(candidates));
    const existing = uniqueCandidates.find((dir) => fs.existsSync(dir));
    if (existing) return existing;

    if (envMmdbDir) {
      return path.resolve(envMmdbDir);
    }
    return ConfigRepository.DEFAULT_MMDB_DIR;
  }

  updateGeoLookupConfig(updates: {
    provider?: GeoLookupProvider;
    onlineApiUrl?: string;
  }): GeoLookupConfig {
    if (updates.provider !== undefined) {
      this.db.prepare(`
        INSERT INTO app_config (key, value) VALUES ('geoip.lookup_provider', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(updates.provider);
    }
    if (updates.onlineApiUrl !== undefined) {
      this.db.prepare(`
        INSERT INTO app_config (key, value) VALUES ('geoip.online_api_url', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(updates.onlineApiUrl);
    }

    return this.getGeoLookupConfig();
  }

  private getConfigValue(key: string): string | undefined {
    return (this.db.prepare(`SELECT value FROM app_config WHERE key = ?`).get(key) as { value: string } | undefined)?.value;
  }

  private setConfigValue(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO app_config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, value);
  }

  private getConfigNumber(key: string, fallback: number): number {
    const parsed = Number(this.getConfigValue(key));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  getBarkNotificationConfig(): BarkNotificationConfig {
    const backendId = this.getConfigNumber('notification.bark.backend_id', 0);
    return {
      enabled: this.getConfigValue('notification.bark.enabled') === '1',
      backendId: backendId > 0 ? backendId : null,
      serverUrl: this.getConfigValue('notification.bark.server_url') || '',
      totalThresholdBytes: this.getConfigNumber('notification.bark.total_threshold_bytes', 0),
      uploadThresholdBytes: this.getConfigNumber('notification.bark.upload_threshold_bytes', 0),
      downloadThresholdBytes: this.getConfigNumber('notification.bark.download_threshold_bytes', 0),
      cooldownMinutes: this.getConfigNumber('notification.bark.cooldown_minutes', 1440),
      lastTotalNotifiedAt: this.getConfigValue('notification.bark.last_total_notified_at'),
      lastUploadNotifiedAt: this.getConfigValue('notification.bark.last_upload_notified_at'),
      lastDownloadNotifiedAt: this.getConfigValue('notification.bark.last_download_notified_at'),
      lastTotalThresholdBytes: this.getConfigNumber('notification.bark.last_total_threshold_bytes', 0),
      lastUploadThresholdBytes: this.getConfigNumber('notification.bark.last_upload_threshold_bytes', 0),
      lastDownloadThresholdBytes: this.getConfigNumber('notification.bark.last_download_threshold_bytes', 0),
    };
  }

  updateBarkNotificationConfig(updates: {
    enabled?: boolean;
    backendId?: number | null;
    serverUrl?: string;
    totalThresholdBytes?: number;
    uploadThresholdBytes?: number;
    downloadThresholdBytes?: number;
    cooldownMinutes?: number;
  }): BarkNotificationConfig {
    if (updates.enabled !== undefined) {
      this.setConfigValue('notification.bark.enabled', updates.enabled ? '1' : '0');
    }
    if (updates.backendId !== undefined) {
      const currentBackendId = this.getConfigNumber('notification.bark.backend_id', 0);
      const parsedBackendId = updates.backendId === null ? 0 : Number(updates.backendId);
      const backendId = Number.isFinite(parsedBackendId) ? Math.max(0, Math.floor(parsedBackendId)) : 0;
      this.setConfigValue('notification.bark.backend_id', String(backendId));
      if (backendId !== currentBackendId) {
        for (const metric of ['total', 'upload', 'download'] as const) {
          const prefix = `notification.bark.last_${metric}`;
          this.setConfigValue(`${prefix}_notified_at`, '');
          this.setConfigValue(`${prefix}_threshold_bytes`, '0');
        }
      }
    }
    if (updates.serverUrl !== undefined) {
      this.setConfigValue('notification.bark.server_url', updates.serverUrl);
    }
    if (updates.totalThresholdBytes !== undefined) {
      this.setConfigValue('notification.bark.total_threshold_bytes', String(Math.max(0, Math.floor(updates.totalThresholdBytes))));
    }
    if (updates.uploadThresholdBytes !== undefined) {
      this.setConfigValue('notification.bark.upload_threshold_bytes', String(Math.max(0, Math.floor(updates.uploadThresholdBytes))));
    }
    if (updates.downloadThresholdBytes !== undefined) {
      this.setConfigValue('notification.bark.download_threshold_bytes', String(Math.max(0, Math.floor(updates.downloadThresholdBytes))));
    }
    if (updates.cooldownMinutes !== undefined) {
      this.setConfigValue('notification.bark.cooldown_minutes', String(Math.max(1, Math.floor(updates.cooldownMinutes))));
    }

    return this.getBarkNotificationConfig();
  }

  markBarkNotificationSent(metric: 'total' | 'upload' | 'download', thresholdBytes: number, notifiedAt = new Date().toISOString()): void {
    const prefix = `notification.bark.last_${metric}`;
    this.setConfigValue(`${prefix}_notified_at`, notifiedAt);
    this.setConfigValue(`${prefix}_threshold_bytes`, String(Math.max(0, Math.floor(thresholdBytes))));
  }

  // Data cleanup
  cleanupOldData(backendId: number | null, days: number): {
    deletedConnections: number; deletedLogs: number; deletedDomains: number;
    deletedIPs: number; deletedProxies: number; deletedRules: number;
  } {
    let deletedConnections = 0;
    let deletedLogs = 0;
    let deletedDomains = 0;
    let deletedIPs = 0;
    let deletedProxies = 0;
    let deletedRules = 0;

    if (backendId !== null) {
      if (days === 0) {
        const minuteResult = this.db.prepare(`DELETE FROM minute_stats WHERE backend_id = ?`).run(backendId);
        deletedConnections = minuteResult.changes;
        deletedLogs = minuteResult.changes;
        this.db.prepare(`DELETE FROM minute_dim_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM minute_country_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM hourly_dim_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM hourly_country_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM connection_logs WHERE backend_id = ?`).run(backendId);

        deletedDomains = this.db.prepare(`DELETE FROM domain_stats WHERE backend_id = ?`).run(backendId).changes;
        deletedIPs = this.db.prepare(`DELETE FROM ip_stats WHERE backend_id = ?`).run(backendId).changes;
        deletedProxies = this.db.prepare(`DELETE FROM proxy_stats WHERE backend_id = ?`).run(backendId).changes;
        deletedRules = this.db.prepare(`DELETE FROM rule_stats WHERE backend_id = ?`).run(backendId).changes;

        this.db.prepare(`DELETE FROM country_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM rule_proxy_map WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM rule_chain_traffic WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM rule_domain_traffic WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM rule_ip_traffic WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM domain_proxy_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM ip_proxy_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM device_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM device_domain_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM device_ip_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM hourly_stats WHERE backend_id = ?`).run(backendId);
        this.db.prepare(`DELETE FROM backend_health_logs WHERE backend_id = ?`).run(backendId);
      } else {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const minuteCutoff = cutoff.toISOString().slice(0, 16) + ':00';
        const hourCutoff = cutoff.toISOString().slice(0, 13) + ':00:00';
        const healthCutoff = cutoff.toISOString().slice(0, 16);
        const minuteResult = this.db.prepare(`DELETE FROM minute_stats WHERE backend_id = ? AND minute < ?`).run(backendId, minuteCutoff);
        deletedConnections = minuteResult.changes;
        deletedLogs = minuteResult.changes;
        this.db.prepare(`DELETE FROM minute_dim_stats WHERE backend_id = ? AND minute < ?`).run(backendId, minuteCutoff);
        this.db.prepare(`DELETE FROM minute_country_stats WHERE backend_id = ? AND minute < ?`).run(backendId, minuteCutoff);
        this.db.prepare(`DELETE FROM hourly_dim_stats WHERE backend_id = ? AND hour < ?`).run(backendId, hourCutoff);
        this.db.prepare(`DELETE FROM hourly_country_stats WHERE backend_id = ? AND hour < ?`).run(backendId, hourCutoff);
        this.db.prepare(`DELETE FROM connection_logs WHERE backend_id = ? AND timestamp < ?`).run(backendId, cutoff.toISOString());
        this.db.prepare(`DELETE FROM backend_health_logs WHERE backend_id = ? AND minute < ?`).run(backendId, healthCutoff);
      }
    } else {
      if (days === 0) {
        const minuteResult = this.db.prepare(`DELETE FROM minute_stats`).run();
        deletedConnections = minuteResult.changes;
        deletedLogs = minuteResult.changes;
        this.db.prepare(`DELETE FROM minute_dim_stats`).run();
        this.db.prepare(`DELETE FROM minute_country_stats`).run();
        this.db.prepare(`DELETE FROM hourly_dim_stats`).run();
        this.db.prepare(`DELETE FROM hourly_country_stats`).run();
        this.db.prepare(`DELETE FROM connection_logs`).run();

        deletedDomains = this.db.prepare(`DELETE FROM domain_stats`).run().changes;
        deletedIPs = this.db.prepare(`DELETE FROM ip_stats`).run().changes;
        deletedProxies = this.db.prepare(`DELETE FROM proxy_stats`).run().changes;
        deletedRules = this.db.prepare(`DELETE FROM rule_stats`).run().changes;

        this.db.prepare(`DELETE FROM country_stats`).run();
        this.db.prepare(`DELETE FROM rule_proxy_map`).run();
        this.db.prepare(`DELETE FROM rule_chain_traffic`).run();
        this.db.prepare(`DELETE FROM rule_domain_traffic`).run();
        this.db.prepare(`DELETE FROM rule_ip_traffic`).run();
        this.db.prepare(`DELETE FROM domain_proxy_stats`).run();
        this.db.prepare(`DELETE FROM ip_proxy_stats`).run();
        this.db.prepare(`DELETE FROM device_stats`).run();
        this.db.prepare(`DELETE FROM device_domain_stats`).run();
        this.db.prepare(`DELETE FROM device_ip_stats`).run();
        this.db.prepare(`DELETE FROM hourly_stats`).run();
        this.db.prepare(`DELETE FROM backend_health_logs`).run();
      } else {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const minuteCutoff = cutoff.toISOString().slice(0, 16) + ':00';
        const hourCutoff = cutoff.toISOString().slice(0, 13) + ':00:00';
        const healthCutoff = cutoff.toISOString().slice(0, 16);
        const minuteResult = this.db.prepare(`DELETE FROM minute_stats WHERE minute < ?`).run(minuteCutoff);
        deletedConnections = minuteResult.changes;
        deletedLogs = minuteResult.changes;
        this.db.prepare(`DELETE FROM minute_dim_stats WHERE minute < ?`).run(minuteCutoff);
        this.db.prepare(`DELETE FROM minute_country_stats WHERE minute < ?`).run(minuteCutoff);
        this.db.prepare(`DELETE FROM hourly_dim_stats WHERE hour < ?`).run(hourCutoff);
        this.db.prepare(`DELETE FROM hourly_country_stats WHERE hour < ?`).run(hourCutoff);
        this.db.prepare(`DELETE FROM connection_logs WHERE timestamp < ?`).run(cutoff.toISOString());
        this.db.prepare(`DELETE FROM backend_health_logs WHERE minute < ?`).run(healthCutoff);
      }
    }

    if (days === 0) {
      this.vacuum();
    }

    return { deletedConnections, deletedLogs, deletedDomains, deletedIPs, deletedProxies, deletedRules };
  }

  cleanupASNCache(days: number): number {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    return this.db.prepare(`DELETE FROM asn_cache WHERE queried_at < ?`).run(cutoff).changes;
  }

  getDatabaseSize(): number {
    try {
      return fs.statSync(this.dbPath).size;
    } catch {
      return 0;
    }
  }

  getConnectionLogsCount(backendId: number): number {
    return (this.db.prepare(`SELECT COUNT(*) as count FROM minute_stats WHERE backend_id = ?`).get(backendId) as { count: number }).count;
  }

  getTotalConnectionLogsCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) as count FROM minute_stats`).get() as { count: number }).count;
  }

  vacuum(): void {
    this.db.exec('VACUUM');
  }

  deleteOldMinuteStats(cutoff: string): number {
    const minuteCutoff = cutoff.slice(0, 16) + ':00';
    this.db.prepare(`DELETE FROM minute_dim_stats WHERE minute < ?`).run(minuteCutoff);
    this.db.prepare(`DELETE FROM minute_country_stats WHERE minute < ?`).run(minuteCutoff);
    this.db.prepare(`DELETE FROM connection_logs WHERE timestamp < ?`).run(cutoff);
    // Also clean hourly_dim_stats and hourly_country_stats using the same cutoff (hour granularity)
    const hourCutoff = cutoff.slice(0, 13) + ':00:00';
    this.db.prepare(`DELETE FROM hourly_dim_stats WHERE hour < ?`).run(hourCutoff);
    this.db.prepare(`DELETE FROM hourly_country_stats WHERE hour < ?`).run(hourCutoff);
    return this.db.prepare(`DELETE FROM minute_stats WHERE minute < ?`).run(minuteCutoff).changes;
  }

  deleteOldConnectionLogs(cutoff: string): number {
    return this.deleteOldMinuteStats(cutoff);
  }

  deleteOldHourlyStats(cutoff: string): number {
    return this.db.prepare(`DELETE FROM hourly_stats WHERE hour < ?`).run(cutoff).changes;
  }

  getCleanupStats(): {
    connectionLogsCount: number; hourlyStatsCount: number;
    oldestConnectionLog: string | null; oldestHourlyStat: string | null;
  } {
    return {
      connectionLogsCount: (this.db.prepare('SELECT COUNT(*) as count FROM minute_stats').get() as { count: number }).count,
      hourlyStatsCount: (this.db.prepare('SELECT COUNT(*) as count FROM hourly_stats').get() as { count: number }).count,
      oldestConnectionLog: (this.db.prepare('SELECT MIN(minute) as ts FROM minute_stats').get() as { ts: string | null })?.ts || null,
      oldestHourlyStat: (this.db.prepare('SELECT MIN(hour) as hr FROM hourly_stats').get() as { hr: string | null })?.hr || null,
    };
  }
}
