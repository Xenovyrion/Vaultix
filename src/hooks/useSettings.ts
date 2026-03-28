import { useState, useEffect, useCallback } from "react";
import { applyTheme } from "../themes";
import { type ShortcutMap, DEFAULT_SHORTCUTS, type CipherType } from "../types";

export interface AppSettings {
  themeId: string;
  customThemeVars: Record<string, string>;
  lockTimeoutMinutes: number; // 0 = never
  customCategories: string[];
  tagColors: Record<string, string>; // tag name → hex color
  kdfMemory: number;    // Argon2 memory in KiB (default 65536 = 64 MiB)
  kdfTime: number;      // Argon2 time cost (default 3)
  compression: boolean; // gzip before encryption
  // Backup
  backupEnabled: boolean;
  backupPath: string;
  backupMaxCount: number; // 0 = unlimited
  backupIntervalHours: number; // in hours (0.5 = 30 min)
  backupNamePattern: string;  // {name} {date} {time} → e.g. {date}_{time}_{name}
  // Clipboard
  clipboardClearSeconds: number; // 0 = disabled, delay in seconds
  clipboardClearOnLock: boolean;  // clear on lock / close
  // Security / behaviour
  minimizeOnLock: boolean;           // minimize window on lock
  excludeExpiredFromSearch: boolean; // hide expired entries from search results
  // Appearance
  zebraStripes: boolean;  // alternating rows in the list
  // Interface
  recentDbsCount: number; // number of recent vaults to display (3, 5 or 10)
  language: string;       // "" = use OS language (auto), otherwise "fr"|"en"|"es"|"de"
  // Debug / logs
  debugMode: boolean;  // enables log file writing
  logPath:   string;   // path to the log file
  // Keyboard shortcuts
  shortcuts: ShortcutMap;
  // Preferred cipher for new vaults (can be changed on an open vault)
  preferredCipher: CipherType;
}

const STORAGE_KEY = "vaultix_settings_v1";

export const DEFAULT_SETTINGS: AppSettings = {
  themeId: "dark",
  customThemeVars: {},
  lockTimeoutMinutes: 60,
  customCategories: [],
  tagColors: { "Travail": "#3b82f6", "Personnel": "#10b981", "Social": "#f59e0b" },
  kdfMemory: 65536,
  kdfTime: 3,
  compression: true,
  backupEnabled: false,
  backupPath: "",
  backupMaxCount: 10,
  backupIntervalHours: 24,
  backupNamePattern: "{date}_{time}_{name}",
  clipboardClearSeconds: 30,
  clipboardClearOnLock: true,
  minimizeOnLock: true,
  excludeExpiredFromSearch: true,
  zebraStripes: true,
  recentDbsCount: 5,
  language: "",
  debugMode: false,
  logPath:   "",
  shortcuts: DEFAULT_SHORTCUTS,
  preferredCipher: "aes-256-gcm",
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          // Deep-merge tagColors: default colours are applied only for tags that have no stored colour
          tagColors: { ...DEFAULT_SETTINGS.tagColors, ...(parsed.tagColors ?? {}) },
        };
      }
    } catch {}
    return { ...DEFAULT_SETTINGS };
  });

  // Apply theme whenever it changes
  useEffect(() => {
    applyTheme(settings.themeId, settings.customThemeVars);
  }, [settings.themeId, settings.customThemeVars]);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { settings, updateSettings };
}
