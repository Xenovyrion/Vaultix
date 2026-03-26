// ── Entry types ───────────────────────────────────────────────────────────────
export type EntryType = "login" | "rdp" | "ssh" | "ftp" | "sftp" | "vnc" | "telnet" | "teamviewer" | "other" | "note";

// ── Entry & Database ──────────────────────────────────────────────────────────

/** A full snapshot of all entry fields before a change. */
export interface EntryHistorySnapshot {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  category: string;
  changed_at: number; // unix timestamp
  changed_fields: string[]; // ["password", "username", ...]
}

export interface PasswordEntry {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  category: string;
  folder: string; // path with "/" separator, "" = root
  tags: string[];
  totp_secret: string | null;
  favorite: boolean;
  strength: number; // 0-4
  created_at: number; // unix timestamp
  updated_at: number;
  history: EntryHistorySnapshot[];
  entry_type: EntryType;
  extra_fields: [string, string][];
  expires_at: number | null; // unix timestamp, null = pas d'expiration
}

export interface DatabaseMeta {
  name: string;
  description: string;
  created_at: number;
  modified_at: number;
  entry_count: number;
  kdf: "argon2id";
  cipher: "aes-256-gcm";
}

export interface UnlockResult {
  success: boolean;
  error?: string;
}

export interface SaveEntryPayload {
  entry: Omit<PasswordEntry, "id" | "created_at" | "updated_at" | "strength">;
  id?: string; // present on edit, absent on create
}

export interface DeleteEntryPayload {
  id: string;
}

// ── Generator ─────────────────────────────────────────────────────────────────

export interface GeneratorOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
  exclude_ambiguous: boolean;
}

// ── TOTP ──────────────────────────────────────────────────────────────────────

export interface TotpCode {
  code: string;
  remaining_seconds: number;
}

// ── App state ─────────────────────────────────────────────────────────────────

export type Screen = "setup" | "unlock" | "vault";

export interface AppState {
  screen: Screen;
  db_path: string | null;
  db_meta: DatabaseMeta | null;
}

// ── Strength ──────────────────────────────────────────────────────────────────

export const STRENGTH_LABELS = ["Très faible", "Faible", "Moyen", "Fort", "Très fort"];
export const STRENGTH_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#22c55e", "#10b981"];

// ── Keyboard shortcuts ─────────────────────────────────────────────────────────

export type ShortcutAction =
  | "focus_search"
  | "new_entry"
  | "edit_entry"
  | "delete_entry"
  | "copy_password"
  | "copy_username"
  | "open_entry"
  | "copy_entry"   // copy entry to internal clipboard
  | "paste_entry"  // duplicate from internal clipboard
  | "navigate_up"
  | "navigate_down";

export type ShortcutMap = Record<ShortcutAction, string>;

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  focus_search:   "Focaliser la recherche",
  new_entry:      "Nouvelle entrée",
  edit_entry:     "Modifier l'entrée sélectionnée",
  delete_entry:   "Supprimer l'entrée sélectionnée",
  copy_password:  "Copier le mot de passe",
  copy_username:  "Copier l'identifiant",
  open_entry:     "Ouvrir la connexion",
  copy_entry:     "Copier la fiche (presse-papier interne)",
  paste_entry:    "Coller / dupliquer la fiche",
  navigate_up:    "Entrée précédente",
  navigate_down:  "Entrée suivante",
};

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  focus_search:   "ctrl+f",
  new_entry:      "ctrl+n",
  edit_entry:     "ctrl+e",
  delete_entry:   "Delete",
  copy_password:  "ctrl+shift+c",
  copy_username:  "ctrl+shift+u",
  open_entry:     "ctrl+o",
  copy_entry:     "ctrl+c",
  paste_entry:    "ctrl+v",
  navigate_up:    "ArrowUp",
  navigate_down:  "ArrowDown",
};

/** Build a canonical shortcut string from a KeyboardEvent. */
export function parseShortcut(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey)  parts.push("ctrl");
  if (e.altKey)   parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  const key = e.key;
  if (!["Control", "Alt", "Shift", "Meta"].includes(key)) {
    parts.push(key.length === 1 ? key.toLowerCase() : key);
  }
  return parts.join("+");
}

/** Convert a shortcut string to a human-readable label. */
export function formatShortcutDisplay(shortcut: string): string {
  return shortcut.split("+").map(part => {
    const p = part.toLowerCase();
    if (p === "ctrl")      return "Ctrl";
    if (p === "alt")       return "Alt";
    if (p === "shift")     return "Shift";
    if (p === "arrowup")   return "↑";
    if (p === "arrowdown") return "↓";
    if (p === "arrowleft") return "←";
    if (p === "arrowright")return "→";
    if (p === "delete")    return "Suppr";
    if (p === "enter")     return "↵";
    if (p === "escape")    return "Esc";
    if (p === "tab")       return "Tab";
    if (p === "backspace") return "⌫";
    if (p === " ")         return "Espace";
    return part.toUpperCase();
  }).join(" + ");
}
