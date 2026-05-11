import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, createTestBackend } from '../../__tests__/helpers.js';
import type { StatsDatabase } from '../../modules/db/db.js';

describe('TrafficWriterRepository', () => {
  let db: StatsDatabase;
  let cleanup: () => void;
  let backendId: number;

  beforeEach(() => {
    ({ db, cleanup } = createTestDatabase());
    backendId = createTestBackend(db);
  });

  afterEach(() => {
    cleanup();
  });

  describe('updateTrafficStats (single)', () => {
    it('should insert domain, IP, proxy, rule, and hourly stats for a single update', () => {
      db.updateTrafficStats(backendId, {
        domain: 'example.com',
        ip: '1.2.3.4',
        chain: 'ProxyA',
        chains: ['ProxyA', 'RuleA'],
        rule: 'DOMAIN-SUFFIX',
        rulePayload: 'example.com',
        upload: 100,
        download: 200,
        sourceIP: '192.168.1.10',
        timestampMs: Date.now(),
      });

      const domains = db.getDomainStats(backendId, 10);
      expect(domains.length).toBe(1);
      expect(domains[0].domain).toBe('example.com');
      expect(domains[0].totalUpload).toBe(100);
      expect(domains[0].totalDownload).toBe(200);

      const ips = db.getIPStats(backendId, 10);
      expect(ips.length).toBe(1);
      expect(ips[0].ip).toBe('1.2.3.4');

      const proxies = db.getProxyStats(backendId);
      expect(proxies.length).toBeGreaterThanOrEqual(1);

      const rules = db.getRuleStats(backendId);
      expect(rules.length).toBe(1);
    });

    it('should skip zero-traffic updates', () => {
      db.updateTrafficStats(backendId, {
        domain: 'zero.com',
        ip: '0.0.0.0',
        chain: 'DIRECT',
        chains: ['DIRECT'],
        rule: 'Match',
        rulePayload: '',
        upload: 0,
        download: 0,
      });

      const domains = db.getDomainStats(backendId, 10);
      expect(domains.length).toBe(0);
    });

    it('should accumulate traffic for the same domain', () => {
      const base = {
        domain: 'repeat.com',
        ip: '1.1.1.1',
        chain: 'ProxyA',
        chains: ['ProxyA'],
        rule: 'Match',
        rulePayload: '',
      };

      db.updateTrafficStats(backendId, { ...base, upload: 50, download: 100 });
      db.updateTrafficStats(backendId, { ...base, upload: 30, download: 70 });

      const domains = db.getDomainStats(backendId, 10);
      expect(domains.length).toBe(1);
      expect(domains[0].totalUpload).toBe(80);
      expect(domains[0].totalDownload).toBe(170);
      expect(domains[0].totalConnections).toBe(2);
    });

    it('should attach process information to domain stats', () => {
      db.updateTrafficStats(backendId, {
        domain: 'process.example',
        ip: '1.1.1.1',
        chain: 'ProxyA',
        chains: ['ProxyA'],
        rule: 'Match',
        rulePayload: '',
        upload: 40,
        download: 60,
        process: 'Safari',
        processPath: '/Applications/Safari.app/Contents/MacOS/Safari',
      });

      const domains = db.getDomainStats(backendId, 10);
      expect(domains[0].processes).toEqual([
        {
          process: 'Safari',
          processPath: '/Applications/Safari.app/Contents/MacOS/Safari',
          totalUpload: 40,
          totalDownload: 60,
          totalConnections: 1,
          lastSeen: expect.any(String),
        },
      ]);
    });
  });

  describe('batchUpdateTrafficStats', () => {
    it('should write all dimensions for a batch of updates', () => {
      const updates = [
        {
          domain: 'a.com',
          ip: '10.0.0.1',
          chain: 'ProxyA',
          chains: ['ProxyA', 'GeoIP'],
          rule: 'DOMAIN',
          rulePayload: 'a.com',
          upload: 100,
          download: 200,
          sourceIP: '192.168.1.1',
          timestampMs: Date.now(),
        },
        {
          domain: 'b.com',
          ip: '10.0.0.2',
          chain: 'ProxyB',
          chains: ['ProxyB', 'Match'],
          rule: 'Match',
          rulePayload: '',
          upload: 50,
          download: 150,
          sourceIP: '192.168.1.2',
          timestampMs: Date.now(),
        },
      ];

      db.batchUpdateTrafficStats(backendId, updates);

      // Verify domain stats
      const domains = db.getDomainStats(backendId, 10);
      expect(domains.length).toBe(2);
      const domainNames = domains.map(d => d.domain).sort();
      expect(domainNames).toEqual(['a.com', 'b.com']);

      // Verify IP stats
      const ips = db.getIPStats(backendId, 10);
      expect(ips.length).toBe(2);

      // Verify proxy stats
      const proxies = db.getProxyStats(backendId);
      expect(proxies.length).toBeGreaterThanOrEqual(2);

      // Verify device stats
      const devices = db.getDevices(backendId, 10);
      expect(devices.length).toBe(2);

      // Verify summary
      const summary = db.getSummary(backendId);
      expect(summary.totalUpload).toBe(150);
      expect(summary.totalDownload).toBe(350);
    });

    it('should correctly aggregate same-domain updates within a batch', () => {
      const now = Date.now();
      const updates = Array.from({ length: 5 }, (_unused, _i) => ({
        domain: 'same.com',
        ip: '1.1.1.1',
        chain: 'ProxyA',
        chains: ['ProxyA'],
        rule: 'Match',
        rulePayload: '',
        upload: 10,
        download: 20,
        sourceIP: '192.168.1.1',
        timestampMs: now,
      }));

      db.batchUpdateTrafficStats(backendId, updates);

      const domains = db.getDomainStats(backendId, 10);
      expect(domains.length).toBe(1);
      expect(domains[0].totalUpload).toBe(50);
      expect(domains[0].totalDownload).toBe(100);
    });

    it('should handle empty batch gracefully', () => {
      expect(() => db.batchUpdateTrafficStats(backendId, [])).not.toThrow();
    });

    it('should filter out zero-traffic entries', () => {
      db.batchUpdateTrafficStats(backendId, [
        {
          domain: 'zero.com',
          ip: '0.0.0.0',
          chain: 'DIRECT',
          chains: ['DIRECT'],
          rule: 'Match',
          rulePayload: '',
          upload: 0,
          download: 0,
          timestampMs: Date.now(),
        },
      ]);

      const summary = db.getSummary(backendId);
      expect(summary.totalUpload).toBe(0);
      expect(summary.totalDownload).toBe(0);
    });

    it('should write minute_stats correctly', () => {
      const now = Date.now();
      db.batchUpdateTrafficStats(backendId, [
        {
          domain: 'minute.com',
          ip: '1.1.1.1',
          chain: 'ProxyA',
          chains: ['ProxyA'],
          rule: 'Match',
          rulePayload: '',
          upload: 100,
          download: 200,
          timestampMs: now,
        },
      ]);

      const trend = db.getTrafficTrend(backendId, 60);
      expect(trend.length).toBeGreaterThanOrEqual(1);
      const total = trend.reduce((sum, t) => sum + t.upload + t.download, 0);
      expect(total).toBe(300);
    });

    it('should respect explicit connection deltas for continuous traffic', () => {
      const now = Date.now();
      const base = {
        domain: 'stream.example',
        ip: '9.9.9.9',
        chain: 'ProxyA',
        chains: ['ProxyA', 'Match'],
        rule: 'Match',
        rulePayload: '',
        sourceIP: '192.168.1.30',
      };

      db.batchUpdateTrafficStats(backendId, [
        {
          ...base,
          upload: 100,
          download: 200,
          connections: 1,
          timestampMs: now,
        },
        {
          ...base,
          upload: 50,
          download: 80,
          connections: 0,
          timestampMs: now + 1000,
        },
      ]);

      const domains = db.getDomainStats(backendId, 10);
      expect(domains.length).toBe(1);
      expect(domains[0].totalUpload).toBe(150);
      expect(domains[0].totalDownload).toBe(280);
      expect(domains[0].totalConnections).toBe(1);

      const summary = db.getSummary(backendId);
      expect(summary.totalConnections).toBe(1);
    });

    it('should aggregate domain processes for time-range domain queries', () => {
      const now = Date.now();
      db.batchUpdateTrafficStats(backendId, [
        {
          domain: 'range-process.example',
          ip: '8.8.8.8',
          chain: 'ProxyA',
          chains: ['ProxyA'],
          rule: 'Match',
          rulePayload: '',
          upload: 100,
          download: 200,
          connections: 1,
          process: 'curl',
          processPath: '/usr/bin/curl',
          timestampMs: now,
        },
        {
          domain: 'range-process.example',
          ip: '8.8.8.8',
          chain: 'ProxyA',
          chains: ['ProxyA'],
          rule: 'Match',
          rulePayload: '',
          upload: 30,
          download: 70,
          connections: 0,
          process: 'curl',
          processPath: '/usr/bin/curl',
          timestampMs: now + 1000,
        },
      ]);

      const result = db.getDomainStatsPaginated(backendId, {
        start: new Date(now - 60_000).toISOString(),
        end: new Date(now + 60_000).toISOString(),
      });

      expect(result.data[0].domain).toBe('range-process.example');
      expect(result.data[0].processes?.[0]).toMatchObject({
        process: 'curl',
        processPath: '/usr/bin/curl',
        totalUpload: 130,
        totalDownload: 270,
        totalConnections: 1,
      });
    });

    it('should aggregate process-centered drilldowns', () => {
      const now = Date.now();
      db.batchUpdateTrafficStats(backendId, [
        {
          domain: 'process.example',
          ip: '1.1.1.1',
          chain: 'ProxyA',
          chains: ['ProxyA', 'Match'],
          rule: 'Match',
          rulePayload: '',
          upload: 120,
          download: 280,
          connections: 1,
          sourceIP: '192.168.1.20',
          process: 'curl',
          processPath: '/usr/bin/curl',
          timestampMs: now,
        },
        {
          domain: 'api.process.example',
          ip: '1.0.0.1',
          chain: 'ProxyB',
          chains: ['ProxyB', 'RuleSet'],
          rule: 'RuleSet',
          rulePayload: 'dev',
          upload: 80,
          download: 120,
          connections: 2,
          sourceIP: '192.168.1.20',
          process: 'curl',
          processPath: '/usr/bin/curl',
          timestampMs: now + 1000,
        },
      ]);

      const start = new Date(now - 60_000).toISOString();
      const end = new Date(now + 60_000).toISOString();
      const processes = db.getProcessStats(backendId, 10, start, end);

      expect(processes[0]).toMatchObject({
        process: 'curl',
        processPath: '/usr/bin/curl',
        totalUpload: 200,
        totalDownload: 400,
        totalConnections: 3,
      });
      expect(processes[0].domains).toEqual(expect.arrayContaining(['process.example', 'api.process.example']));
      expect(processes[0].ips).toEqual(expect.arrayContaining(['1.1.1.1', '1.0.0.1']));
      expect(processes[0].rules).toEqual(expect.arrayContaining(['Match', 'RuleSet']));
      expect(processes[0].chains).toEqual(expect.arrayContaining(['ProxyA > Match', 'ProxyB > RuleSet']));

      expect(db.getProcessDomains(backendId, 'curl', '/usr/bin/curl', 10, start, end)).toHaveLength(2);
      expect(db.getProcessIPs(backendId, 'curl', '/usr/bin/curl', 10, start, end)).toHaveLength(2);
      expect(db.getProcessRules(backendId, 'curl', '/usr/bin/curl', 10, start, end)).toHaveLength(2);
      expect(db.getProcessProxies(backendId, 'curl', '/usr/bin/curl', 10, start, end)).toHaveLength(2);
    });
  });
});
