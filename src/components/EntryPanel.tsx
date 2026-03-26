import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type PasswordEntry, type EntryHistorySnapshot, type EntryType, STRENGTH_COLORS, STRENGTH_LABELS } from "../types";

interface Props {
  mode: "view" | "edit";
  entry: PasswordEntry | null;
  defaultCategory: string;
  customTags: string[];
  tagColors: Record<string, string>;
  allFolders: string[];
  onSaved: () => void;
  onDeleted: () => void;
  onClose: () => void;
  onCopy: (text: string, label: string) => void;
  onRequestGenerator: (cb: (pw: string) => void) => void;
}

// Tags are now fully driven by settings (passed via customTags prop from Vault).

// ── Entry type definitions ────────────────────────────────────────────────────
type ExtraKey = { key: string; label: string; placeholder?: string; secret?: boolean; multiline?: boolean };

const ENTRY_TYPES: {
  value: EntryType; label: string; icon: React.ReactNode;
  extraKeys: ExtraKey[];
  showUsername: boolean; showPassword: boolean; showUrl: boolean; showTotp: boolean;
  urlLabel: string; urlPlaceholder: string;
}[] = [
  {
    value: "login", label: "Site Web",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
    urlLabel: "URL du site", urlPlaceholder: "https://exemple.com",
    extraKeys: [], showUsername: true, showPassword: true, showUrl: true, showTotp: true,
  },
  {
    value: "rdp", label: "Remote Desktop",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
    urlLabel: "Hôte / Adresse IP", urlPlaceholder: "192.168.1.1 ou SERVEUR-PC",
    extraKeys: [
      { key: "port",   label: "Port RDP",  placeholder: "3389" },
      { key: "domain", label: "Domaine",   placeholder: "DOMAIN.LOCAL" },
    ],
    showUsername: true, showPassword: true, showUrl: true, showTotp: false,
  },
  {
    value: "ssh", label: "SSH",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
    urlLabel: "Hôte / Serveur", urlPlaceholder: "hostname ou 192.168.1.1",
    extraKeys: [
      { key: "port",        label: "Port",         placeholder: "22" },
      { key: "public_key",  label: "Clé publique", placeholder: "ssh-ed25519 AAAA…",                           multiline: true },
      { key: "private_key", label: "Clé privée",   placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----",         multiline: true, secret: true },
      { key: "passphrase",  label: "Passphrase",   placeholder: "",                                            secret: true },
      { key: "fingerprint", label: "Fingerprint",  placeholder: "SHA256:…" },
    ],
    showUsername: true, showPassword: false, showUrl: true, showTotp: false,
  },
  {
    value: "ftp", label: "FTP",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>,
    urlLabel: "Hôte FTP", urlPlaceholder: "ftp.exemple.com ou 192.168.1.1",
    extraKeys: [
      { key: "port", label: "Port FTP", placeholder: "21" },
    ],
    showUsername: true, showPassword: true, showUrl: true, showTotp: false,
  },
  {
    value: "sftp", label: "SFTP",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><polyline points="16 16 19 19 22 16"/></svg>,
    urlLabel: "Hôte SFTP", urlPlaceholder: "sftp.exemple.com ou 192.168.1.1",
    extraKeys: [
      { key: "port", label: "Port SFTP", placeholder: "22" },
    ],
    showUsername: true, showPassword: true, showUrl: true, showTotp: false,
  },
  {
    value: "vnc", label: "VNC",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><circle cx="12" cy="10" r="3"/></svg>,
    urlLabel: "Hôte VNC", urlPlaceholder: "192.168.1.1",
    extraKeys: [
      { key: "port", label: "Port VNC", placeholder: "5900" },
    ],
    showUsername: false, showPassword: true, showUrl: true, showTotp: false,
  },
  {
    value: "teamviewer", label: "TeamViewer",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 10h10"/><path d="M12 7v6"/></svg>,
    urlLabel: "ID TeamViewer", urlPlaceholder: "123456789",
    extraKeys: [],
    showUsername: false, showPassword: true, showUrl: true, showTotp: false,
  },
  {
    value: "telnet", label: "Telnet",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><polyline points="12 19 20 19"/></svg>,
    urlLabel: "Hôte", urlPlaceholder: "hostname ou 192.168.1.1",
    extraKeys: [
      { key: "port", label: "Port Telnet", placeholder: "23" },
    ],
    showUsername: true, showPassword: true, showUrl: true, showTotp: false,
  },
  {
    value: "other", label: "Autre",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
    urlLabel: "URL / Adresse", urlPlaceholder: "",
    extraKeys: [],
    showUsername: true, showPassword: true, showUrl: true, showTotp: false,
  },
  {
    value: "note", label: "Note sécurisée",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
    urlLabel: "URL", urlPlaceholder: "",
    extraKeys: [], showUsername: false, showPassword: false, showUrl: false, showTotp: false,
  },
];

export default function EntryPanel({ mode: initialMode, entry, defaultCategory, customTags, tagColors, allFolders, onSaved, onDeleted, onClose, onCopy, onRequestGenerator }: Props) {
  const [mode, setMode] = useState(initialMode);
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [totpCode, setTotpCode] = useState<{ code: string; remaining: number } | null>(null);

  // Init tags: prefer entry.tags if non-empty, fallback to [entry.category] for old data
  const initTags = (e: PasswordEntry | null) =>
    e ? (e.tags.length > 0 ? e.tags : (e.category ? [e.category] : [])) : (defaultCategory ? [defaultCategory] : []);

  // Form state
  const [title, setTitle] = useState(entry?.title ?? "");
  const [username, setUsername] = useState(entry?.username ?? "");
  const [password, setPassword] = useState(entry?.password ?? "");
  const [url, setUrl] = useState(entry?.url ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [tags, setTags] = useState<string[]>(initTags(entry));
  const [folder, setFolder] = useState(entry?.folder ?? "");
  const [favorite, setFavorite] = useState(entry?.favorite ?? false);
  const [totpSecret, setTotpSecret] = useState(entry?.totp_secret ?? "");
  const [entryType, setEntryType] = useState<EntryType>(entry?.entry_type ?? "login");
  const [extraFields, setExtraFields] = useState<[string, string][]>(entry?.extra_fields ?? []);
  // expires_at stored as YYYY-MM-DD string (empty = no expiry)
  const tsToDate = (ts: number | null | undefined) =>
    ts ? new Date(ts * 1000).toISOString().split("T")[0] : "";
  const [expiresAt, setExpiresAt] = useState<string>(tsToDate(entry?.expires_at));

  // Sync when entry changes
  useEffect(() => {
    setMode(initialMode);
    setTitle(entry?.title ?? "");
    setUsername(entry?.username ?? "");
    setPassword(entry?.password ?? "");
    setUrl(entry?.url ?? "");
    setNotes(entry?.notes ?? "");
    setTags(initTags(entry));
    setFolder(entry?.folder ?? "");
    setFavorite(entry?.favorite ?? false);
    setTotpSecret(entry?.totp_secret ?? "");
    setEntryType(entry?.entry_type ?? "login");
    setExtraFields(entry?.extra_fields ?? []);
    setExpiresAt(tsToDate(entry?.expires_at));
    setShowPw(false);
    setConfirmDelete(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, initialMode, defaultCategory]);

  // TOTP live code
  useEffect(() => {
    if (!entry?.totp_secret || mode !== "view") return;
    const fetch = async () => {
      try {
        const r = await invoke<{ code: string; remaining_seconds: number }>("get_totp_code", { secret: entry.totp_secret });
        setTotpCode({ code: r.code, remaining: r.remaining_seconds });
      } catch { setTotpCode(null); }
    };
    fetch();
    const id = window.setInterval(fetch, 1000);
    return () => clearInterval(id);
  }, [entry?.totp_secret, mode]);

  const strength = calcStrength(password);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await invoke("save_entry", {
        entry: {
          id: entry?.id ?? null,
          title: title.trim(),
          username,
          password,
          url,
          notes,
          category: tags[0] ?? defaultCategory,
          folder: folder.trim(),
          tags,
          totp_secret: totpSecret || null,
          favorite,
          entry_type: entryType,
          extra_fields: extraFields,
          expires_at: expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : null,
        },
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!entry) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await invoke("delete_entry", { id: entry.id });
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  const handleOpenGenerator = () => {
    onRequestGenerator((pw) => setPassword(pw));
  };

  const isNew = !entry;
  const title_ = isNew ? "Nouvelle entrée" : (mode === "edit" ? "Modifier l'entrée" : entry.title);

  return (
    <div className="side-panel">
      {/* Header */}
      <div className="panel-header">
        <h2>{title_}</h2>
        <div style={{ display: "flex", gap: 4 }}>
          {mode === "view" && (
            <button className="btn-icon" onClick={() => setMode("edit")} title="Modifier">
              <EditIcon size={14} />
            </button>
          )}
          <button className="btn-icon" onClick={onClose} title="Fermer">
            <XIcon size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="panel-body">
        {mode === "view" && entry ? (
          <ViewMode entry={entry} showPw={showPw} setShowPw={setShowPw} onCopy={onCopy} totpCode={totpCode} />
        ) : (
          <EditMode
            title={title} setTitle={setTitle}
            username={username} setUsername={setUsername}
            password={password} setPassword={setPassword}
            url={url} setUrl={setUrl}
            notes={notes} setNotes={setNotes}
            tags={tags} setTags={setTags}
            allTags={customTags}
            tagColors={tagColors}
            folder={folder} setFolder={setFolder}
            allFolders={allFolders}
            favorite={favorite} setFavorite={setFavorite}
            totpSecret={totpSecret} setTotpSecret={setTotpSecret}
            showPw={showPw} setShowPw={setShowPw}
            strength={strength}
            onGeneratePw={handleOpenGenerator}
            entryType={entryType} setEntryType={setEntryType}
            extraFields={extraFields} setExtraFields={setExtraFields}
            expiresAt={expiresAt} setExpiresAt={setExpiresAt}
          />
        )}
      </div>

      {/* Footer */}
      <div className="panel-footer">
        {mode === "view" && entry && (
          <>
            {confirmDelete ? (
              <>
                <span style={{ fontSize: 12, color: "var(--danger)", marginRight: "auto" }}>Confirmer la suppression ?</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Annuler</button>
                <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "..." : "Supprimer"}
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-ghost btn-sm" style={{ marginRight: "auto", color: "var(--danger)" }} onClick={handleDelete}>
                  <TrashIcon size={13} /> Supprimer
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => setMode("edit")}>
                  <EditIcon size={13} /> Modifier
                </button>
              </>
            )}
          </>
        )}

        {mode === "edit" && (
          <>
            {!isNew && (
              <button className="btn btn-ghost btn-sm" style={{ marginRight: "auto" }} onClick={() => setMode("view")}>
                Annuler
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !title.trim()}>
              {saving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <SaveIcon size={13} />}
              {saving ? "Sauvegarde..." : "Enregistrer"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── View mode ─────────────────────────────────────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
  title: "Titre", username: "Nom d'utilisateur", password: "Mot de passe",
  url: "URL", notes: "Notes", category: "Tag", tags: "Tags",
};

function estimateEntropy(pw: string): number {
  if (!pw) return 0;
  let size = 0;
  if (/[a-z]/.test(pw)) size += 26;
  if (/[A-Z]/.test(pw)) size += 26;
  if (/[0-9]/.test(pw)) size += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) size += 32;
  if (size === 0) return 0;
  return Math.log2(size) * pw.length;
}

function entropyLabel(bits: number): { label: string; color: string } {
  if (bits < 28) return { label: "Catastrophique", color: "#ef4444" };
  if (bits < 36) return { label: "Très faible",    color: "#ef4444" };
  if (bits < 50) return { label: "Faible",          color: "#f97316" };
  if (bits < 64) return { label: "Moyen",           color: "#f59e0b" };
  if (bits < 80) return { label: "Fort",            color: "#22c55e" };
  return                { label: "Très fort",       color: "#10b981" };
}

function ViewMode({ entry, showPw, setShowPw, onCopy, totpCode }: {
  entry: PasswordEntry;
  showPw: boolean;
  setShowPw: (v: boolean) => void;
  onCopy: (text: string, label: string) => void;
  totpCode: { code: string; remaining: number } | null;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyShowIdx, setHistoryShowIdx] = useState<number | null>(null);
  const [hibpStatus, setHibpStatus] = useState<"idle" | "checking" | number>("idle");

  const history = entry.history ?? [];

  const checkHibp = async () => {
    setHibpStatus("checking");
    try {
      const count = await invoke<number>("check_hibp_password", { password: entry.password });
      setHibpStatus(count);
    } catch {
      setHibpStatus(0);
    }
  };

  const bits = estimateEntropy(entry.password);
  const { label: entLabel, color: entColor } = entropyLabel(bits);

  return (
    <>
      {/* Title row with favicon */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: "var(--bg-hover)",
          border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {entry.url ? (
            <img
              src={`https://www.google.com/s2/favicons?sz=32&domain=${new URL(entry.url.startsWith("http") ? entry.url : "https://" + entry.url).hostname}`}
              width={20} height={20} style={{ borderRadius: 4 }} alt=""
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <LockIcon size={18} />
          )}
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>{entry.title}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
            {(entry.tags.length > 0 ? entry.tags : (entry.category ? [entry.category] : [])).map(t => (
              <span key={t} style={{ padding: "1px 6px", borderRadius: 10, background: "var(--bg-hover)", border: "1px solid var(--border-light)", fontSize: 10 }}>{t}</span>
            ))}
            {entry.folder && <span title="Dossier" style={{ opacity: 0.7 }}>· {entry.folder}</span>}
          </div>
        </div>
        {entry.favorite && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" strokeWidth="2" style={{ marginLeft: "auto" }}>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        )}
      </div>

      {/* Type badge */}
      {(() => {
        const t = ENTRY_TYPES.find(x => x.value === (entry.entry_type ?? "login"));
        return t ? (
          <span className="type-badge" style={{ marginLeft: 4 }}>{t.icon} {t.label}</span>
        ) : null;
      })()}

      <div className="divider" />

      {/* Username */}
      {entry.username && (
        <Field label="Nom d'utilisateur">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: 1, color: "var(--text-1)", fontSize: 13 }}>{entry.username}</span>
            <button className="btn-icon" onClick={() => onCopy(entry.username, "Nom d'utilisateur")} title="Copier">
              <CopyIcon size={13} />
            </button>
          </div>
        </Field>
      )}

      {/* Password */}
      <Field label="Mot de passe">
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className={showPw ? "input-mono" : "password-mask"} style={{ flex: 1, color: "var(--text-1)", fontSize: 13 }}>
            {showPw ? entry.password : "••••••••••••"}
          </span>
          <button className="btn-icon" onClick={() => setShowPw(!showPw)} title={showPw ? "Masquer" : "Afficher"}>
            {showPw ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
          </button>
          <button className="btn-icon" onClick={() => onCopy(entry.password, "Mot de passe")} title="Copier">
            <CopyIcon size={13} />
          </button>
        </div>
        <StrengthRow score={entry.strength} />
        {/* Entropy */}
        {entry.password && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <div style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 2, background: entColor, width: `${Math.min(100, (bits / 128) * 100)}%`, transition: "width 0.3s" }} />
            </div>
            <span style={{ fontSize: 10, color: entColor, minWidth: 110, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {bits.toFixed(1)} bits · {entLabel}
            </span>
          </div>
        )}
        {/* HIBP breach check */}
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11, padding: "2px 8px" }}
            onClick={checkHibp}
            disabled={hibpStatus === "checking" || !entry.password}
            title="Vérifier si ce mot de passe a fuité (HaveIBeenPwned)"
          >
            {hibpStatus === "checking"
              ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Vérification…</>
              : <><ShieldIcon size={11} /> Vérifier les fuites</>
            }
          </button>
          {hibpStatus !== "idle" && hibpStatus !== "checking" && (
            hibpStatus > 0
              ? <span style={{ fontSize: 11, color: "#ef4444" }}>⚠ Compromis {hibpStatus.toLocaleString()} fois !</span>
              : <span style={{ fontSize: 11, color: "var(--success)" }}>✓ Non trouvé dans les fuites</span>
          )}
        </div>
      </Field>

      {/* URL */}
      {entry.url && (
        <Field label="URL">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <a
              href="#"
              onClick={e => { e.preventDefault(); import("@tauri-apps/plugin-opener").then(m => m.openUrl(entry.url)); }}
              style={{ flex: 1, color: "var(--accent)", fontSize: 13, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {entry.url}
            </a>
            <button className="btn-icon" onClick={() => onCopy(entry.url, "URL")} title="Copier">
              <CopyIcon size={13} />
            </button>
          </div>
        </Field>
      )}

      {/* TOTP */}
      {entry.totp_secret && totpCode && (
        <Field label="Code MFA (TOTP)">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="totp-code">{totpCode.code.slice(0, 3)} {totpCode.code.slice(3)}</span>
            <button className="btn-icon" onClick={() => onCopy(totpCode.code, "Code TOTP")} title="Copier">
              <CopyIcon size={13} />
            </button>
          </div>
          <div className="totp-progress">
            <div className="totp-progress-bar" style={{ width: `${(totpCode.remaining / 30) * 100}%` }} />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{totpCode.remaining}s restantes</div>
        </Field>
      )}

      {/* Notes */}
      {entry.notes && (
        <Field label="Notes">
          <div style={{ color: "var(--text-2)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", userSelect: "text" }}>
            {entry.notes}
          </div>
        </Field>
      )}

      {/* Expiry */}
      {entry.expires_at && (() => {
        const now = Math.floor(Date.now() / 1000);
        const diff = Math.ceil((entry.expires_at - now) / 86400);
        const isExpired = diff <= 0;
        const isSoon = !isExpired && diff <= 7;
        return (
          <Field label="Expiration">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: isExpired ? "var(--danger)" : isSoon ? "var(--warning)" : "var(--text-1)" }}>
                {new Date(entry.expires_at * 1000).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}
              </span>
              <span style={{
                fontSize: 10, padding: "2px 7px", borderRadius: 10, fontWeight: 600,
                background: isExpired ? "rgba(239,68,68,0.15)" : isSoon ? "rgba(245,158,11,0.15)" : "rgba(34,197,94,0.12)",
                color: isExpired ? "var(--danger)" : isSoon ? "var(--warning)" : "var(--success)",
              }}>
                {isExpired ? `Expiré il y a ${Math.abs(diff)} j` : `Expire dans ${diff} j`}
              </span>
            </div>
          </Field>
        );
      })()}

      {/* Extra type-specific fields */}
      {(() => {
        const typeDef = ENTRY_TYPES.find(t => t.value === (entry.entry_type ?? "login"));
        if (!typeDef || typeDef.extraKeys.length === 0) return null;
        const extraMap = Object.fromEntries(entry.extra_fields ?? []);
        return typeDef.extraKeys
          .filter(ef => extraMap[ef.key])
          .map(ef => (
            <Field key={ef.key} label={ef.label}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ flex: 1, color: "var(--text-1)", fontSize: 13, fontFamily: ef.secret ? "monospace" : "inherit", wordBreak: "break-all" }}>
                  {ef.secret ? "••••••••" : extraMap[ef.key]}
                </span>
                <button className="btn-icon" onClick={() => onCopy(extraMap[ef.key], ef.label)} title="Copier">
                  <CopyIcon size={13} />
                </button>
              </div>
            </Field>
          ));
      })()}

      {/* Full history — always shown */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 4 }}>
        <button
          onClick={() => setHistoryOpen(o => !o)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-3)", fontSize: 12, padding: 0, width: "100%",
          }}
        >
          <HistoryIcon size={13} />
          <span>Historique des modifications</span>
          {history.length > 0 && (
            <span style={{ marginLeft: "auto", fontSize: 11, background: "var(--bg-hover)", borderRadius: 10, padding: "1px 7px" }}>
              {history.length}
            </span>
          )}
          <span style={{ fontSize: 10, marginLeft: history.length === 0 ? "auto" : undefined }}>{historyOpen ? "▲" : "▼"}</span>
        </button>

        {historyOpen && history.length === 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-3)", padding: "8px 10px",
            background: "var(--bg-hover)", borderRadius: 8, border: "1px solid var(--border)" }}>
            Aucune modification enregistrée. L'historique se remplit dès qu'un champ est modifié et sauvegardé.
          </div>
        )}

        {historyOpen && history.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {[...history].reverse().map((h: EntryHistorySnapshot, i: number) => (
              <div key={i} style={{
                padding: "8px 10px", borderRadius: 8, background: "var(--bg-hover)",
                border: "1px solid var(--border)", fontSize: 12,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {h.changed_fields.map(f => (
                      <span key={f} style={{
                        fontSize: 10, padding: "1px 6px", borderRadius: 10,
                        background: "var(--accent-dim)", color: "var(--accent)", fontWeight: 500,
                      }}>
                        {FIELD_LABELS[f] ?? f}
                      </span>
                    ))}
                  </div>
                  <span style={{ color: "var(--text-3)", fontSize: 11, flexShrink: 0, marginLeft: 8 }}>
                    {new Date(h.changed_at * 1000).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {h.changed_fields.includes("password") && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: "var(--text-3)", flexShrink: 0 }}>Mot de passe :</span>
                    <span className={historyShowIdx === i ? "input-mono" : "password-mask"} style={{ flex: 1, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
                      {historyShowIdx === i ? h.password : "••••••••"}
                    </span>
                    <button className="btn-icon" onClick={() => setHistoryShowIdx(historyShowIdx === i ? null : i)}>
                      {historyShowIdx === i ? <EyeOffIcon size={11} /> : <EyeIcon size={11} />}
                    </button>
                    <button className="btn-icon" onClick={() => onCopy(h.password, "Ancien mot de passe")}>
                      <CopyIcon size={11} />
                    </button>
                  </div>
                )}
                {h.changed_fields.includes("username") && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                    <span style={{ fontSize: 11, color: "var(--text-3)", flexShrink: 0 }}>Login :</span>
                    <span style={{ flex: 1, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>{h.username}</span>
                  </div>
                )}
                {h.changed_fields.includes("url") && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                    <span style={{ fontSize: 11, color: "var(--text-3)", flexShrink: 0 }}>URL :</span>
                    <span style={{ flex: 1, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>{h.url}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dates */}
      <div style={{ marginTop: 4, padding: "10px 0", borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-3)" }}>
          <span>Créé le {new Date(entry.created_at * 1000).toLocaleDateString("fr-FR")}</span>
          <span>Modifié le {new Date(entry.updated_at * 1000).toLocaleDateString("fr-FR")}</span>
        </div>
      </div>
    </>
  );
}

// ── Edit mode ─────────────────────────────────────────────────────────────────
function EditMode({ title, setTitle, username, setUsername, password, setPassword, url, setUrl, notes, setNotes, tags, setTags, allTags, tagColors, folder, setFolder, allFolders, favorite, setFavorite, totpSecret, setTotpSecret, showPw, setShowPw, strength, onGeneratePw, entryType, setEntryType, extraFields, setExtraFields, expiresAt, setExpiresAt }: {
  title: string; setTitle: (v: string) => void;
  username: string; setUsername: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  url: string; setUrl: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
  tags: string[]; setTags: (v: string[]) => void;
  allTags: string[];
  tagColors: Record<string, string>;
  folder: string; setFolder: (v: string) => void;
  allFolders: string[];
  favorite: boolean; setFavorite: (v: boolean) => void;
  totpSecret: string; setTotpSecret: (v: string) => void;
  showPw: boolean; setShowPw: (v: boolean) => void;
  strength: number;
  onGeneratePw: () => void;
  entryType: EntryType; setEntryType: (v: EntryType) => void;
  extraFields: [string, string][]; setExtraFields: (updater: (prev: [string, string][]) => [string, string][]) => void;
  expiresAt: string; setExpiresAt: (v: string) => void;
}) {
  const typeDef = ENTRY_TYPES.find(t => t.value === entryType) ?? ENTRY_TYPES[0];
  const getExtra = (key: string) => extraFields.find(([k]) => k === key)?.[1] ?? "";
  const setExtra = (key: string, value: string) =>
    setExtraFields(prev => {
      const filtered = prev.filter(([k]) => k !== key);
      return value ? [...filtered, [key, value] as [string, string]] : filtered;
    });

  return (
    <>
      {/* Type selector */}
      <div className="field-group">
        <label className="field-label">Type d'élément</label>
        <div className="type-selector">
          {ENTRY_TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              className={`btn-type ${entryType === t.value ? "active" : ""}`}
              onClick={() => setEntryType(t.value)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Titre *</label>
        <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="ex: Gmail, GitHub…" autoFocus />
      </div>

      {typeDef.showUsername && (
        <div className="field-group">
          <label className="field-label">Nom d'utilisateur / Email</label>
          <input className="input" value={username} onChange={e => setUsername(e.target.value)} placeholder="utilisateur@exemple.com" autoComplete="off" />
        </div>
      )}

      {typeDef.showPassword && (
        <div className="field-group">
          <label className="field-label">Mot de passe</label>
          <div className="input-wrap">
            <input className="input input-mono" type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Mot de passe" autoComplete="new-password" />
            <div className="input-wrap-actions">
              <button className="btn-icon" onClick={() => setShowPw(!showPw)} type="button">
                {showPw ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
              </button>
              <button className="btn-icon" onClick={onGeneratePw} type="button" title="Générateur">
                <RefreshIcon size={13} />
              </button>
            </div>
          </div>
          {password && <StrengthRow score={strength} />}
        </div>
      )}

      {typeDef.showUrl && (
        <div className="field-group">
          <label className="field-label">{typeDef.urlLabel}</label>
          <input className="input" value={url} onChange={e => setUrl(e.target.value)} placeholder={typeDef.urlPlaceholder} autoComplete="off" />
        </div>
      )}

      {/* Extra type-specific fields */}
      {typeDef.extraKeys.map(ef => (
        <div key={ef.key} className="field-group">
          <label className="field-label">{ef.label}</label>
          {ef.multiline ? (
            <textarea
              className="input input-mono"
              rows={4}
              value={getExtra(ef.key)}
              onChange={e => setExtra(ef.key, e.target.value)}
              placeholder={ef.placeholder}
              autoComplete="off"
            />
          ) : (
            <input
              className={`input${ef.secret ? " input-mono" : ""}`}
              type={ef.secret && !showPw ? "password" : "text"}
              value={getExtra(ef.key)}
              onChange={e => setExtra(ef.key, e.target.value)}
              placeholder={ef.placeholder}
              autoComplete="off"
            />
          )}
        </div>
      ))}

      {typeDef.showTotp && (
        <div className="field-group">
          <label className="field-label">Secret TOTP (MFA)</label>
          <input className="input input-mono" value={totpSecret} onChange={e => setTotpSecret(e.target.value)} placeholder="JBSWY3DPEHPK3PXP" autoComplete="off" />
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
            Entrez le secret Base32 fourni par le service.
          </div>
        </div>
      )}

      <div className="field-group">
        <label className="field-label">Tags</label>
        <TagPicker tags={tags} setTags={setTags} allTags={allTags} tagColors={tagColors} />
      </div>

      <div className="field-group">
        <label className="field-label">Dossier</label>
        <FolderPicker folder={folder} setFolder={setFolder} allFolders={allFolders} />
      </div>

      <div className="field-group">
        <label className="field-label">Notes</label>
        <textarea className="input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes, informations supplémentaires…" rows={3} />
      </div>

      <label className="checkbox-row" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={favorite} onChange={e => setFavorite(e.target.checked)} />
        <span>Marquer comme favori</span>
      </label>

      {/* Expiry date */}
      <div className="field-group">
        <label className="field-label">
          Date d'expiration
          <span style={{ fontWeight: 400, color: "var(--text-3)", marginLeft: 6 }}>— optionnel</span>
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="date"
            className="input"
            value={expiresAt}
            onChange={e => setExpiresAt(e.target.value)}
            style={{ maxWidth: 180 }}
          />
          {expiresAt && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setExpiresAt("")}
            >
              Retirer
            </button>
          )}
        </div>
        {expiresAt && (() => {
          const diff = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
          if (diff < 0) return <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 3 }}>⚠ Ce mot de passe est déjà expiré.</div>;
          if (diff <= 7) return <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 3 }}>⚠ Expire dans {diff} jour{diff > 1 ? "s" : ""}.</div>;
          return <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>Expire dans {diff} jours.</div>;
        })()}
      </div>
    </>
  );
}

// ── Folder picker ─────────────────────────────────────────────────────────────
function FolderPicker({ folder, setFolder, allFolders }: {
  folder: string; setFolder: (v: string) => void;
  allFolders: string[];
}) {
  const isInList = folder === "" || allFolders.includes(folder);
  const [mode, setMode] = useState<"select" | "type">(
    allFolders.length === 0 || !isInList ? "type" : "select"
  );

  if (mode === "type" || allFolders.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            value={folder}
            onChange={e => setFolder(e.target.value)}
            placeholder="ex: Travail  ou  Travail/Projets"
            autoComplete="off"
          />
          {allFolders.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => setMode("select")}
              title="Choisir un dossier existant"
            >
              Existant
            </button>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
          Utilisez « / » pour les sous-dossiers. Laissez vide pour la racine.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6 }}>
      <select
        className="input"
        style={{ flex: 1 }}
        value={folder}
        onChange={e => setFolder(e.target.value)}
      >
        <option value="">(Racine)</option>
        {allFolders.map(f => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
      <button type="button" className="btn btn-ghost btn-sm"
        onClick={() => { setMode("type"); setFolder(""); }}
        title="Créer un nouveau dossier"
      >
        + Nouveau
      </button>
    </div>
  );
}

// ── Tag picker ────────────────────────────────────────────────────────────────
function TagPicker({ tags, setTags, allTags, tagColors }: {
  tags: string[]; setTags: (v: string[]) => void;
  allTags: string[]; tagColors: Record<string, string>;
}) {
  const toggle = (t: string) =>
    setTags(tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Selected tags as removable chips */}
      {tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {tags.map(t => {
            const color = tagColors[t] ?? "var(--accent)";
            return (
              <span key={t} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 500,
                background: color + "22", border: `1px solid ${color}66`, color: color,
                cursor: "pointer",
              }} onClick={() => toggle(t)} title="Cliquer pour retirer">
                {t} <span style={{ fontSize: 10, opacity: 0.7 }}>×</span>
              </span>
            );
          })}
        </div>
      )}
      {/* Available tags to add */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {allTags.filter(t => !tags.includes(t)).map(t => {
          const color = tagColors[t];
          return (
            <button key={t} type="button" onClick={() => toggle(t)} style={{
              padding: "2px 8px", borderRadius: 12, fontSize: 11,
              background: "var(--bg-hover)", border: "1px solid var(--border)",
              color: color ?? "var(--text-2)", cursor: "pointer",
            }}>
              + {t}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Shared ────────────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field-group">
      <div className="field-label">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function StrengthRow({ score }: { score: number }) {
  const color = STRENGTH_COLORS[score] ?? "#64748b";
  const label = STRENGTH_LABELS[score] ?? "";
  return (
    <div className="pw-strength-row" style={{ marginTop: 5 }}>
      {[0,1,2,3,4].map(i => (
        <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= score ? color : "rgba(255,255,255,0.08)" }} />
      ))}
      <span className="pw-strength-label" style={{ color }}>{label}</span>
    </div>
  );
}

function calcStrength(pw: string): number {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 14) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, Math.max(0, s - 1));
}

// Icons
function EyeIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>; }
function EyeOffIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>; }
function CopyIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>; }
function EditIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function XIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
function TrashIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>; }
function SaveIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>; }
function RefreshIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>; }
function LockIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>; }
function HistoryIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>; }
function ShieldIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
