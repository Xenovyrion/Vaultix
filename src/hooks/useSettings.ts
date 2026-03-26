import { useState, useEffect, useCallback } from "react";
import { applyTheme } from "../themes";
import { type ShortcutMap, DEFAULT_SHORTCUTS } from "../types";

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
  backupNamePattern: string;  // {name} {date} {time} → ex: {date}_{time}_{name}
  // Presse-papiers
  clipboardClearSeconds: number; // 0 = désactivé, sinon délai en secondes
  clipboardClearOnLock: boolean;  // effacer au verrouillage / fermeture
  // Sécurité / comportement
  minimizeOnLock: boolean;           // minimiser la fenêtre au verrouillage
  excludeExpiredFromSearch: boolean; // masquer les expirées dans les résultats
  // Apparence
  zebraStripes: boolean;  // lignes alternées dans la liste
  // Interface
  recentDbsCount: number; // nombre de coffres récents à afficher (3, 5 ou 10)
  systemTrayEnabled: boolean; // afficher l'icône dans la barre système
  // Debug / logs
  debugMode: boolean;  // active l'écriture de logs dans un fichier
  logPath:   string;   // chemin du fichier de log
  // Updates
  autoUpdateEnabled: boolean; // vérifier les mises à jour au démarrage
  // Keyboard shortcuts
  shortcuts: ShortcutMap;
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
  systemTrayEnabled: false,
  debugMode: false,
  logPath:   "",
  autoUpdateEnabled: true,
  shortcuts: DEFAULT_SHORTCUTS,
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
