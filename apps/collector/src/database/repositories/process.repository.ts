/**
 * Process Repository
 *
 * Handles source-process statistics and process-centered drilldowns.
 */
import type Database from 'better-sqlite3';
import type {
  DomainStats,
  IPStats,
  ProcessStats,
  ProxyStats,
  RuleStats,
} from '@neko-master/shared';
import { BaseRepository } from './base.repository.js';

type ProcessFilter = {
  process: string;
  processPath?: string;
};

export class ProcessRepository extends BaseRepository {
  constructor(db: Database.Database) {
    super(db);
  }

  private resolveProcessFactTable(
    start?: string,
    end?: string,
  ): { table: 'hourly_process_dim_stats' | 'minute_process_dim_stats'; timeCol: 'hour' | 'minute'; startKey?: string; endKey?: string } {
    if (!start || !end) {
      return { table: 'minute_process_dim_stats', timeCol: 'minute' };
    }

    const resolved = this.resolveFactTable(start, end);
    return {
      table: resolved.table === 'hourly_dim_stats' ? 'hourly_process_dim_stats' : 'minute_process_dim_stats',
      timeCol: resolved.timeCol,
      startKey: resolved.startKey,
      endKey: resolved.endKey,
    };
  }

  private splitList(value: string | null | undefined): string[] {
    if (!value) return [];
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }

  private processWhere(filter: ProcessFilter): { clause: string; params: string[] } {
    const process = filter.process.trim();
    const processPath = filter.processPath?.trim();
    if (processPath !== undefined && processPath.length > 0) {
      return {
        clause: 'process = ? AND process_path = ?',
        params: [process, processPath],
      };
    }
    return {
      clause: 'process = ?',
      params: [process],
    };
  }

  private normalizeProcessRows(rows: Array<ProcessStats & {
    domains?: string | string[];
    ips?: string | string[];
    rules?: string | string[];
    chains?: string | string[];
  }>): ProcessStats[] {
    return rows.map(row => ({
      process: row.process,
      processPath: row.processPath || undefined,
      totalUpload: Number(row.totalUpload || 0),
      totalDownload: Number(row.totalDownload || 0),
      totalConnections: Number(row.totalConnections || 0),
      lastSeen: row.lastSeen || '',
      domains: Array.isArray(row.domains) ? row.domains : this.splitList(row.domains),
      ips: Array.isArray(row.ips) ? row.ips : this.splitList(row.ips),
      rules: Array.isArray(row.rules) ? row.rules : this.splitList(row.rules),
      chains: Array.isArray(row.chains) ? row.chains : this.splitList(row.chains),
    }));
  }

  getProcessStats(backendId: number, limit = 50, start?: string, end?: string): ProcessStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveProcessFactTable(start, end);
      const stmt = this.db.prepare(`
        SELECT
          process,
          process_path as processPath,
          SUM(upload) as totalUpload,
          SUM(download) as totalDownload,
          SUM(connections) as totalConnections,
          MAX(${resolved.timeCol}) as lastSeen,
          GROUP_CONCAT(DISTINCT CASE WHEN domain != '' THEN domain END) as domains,
          GROUP_CONCAT(DISTINCT CASE WHEN ip != '' THEN ip END) as ips,
          GROUP_CONCAT(DISTINCT CASE WHEN rule != '' THEN rule END) as rules,
          GROUP_CONCAT(DISTINCT CASE WHEN chain != '' THEN chain END) as chains
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ?
          AND (process != '' OR process_path != '')
        GROUP BY process, process_path
        ORDER BY (SUM(upload) + SUM(download)) DESC
        LIMIT ?
      `);
      const rows = stmt.all(backendId, resolved.startKey, resolved.endKey, limit) as any[];
      return this.normalizeProcessRows(rows);
    }

    const stmt = this.db.prepare(`
      SELECT
        process,
        process_path as processPath,
        total_upload as totalUpload,
        total_download as totalDownload,
        total_connections as totalConnections,
        last_seen as lastSeen,
        domains,
        ips,
        rules,
        chains
      FROM process_stats
      WHERE backend_id = ?
      ORDER BY (total_upload + total_download) DESC
      LIMIT ?
    `);
    return this.normalizeProcessRows(stmt.all(backendId, limit) as any[]);
  }

  getProcessDomains(
    backendId: number,
    filter: ProcessFilter,
    limit = 5000,
    start?: string,
    end?: string,
  ): DomainStats[] {
    const range = this.parseMinuteRange(start, end);
    if (range) {
      const resolved = this.resolveProcessFactTable(start, end);
      const where = this.processWhere(filter);
      const stmt = this.db.prepare(`
        SELECT
          domain,
          SUM(upload) as totalUpload,
          SUM(download) as totalDownload,
          SUM(connections) as totalConnections,
          MAX(${resolved.timeCol}) as lastSeen,
          GROUP_CONCAT(DISTINCT CASE WHEN ip != '' THEN ip END) as ips,
          GROUP_CONCAT(DISTINCT CASE WHEN rule != '' THEN rule END) as rules,
          GROUP_CONCAT(DISTINCT CASE WHEN chain != '' THEN chain END) as chains
        FROM ${resolved.table}
        WHERE backend_id = ? AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ?
          AND ${where.clause} AND domain != ''
        GROUP BY domain
        ORDER BY (SUM(upload) + SUM(download)) DESC
        LIMIT ?
      `);
      const rows = stmt.all(backendId, resolved.startKey, resolved.endKey, ...where.params, limit) as any[];
      return rows.map(row => ({
        ...row,
        ips: this.splitList(row.ips),
        rules: this.splitList(row.rules),
        chains: this.expandShortChainsForRules(backendId, this.splitList(row.chains), this.splitList(row.rules)),
        processes: [{
          process: filter.process,
          processPath: filter.processPath || undefined,
          totalUpload: row.totalUpload,
          totalDownload: row.totalDownload,
          totalConnections: row.totalConnections,
          lastSeen: row.lastSeen,
        }],
      })) as DomainStats[];
    }

    const where = this.processWhere(filter);
    const stmt = this.db.prepare(`
      SELECT
        p.domain,
        p.total_upload as totalUpload,
        p.total_download as totalDownload,
        p.total_connections as totalConnections,
        p.last_seen as lastSeen,
        d.ips,
        d.rules,
        d.chains
      FROM domain_process_stats p
      LEFT JOIN domain_stats d ON d.backend_id = p.backend_id AND d.domain = p.domain
      WHERE p.backend_id = ? AND ${where.clause}
      ORDER BY (p.total_upload + p.total_download) DESC
      LIMIT ?
    `);
    const rows = stmt.all(backendId, ...where.params, limit) as any[];
    return rows.map(row => ({
      ...row,
      ips: this.splitList(row.ips),
      rules: this.splitList(row.rules),
      chains: this.expandShortChainsForRules(backendId, this.splitList(row.chains), this.splitList(row.rules)),
      processes: [{
        process: filter.process,
        processPath: filter.processPath || undefined,
        totalUpload: row.totalUpload,
        totalDownload: row.totalDownload,
        totalConnections: row.totalConnections,
        lastSeen: row.lastSeen,
      }],
    })) as DomainStats[];
  }

  getProcessIPs(
    backendId: number,
    filter: ProcessFilter,
    limit = 5000,
    start?: string,
    end?: string,
  ): IPStats[] {
    const resolved = this.resolveProcessFactTable(start, end);
    const where = this.processWhere(filter);
    const timeClause = resolved.startKey && resolved.endKey
      ? `AND p.${resolved.timeCol} >= ? AND p.${resolved.timeCol} <= ?`
      : '';
    const timeParams = resolved.startKey && resolved.endKey ? [resolved.startKey, resolved.endKey] : [];
    const stmt = this.db.prepare(`
      SELECT
        p.ip,
        SUM(p.upload) as totalUpload,
        SUM(p.download) as totalDownload,
        SUM(p.connections) as totalConnections,
        MAX(p.${resolved.timeCol}) as lastSeen,
        GROUP_CONCAT(DISTINCT CASE WHEN p.domain != '' THEN p.domain END) as domains,
        COALESCE(i.asn, g.asn) as asn,
        CASE WHEN g.country IS NOT NULL THEN json_array(g.country, COALESCE(g.country_name, g.country), COALESCE(g.city, ''), COALESCE(g.as_name, ''))
             WHEN i.geoip IS NOT NULL THEN json(i.geoip) ELSE NULL END as geoIP,
        GROUP_CONCAT(DISTINCT CASE WHEN p.chain != '' THEN p.chain END) as chains,
        GROUP_CONCAT(DISTINCT CASE WHEN p.rule != '' THEN p.rule END) as rules
      FROM ${resolved.table} p
      LEFT JOIN ip_stats i ON i.backend_id = p.backend_id AND i.ip = p.ip
      LEFT JOIN geoip_cache g ON g.ip = p.ip
      WHERE p.backend_id = ? ${timeClause} AND ${where.clause} AND p.ip != ''
      GROUP BY p.ip
      ORDER BY (SUM(p.upload) + SUM(p.download)) DESC
      LIMIT ?
    `);
    const rows = stmt.all(backendId, ...timeParams, ...where.params, limit) as any[];
    return rows.map(row => ({
      ...row,
      domains: this.splitList(row.domains),
      geoIP: row.geoIP ? JSON.parse(row.geoIP).filter(Boolean) : undefined,
      asn: row.asn || undefined,
      chains: this.expandShortChainsForRules(backendId, this.splitList(row.chains), this.splitList(row.rules)),
    })) as IPStats[];
  }

  getProcessRules(
    backendId: number,
    filter: ProcessFilter,
    limit = 5000,
    start?: string,
    end?: string,
  ): RuleStats[] {
    const resolved = this.resolveProcessFactTable(start, end);
    const where = this.processWhere(filter);
    const timeClause = resolved.startKey && resolved.endKey
      ? `AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ?`
      : '';
    const timeParams = resolved.startKey && resolved.endKey ? [resolved.startKey, resolved.endKey] : [];
    const stmt = this.db.prepare(`
      SELECT
        rule,
        chain as finalProxy,
        SUM(upload) as totalUpload,
        SUM(download) as totalDownload,
        SUM(connections) as totalConnections,
        MAX(${resolved.timeCol}) as lastSeen
      FROM ${resolved.table}
      WHERE backend_id = ? ${timeClause} AND ${where.clause} AND rule != ''
      GROUP BY rule
      ORDER BY (SUM(upload) + SUM(download)) DESC
      LIMIT ?
    `);
    return stmt.all(backendId, ...timeParams, ...where.params, limit) as RuleStats[];
  }

  getProcessProxies(
    backendId: number,
    filter: ProcessFilter,
    limit = 5000,
    start?: string,
    end?: string,
  ): ProxyStats[] {
    const resolved = this.resolveProcessFactTable(start, end);
    const where = this.processWhere(filter);
    const timeClause = resolved.startKey && resolved.endKey
      ? `AND ${resolved.timeCol} >= ? AND ${resolved.timeCol} <= ?`
      : '';
    const timeParams = resolved.startKey && resolved.endKey ? [resolved.startKey, resolved.endKey] : [];
    const stmt = this.db.prepare(`
      SELECT
        chain,
        SUM(upload) as totalUpload,
        SUM(download) as totalDownload,
        SUM(connections) as totalConnections,
        MAX(${resolved.timeCol}) as lastSeen
      FROM ${resolved.table}
      WHERE backend_id = ? ${timeClause} AND ${where.clause} AND chain != ''
      GROUP BY chain
      ORDER BY (SUM(upload) + SUM(download)) DESC
      LIMIT ?
    `);
    return stmt.all(backendId, ...timeParams, ...where.params, limit) as ProxyStats[];
  }
}
