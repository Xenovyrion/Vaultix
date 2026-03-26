import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type PasswordEntry, type DatabaseMeta, type EntryType, STRENGTH_COLORS, STRENGTH_LABELS, DEFAULT_SHORTCUTS, parseShortcut } from "../types";
import { type AppSettings } from "../hooks/useSettings";
import { detectProtocol, getDisplayHost } from "../utils/protocol";
import EntryPanel from "./EntryPanel";
import GeneratorModal from "./GeneratorModal";
import SettingsPanel from "./SettingsPanel";
import UpdateBanner from "./UpdateBanner";

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
  other:      { label: "Autre",       color: "#64748b" },
  note:       { label: "Note",        color: "#f59e0b" },
};

export default function Vault({ dbMeta, dbPath, settings, onSettingsChange, onLock, onClose }: Props) {
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
  const lastClickTime = useRef<Record<string, number>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const [copiedEntry, setCopiedEntry] = useState<PasswordEntry | null>(null);
  const clipboardClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs so shortcut handler always sees current values without re-registering
  const filteredRef = useRef<PasswordEntry[]>([]);
  const entriesRef  = useRef<PasswordEntry[]>([]);
  const [appVersion, setAppVersion] = useState<string>("");
  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  // ── Auto-update check ────────────────────────────────────────────────────────
  const [updateInfo, setUpdateInfo] = useState<{ version: string; notes?: string } | null>(null);
  useEffect(() => {
    if (!settings.autoUpdateEnabled) return;
    // Delay 5 s to avoid blocking startup
    const t = setTimeout(async () => {
      try {
        const result = await invoke<{ version: string; notes?: string } | null>("check_update");
        if (result) setUpdateInfo(result);
      } catch {
        // Silently ignore — network may be unavailable or pubkey not yet set
      }
    }, 5000);
    return () => clearTimeout(t);
  }, [settings.autoUpdateEnabled]);

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
        if (entry?.password) copyToClipboard(entry.password, "Mot de passe");
        return;
      }

      if (key === sc.copy_username && selectedId) {
        e.preventDefault();
        const entry = entriesRef.current.find(x => x.id === selectedId);
        if (entry?.username) copyToClipboard(entry.username, "Identifiant");
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
        if (entry) { setCopiedEntry(entry); showToast("Fiche copiée"); }
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

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  };

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
          showToast("Sauvegarde automatique effectuée ✓");
        })
        .catch(e => showToast(`Sauvegarde échouée : ${e}`));
    }
  }, [ // eslint-disable-next-line react-hooks/exhaustive-deps
    settings.backupEnabled, settings.backupPath, settings.backupIntervalHours,
    settings.backupMaxCount, settings.backupNamePattern, dbPath,
  ]);

  // Timer périodique — vérifie toutes les 60 s si une sauvegarde est due
  useEffect(() => {
    if (!settings.backupEnabled || !settings.backupPath || settings.backupIntervalHours <= 0) return;
    const timer = setInterval(runBackupIfDue, 60_000);
    return () => clearInterval(timer);
  }, [settings.backupEnabled, settings.backupPath, settings.backupIntervalHours, runBackupIfDue]);

  const scheduleClipboardClear = () => {
    if (clipboardClearTimer.current) clearTimeout(clipboardClearTimer.current);
    if (settings.clipboardClearSeconds > 0) {
      clipboardClearTimer.current = setTimeout(() => {
        writeText("").catch(() => {});
        clipboardClearTimer.current = null;
      }, settings.clipboardClearSeconds * 1000);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    await writeText(text);
    scheduleClipboardClear();
    const suffix = settings.clipboardClearSeconds > 0
      ? ` — effacé dans ${settings.clipboardClearSeconds} s` : "";
    showToast(`${label} copié${suffix}`);
  };

  const duplicateEntry = async (entry: PasswordEntry) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, created_at, updated_at, strength, ...rest } = entry;
      await invoke("save_entry", { entry: { ...rest, title: rest.title + " (copie)" } });
      await loadEntries();
      showToast("Fiche dupliquée");
    } catch {}
  };

  // Match entry to tag: checks both new tags[] and legacy category field
  const entryMatchesTag = (e: PasswordEntry, cat: string) =>
    e.tags.includes(cat) || e.category === cat;

  const nowTs = Math.floor(Date.now() / 1000);

  const filtered = entries.filter(e => {
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
  });

  // Keep refs in sync so shortcut handler always reads current values
  filteredRef.current = filtered;
  entriesRef.current  = entries;

  const allCategories = [...DEFAULT_CATEGORIES, ...settings.customCategories];

  // Build a tree from entry folder paths
  const folderTree = (() => {
    const nodeMap = new Map<string, FolderNode>();
    const roots: FolderNode[] = [];
    // Collect all intermediate paths from entries
    const allPaths = new Set<string>();
    for (const e of entries) {
      if (!e.folder) continue;
      const parts = e.folder.split("/").filter(Boolean);
      for (let i = 1; i <= parts.length; i++) allPaths.add(parts.slice(0, i).join("/"));
    }
    // Build tree sorted alphabetically
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
  })();
  const hasFolders = folderTree.length > 0;

  // Flat sorted list of all folder paths (for FolderPicker in EntryPanel)
  const allFolderPaths = [...new Set(entries.map(e => e.folder ?? "").filter(Boolean))].sort();
  const folderEntryCount = (path: string): number =>
    entries.filter(e => (e.folder ?? "") === path || (e.folder ?? "").startsWith(path + "/")).length;
  const toggleFolderNode = (path: string) =>
    setExpandedFolderNodes(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  // Group entries by password to detect reuse
  const reusedGroups = (() => {
    const byPw = new Map<string, PasswordEntry[]>();
    for (const e of entries) {
      if (!e.password) continue;
      const group = byPw.get(e.password) ?? [];
      group.push(e);
      byPw.set(e.password, group);
    }
    return [...byPw.values()].filter(g => g.length >= 2);
  })();
  const reusedEntryIds = new Set(reusedGroups.flat().map(e => e.id));

  const countFor = (cat: Category) => {
    if (cat === "all") return entries.length;
    if (cat === "favorites") return entries.filter(e => e.favorite).length;
    if (cat === "reused") return reusedEntryIds.size;
    if (cat === "expired") return entries.filter(e => e.expires_at && e.expires_at < nowTs).length;
    return entries.filter(e => entryMatchesTag(e, cat)).length;
  };
  const expiredCount = countFor("expired");

  const openEntry = async (entry: PasswordEntry) => {
    const raw = entry.url?.trim();
    if (!raw) return;
    const type = entry.entry_type ?? "login";

    // Auto-copy password so it's ready to paste after the connection opens
    if (entry.password) {
      await copyToClipboard(entry.password, "Mot de passe");
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
          showToast(`Erreur ouverture ${type.toUpperCase()}: ${err}`);
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
            ? ` — effacé dans ${settings.clipboardClearSeconds} s` : "";
          showToast(`Mot de passe copié, collez-le dans TeamViewer${suffix}`);
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
  };

  const toggleSort = (field: SortField) =>
    setSort(s => s.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" });

  const setPresetSort = (field: SortField, dir: SortDir) =>
    setSort({ field, dir });

  const handleRowClick = (entry: PasswordEntry) => {
    const now = Date.now();
    const last = lastClickTime.current[entry.id] ?? 0;
    if (now - last < 400) {
      if (entry.url) openEntry(entry);
    } else {
      setSelectedId(entry.id);
      setPanelMode("view");
    }
    lastClickTime.current[entry.id] = now;
    setContextMenu(null);
  };

  const handleContextMenu = (e: React.MouseEvent, entry: PasswordEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

// Quick-save an entry with partial field updates (no panel needed)
  const quickSave = async (entry: PasswordEntry, patch: { tags?: string[]; folder?: string; favorite?: boolean }) => {
    const newTags = patch.tags ?? entry.tags;
    await invoke("save_entry", {
      entry: {
        id: entry.id,
        expires_at: entry.expires_at ?? null,
        title: entry.title,
        username: entry.username,
        password: entry.password,
        url: entry.url,
        notes: entry.notes,
        category: newTags[0] ?? entry.category,
        folder: patch.folder ?? entry.folder ?? "",
        tags: newTags,
        totp_secret: entry.totp_secret,
        favorite: patch.favorite ?? entry.favorite,
        entry_type: entry.entry_type ?? "login",
        extra_fields: entry.extra_fields ?? [],
      },
    });
    await loadEntries();
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
    ? `Verrouillage auto dans ${settings.lockTimeoutMinutes} min`
    : "Verrouillage auto désactivé";

  const isSearchActive = search.trim().length > 0;

  return (
    <div className="app-layout" onClick={() => setContextMenu(null)}>
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <img src="/LockSafe.ico" alt="" style={{ width: 20, height: 20, objectFit: "contain" }} />
          </div>
          <div>
            <div className="sidebar-title">Vaultix</div>
            <div className="sidebar-subtitle">{meta.name}</div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-label">Navigation</div>
          <button
            className={`sidebar-item ${category === "all" && selectedFolder === null ? "active" : ""}`}
            onClick={() => { setCategory("all"); setSelectedFolder(null); }}
          >
            <span style={{ pointerEvents: "none", display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
              <GridIcon size={16} />
              Tous
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
          {/* Favoris & Réutilisés */}
          <button
            className={`sidebar-item ${category === "favorites" ? "active" : ""}`}
            onClick={() => { setCategory("favorites"); setSelectedFolder(null); }}
          >
            <StarIcon size={16} />
            Favoris
            <span className="count" style={{ background: "rgba(245,158,11,0.14)", color: "#f59e0b" }}>{countFor("favorites")}</span>
          </button>
          <button
            className={`sidebar-item ${category === "reused" ? "active" : ""}`}
            onClick={() => { setCategory("reused"); setSelectedFolder(null); }}
          >
            <AlertIcon size={16} />
            Réutilisés
            <span className="count" style={{ background: "rgba(239,68,68,0.12)", color: "var(--danger)" }}>{countFor("reused")}</span>
          </button>
          {expiredCount > 0 && (
            <button
              className={`sidebar-item ${category === "expired" ? "active" : ""}`}
              onClick={() => { setCategory("expired"); setSelectedFolder(null); }}
              style={{ color: category === "expired" ? undefined : "var(--danger)" }}
            >
              <ClockExpiredIcon size={16} />
              Expirés
              <span className="count" style={{ background: "rgba(239,68,68,0.12)", color: "var(--danger)" }}>{expiredCount}</span>
            </button>
          )}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-label">Tags</div>
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
                <label title="Changer la couleur" style={{ flexShrink: 0, cursor: "pointer", position: "relative", display: "flex", alignItems: "center" }} onClick={e => e.stopPropagation()}>
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
          <button className="sidebar-item" onClick={() => setShowGenerator(true)}>
            <KeyIcon size={16} /> Générateur
          </button>
          <button className="sidebar-item" onClick={() => setShowSettings(true)}>
            <SettingsIcon size={16} /> Paramètres
          </button>
          <div className="divider" />
          <button className="sidebar-item" onClick={doLock} title={lockLabel}>
            <LockIcon size={16} /> Verrouiller
          </button>
          <button className="sidebar-item" onClick={doClose} style={{ color: "var(--text-3)" }}>
            <XIcon size={16} /> Changer de coffre
          </button>
          {updateInfo && (
            <UpdateBanner
              version={updateInfo.version}
              notes={updateInfo.notes}
              onDismiss={() => setUpdateInfo(null)}
            />
          )}
          <div className="divider" />
          <div style={{ textAlign: "center", fontSize: 11, fontWeight: 600, fontVariant: "small-caps", color: "var(--text-3)", opacity: 0.8, padding: "2px 0 4px", letterSpacing: "0.06em" }}>
            Vaultix {appVersion ? `v${appVersion}` : ""}
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="main-content">
        <div className="main-header">
          <h1>
            {category === "all" ? "Tous les mots de passe"
              : category === "favorites" ? "Favoris"
              : category === "reused" ? "Mots de passe réutilisés"
              : category === "expired" ? "Entrées expirées"
              : category}
          </h1>
          <div className="search-wrap">
            <SearchIcon size={16} />
            <input
              ref={searchRef}
              className="search-input"
              placeholder="Rechercher…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {isSearchActive && (
              <button
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", padding: "0 4px", lineHeight: 1 }}
                onClick={() => setSearch("")}
                title="Effacer la recherche"
              >
                <XIcon size={12} />
              </button>
            )}
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => { setSelectedId(null); setPanelMode("new"); }}>
            <PlusIcon size={13} /> Ajouter
          </button>
        </div>

        {/* Sort toolbar + search count */}
        <div style={{ display: (category === "reused") ? "none" : "flex", alignItems: "center", gap: 6, padding: "0 16px 10px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {[
              { label: "A→Z",   field: "title" as SortField,      dir: "asc" as SortDir },
              { label: "Z→A",   field: "title" as SortField,      dir: "desc" as SortDir },
              { label: "Récent", field: "updated_at" as SortField, dir: "desc" as SortDir },
              { label: "Force",  field: "strength" as SortField,   dir: "desc" as SortDir },
            ].map(p => {
              const active = sort.field === p.field && sort.dir === p.dir;
              return (
                <button
                  key={p.label}
                  className={`btn btn-sm ${active ? "btn-primary" : "btn-ghost"}`}
                  style={{ fontSize: 11, padding: "3px 8px" }}
                  onClick={() => setPresetSort(p.field, p.dir)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          {isSearchActive && (
            <span style={{ fontSize: 12, color: "var(--text-3)", marginLeft: "auto" }}>
              {filtered.length} résultat{filtered.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* ── Filter bar ── */}
        <div className="filter-bar">
          <select
            className="input"
            value={selectedFolder ?? ""}
            onChange={e => setSelectedFolder(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">Dossier : Tous</option>
            {allFolderPaths.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <select
            className="input"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as EntryType | "all")}
          >
            <option value="all">Type : Tous</option>
            <option value="login">Site Web</option>
            <option value="rdp">Remote Desktop (RDP)</option>
            <option value="ssh">SSH</option>
            <option value="ftp">FTP</option>
            <option value="sftp">SFTP</option>
            <option value="vnc">VNC</option>
            <option value="teamviewer">TeamViewer</option>
            <option value="telnet">Telnet</option>
            <option value="other">Autre</option>
            <option value="note">Note sécurisée</option>
          </select>
          {(selectedFolder !== null || typeFilter !== "all") && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setSelectedFolder(null); setTypeFilter("all"); }}
              style={{ fontSize: 12 }}
            >
              ✕ Effacer filtres
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
              <p>{search ? "Aucun résultat pour votre recherche." : <>Aucune entrée dans cette catégorie.<br/>Cliquez sur «&nbsp;Ajouter&nbsp;» pour commencer.</>}</p>
            </div>
          ) : (
            <table className="entry-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>{/* star */}
                  <th onClick={() => toggleSort("title")}>
                    Titre {sort.field === "title" ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th onClick={() => toggleSort("username")}>Utilisateur {sort.field === "username" ? (sort.dir === "asc" ? "▲" : "▼") : ""}</th>
                  <th onClick={() => toggleSort("url")}>URL</th>
                  <th onClick={() => toggleSort("strength")}>Force {sort.field === "strength" ? (sort.dir === "asc" ? "▲" : "▼") : ""}</th>
                  <th onClick={() => toggleSort("updated_at")}>Modifié {sort.field === "updated_at" ? (sort.dir === "asc" ? "▲" : "▼") : ""}</th>
                  <th style={{ width: 80 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry, rowIdx) => (
                  <tr
                    key={entry.id}
                    className={selectedId === entry.id ? "selected" : ""}
                    onClick={() => handleRowClick(entry)}
                    onContextMenu={e => handleContextMenu(e, entry)}
                    style={{
                      cursor: "pointer",
                      ...(settings.zebraStripes && rowIdx % 2 === 1 && selectedId !== entry.id
                        ? { background: "var(--zebra-bg)" } : {}),
                    }}
                  >
                    {/* Favorite star toggle */}
                    <td onClick={e => e.stopPropagation()} style={{ paddingLeft: 6, paddingRight: 0, width: 28 }}>
                      <button
                        className="btn-icon"
                        title={entry.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                        onClick={() => quickSave(entry, { favorite: !entry.favorite })}
                        style={{ color: entry.favorite ? "#f59e0b" : "var(--text-3)", padding: "2px 3px" }}
                      >
                        <StarIcon size={13} />
                      </button>
                    </td>
                    <td>
                      <div className="title-cell">
                        <div className="entry-icon">{entry.url ? getFavicon(entry.url) : <LockIcon size={13} />}</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span title={entry.title} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.title}</span>
                            {entry.totp_secret && <TotpIcon size={12} style={{ color: "var(--info)", flexShrink: 0 }} />}
                            {/* Protocol type badge */}
                            {(() => {
                              const tm = TYPE_META[entry.entry_type ?? "login"];
                              if (!tm) return null;
                              return (
                                <span style={{
                                  fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 700,
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
                                <span title={isExpired ? `Expiré il y a ${Math.abs(diff)} jour(s)` : `Expire dans ${diff} jour(s)`} style={{
                                  fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 700, flexShrink: 0,
                                  background: isExpired ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)",
                                  color: isExpired ? "var(--danger)" : "var(--warning)",
                                  border: `1px solid ${isExpired ? "rgba(239,68,68,0.3)" : "rgba(245,158,11,0.3)"}`,
                                }}>
                                  {isExpired ? "Expiré" : `${diff}j`}
                                </span>
                              );
                            })()}
                          </div>
                          {/* Tag badges */}
                          {(() => {
                            const entryTags = entry.tags ?? [];
                            const badges = entryTags.length > 0 ? entryTags : (entry.category ? [entry.category] : []);
                            if (badges.length === 0) return null;
                            return (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                                {badges.map(t => {
                                  const c = settings.tagColors?.[t] ?? "";
                                  return (
                                    <span key={t} title={t} style={{
                                      fontSize: 10, padding: "2px 6px", borderRadius: 8, lineHeight: 1.5,
                                      background: c ? c + "30" : "rgba(255,255,255,0.08)",
                                      border: `1px solid ${c ? c + "66" : "rgba(255,255,255,0.15)"}`,
                                      color: c || "var(--text-2)",
                                      whiteSpace: "nowrap", fontWeight: 500,
                                    }}>{t}</span>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </td>
                    <td title={entry.username || undefined}>{entry.username || "—"}</td>
                    <td>
                      {entry.url ? (
                        <UrlCell url={entry.url} entryType={entry.entry_type ?? "login"} onOpen={() => openEntry(entry)} onCopy={() => copyToClipboard(entry.url, "URL")} />
                      ) : <span style={{ color: "var(--text-3)" }}>—</span>}
                    </td>
                    <td><StrengthBadge score={entry.strength} /></td>
                    <td>{formatDate(entry.updated_at)}</td>
                    <td onClick={e => e.stopPropagation()} style={{ width: 110, paddingRight: 10 }}>
                      <div style={{ display: "flex", gap: 2, justifyContent: "flex-end", alignItems: "center" }}>
                        {/* Open */}
                        <button
                          className="btn-icon"
                          title={entry.url
                            ? (entry.entry_type === "rdp" ? "Ouvrir la connexion RDP"
                              : entry.entry_type === "ssh" ? "Ouvrir une session SSH"
                              : entry.entry_type === "ftp" ? "Ouvrir le client FTP"
                              : entry.entry_type === "sftp" ? "Ouvrir la connexion SFTP"
                              : entry.entry_type === "vnc" ? "Ouvrir la connexion VNC"
                              : entry.entry_type === "telnet" ? "Ouvrir Telnet"
                              : "Ouvrir dans le navigateur")
                            : "Aucune adresse renseignée"}
                          disabled={!entry.url}
                          style={{ opacity: entry.url ? 1 : 0.25 }}
                          onClick={() => openEntry(entry)}
                        >
                          <ExternalIcon size={15} />
                        </button>
                        {/* Copy dropdown */}
                        <CopyDropdown entry={entry} onCopy={copyToClipboard} />
                        {/* Actions */}
                        <ActionsButton entry={entry} onContextMenu={(e2, en) => {
                          e2.preventDefault();
                          setContextMenu({ x: e2.clientX, y: e2.clientY, entry: en });
                        }} />
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
            <ContextMenuItem
              icon={<UserIcon size={13} />}
              label="Copier l'identifiant"
              disabled={!contextMenu.entry.username}
              onClick={() => { copyToClipboard(contextMenu.entry.username, "Identifiant"); setContextMenu(null); }}
            />
            <ContextMenuItem
              icon={<CopyIcon size={13} />}
              label="Copier le mot de passe"
              onClick={() => { copyToClipboard(contextMenu.entry.password, "Mot de passe"); setContextMenu(null); }}
            />
            {contextMenu.entry.totp_secret && (
              <ContextMenuItem
                icon={<TotpIcon size={13} />}
                label="Copier le code TOTP"
                onClick={async () => {
                  try {
                    const r = await invoke<{ code: string }>("get_totp_code", { secret: contextMenu.entry.totp_secret });
                    copyToClipboard(r.code, "Code TOTP");
                  } catch {}
                  setContextMenu(null);
                }}
              />
            )}
            {contextMenu.entry.url && (
              <ContextMenuItem
                icon={<ExternalIcon size={13} />}
                label="Ouvrir la connexion"
                onClick={() => { openEntry(contextMenu.entry); setContextMenu(null); }}
              />
            )}
            <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
            <ContextMenuItem
              icon={<EditIcon size={13} />}
              label="Modifier"
              onClick={() => { setSelectedId(contextMenu.entry.id); setPanelMode("edit"); setContextMenu(null); }}
            />
            <ContextMenuItem
              icon={<TrashIcon size={13} />}
              label="Supprimer"
              danger
              onClick={() => { setPendingDelete(contextMenu.entry); setContextMenu(null); }}
            />
          </div>
        </>
      )}

      {/* ── Modals ── */}
      {showGenerator && <GeneratorModal onClose={() => setShowGenerator(false)} onUse={() => setShowGenerator(false)} />}
      {generatorCallback && (
        <GeneratorModal
          onClose={() => setGeneratorCallback(null)}
          onUse={(pw) => { generatorCallback(pw); setGeneratorCallback(null); }}
        />
      )}
      {showSettings && <SettingsPanel settings={settings} onSettingsChange={handleSettingsChange} onClose={() => setShowSettings(false)} dbPath={dbPath} />}

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
              Supprimer <strong>«&nbsp;{pendingDelete.title}&nbsp;»</strong> ?
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setPendingDelete(null)}>
              Annuler
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
              <TrashIcon size={12} /> Supprimer
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
function UrlCell({ url, onOpen, onCopy: _onCopy }: { url: string; entryType?: string; onOpen: () => void; onCopy: () => void }) {
  // Show a clean host / address — strip scheme for display
  const isHttp = url.startsWith("http://") || url.startsWith("https://") || (!url.includes("://") && url.includes("."));
  const host = isHttp ? getDisplayHost(url) : url.replace(/^[a-z][a-z0-9+\-.]*:\/\//i, "");
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 6 }}
      title="Double-cliquer pour ouvrir"
      onDoubleClick={e => { e.stopPropagation(); onOpen(); }}
    >
      <span style={{ color: "var(--accent)", fontSize: 12,
        maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        cursor: "pointer" }}
      >
        {host}
      </span>
    </div>
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
  return new Date(ts * 1000).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function StrengthBadge({ score }: { score: number }) {
  const color = STRENGTH_COLORS[score] ?? "#64748b";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ display: "flex", gap: 2 }}>
        {[0,1,2,3,4].map(i => <div key={i} style={{ width: 14, height: 4, borderRadius: 2, background: i <= score ? color : "rgba(255,255,255,0.08)" }} />)}
      </div>
      <span style={{ fontSize: 11, color, minWidth: 52 }}>{STRENGTH_LABELS[score]}</span>
    </div>
  );
}

// ── Copy dropdown ──────────────────────────────────────────────────────────────
function CopyDropdown({ entry, onCopy }: {
  entry: PasswordEntry;
  onCopy: (text: string, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ right: 0, top: 0 });
  const chevronRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && chevronRef.current) {
      const rect = chevronRef.current.getBoundingClientRect();
      setDropPos({ right: window.innerWidth - rect.right, top: rect.bottom + 4 });
    }
    setOpen(o => !o);
  };

  const items: { label: string; value: string }[] = [];
  const type = entry.entry_type ?? "login";
  if (type === "ssh") {
    if (entry.username) items.push({ label: "Identifiant", value: entry.username });
    const priv = entry.extra_fields?.find(([k]) => k === "private_key")?.[1] ?? "";
    const pub  = entry.extra_fields?.find(([k]) => k === "public_key")?.[1]  ?? "";
    if (priv) items.push({ label: "Clé privée", value: priv });
    if (pub)  items.push({ label: "Clé publique", value: pub });
  } else if (type === "note") {
    if (entry.notes) items.push({ label: "Contenu", value: entry.notes });
  } else {
    if (entry.username) items.push({ label: "Identifiant", value: entry.username });
    if (entry.password) items.push({ label: "Mot de passe", value: entry.password });
  }

  const primary = items[0];

  return (
    <div ref={containerRef} style={{ position: "relative", display: "flex" }} className="copy-split">
      <button
        className="btn-icon"
        title={primary ? `Copier ${primary.label.toLowerCase()}` : "Copier"}
        disabled={!primary}
        style={{ opacity: primary ? 1 : 0.25 }}
        onClick={e => { e.stopPropagation(); if (primary) onCopy(primary.value, primary.label); }}
      >
        <CopyIcon size={15} />
      </button>
      <button
        ref={chevronRef}
        className="btn-icon"
        title="Plus d'options"
        onClick={handleToggle}
      >
        <ChevronDownIcon size={10} />
      </button>
      {open && items.length > 0 && (
        <div style={{
          position: "fixed",
          right: dropPos.right,
          top: dropPos.top,
          zIndex: 1200,
          background: "var(--bg-card)",
          border: "1px solid var(--border-light)",
          borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          padding: 4,
          minWidth: 210,
        }}>
          {items.map(item => (
            <button
              key={item.label}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "7px 10px",
                border: "none", background: "none", borderRadius: 5,
                cursor: "pointer", fontSize: 13, textAlign: "left",
                color: "var(--text-1)", fontFamily: "inherit",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none"; }}
              onClick={e => { e.stopPropagation(); onCopy(item.value, item.label); setOpen(false); }}
            >
              <CopyIcon size={13} />
              Copier {item.label.toLowerCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Actions button (three dots) ────────────────────────────────────────────────
function ActionsButton({ entry, onContextMenu }: {
  entry: PasswordEntry;
  onContextMenu: (e: React.MouseEvent, entry: PasswordEntry) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      // Fake a mouse event at the bottom-left of the button
      onContextMenu(
        { ...e, clientX: rect.right, clientY: rect.bottom, preventDefault: () => {} } as React.MouseEvent,
        entry
      );
    }
  };
  return (
    <button ref={btnRef} className="btn-icon" title="Actions" onClick={handleClick}>
      <DotsIcon size={15} />
    </button>
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
function UserIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>; }
function ExternalIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>; }
function TrashIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>; }

function AlertIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>; }
function ClockExpiredIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><line x1="18" y1="18" x2="21" y2="21"/></svg>; }
function FolderIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>; }
function FolderOpenIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="1 11 22 11"/></svg>; }
function ChevronRightIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>; }
function ChevronDownIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>; }
function DotsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
    </svg>
  );
}

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
  if (groups.length === 0) {
    return (
      <div className="entry-list">
        <div className="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <p>Aucun mot de passe réutilisé détecté.<br/>Tous vos mots de passe sont uniques.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="entry-list" style={{ padding: "0 16px 16px" }}>
      <div style={{ fontSize: 12, color: "#f97316", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <AlertIcon size={13} />
        {groups.length} groupe{groups.length > 1 ? "s" : ""} de mots de passe partagés entre {groups.reduce((a, g) => a + g.length, 0)} entrées
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {groups.map((group, gi) => (
          <div key={gi} style={{ border: "1px solid #f9731644", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ background: "#f9731608", padding: "8px 12px", fontSize: 11, color: "#f97316", fontWeight: 600, borderBottom: "1px solid #f9731622" }}>
              Même mot de passe — {group.length} entrées
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
                <button className="btn-icon" title="Copier le mot de passe" onClick={ev => { ev.stopPropagation(); onCopy(entry.password, "Mot de passe"); }}>
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
