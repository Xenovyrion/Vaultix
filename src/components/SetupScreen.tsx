import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getRecentDbs, removeRecentDb, type RecentDb } from "../utils/recentDbs";

interface Props {
  onCreated: (path: string) => void;
  onOpened: (path: string) => void;
  onCreatedAndUnlocked: (path: string, masterPassword: string) => void;
  recentDbsCount?: number; // max number of recent vaults to display (default 5)
}

type Tab = "create" | "open";

const FORBIDDEN_CHARS = /[\\/:*?"<>|]/g;

function sanitizeFilename(name: string): string {
  return name.replace(FORBIDDEN_CHARS, "").trim();
}

function validateDbName(name: string): string {
  if (!name.trim()) return "Nom du coffre requis.";
  if (FORBIDDEN_CHARS.test(name)) return 'Caractères interdits : \\ / : * ? " < > |';
  return "";
}

function validatePassword(pw: string): string[] {
  const errors: string[] = [];
  if (pw.length < 8) errors.push("Au moins 8 caractères");
  if (!/[A-Z]/.test(pw)) errors.push("Au moins une majuscule");
  if (!/[a-z]/.test(pw)) errors.push("Au moins une minuscule");
  if (!/[0-9]/.test(pw)) errors.push("Au moins un chiffre");
  if (!/[^A-Za-z0-9]/.test(pw)) errors.push("Au moins un caractère spécial (!@#$…)");
  return errors;
}

function formatRelativeDate(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Il y a ${days} jour${days > 1 ? "s" : ""}`;
  return new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function truncatePath(path: string, maxLen = 48): string {
  if (path.length <= maxLen) return path;
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(sep);
  const filename = parts[parts.length - 1];
  const prefix = parts[0] + sep + "…" + sep;
  if (prefix.length + filename.length <= maxLen) return prefix + filename;
  return "…" + sep + filename;
}

export default function SetupScreen({ onCreated: _onCreated, onOpened, onCreatedAndUnlocked, recentDbsCount = 5 }: Props) {
  const [tab, setTab] = useState<Tab>("open");
  const [recentDbs, setRecentDbs] = useState<RecentDb[]>(() => getRecentDbs());

  // Create tab state
  const [dbName, setDbName] = useState("Mon coffre");
  const [masterPw, setMasterPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [touched, setTouched] = useState(false);

  // Open tab state
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const [openingRecentPath, setOpeningRecentPath] = useState<string | null>(null);

  const nameError = touched ? validateDbName(dbName) : "";
  const matchError = touched && confirmPw && confirmPw !== masterPw ? "Les mots de passe ne correspondent pas." : "";

  const handleCreate = async () => {
    setTouched(true);
    setCreateError("");
    if (validateDbName(dbName)) return;
    if (validatePassword(masterPw).length > 0) return;
    if (masterPw !== confirmPw) return;

    const safeName = sanitizeFilename(dbName);
    const path = await save({
      title: "Enregistrer le coffre",
      defaultPath: `${safeName}.kv`,
      filters: [{ name: "Vaultix Database", extensions: ["kv"] }],
    });
    if (!path) return;

    setCreating(true);
    try {
      await invoke("create_database", { path, name: dbName, masterPassword: masterPw });
      // Unlock immediately so we can register biometric/TOTP without going through unlock screen
      await invoke("unlock_database", { masterPassword: masterPw });
      onCreatedAndUnlocked(path, masterPw);
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleBrowse = async () => {
    setOpenError("");
    const path = await open({
      title: "Ouvrir un coffre",
      filters: [{ name: "Vaultix Database", extensions: ["kv"] }],
      multiple: false,
    });
    if (!path || Array.isArray(path)) return;
    setOpening(true);
    try {
      await invoke("open_database", { path });
      onOpened(path);
    } catch (e) {
      setOpenError(String(e));
    } finally {
      setOpening(false);
    }
  };

  const handleOpenRecent = async (path: string) => {
    setOpenError("");
    const exists = await invoke<boolean>("file_exists", { path });
    if (!exists) {
      setOpenError(`Fichier introuvable — il a peut-être été déplacé ou supprimé :\n${path}`);
      return;
    }
    setOpeningRecentPath(path);
    try {
      await invoke("open_database", { path });
      onOpened(path);
    } catch (e) {
      setOpenError(String(e));
    } finally {
      setOpeningRecentPath(null);
    }
  };

  const handleRemoveRecent = (path: string) => {
    removeRecentDb(path);
    setRecentDbs(getRecentDbs());
  };

  return (
    <div className="setup-screen">
      <div className="setup-card">
        {/* Header */}
        <div style={{ padding: "28px 28px 20px", textAlign: "center", borderBottom: "1px solid var(--border)" }}>
          <div className="unlock-logo" style={{ margin: "0 auto 14px" }}>
            <LockIcon size={26} color="#fff" />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)" }}>Vaultix</div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>Gestionnaire de mots de passe sécurisé</div>
        </div>

        {/* Tabs */}
        <div className="setup-tabs">
          <button className={`setup-tab ${tab === "open" ? "active" : ""}`} onClick={() => setTab("open")}>
            Ouvrir un coffre
          </button>
          <button className={`setup-tab ${tab === "create" ? "active" : ""}`} onClick={() => setTab("create")}>
            Nouveau coffre
          </button>
        </div>

        {/* ── Open tab ── */}
        {tab === "open" && (
          <div style={{ padding: "18px 24px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Recent databases */}
            {recentDbs.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Coffres récents
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {recentDbs.slice(0, recentDbsCount).map((db, i) => (
                    <div
                      key={db.path}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 12px", borderRadius: 8,
                        background: i === 0 ? "var(--bg-hover)" : "transparent",
                        border: `1px solid ${i === 0 ? "var(--accent)" : "var(--border)"}`,
                        transition: "border-color 0.15s",
                      }}
                    >
                      {/* DB icon */}
                      <div style={{
                        width: 34, height: 34, borderRadius: 8,
                        background: i === 0 ? "var(--accent)" : "var(--bg-hover)",
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}>
                        <DatabaseIcon size={16} color={i === 0 ? "#fff" : "var(--text-3)"} />
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {db.name}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={db.path}>
                          {truncatePath(db.path)}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1 }}>
                          {formatRelativeDate(db.openedAt)}
                        </div>
                      </div>

                      {/* Actions */}
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleOpenRecent(db.path)}
                          disabled={openingRecentPath === db.path}
                          style={{ fontSize: 12, padding: "5px 10px" }}
                        >
                          {openingRecentPath === db.path
                            ? <span className="spinner" style={{ width: 12, height: 12 }} />
                            : <FolderOpenIcon size={13} />
                          }
                          {openingRecentPath === db.path ? "" : "Ouvrir"}
                        </button>
                        <button
                          className="btn-icon"
                          onClick={() => handleRemoveRecent(db.path)}
                          title="Retirer de la liste"
                          style={{ color: "var(--text-3)" }}
                        >
                          <XIcon size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {recentDbs.length > 0 && (
              <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />
            )}

            <p style={{ color: "var(--text-2)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
              {recentDbs.length > 0
                ? "Ou sélectionnez un autre fichier :"
                : <>Sélectionnez un fichier coffre Vaultix (<code style={{ color: "var(--accent)" }}>.kv</code>).</>
              }
            </p>

            {openError && <div className="error-msg"><span>⚠</span>{openError}</div>}

            <button className="btn btn-ghost btn-sm" onClick={handleBrowse} disabled={opening} style={{ alignSelf: "flex-start" }}>
              {opening ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <FolderIcon size={15} />}
              {opening ? "Ouverture..." : "Parcourir…"}
            </button>
          </div>
        )}

        {/* ── Create tab ── */}
        {tab === "create" && (
          <div style={{ padding: "22px 24px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="field-group">
              <label className="field-label">Nom du coffre</label>
              <input
                className="input"
                value={dbName}
                onChange={e => setDbName(e.target.value.replace(FORBIDDEN_CHARS, ""))}
                placeholder="Mon coffre"
              />
              {nameError && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 3 }}>{nameError}</div>}
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
                Caractères interdits : \ / : * ? " &lt; &gt; |
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">Mot de passe maître</label>
              <div className="input-wrap">
                <input
                  className="input"
                  type={showPw ? "text" : "password"}
                  value={masterPw}
                  onChange={e => setMasterPw(e.target.value)}
                  onBlur={() => setTouched(true)}
                  placeholder="Minimum 8 caractères"
                  autoComplete="new-password"
                />
                <div className="input-wrap-actions">
                  <button className="btn-icon" onClick={() => setShowPw(!showPw)} type="button">
                    {showPw ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                  </button>
                </div>
              </div>
              {masterPw && <PwStrengthBar password={masterPw} />}
              {touched && (
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                  {[
                    { label: "Au moins 8 caractères", ok: masterPw.length >= 8 },
                    { label: "Au moins une majuscule", ok: /[A-Z]/.test(masterPw) },
                    { label: "Au moins une minuscule", ok: /[a-z]/.test(masterPw) },
                    { label: "Au moins un chiffre", ok: /[0-9]/.test(masterPw) },
                    { label: "Au moins un caractère spécial", ok: /[^A-Za-z0-9]/.test(masterPw) },
                  ].map(r => (
                    <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: r.ok ? "var(--success)" : "var(--danger)" }}>
                      {r.ok ? "✓" : "✗"} {r.label}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="field-group">
              <label className="field-label">Confirmer le mot de passe</label>
              <input
                className="input"
                type={showPw ? "text" : "password"}
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                placeholder="Répéter le mot de passe"
                autoComplete="new-password"
              />
              {matchError && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 3 }}>{matchError}</div>}
            </div>

            <div className="info-msg" style={{ fontSize: 11 }}>
              Chiffrement AES-256-GCM + dérivation Argon2id. Sans ce mot de passe, les données sont irrécupérables.
            </div>

            {createError && <div className="error-msg"><span>⚠</span>{createError}</div>}

            <button className="btn btn-primary" onClick={handleCreate} disabled={creating} style={{ marginTop: 4 }}>
              {creating ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null}
              {creating ? "Création..." : "Créer le coffre"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Strength bar ──────────────────────────────────────────────────────────────
function PwStrengthBar({ password }: { password: string }) {
  const errors = validatePassword(password);
  const score = Math.min(4, Math.max(0, 4 - errors.length));
  const colors = ["#ef4444", "#f97316", "#f59e0b", "#22c55e", "#10b981"];
  const labels = ["Très faible", "Faible", "Moyen", "Fort", "Très fort"];
  return (
    <div className="pw-strength-row" style={{ marginTop: 5 }}>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= score ? colors[score] : "rgba(255,255,255,0.08)" }} />
      ))}
      <span className="pw-strength-label" style={{ color: colors[score] }}>{labels[score]}</span>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function LockIcon({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function DatabaseIcon({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}
function FolderIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>;
}
function FolderOpenIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="2 12 7 12 9 7 16 7 18 12 22 12"/></svg>;
}
function XIcon({ size = 13 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}
function EyeIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;
}
function EyeOffIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>;
}
