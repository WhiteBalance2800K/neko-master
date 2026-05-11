import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type ByteUnit = "B" | "KB" | "MB" | "GB" | "TB" | "PB";

const BYTE_UNITS: ByteUnit[] = ["B", "KB", "MB", "GB", "TB", "PB"];
const BYTE_UNIT_INDEX = new Map<ByteUnit, number>(
  BYTE_UNITS.map((unit, index) => [unit, index]),
);

let preferredTrafficUnit: ByteUnit | null = null;

function getByteUnit(bytes: number): ByteUnit {
  if (!Number.isFinite(bytes) || bytes <= 0) return "B";
  const exponent = Math.log(bytes) / Math.log(1024);
  const rawIndex = Number.isFinite(exponent) ? Math.floor(exponent) : 0;
  const index = rawIndex < 0 ? 0 : Math.min(rawIndex, BYTE_UNITS.length - 1);
  return BYTE_UNITS[index] ?? "B";
}

function normalizePreferredTrafficUnit(unit: ByteUnit): ByteUnit | null {
  const index = BYTE_UNIT_INDEX.get(unit) ?? 0;
  return index >= (BYTE_UNIT_INDEX.get("MB") ?? 2) ? unit : null;
}

export function setPreferredTrafficUnitFromValues(values: number[]): ByteUnit | null {
  const totals = values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a);

  if (totals.length === 0) {
    preferredTrafficUnit = null;
    return preferredTrafficUnit;
  }

  const firstUnit = getByteUnit(totals[0]);
  const secondUnit = totals.length > 1 ? getByteUnit(totals[1]) : firstUnit;
  const comparisonUnit = totals.length > 1 && firstUnit === secondUnit ? secondUnit : firstUnit;
  preferredTrafficUnit = normalizePreferredTrafficUnit(comparisonUnit);
  return preferredTrafficUnit;
}

export function formatBytes(bytes: number, decimals = 2): string {
  const normalizedBytes = Number(bytes);
  const forcedUnit = preferredTrafficUnit;
  if (!Number.isFinite(normalizedBytes) || normalizedBytes === 0) {
    return forcedUnit ? `0 ${forcedUnit}` : "0 B";
  }
  if (normalizedBytes < 0) return `-${formatBytes(-normalizedBytes, decimals)}`;

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const autoUnit = getByteUnit(normalizedBytes);
  const unit = forcedUnit ?? autoUnit;
  const i = BYTE_UNIT_INDEX.get(unit) ?? 0;
  const scaled = normalizedBytes / Math.pow(k, i);
  const safeScaled = Number.isFinite(scaled) ? scaled : 0;

  return `${parseFloat(safeScaled.toFixed(dm))} ${unit}`;
}

export function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

function parseApiTimestamp(dateString: string): Date {
  const raw = (dateString || "").trim();
  if (!raw) return new Date(Number.NaN);

  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
  if (hasTimezone) {
    return new Date(raw);
  }

  // Range-query rows may return minute keys like "2026-02-08T13:21:00"
  // without timezone info. Treat them as UTC to avoid local-time offsets.
  const isoNoTimezone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw);
  if (isoNoTimezone) {
    return new Date(`${raw}Z`);
  }

  // SQLite CURRENT_TIMESTAMP style: "YYYY-MM-DD HH:MM:SS"
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw);
  if (sqliteUtc) {
    return new Date(raw.replace(" ", "T") + "Z");
  }

  return new Date(raw);
}

export function formatDuration(dateString: string): string {
  const date = parseApiTimestamp(dateString);
  if (Number.isNaN(date.getTime())) return "-";

  const now = new Date();
  const diff = Math.max(0, now.getTime() - date.getTime());

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}
