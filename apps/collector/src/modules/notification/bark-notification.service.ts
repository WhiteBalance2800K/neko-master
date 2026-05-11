import type { BarkNotificationConfig, StatsDatabase } from '../db/db.js';

type BarkMetric = 'total' | 'upload' | 'download';

const CHECK_INTERVAL_MS = Math.max(
  10_000,
  Number.parseInt(process.env.BARK_NOTIFY_CHECK_INTERVAL_MS || '60000', 10) || 60_000,
);

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function normalizeBarkBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, '');
}

function buildBarkUrl(baseUrl: string, title: string, body: string): string {
  return `${normalizeBarkBaseUrl(baseUrl)}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
}

function lastNotifiedAt(config: BarkNotificationConfig, metric: BarkMetric): string | undefined {
  if (metric === 'total') return config.lastTotalNotifiedAt;
  if (metric === 'upload') return config.lastUploadNotifiedAt;
  return config.lastDownloadNotifiedAt;
}

function lastThreshold(config: BarkNotificationConfig, metric: BarkMetric): number {
  if (metric === 'total') return config.lastTotalThresholdBytes;
  if (metric === 'upload') return config.lastUploadThresholdBytes;
  return config.lastDownloadThresholdBytes;
}

export class BarkNotificationService {
  private timer: NodeJS.Timeout | null = null;
  private checking = false;

  constructor(private db: StatsDatabase) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.checkThresholds();
    }, CHECK_INTERVAL_MS);
    this.timer.unref?.();
    void this.checkThresholds();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async sendTest(): Promise<void> {
    const config = this.db.getBarkNotificationConfig();
    if (!config.serverUrl.trim()) {
      throw new Error('Bark server URL is required');
    }
    await this.send(config.serverUrl, 'Neko Master 测试通知', 'Bark 推送已连接。');
  }

  private async checkThresholds(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const config = this.db.getBarkNotificationConfig();
      if (!config.enabled || !config.serverUrl.trim()) return;

      const backend = config.backendId ? this.db.getBackend(config.backendId) : null;
      if (config.backendId && !backend) return;

      const summary = config.backendId
        ? this.db.getSummary(config.backendId)
        : this.db.getGlobalSummary();
      const scopeLabel = backend ? `（${backend.name}）` : '';
      const values: Record<BarkMetric, number> = {
        total: summary.totalUpload + summary.totalDownload,
        upload: summary.totalUpload,
        download: summary.totalDownload,
      };
      const thresholds: Record<BarkMetric, number> = {
        total: config.totalThresholdBytes,
        upload: config.uploadThresholdBytes,
        download: config.downloadThresholdBytes,
      };

      for (const metric of ['total', 'upload', 'download'] as const) {
        const threshold = thresholds[metric];
        const value = values[metric];
        if (!threshold || value < threshold) continue;
        if (!this.shouldNotify(config, metric, threshold)) continue;

        const label = metric === 'total' ? '总流量' : metric === 'upload' ? '上传流量' : '下载流量';
        await this.send(
          config.serverUrl,
          `Neko Master ${label}提醒`,
          `${label}${scopeLabel}已达到 ${formatBytes(value)}，阈值 ${formatBytes(threshold)}。`,
        );
        this.db.markBarkNotificationSent(metric, threshold);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[BarkNotification] ${message}`);
    } finally {
      this.checking = false;
    }
  }

  private shouldNotify(config: BarkNotificationConfig, metric: BarkMetric, threshold: number): boolean {
    if (lastThreshold(config, metric) !== threshold) return true;

    const lastAt = lastNotifiedAt(config, metric);
    if (!lastAt) return true;

    const lastMs = new Date(lastAt).getTime();
    if (!Number.isFinite(lastMs)) return true;

    const cooldownMs = Math.max(1, config.cooldownMinutes) * 60_000;
    return Date.now() - lastMs >= cooldownMs;
  }

  private async send(serverUrl: string, title: string, body: string): Promise<void> {
    const response = await fetch(buildBarkUrl(serverUrl, title, body), {
      method: 'GET',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`Bark push failed: HTTP ${response.status}`);
    }
  }
}
