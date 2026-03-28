import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type PasswordEntry, type DatabaseMeta, type EntryType, STRENGTH_COLORS, DEFAULT_SHORTCUTS, parseShortcut } from "../types";
import { type AppSettings } from "../hooks/useSettings";
import { detectProtocol, getDisplayHost } from "../utils/protocol";
import EntryPanel from "./EntryPanel";
import GeneratorModal from "./GeneratorModal";
import SettingsPanel from "./SettingsPanel";
import UpdateModal from "./UpdateModal";
import ChangelogModal from "./ChangelogModal";

interface Props {
  dbMeta: DatabaseMeta;
  dbPath: string;
  settings: AppSettings;
  onSettingsChange: (s: Partial<AppSettings>) => void;
  onLock: () => void;
  onClose: () => void;
}

type Category = "all" | "favorites" | "reused" | "expired" | string;
type SortField = "title" | "username" | "url" | "updated_at" | "strength";
type SortDir = "asc" | "desc";

interface ContextMenu {
  x: number;
  y: number;
  entry: PasswordEntry;
}

interface FolderNode { name: string; path: string; children: FolderNode[]; }

const DEFAULT_CATEGORIES = ["Travail", "Personnel", "Social"];

// Pure helper — defined outside component so it never causes re-renders
const entryMatchesTag = (e: PasswordEntry, cat: string) =>
  e.tags.includes(cat) || e.category === cat;

// Protocol type display metadata — kept in sync with ENTRY_TYPES in EntryPanel
const TYPE_META: Record<string, { label: string; color: string }> = {
  login:  { label: "Web",    color: "#3b82f6" },
  rdp:    { label: "RDP",    color: "#0078d4" },
  ssh:    { label: "SSH",    color: "#16a34a" },
  ftp:    { label: "FTP",    color: "#ea580c" },
  sftp:   { label: "SFTP",   color: "#0891b2" },
  vnc:    { label: "VNC",    color: "#7c3aed" },
  telnet:     { label: "Telnet",      color: "#dc2626" },
  teamviewer: { label: "TeamViewer",  color: "#0066cc" },
  other:      { label: "Other",       color: "#64748b" },
  note:       { label: "Note",        color: "#f59e0b" },
};

export default function Vault({ dbMeta, dbPath, settings, onSettingsChange, onLock, onClose }: Props) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<PasswordEntry[]>([]);
  const [category, setCategory] = useState<Category>("all");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null); // null = all folders
  const [expandedFolderNodes, setExpandedFolderNodes] = useState<Set<string>>(new Set());
const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: "title", dir: "asc" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<"view" | "edit" | "new" | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);
  const [generatorCallback, setGeneratorCallback] = useState<((pw: string) => void) | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState("");
  const [meta, setMeta] = useState(dbMeta);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [typeFilter, setTypeFilter] = useState<EntryType | "all">("all");
  const [pendingDelete, setPendingDelete] = useState<PasswordEntry | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const [copiedEntry, setCopiedEntry] = useState<PasswordEntry | null>(null);
  const clipboardClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs so shortcut handler always sees current values without re-registering
  const filteredRef = useRef<PasswordEntry[]>([]);
  const entriesRef  = useRef<PasswordEntry[]>([]);
  const [appVersion, setAppVersion] = useState<string>("");
  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  // ── Update check ─────────────────────────────────────────────────────────────
  const [updateInfo, setUpdateInfo] = useState<{ version: string; notes?: string } | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateChecked, setUpdateChecked] = useState<"idle" | "up_to_date" | "error">("idle");

  // ── HIBP per-row breach status ────────────────────────────────────────────────
  const [hibpStatuses, setHibpStatuses] = useState<Record<string, "idle" | "checking" | number>>({});

  // ── Password visibility per row ───────────────────────────────────────────────
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  const togglePasswordVisibility = useCallback((id: string) => {
    setVisiblePasswords(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Check on startup (5 s delay to avoid blocking startup)
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const result = await invoke<{ version: string; notes?: string } | null>("check_update");
        if (result) { setUpdateInfo(result); setShowUpdateModal(true); }
      } catch {
        // Silently ignore — network may be unavailable
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateChecked("idle");
    try {
      const result = await invoke<{ version: string; notes?: string } | null>("check_update");
      if (result) { setUpdateInfo(result); setShowUpdateModal(true); }
      else setUpdateChecked("up_to_date");
    } catch {
      setUpdateChecked("error");
    } finally {
      setCheckingUpdate(false);
    }
  };

const loadEntries = useCallback(async () => {
    const data = await invoke<PasswordEntry[]>("get_entries");
    setEntries(data);
  }, []);

  // Wrap onSettingsChange to clean up stale tags from entries when a tag is removed
  const handleSettingsChange = useCallback(async (updates: Partial<AppSettings>) => {
    if (updates.customCategories !== undefined) {
      // Build the new valid tag set (builtin + new custom list)
      const validTags = new Set([...DEFAULT_CATEGORIES, ...(updates.customCategories ?? [])]);
      // Find all entries that reference a tag no longer in the valid set
      const currentEntries = await invoke<PasswordEntry[]>("get_entries");
      const affected = currentEntries.filter(e => e.tags.some(t => !validTags.has(t)));
      if (affected.length > 0) {
        await Promise.all(affected.map(e => invoke("save_entry", {
          entry: {
            ...e,
            tags: e.tags.filter(t => validTags.has(t)),
            category: e.tags.filter(t => validTags.has(t))[0] ?? "",
            entry_type: e.entry_type ?? "login",
            extra_fields: e.extra_fields ?? [],
          },
        })));
        await loadEntries();
      }
    }
    onSettingsChange(updates);
  }, [onSettingsChange, loadEntries]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // Clears clipboard then locks — used by auto-lock timer + sidebar button
  const doLock = useCallback(() => {
    if (clipboardClearTimer.current) { clearTimeout(clipboardClearTimer.current); clipboardClearTimer.current = null; }
    if (settings.clipboardClearOnLock) writeText("").catch(() => {});
    if (settings.minimizeOnLock) getCurrentWindow().minimize().catch(() => {});
    onLock();
  }, [onLock, settings.clipboardClearOnLock, settings.minimizeOnLock]);

  // Clears clipboard then closes the vault
  const doClose = useCallback(() => {
    if (clipboardClearTimer.current) { clearTimeout(clipboardClearTimer.current); clipboardClearTimer.current = null; }
    if (settings.clipboardClearOnLock) writeText("").catch(() => {});
    onClose();
  }, [onClose, settings.clipboardClearOnLock]);

// Auto-lock on inactivity
  useEffect(() => {
    const ms = settings.lockTimeoutMinutes > 0 ? settings.lockTimeoutMinutes * 60 * 1000 : null;
    if (!ms) return;
    let timer = window.setTimeout(doLock, ms);
    const reset = () => { clearTimeout(timer); timer = window.setTimeout(doLock, ms); };
    window.addEventListener("mousemove", reset);
    window.addEventListener("keydown", reset);
    return () => { clearTimeout(timer); window.removeEventListener("mousemove", reset); window.removeEventListener("keydown", reset); };
  }, [doLock, settings.lockTimeoutMinutes]);

  // Close modals on Escape — priority: context menu > generator/settings > entry panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (contextMenu) { setContextMenu(null); return; }
      if (pendingDelete) { setPendingDelete(null); return; }
      if (generatorCallback) { setGeneratorCallback(null); return; }
      if (showGenerator) { setShowGenerator(false); return; }
      if (showSettings) { setShowSettings(false); return; }
      if (panelMode) { setPanelMode(null); return; }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [contextMenu, pendingDelete, generatorCallback, showGenerator, showSettings, panelMode]);

  // Global keyboard shortcuts
  useEffect(() => {
    const sc = { ...DEFAULT_SHORTCUTS, ...(settings.shortcuts ?? {}) };
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      const key = parseShortcut(e);

      // Focus search — works even when typing (Ctrl+F override)
      if (key === sc.focus_search) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      // All other shortcuts: ignore when typing
      if (isTyping) return;

      // Modals open — only Escape (handled separately) and search allowed
      if (contextMenu || pendingDelete || showGenerator || showSettings || generatorCallback) return;

      if (key === sc.navigate_up || key === sc.navigate_down) {
        e.preventDefault();
        const cur = filteredRef.current;
        const idx = cur.findIndex(x => x.id === selectedId);
        const next = key === sc.navigate_up
          ? Math.max(0, (idx < 0 ? 0 : idx) - 1)
          : Math.min(cur.length - 1, (idx < 0 ? -1 : idx) + 1);
        if (cur[next]) {
          setSelectedId(cur[next].id);
          if (!panelMode) setPanelMode("view");
        }
        return;
      }

      if (key === sc.new_entry) {
        e.preventDefault();
        setSelectedId(null);
        setPanelMode("new");
        return;
      }

      if (key === sc.edit_entry && selectedId) {
        e.preventDefault();
        setPanelMode("edit");
        return;
      }

      if (key === sc.delete_entry && selectedId) {
        e.preventDefault();
        const entry = entriesRef.current.find(x => x.id === selectedId);
        if (entry) setPendingDelete(entry);
        return;
      }

      if (key === sc.copy_password && selectedId) {
        if (window.getSelection()?.isCollapsed === false) return;
        e.preventDefault();
        const entry = entriesRef.current.find(x => x.id === selectedId);
        if (entry?.password) copyToClipboard(entry.password, t("entry.password"));
        return;
      }

      if (key === sc.copy_username && selectedId) {
        e.preventDefault();
        const entry = entriesRef.current.find(x => x.id === selectedId);
        if (entry?.username) copyToClipboard(entry.username, t("entry.username"));
        return;
      }

      if (key === sc.open_entry && selectedId) {
        e.preventDefault();
        const entry = entriesRef.current.find(x => x.id === selectedId);
        if (entry) openEntry(entry);
        return;
      }

      if (key === sc.copy_entry && selectedId) {
        if (window.getSelection()?.isCollapsed === false) return;
        e.preventDefault();
        const entry = entriesRef.current.find(x => x.id === selectedId);
        if (entry) { setCopiedEntry(entry); showToast(t("vault.entry_copied")); }
        return;
      }

      if (key === sc.paste_entry && copiedEntry) {
        e.preventDefault();
        duplicateEntry(copiedEntry);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.shortcuts, selectedId, copiedEntry, panelMode,
      contextMenu, pendingDelete, showGenerator, showSettings, generatorCallback]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  }, []);

  // ── Auto-backup ────────────────────────────────────────────────────────────
  const runBackupIfDue = useCallback(() => {
    if (!settings.backupEnabled || !settings.backupPath) return;
    const lastKey = `vaultix_last_backup_${dbPath}`;
    const last = Number(localStorage.getItem(lastKey) ?? 0);
    const elapsedHours = (Date.now() - last) / 3600000;
    if (elapsedHours >= settings.backupIntervalHours) {
      invoke("backup_database", {
        backupDir: settings.backupPath,
        maxCount: settings.backupMaxCount,
        namePattern: settings.backupNamePattern ?? "{date}_{time}_{name}",
      })
        .then(() => {
          localStorage.setItem(lastKey, String(Date.now()));
          showToast(t("vault.backup_done"));
        })
        .catch(e => showToast(t("vault.backup_failed", { error: e })));
    }
  }, [
    settings.backupEnabled, settings.backupPath, settings.backupIntervalHours,
    settings.backupMaxCount, settings.backupNamePattern, dbPath, showToast, t,
  ]);

  // Periodic timer — checks every 60 s whether a backup is due
  useEffect(() => {
    if (!settings.backupEnabled || !settings.backupPath || settings.backupIntervalHours <= 0) return;
    const timer = setInterval(runBackupIfDue, 60_000);
    return () => clearInterval(timer);
  }, [settings.backupEnabled, settings.backupPath, settings.backupIntervalHours, runBackupIfDue]);

  const scheduleClipboardClear = useCallback(() => {
    if (clipboardClearTimer.current) clearTimeout(clipboardClearTimer.current);
    if (settings.clipboardClearSeconds > 0) {
      clipboardClearTimer.current = setTimeout(() => {
        writeText("").catch(() => {});
        clipboardClearTimer.current = null;
      }, settings.clipboardClearSeconds * 1000);
    }
  }, [settings.clipboardClearSeconds]);

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    await writeText(text);
    scheduleClipboardClear();
    const suffix = settings.clipboardClearSeconds > 0
      ? t("vault.copied_suffix", { seconds: settings.clipboardClearSeconds }) : "";
    showToast(`${label} ${t("vault.copy_suffix_title")}${suffix}`);
  }, [scheduleClipboardClear, settings.clipboardClearSeconds, t, showToast]);

  const duplicateEntry = useCallback(async (entry: PasswordEntry) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, created_at, updated_at, strength, ...rest } = entry;
      await invoke("save_entry", { entry: { ...rest, title: rest.title + ` (${t("vault.copy_label")})` } });
      await loadEntries();
      showToast(t("vault.entry_duplicated"));
    } catch {}
  }, [loadEntries, showToast, t]);

  const nowTs = useMemo(() => Math.floor(Date.now() / 1000), []);

  const filtered = useMemo(() => entries.filter(e => {
    if (category === "favorites" && !e.favorite) return false;
    if (category === "expired" && !(e.expires_at && e.expires_at < nowTs)) return false;
    if (category !== "all" && category !== "favorites" && category !== "reused" && category !== "expired" && !entryMatchesTag(e, category)) return false;
    // Hide expired entries from all views except the dedicated "expired" category
    if (settings.excludeExpiredFromSearch && category !== "expired" && e.expires_at && e.expires_at < nowTs) return false;
    // Folder filter: include entry if its folder matches or is a descendant
    if (selectedFolder !== null) {
      const f = e.folder ?? "";
      if (f !== selectedFolder && !f.startsWith(selectedFolder + "/")) return false;
    }
    if (typeFilter !== "all" && (e.entry_type ?? "login") !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return e.title.toLowerCase().includes(q)
        || e.username.toLowerCase().includes(q)
        || e.url.toLowerCase().includes(q)
        || e.notes.toLowerCase().includes(q);
    }
    return true;
  }).sort((a, b) => {
    const dir = sort.dir === "asc" ? 1 : -1;
    if (sort.field === "updated_at" || sort.field === "strength") {
      return ((a[sort.field] as number) - (b[sort.field] as number)) * dir;
    }
    return String(a[sort.field] ?? "").localeCompare(String(b[sort.field] ?? "")) * dir;
  }), [entries, category, search, sort, settings.excludeExpiredFromSearch, selectedFolder, typeFilter, nowTs]);

  // Keep refs in sync so shortcut handler always reads current values
  filteredRef.current = filtered;
  entriesRef.current  = entries;

  const allCategories = useMemo(
    () => [...DEFAULT_CATEGORIES, ...settings.customCategories],
    [settings.customCategories]
  );

  // Build a tree from entry folder paths
  const folderTree = useMemo(() => {
    const nodeMap = new Map<string, FolderNode>();
    const roots: FolderNode[] = [];
    const allPaths = new Set<string>();
    for (const e of entries) {
      if (!e.folder) continue;
      const parts = e.folder.split("/").filter(Boolean);
      for (let i = 1; i <= parts.length; i++) allPaths.add(parts.slice(0, i).join("/"));
    }
    for (const path of [...allPaths].sort()) {
      const parts = path.split("/");
      const name = parts[parts.length - 1];
      const node: FolderNode = { name, path, children: [] };
      nodeMap.set(path, node);
      if (parts.length === 1) {
        roots.push(node);
      } else {
        const parentPath = parts.slice(0, -1).join("/");
        nodeMap.get(parentPath)?.children.push(node);
      }
    }
    return roots;
  }, [entries]);
  const hasFolders = folderTree.length > 0;

  // Flat sorted list of all folder paths (for FolderPicker in EntryPanel)
  const allFolderPaths = useMemo(
    () => [...new Set(entries.map(e => e.folder ?? "").filter(Boolean))].sort(),
    [entries]
  );

  // Precomputed folder entry counts — O(n) once, O(1) per lookup
  const folderCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const f = e.folder ?? "";
      if (!f) continue;
      const parts = f.split("/").filter(Boolean);
      for (let i = 1; i <= parts.length; i++) {
        const p = parts.slice(0, i).join("/");
        map.set(p, (map.get(p) ?? 0) + 1);
      }
    }
    return map;
  }, [entries]);
  const folderEntryCount = useCallback((path: string): number => folderCountMap.get(path) ?? 0, [folderCountMap]);

  const toggleFolderNode = useCallback((path: string) =>
    setExpandedFolderNodes(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    }), []);

  // Group entries by password to detect reuse
  const reusedGroups = useMemo(() => {
    const byPw = new Map<string, PasswordEntry[]>();
    for (const e of entries) {
      if (!e.password) continue;
      const group = byPw.get(e.password) ?? [];
      group.push(e);
      byPw.set(e.password, group);
    }
    return [...byPw.values()].filter(g => g.length >= 2);
  }, [entries]);

  const reusedEntryIds = useMemo(
    () => new Set(reusedGroups.flat().map(e => e.id)),
    [reusedGroups]
  );

  // Precomputed category counts — O(n) once per entries change
  const counts = useMemo(() => {
    const favorites = entries.filter(e => e.favorite).length;
    const expired = entries.filter(e => e.expires_at && e.expires_at < nowTs).length;
    const byTag: Record<string, number> = {};
    for (const e of entries) {
      for (const tag of e.tags) { byTag[tag] = (byTag[tag] ?? 0) + 1; }
      if (e.category && !e.tags.includes(e.category)) {
        byTag[e.category] = (byTag[e.category] ?? 0) + 1;
      }
    }
    return { all: entries.length, favorites, reused: reusedEntryIds.size, expired, byTag };
  }, [entries, reusedEntryIds, nowTs]);

  const countFor = useCallback((cat: Category) => {
    if (cat === "all") return counts.all;
    if (cat === "favorites") return counts.favorites;
    if (cat === "reused") return counts.reused;
    if (cat === "expired") return counts.expired;
    return counts.byTag[cat] ?? 0;
  }, [counts]);

  const expiredCount = counts.expired;

  const openEntry = useCallback(async (entry: PasswordEntry) => {
    const raw = entry.url?.trim();
    if (!raw) return;
    const type = entry.entry_type ?? "login";

    // Auto-copy password so it's ready to paste after the connection opens
    if (entry.password) {
      await copyToClipboard(entry.password, t("entry.password"));
    }

    // Extract bare host (strip scheme, user@, trailing port/path)
    const bareHost = raw
      .replace(/^[a-z][a-z0-9+\-.]*:\/\//i, "") // strip scheme
      .replace(/^[^@]+@/, "")                    // strip user@
      .split(/[/:?#]/)[0];                        // strip port/path
    const extraPort = entry.extra_fields?.find(([k]) => k === "port")?.[1] ?? "";

    switch (type) {
      // ── Direct-process protocols (use Rust command) ────────────────────────
      case "rdp":
      case "ssh":
      case "telnet":
        try {
          await invoke("open_connection", {
            entryType: type,   // Tauri 2: JS camelCase → Rust snake_case
            host: bareHost,
            port: extraPort || null,
            username: entry.username || null,
          });
        } catch (err) {
          // Surface error as toast so user knows something failed
          showToast(t("vault.error_open", { type: type.toUpperCase(), error: String(err) }));
        }
        return;

      // ── TeamViewer: URI scheme + auto-copy password ────────────────────────
      case "teamviewer": {
        const tvId = raw.replace(/\D/g, ""); // keep digits only
        if (!tvId) return;
        // Copy password to clipboard first so user can paste it in TeamViewer
        if (entry.password) {
          await writeText(entry.password);
          scheduleClipboardClear();
          const suffix = settings.clipboardClearSeconds > 0
            ? t("vault.copied_suffix", { seconds: settings.clipboardClearSeconds }) : "";
          showToast(t("vault.tv_copy_msg", { suffix }));
        }
        openUrl(`teamviewer10://control?device=${tvId}`).catch(() => {});
        return;
      }

      // ── URL-scheme protocols (openUrl with guaranteed prefix) ──────────────
      case "ftp":
        openUrl(raw.startsWith("ftp://") ? raw : `ftp://${raw}`).catch(() => {});
        return;
      case "sftp":
        openUrl(raw.startsWith("sftp://") ? raw : `sftp://${raw}`).catch(() => {});
        return;
      case "vnc":
        openUrl(raw.startsWith("vnc://") ? raw : `vnc://${raw}`).catch(() => {});
        return;

      // ── Web / other — delegate to detectProtocol ──────────────────────────
      default: {
        const proto = detectProtocol(raw);
        if (proto) openUrl(proto.buildUrl(raw)).catch(() => {});
      }
    }
  }, [copyToClipboard, scheduleClipboardClear, settings.clipboardClearSeconds, showToast, t]);

  const toggleSort = useCallback((field: SortField) =>
    setSort(s => s.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" }), []);

  const setPresetSort = useCallback((field: SortField, dir: SortDir) =>
    setSort({ field, dir }), []);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: PasswordEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

// Quick-save an entry with partial field updates (no panel needed)
  const checkHibpRow = async (entry: PasswordEntry) => {
    if (!entry.password) return;
    setHibpStatuses(prev => ({ ...prev, [entry.id]: "checking" }));
    try {
      const count = await invoke<number>("check_hibp_password", { password: entry.password });
      setHibpStatuses(prev => ({ ...prev, [entry.id]: count }));
      const msg = count > 0
        ? `⚠ ${t("entry.hibp_pwned", { count })}`
        : `✓ ${t("entry.hibp_safe")}`;
      setToast(msg);
      setTimeout(() => setToast(""), 3500);
    } catch {
      setHibpStatuses(prev => ({ ...prev, [entry.id]: -1 }));
      setToast(t("entry.hibp_error"));
      setTimeout(() => setToast(""), 3500);
    }
  };

  const quickSave = (entry: PasswordEntry, patch: { tags?: string[]; folder?: string; favorite?: boolean }) => {
    const newTags = patch.tags ?? entry.tags;
    const updated = {
      ...entry,
      ...patch,
      tags: newTags,
      category: newTags[0] ?? entry.category,
    };
    // Optimistic update — instant visual feedback, no round-trip wait
    setEntries(prev => prev.map(e => e.id === entry.id ? updated : e));
    // Background save — fire and forget; revert on failure
    invoke("save_entry", {
      entry: {
        id: updated.id,
        expires_at: updated.expires_at ?? null,
        title: updated.title,
        username: updated.username,
        password: updated.password,
        url: updated.url,
        notes: updated.notes,
        category: updated.category,
        folder: updated.folder ?? "",
        tags: updated.tags,
        totp_secret: updated.totp_secret,
        favorite: updated.favorite,
        entry_type: updated.entry_type ?? "login",
        extra_fields: updated.extra_fields ?? [],
      },
    }).catch(() => loadEntries()); // revert to real state if save fails
  };

const selectedEntry = entries.find(e => e.id === selectedId) ?? null;

  const handleSaved = async () => {
    await loadEntries();
    const newMeta = await invoke<DatabaseMeta>("get_db_meta");
    setMeta(newMeta);
    setPanelMode(null); // close panel after save — return to list
    runBackupIfDue();
  };

  const handleDeleted = async () => {
    setSelectedId(null);
    setPanelMode(null);
    await loadEntries();
    const newMeta = await invoke<DatabaseMeta>("get_db_meta");
    setMeta(newMeta);
  };

  const lockLabel = settings.lockTimeoutMinutes > 0
    ? t("vault.auto_lock_in", { minutes: settings.lockTimeoutMinutes })
    : t("vault.auto_lock_disabled");

  const isSearchActive = search.trim().length > 0;

  return (
    <div className="app-layout" onClick={() => setContextMenu(null)}>
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <img src="/LockSafe.ico" alt="" style={{ width: 22, height: 22, objectFit: "contain" }} />
          </div>
          <div>
            <div className="sidebar-title">Vaultix</div>
            <div className="sidebar-subtitle">{meta.name}</div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-label">{t("vault.navigation")}</div>
          <button
            className={`sidebar-item ${category === "all" && selectedFolder === null ? "active" : ""}`}
            onClick={() => { setCategory("all"); setSelectedFolder(null); }}
          >
            <span style={{ pointerEvents: "none", display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
              <GridIcon size={16} />
              {t("vault.all_entries")}
              <span className="count" style={{ background: "rgba(59,130,246,0.14)", color: "var(--accent)" }}>{countFor("all")}</span>
            </span>
          </button>
          {/* Folder tree — always visible under Tous when folders exist */}
          {hasFolders && folderTree.map(node => (
            <FolderTreeItem
              key={node.path}
              node={node}
              depth={1}
              selectedFolder={selectedFolder}
              expanded={expandedFolderNodes}
              onSelect={p => { setSelectedFolder(p); setCategory("all"); }}
              onToggle={toggleFolderNode}
              countFor={folderEntryCount}
            />
          ))}
          {/* Favourites & Reused */}
          <button
            className={`sidebar-item ${category === "favorites" ? "active" : ""}`}
            onClick={() => { setCategory("favorites"); setSelectedFolder(null); }}
          >
            <StarIcon size={16} />
            {t("vault.favorites")}
            <span className="count" style={{ background: "rgba(245,158,11,0.14)", color: "#f59e0b" }}>{countFor("favorites")}</span>
          </button>
          <button
            className={`sidebar-item ${category === "reused" ? "active" : ""}`}
            onClick={() => { setCategory("reused"); setSelectedFolder(null); }}
          >
            <AlertIcon size={16} />
            {t("vault.reused")}
            <span className="count" style={{ background: "rgba(239,68,68,0.12)", color: "var(--danger)" }}>{countFor("reused")}</span>
          </button>
          {expiredCount > 0 && (
            <button
              className={`sidebar-item ${category === "expired" ? "active" : ""}`}
              onClick={() => { setCategory("expired"); setSelectedFolder(null); }}
              style={{ color: category === "expired" ? undefined : "var(--danger)" }}
            >
              <ClockExpiredIcon size={16} />
              {t("vault.expired")}
              <span className="count" style={{ background: "rgba(239,68,68,0.12)", color: "var(--danger)" }}>{expiredCount}</span>
            </button>
          )}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-label">{t("vault.tags")}</div>
          {allCategories.map(cat => {
            const color = settings.tagColors?.[cat] ?? "";
            return (
              <div
                key={cat}
                className={`sidebar-item ${category === cat ? "active" : ""}`}
                onClick={() => setCategory(cat)}
                style={{ cursor: "pointer" }}
              >
                {/* Inline color swatch — click opens color picker without navigating */}
                <label title={t("vault.change_color")} style={{ flexShrink: 0, cursor: "pointer", position: "relative", display: "flex", alignItems: "center" }} onClick={e => e.stopPropagation()}>
                  <div style={{ width: 12, height: 12, borderRadius: "50%", background: color || "var(--text-3)", border: "1.5px solid var(--border-light)", flexShrink: 0 }} />
                  <input type="color" value={color || "#888888"}
                    onChange={e => { e.stopPropagation(); handleSettingsChange({ tagColors: { ...settings.tagColors, [cat]: e.target.value } }); }}
                    style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }} />
                </label>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat}</span>
                {countFor(cat) > 0 && (
                  <span className="count" style={color ? {
                    background: `${color}22`,
                    color,
                  } : undefined}>{countFor(cat)}</span>
                )}
              </div>
            );
          })}
        </div>


        <div className="sidebar-footer">
          {/* ── Groupe 1 : actions principales ── */}
          <div style={{ padding: "10px 8px 14px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
            <button className="btn btn-ghost" style={{ width: "100%", justifyContent: "center" }} onClick={() => setShowGenerator(true)}>
              <KeyIcon size={14} /> {t("vault.generator")}
            </button>
            <button className="btn btn-ghost" style={{ width: "100%", justifyContent: "center" }} onClick={() => setShowSettings(true)}>
              <SettingsIcon size={14} /> {t("vault.settings")}
            </button>
            <button className="btn btn-ghost" style={{ width: "100%", justifyContent: "center" }} onClick={doLock} title={lockLabel}>
              <LockIcon size={14} /> {t("vault.lock")}
            </button>
            <button className="btn btn-ghost" style={{ width: "100%", justifyContent: "center" }} onClick={doClose}>
              <XIcon size={14} /> {t("vault.change_vault")}
            </button>
          </div>

          {/* ── Group 2: check for updates ── */}
          <div style={{ padding: "8px 8px 0", borderTop: "1px solid var(--border)" }}>
            <button
              className="btn btn-ghost"
              onClick={handleCheckUpdate}
              disabled={checkingUpdate}
              style={{
                width: "100%", justifyContent: "center",
                color: updateChecked === "up_to_date" ? "var(--accent)" : updateChecked === "error" ? "#ef4444" : undefined,
              }}
            >
              {checkingUpdate
                ? <><SpinSidebarIcon size={14} /> {t("vault.checking_updates")}</>
                : updateChecked === "up_to_date"
                  ? <><CheckSidebarIcon size={14} /> {t("vault.up_to_date")}</>
                  : updateChecked === "error"
                    ? <><RefreshSidebarIcon size={14} /> {t("vault.update_error")}</>
                    : <><RefreshSidebarIcon size={14} /> {t("vault.check_updates")}</>
              }
            </button>
          </div>

          {/* ── Version + Notes de version ── */}
          <div style={{ padding: "6px 8px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-3)", letterSpacing: "0.07em", textTransform: "uppercase" }}>
              Vaultix {appVersion ? `v${appVersion}` : ""}
            </span>
            <button
              onClick={() => setShowChangelog(true)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--text-3)", textDecoration: "underline", textUnderlineOffset: "2px", transition: "color 0.15s", padding: "1px 0" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--text-2)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--text-3)")}
            >
              {t("vault.release_notes")}
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="main-content">
        <div className="main-header">
          <h1>
            {category === "all" ? t("vault.all_entries")
              : category === "favorites" ? t("vault.favorites")
              : category === "reused" ? t("vault.reused")
              : category === "expired" ? t("vault.expired")
              : category}
          </h1>
          <button className="btn btn-primary btn-sm" onClick={() => { setSelectedId(null); setPanelMode("new"); }}>
            <PlusIcon size={13} /> {t("vault.new_entry")}
          </button>
        </div>

        {/* Search + Sort toolbar */}
        <div style={{ display: (category === "reused") ? "none" : "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-card)", flexWrap: "wrap" }}>
          {/* Search on the left */}
          <div className="search-wrap">
            <SearchIcon size={14} />
            <input
              ref={searchRef}
              className="search-input"
              placeholder={t("vault.search_placeholder")}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {isSearchActive && (
              <button
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", padding: "0 4px", lineHeight: 1 }}
                onClick={() => setSearch("")}
                title={t("vault.clear_search")}
              >
                <XIcon size={12} />
              </button>
            )}
          </div>

          {/* Count — right after search, like TeamsManager */}
          <span style={{ fontSize: 12, color: "var(--text-3)", whiteSpace: "nowrap" }}>
            {filtered.length} {filtered.length !== 1 ? t("vault.results_many") : t("vault.result_one")}
          </span>

          {/* Sort buttons pushed to the far right */}
          <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
            {[
              { label: "A→Z",                    field: "title" as SortField,      dir: "asc" as SortDir },
              { label: "Z→A",                    field: "title" as SortField,      dir: "desc" as SortDir },
              { label: t("vault.sort_updated"),  field: "updated_at" as SortField, dir: "desc" as SortDir },
              { label: t("vault.sort_strength"), field: "strength" as SortField,   dir: "desc" as SortDir },
            ].map(p => {
              const active = sort.field === p.field && sort.dir === p.dir;
              return (
                <button
                  key={p.label}
                  className={`btn btn-sm ${active ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setPresetSort(p.field, p.dir)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Filter bar ── */}
        <div className="filter-bar">
          <select
            className="input"
            value={selectedFolder ?? ""}
            onChange={e => setSelectedFolder(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">{t("vault.folder_all")}</option>
            {allFolderPaths.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <select
            className="input"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as EntryType | "all")}
          >
            <option value="all">{t("vault.all_types")}</option>
            <option value="login">{t("vault.type_labels.login")}</option>
            <option value="rdp">Remote Desktop (RDP)</option>
            <option value="ssh">SSH</option>
            <option value="ftp">FTP</option>
            <option value="sftp">SFTP</option>
            <option value="vnc">VNC</option>
            <option value="teamviewer">TeamViewer</option>
            <option value="telnet">Telnet</option>
            <option value="other">{t("vault.type_labels.other")}</option>
            <option value="note">{t("vault.type_labels.note")}</option>
          </select>
          {(selectedFolder !== null || typeFilter !== "all") && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setSelectedFolder(null); setTypeFilter("all"); }}
              style={{ color: "var(--text-3)" }}
            >
              <XIcon size={12} /> {t("vault.clear_filters")}
            </button>
          )}
        </div>

        {category === "reused" ? (
          <ReusedPasswordsView
            groups={reusedGroups}
            selectedId={selectedId}
            onSelect={(entry) => { setSelectedId(entry.id); setPanelMode("view"); }}
            onCopy={copyToClipboard}
          />
        ) : null}

        <div className="entry-list" style={category === "reused" ? { display: "none" } : undefined}>
          {filtered.length === 0 ? (
            <div className="empty-state">
              <LockIcon size={40} />
              <p>{search ? t("vault.no_results") : <>{t("vault.empty_category")}<br/>{t("vault.click_add")}</>}</p>
            </div>
          ) : (
            <table className="entry-table">
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>{/* star */}
                  <th style={{ width: 180 }} onClick={() => toggleSort("title")}>
                    {t("vault.sort_title")} {sort.field === "title" ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th style={{ width: 145 }} onClick={() => toggleSort("url")}>{t("vault.sort_url")} {sort.field === "url" ? (sort.dir === "asc" ? "▲" : "▼") : ""}</th>
                  <th style={{ width: 135 }} onClick={() => toggleSort("username")}>{t("vault.sort_username")} {sort.field === "username" ? (sort.dir === "asc" ? "▲" : "▼") : ""}</th>
                  <th style={{ width: 210 }}>{t("entry.password")}</th>
                  <th style={{ width: 130 }} onClick={() => toggleSort("strength")}>{t("vault.sort_strength")} {sort.field === "strength" ? (sort.dir === "asc" ? "▲" : "▼") : ""}</th>
                  <th style={{ width: 80 }} onClick={() => toggleSort("updated_at")}>{t("vault.sort_updated")} {sort.field === "updated_at" ? (sort.dir === "asc" ? "▲" : "▼") : ""}</th>
                  <th style={{ width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry, rowIdx) => (
                  <tr
                    key={entry.id}
                    className={selectedId === entry.id ? "selected" : ""}
                    onContextMenu={e => handleContextMenu(e, entry)}
                    style={{
                      cursor: "default",
                      ...(settings.zebraStripes && rowIdx % 2 === 1 && selectedId !== entry.id
                        ? { background: "var(--zebra-bg)" } : {}),
                    }}
                  >
                    {/* Favorite star toggle */}
                    <td onClick={e => e.stopPropagation()} style={{ paddingLeft: 6, paddingRight: 0, width: 28 }}>
                      <button
                        className="btn-icon"
                        title={entry.favorite ? t("vault.remove_from_favorites") : t("vault.add_to_favorites")}
                        onClick={() => quickSave(entry, { favorite: !entry.favorite })}
                        style={{ color: entry.favorite ? "#f59e0b" : "var(--text-3)", padding: "2px 3px" }}
                      >
                        <StarIcon size={13} />
                      </button>
                    </td>
                    <td>
                      <div className="title-cell">
                        <div className="entry-icon">{entry.url ? getFavicon(entry.url) : <LockIcon size={13} />}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden" }}>
                          <span title={entry.title} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1 1 auto", minWidth: 0 }}>{entry.title}</span>
                          {entry.totp_secret && <TotpIcon size={12} style={{ color: "var(--info)", flexShrink: 0 }} />}
                          {/* Protocol type badge */}
                          {(() => {
                            const tm = TYPE_META[entry.entry_type ?? "login"];
                            if (!tm) return null;
                            return (
                              <span style={{
                                fontSize: 10, padding: "1px 6px", borderRadius: 4, fontWeight: 700,
                                background: tm.color + "22", color: tm.color,
                                border: `1px solid ${tm.color}44`, flexShrink: 0, letterSpacing: "0.02em",
                              }}>
                                {tm.label}
                              </span>
                            );
                          })()}
                          {/* Expiry badge */}
                          {entry.expires_at && (() => {
                            const diff = Math.ceil((entry.expires_at - nowTs) / 86400);
                            const isExpired = diff <= 0;
                            const isSoon = !isExpired && diff <= 7;
                            if (!isExpired && !isSoon) return null;
                            return (
                              <span title={isExpired ? t("entry.expired_days_ago", { count: Math.abs(diff) }) : t("entry.expires_in_days_short", { count: diff })} style={{
                                fontSize: 10, padding: "1px 6px", borderRadius: 4, fontWeight: 700, flexShrink: 0,
                                background: isExpired ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)",
                                color: isExpired ? "var(--danger)" : "var(--warning)",
                                border: `1px solid ${isExpired ? "rgba(239,68,68,0.3)" : "rgba(245,158,11,0.3)"}`,
                              }}>
                                {isExpired ? t("entry.expired_badge") : `${diff}d`}
                              </span>
                            );
                          })()}
                          {/* Tag badges — max 2, inline */}
                          {(entry.tags ?? []).slice(0, 2).map(tag => {
                            const c = settings.tagColors?.[tag] ?? "";
                            return (
                              <span key={tag} title={tag} style={{
                                fontSize: 10, padding: "1px 6px", borderRadius: 8, fontWeight: 500, flexShrink: 0,
                                background: c ? c + "30" : "rgba(255,255,255,0.08)",
                                border: `1px solid ${c ? c + "66" : "rgba(255,255,255,0.15)"}`,
                                color: c || "var(--text-2)",
                                whiteSpace: "nowrap",
                              }}>{tag}</span>
                            );
                          })}
                          {/* +N more tags indicator */}
                          {(entry.tags ?? []).length > 2 && (
                            <span style={{
                              fontSize: 10, padding: "1px 5px", borderRadius: 8, fontWeight: 500, flexShrink: 0,
                              background: "rgba(255,255,255,0.08)", color: "var(--text-3)",
                              border: "1px solid rgba(255,255,255,0.12)",
                            }}>+{(entry.tags ?? []).length - 2}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      {entry.url ? (
                        <UrlCell url={entry.url} entryType={entry.entry_type ?? "login"} onOpen={() => openEntry(entry)} />
                      ) : <span style={{ color: "var(--text-3)" }}>—</span>}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      {entry.username ? (
                        <span
                          style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}
                          title={t("vault.context_copy_username") + " — " + entry.username}
                          onClick={() => copyToClipboard(entry.username, t("entry.username"))}
                        >
                          {entry.username}
                        </span>
                      ) : <span style={{ color: "var(--text-3)" }}>—</span>}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      {entry.password ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <button
                            className="btn-icon"
                            title={visiblePasswords.has(entry.id) ? t("entry.hide_password") : t("entry.show_password")}
                            onClick={() => togglePasswordVisibility(entry.id)}
                          >
                            {visiblePasswords.has(entry.id) ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
                          </button>
                          <button
                            className="btn-icon"
                            title={t("entry.hibp_check")}
                            disabled={hibpStatuses[entry.id] === "checking"}
                            onClick={e => { e.stopPropagation(); checkHibpRow(entry); }}
                          >
                            {hibpStatuses[entry.id] === "checking"
                              ? <span className="spinner" style={{ width: 10, height: 10 }} />
                              : <ShieldIcon size={13} />}
                          </button>
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontSize: 12,
                              letterSpacing: "0.06em",
                              flex: 1,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              cursor: "pointer",
                              color: visiblePasswords.has(entry.id) ? "var(--text-1)" : "var(--text-3)",
                            }}
                            title={t("vault.context_copy_password")}
                            onClick={() => copyToClipboard(entry.password, t("entry.password"))}
                          >
                            {visiblePasswords.has(entry.id) ? entry.password : "••••••••"}
                          </span>
                        </div>
                      ) : <span style={{ color: "var(--text-3)" }}>—</span>}
                    </td>
                    <td><StrengthBadge score={entry.strength} /></td>
                    <td>{formatDate(entry.updated_at)}</td>
                    <td onClick={e => e.stopPropagation()} style={{ paddingRight: 10 }}>
                      <div style={{ display: "flex", gap: 2, justifyContent: "flex-end", alignItems: "center" }}>
                        <button
                          className="btn-icon"
                          title={t("common.view_details")}
                          onClick={e => { e.stopPropagation(); setSelectedId(entry.id); setPanelMode("view"); }}
                        >
                          <InfoIcon size={15} />
                        </button>
                        <button
                          className="btn-icon"
                          title={t("common.edit")}
                          onClick={e => { e.stopPropagation(); setSelectedId(entry.id); setPanelMode("edit"); }}
                        >
                          <EditIcon size={15} />
                        </button>
                        <button
                          className="btn-icon"
                          title={t("common.delete")}
                          style={{ color: "var(--danger, #ef4444)" }}
                          onClick={e => { e.stopPropagation(); setPendingDelete(entry); }}
                        >
                          <TrashIcon size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Side panel ── */}
      {panelMode && (
        <EntryPanel
          mode={panelMode === "new" ? "edit" : panelMode}
          entry={panelMode === "new" ? null : selectedEntry}
          defaultCategory={category !== "all" && category !== "favorites" && category !== "reused" ? category : "Autre"}
          customTags={[...DEFAULT_CATEGORIES, ...settings.customCategories]}
          tagColors={settings.tagColors ?? {}}
          allFolders={allFolderPaths}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onClose={() => setPanelMode(null)}
          onCopy={copyToClipboard}
          onRequestGenerator={(cb) => setGeneratorCallback(() => cb)}
        />
      )}

      {/* ── Context menu ── */}
      {contextMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 998 }}
            onClick={() => setContextMenu(null)}
            onContextMenu={e => { e.preventDefault(); setContextMenu(null); }}
          />
          <div
            style={{
              position: "fixed",
              left: Math.min(contextMenu.x, window.innerWidth - 200),
              top: Math.min(contextMenu.y, window.innerHeight - 220),
              zIndex: 999,
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
              padding: "4px",
              minWidth: 192,
            }}
            onClick={e => e.stopPropagation()}
          >
            {contextMenu.entry.totp_secret && (
              <ContextMenuItem
                icon={<TotpIcon size={13} />}
                label={t("entry.copy_totp")}
                onClick={async () => {
                  try {
                    const r = await invoke<{ code: string }>("get_totp_code", { secret: contextMenu.entry.totp_secret });
                    copyToClipboard(r.code, t("vault.totp_code"));
                  } catch {}
                  setContextMenu(null);
                }}
              />
            )}
            {contextMenu.entry.totp_secret && <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />}
            <ContextMenuItem
              icon={<EditIcon size={13} />}
              label={t("common.edit")}
              onClick={() => { setSelectedId(contextMenu.entry.id); setPanelMode("edit"); setContextMenu(null); }}
            />
            <ContextMenuItem
              icon={<TrashIcon size={13} />}
              label={t("common.delete")}
              danger
              onClick={() => { setPendingDelete(contextMenu.entry); setContextMenu(null); }}
            />
          </div>
        </>
      )}

      {/* ── Modals ── */}
      {showGenerator && <GeneratorModal onClose={() => setShowGenerator(false)} />}
      {generatorCallback && (
        <GeneratorModal
          onClose={() => setGeneratorCallback(null)}
          onUse={(pw) => { generatorCallback(pw); setGeneratorCallback(null); }}
        />
      )}
      {showSettings && <SettingsPanel settings={settings} onSettingsChange={handleSettingsChange} onClose={() => setShowSettings(false)} dbPath={dbPath} />}
      {showUpdateModal && updateInfo && (
        <UpdateModal version={updateInfo.version} notes={updateInfo.notes} onClose={() => setShowUpdateModal(false)} />
      )}
      {showChangelog && (
        <ChangelogModal appVersion={appVersion} onClose={() => setShowChangelog(false)} />
      )}

      {toast && <div className="copy-toast">{toast}</div>}

      {/* ── Delete confirmation ── */}
      {pendingDelete && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 1098 }}
            onClick={() => setPendingDelete(null)}
          />
          <div style={{
            position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
            zIndex: 1099,
            background: "var(--bg-card)",
            border: "1px solid var(--danger)",
            borderRadius: 12,
            padding: "14px 20px",
            boxShadow: "0 10px 32px rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", gap: 16, minWidth: 320,
          }}>
            <TrashIcon size={16} />
            <span style={{ flex: 1, fontSize: 13, color: "var(--text-1)" }}>
              {t("vault.delete_confirm", { title: pendingDelete.title })}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setPendingDelete(null)}>
              {t("common.cancel")}
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={async () => {
                try {
                  await invoke("delete_entry", { id: pendingDelete.id });
                  setPendingDelete(null);
                  // If the deleted entry was open in the panel, close it
                  if (selectedId === pendingDelete.id) {
                    setSelectedId(null);
                    setPanelMode(null);
                  }
                  await handleDeleted();
                } catch {}
              }}
            >
              <TrashIcon size={12} /> {t("common.delete")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Context menu item ──────────────────────────────────────────────────────────
function ContextMenuItem({ icon, label, onClick, disabled, danger }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        width: "100%", padding: "7px 10px", border: "none",
        background: "none", cursor: disabled ? "default" : "pointer",
        borderRadius: 5, fontSize: 13, textAlign: "left",
        color: disabled ? "var(--text-3)" : danger ? "var(--danger)" : "var(--text-1)",
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.1s",
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none"; }}
    >
      {icon}
      {label}
    </button>
  );
}

// ── URL cell ──────────────────────────────────────────────────────────────────
function UrlCell({ url, entryType, onOpen }: { url: string; entryType?: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const isHttp = url.startsWith("http://") || url.startsWith("https://") || (!url.includes("://") && url.includes("."));
  const host = isHttp ? getDisplayHost(url) : url.replace(/^[a-z][a-z0-9+\-.]*:\/\//i, "");
  const openTitle = entryType === "rdp" ? t("vault.open_rdp")
    : entryType === "ssh" ? t("vault.open_ssh")
    : entryType === "ftp" ? t("vault.open_ftp")
    : entryType === "sftp" ? t("vault.open_sftp")
    : entryType === "vnc" ? t("vault.open_vnc")
    : entryType === "telnet" ? t("vault.open_telnet")
    : t("vault.open_browser");
  return (
    <span
      style={{ color: "var(--accent)", fontSize: 12,
        display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        cursor: "pointer" }}
      title={openTitle + " — " + url}
      onClick={e => { e.stopPropagation(); onOpen(); }}
    >
      {host}
    </span>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getFavicon(url: string): React.ReactNode {
  try {
    const host = new URL(url.startsWith("http") ? url : "https://" + url).hostname;
    return <img src={`https://www.google.com/s2/favicons?sz=32&domain=${host}`} width={14} height={14} style={{ borderRadius: 3, objectFit: "cover" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} alt="" />;
  } catch { return <LockIcon size={13} />; }
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function StrengthBadge({ score }: { score: number }) {
  const { t } = useTranslation();
  const color = STRENGTH_COLORS[score] ?? "#64748b";
  const strengthLabels = [
    t("setup.strength.very_weak"),
    t("setup.strength.weak"),
    t("setup.strength.medium"),
    t("setup.strength.strong"),
    t("setup.strength.very_strong"),
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ display: "flex", gap: 2 }}>
        {[0,1,2,3,4].map(i => <div key={i} style={{ width: 14, height: 4, borderRadius: 2, background: i <= score ? color : "rgba(255,255,255,0.08)" }} />)}
      </div>
      <span style={{ fontSize: 11, color, minWidth: 52 }}>{strengthLabels[score]}</span>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function GridIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>; }
function StarIcon({ size = 14, style }: { size?: number; style?: React.CSSProperties }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>; }
function KeyIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>; }
function LockIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>; }
function XIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
function SearchIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>; }
function PlusIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function CopyIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>; }
function EditIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function SettingsIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>; }
function TotpIcon({ size = 14, style }: { size?: number; style?: React.CSSProperties }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }

function ExternalIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>; }
function ShieldIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
function EyeIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>; }
function EyeOffIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>; }
function TrashIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>; }
function InfoIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="8"/><line x1="12" y1="12" x2="12" y2="16"/></svg>; }

function AlertIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>; }
function ClockExpiredIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><line x1="18" y1="18" x2="21" y2="21"/></svg>; }
function FolderIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>; }
function FolderOpenIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="1 11 22 11"/></svg>; }
function ChevronRightIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>; }
function ChevronDownIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>; }


function RefreshSidebarIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>; }
function SpinSidebarIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>; }
function CheckSidebarIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>; }

// ── Folder tree item ──────────────────────────────────────────────────────────
function FolderTreeItem({ node, depth, selectedFolder, expanded, onSelect, onToggle, countFor }: {
  node: FolderNode;
  depth: number;
  selectedFolder: string | null;
  expanded: Set<string>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  countFor: (path: string) => number;
}) {
  const isExpanded = expanded.has(node.path);
  const hasChildren = node.children.length > 0;
  const isActive = selectedFolder === node.path;
  const count = countFor(node.path);
  const indent = depth * 14;

  return (
    <>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 0,
          paddingLeft: 8 + indent,
          borderRadius: 6,
        }}
      >
        {/* Expand/collapse toggle — pointer-events kept so click still works */}
        <button
          onClick={e => { e.stopPropagation(); if (hasChildren) onToggle(node.path); }}
          style={{
            background: "none", border: "none", padding: "2px 2px", cursor: hasChildren ? "pointer" : "default",
            color: "var(--text-3)", flexShrink: 0, display: "flex", alignItems: "center", opacity: hasChildren ? 1 : 0,
          }}
          tabIndex={hasChildren ? 0 : -1}
        >
          <span style={{ pointerEvents: "none" }}>
            {isExpanded ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
          </span>
        </button>

        <button
          className={`sidebar-item ${isActive ? "active" : ""}`}
          onClick={() => onSelect(node.path)}
          style={{ flex: 1, paddingLeft: 4 }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, overflow: "hidden" }}>
            {isExpanded ? <FolderOpenIcon size={13} /> : <FolderIcon size={13} />}
            <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {node.name}
            </span>
            {count > 0 && <span className="count">{count}</span>}
          </span>
        </button>
      </div>

      {/* Children — rendered only when expanded */}
      {isExpanded && hasChildren && node.children.map(child => (
        <FolderTreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedFolder={selectedFolder}
          expanded={expanded}
          onSelect={onSelect}
          onToggle={onToggle}
          countFor={countFor}
        />
      ))}
    </>
  );
}

// ── Reused passwords view ──────────────────────────────────────────────────────
function ReusedPasswordsView({ groups, selectedId, onSelect, onCopy }: {
  groups: PasswordEntry[][];
  selectedId: string | null;
  onSelect: (e: PasswordEntry) => void;
  onCopy: (text: string, label: string) => void;
}) {
  const { t } = useTranslation();
  if (groups.length === 0) {
    return (
      <div className="entry-list">
        <div className="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <p>{t("vault.no_reused_detected")}<br/>{t("vault.all_unique")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="entry-list" style={{ padding: "0 16px 16px" }}>
      <div style={{ fontSize: 12, color: "#f97316", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <AlertIcon size={13} />
        {t("vault.reused_summary", { groups: groups.length, entries: groups.reduce((a, g) => a + g.length, 0) })}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {groups.map((group, gi) => (
          <div key={gi} style={{ border: "1px solid #f9731644", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ background: "#f9731608", padding: "8px 12px", fontSize: 11, color: "#f97316", fontWeight: 600, borderBottom: "1px solid #f9731622" }}>
              {t("vault.same_password", { count: group.length })}
            </div>
            {group.map(entry => (
              <div
                key={entry.id}
                onClick={() => onSelect(entry)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                  cursor: "pointer", borderBottom: "1px solid var(--border)",
                  background: selectedId === entry.id ? "var(--bg-hover)" : "transparent",
                  transition: "background 0.12s",
                }}
                onMouseEnter={e => { if (selectedId !== entry.id) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; }}
                onMouseLeave={e => { if (selectedId !== entry.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--bg-primary)", border: "1px solid var(--border)",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {entry.url ? (
                    <img src={`https://www.google.com/s2/favicons?sz=32&domain=${(() => { try { return new URL(entry.url.startsWith("http") ? entry.url : "https://" + entry.url).hostname; } catch { return ""; } })()}`}
                      width={14} height={14} style={{ borderRadius: 3 }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} alt="" />
                  ) : <LockIcon size={12} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.title}</div>
                  {entry.username && <div style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.username}</div>}
                </div>
                <button className="btn-icon" title={t("vault.context_copy_password")} onClick={ev => { ev.stopPropagation(); onCopy(entry.password, t("entry.password")); }}>
                  <CopyIcon size={13} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
