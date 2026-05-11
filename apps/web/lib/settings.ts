"use client";

import { useCallback, useSyncExternalStore } from "react";

export type FaviconProvider = "google" | "faviconim" | "off";
export type RadixColorName =
  | "blue"
  | "indigo"
  | "violet"
  | "purple"
  | "cyan"
  | "teal"
  | "green"
  | "amber"
  | "orange"
  | "red"
  | "pink"
  | "slate";

export interface RadixColorOption {
  name: RadixColorName;
  label: string;
  value: string;
}

export const RADIX_COLOR_OPTIONS: RadixColorOption[] = [
  { name: "blue", label: "Blue", value: "#0090ff" },
  { name: "indigo", label: "Indigo", value: "#3e63dd" },
  { name: "violet", label: "Violet", value: "#6e56cf" },
  { name: "purple", label: "Purple", value: "#8e4ec6" },
  { name: "cyan", label: "Cyan", value: "#00a2c7" },
  { name: "teal", label: "Teal", value: "#12a594" },
  { name: "green", label: "Green", value: "#30a46c" },
  { name: "amber", label: "Amber", value: "#ffb224" },
  { name: "orange", label: "Orange", value: "#f76808" },
  { name: "red", label: "Red", value: "#e5484d" },
  { name: "pink", label: "Pink", value: "#d6409f" },
  { name: "slate", label: "Slate", value: "#8b8d98" },
];

export interface UserSettings {
  faviconProvider: FaviconProvider;
  backgroundColor: RadixColorName;
  uploadColor: RadixColorName;
  downloadColor: RadixColorName;
}

const DEFAULT_SETTINGS: UserSettings = {
  faviconProvider: "faviconim",
  backgroundColor: "blue",
  uploadColor: "violet",
  downloadColor: "blue",
};

const STORAGE_KEY = "neko-master-settings";

// Cached settings for sync access
let cachedSettings: UserSettings = DEFAULT_SETTINGS;
let isClient = false;

// Initialize cache (only runs once)
function initCache() {
  if (typeof window === "undefined") return;
  isClient = true;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      cachedSettings = { ...DEFAULT_SETTINGS, ...parsed };
    }
    applyAppearanceSettings(cachedSettings);
  } catch {
    // Ignore parse errors
  }
}

function resolveColor(name: RadixColorName | undefined): string {
  return (
    RADIX_COLOR_OPTIONS.find((color) => color.name === name)?.value ||
    RADIX_COLOR_OPTIONS[0].value
  );
}

export function applyAppearanceSettings(settings: UserSettings): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const background = resolveColor(settings.backgroundColor);
  const upload = resolveColor(settings.uploadColor);
  const download = resolveColor(settings.downloadColor);

  root.style.setProperty("--user-bg-accent", background);
  root.style.setProperty("--traffic-upload", upload);
  root.style.setProperty("--traffic-download", download);
  root.style.setProperty("--traffic-total", resolveColor("pink"));
  root.style.setProperty("--app-bg-tint", background);
  root.style.setProperty("--app-surface-tint", background);
}

// Get settings from cache (sync, returns same reference if unchanged)
function getCachedSettings(): UserSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }
  if (!isClient) {
    initCache();
  }
  return cachedSettings;
}

// Get settings from localStorage (force refresh)
export function getSettings(): UserSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const settings = { ...DEFAULT_SETTINGS, ...parsed };
      cachedSettings = settings; // Update cache
      return settings;
    }
  } catch {
    // Ignore parse errors
  }
  
  return DEFAULT_SETTINGS;
}

// Save settings to localStorage
export function saveSettings(settings: Partial<UserSettings>): void {
  if (typeof window === "undefined") {
    return;
  }
  
  try {
    const current = getSettings();
    const updated = { ...current, ...settings };
    cachedSettings = updated; // Update cache immediately
    applyAppearanceSettings(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    
    // Dispatch event to notify components
    window.dispatchEvent(new CustomEvent("settings-changed", { detail: updated }));
  } catch {
    // Ignore storage errors
  }
}

// Subscribe to settings changes
function subscribe(callback: () => void) {
  const handler = () => {
    // Update cache when settings change
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        cachedSettings = { ...DEFAULT_SETTINGS, ...parsed };
        applyAppearanceSettings(cachedSettings);
      }
    } catch {
      // Ignore parse errors
    }
    callback();
  };
  window.addEventListener("settings-changed", handler);
  return () => window.removeEventListener("settings-changed", handler);
}

// Snapshot function that returns cached value (must be same reference if unchanged)
function getSnapshot(): UserSettings {
  return getCachedSettings();
}

// Server snapshot
function getServerSnapshot(): UserSettings {
  return DEFAULT_SETTINGS;
}

// React hook for settings using useSyncExternalStore for instant sync
export function useSettings() {
  // useSyncExternalStore already returns a stable snapshot reference;
  // it only changes when the subscribe callback fires and getSnapshot
  // returns a different value (cachedSettings is replaced in saveSettings).
  const settings = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  const setSettings = useCallback((newSettings: Partial<UserSettings>) => {
    saveSettings(newSettings);
  }, []);

  return { settings, setSettings, mounted: true };
}

// Generate favicon URL based on provider
export function getFaviconUrl(domain: string, provider: FaviconProvider): string {
  if (provider === "off") {
    return "";
  }
  const cleanDomain = domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];

  switch (provider) {
    case "faviconim":
      return `https://favicon.im/${encodeURIComponent(cleanDomain)}?larger=true`;
    case "google":
    default:
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(cleanDomain)}&sz=128`;
  }
}
