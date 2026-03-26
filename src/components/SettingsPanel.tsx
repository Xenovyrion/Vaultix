import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type AppSettings, DEFAULT_SETTINGS } from "../hooks/useSettings";
import { THEME_PRESETS, EDITABLE_VARS, applyTheme } from "../themes";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { QRCodeSVG } from "qrcode.react";
import { type ShortcutAction, type ShortcutMap, SHORTCUT_LABELS, DEFAULT_SHORTCUTS, parseShortcut, formatShortcutDisplay } from "../types";

interface Props {
  settings: AppSettings;
  onSettingsChange: (s: Partial<AppSettings>) => void;
  onClose: () => void;
  dbPath?: string;
}

type Tab = "apparence" | "securite" | "coffre" | "authentification" | "tags" | "systeme";

export default function SettingsPanel({ settings, onSettingsChange, onClose, dbPath }: Props) {
  const [tab, setTab] = useState<Tab>("apparence");
  // Local draft — only applied on Save
  const [draft, setDraft] = useState<AppSettings>({ ...settings });
  const [dirty, setDirty] = useState(false);

  const update = (patch: Partial<AppSettings>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setDirty(true);
    // Live preview for theme changes
    if (patch.themeId !== undefined || patch.customThemeVars !== undefined) {
      applyTheme(next.themeId, next.customThemeVars);
    }
  };

  const handleSave = () => {
    onSettingsChange(draft);
    setDirty(false);
  };

  const handleClose = () => {
    if (dirty) {
      // Revert live theme preview
      applyTheme(settings.themeId, settings.customThemeVars);
    }
    onClose();
  };

  // Reset all settings to defaults (authentication excluded — stored in backend)
  const handleReset = () => {
    setDraft({ ...DEFAULT_SETTINGS });
    setDirty(true);
    applyTheme(DEFAULT_SETTINGS.themeId, DEFAULT_SETTINGS.customThemeVars);
  };

  const TABS: Array<{ id: Tab; label: string; icon: React.FC<{size?:number}> }> = [
    { id: "apparence",       label: "Apparence",    icon: SunIcon },
    { id: "securite",        label: "Sécurité",     icon: ShieldIcon },
    { id: "coffre",          label: "Coffre",       icon: HardDriveIcon },
    { id: "authentification",label: "Authentif.",   icon: FingerprintIcon },
    { id: "tags",            label: "Tags",         icon: TagIcon },
    { id: "systeme",         label: "Système",      icon: ToolIcon },
  ];

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="modal" style={{ width: 660, maxHeight: "86vh", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ width: 32, height: 32, background: "var(--accent-dim)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <SettingsIcon size={16} />
          </div>
          <h2>Paramètres {dirty && <span style={{ fontSize: 11, color: "var(--warning)", fontWeight: 400 }}>· Modifications non sauvegardées</span>}</h2>
          <button className="btn-icon" onClick={handleClose}><XIcon /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "11px 4px", background: "none", border: "none", cursor: "pointer",
              fontSize: 12, fontWeight: 500, fontFamily: "inherit",
              color: tab === t.id ? "var(--accent)" : "var(--text-2)",
              borderBottom: `2px solid ${tab === t.id ? "var(--accent)" : "transparent"}`,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              transition: "color 0.12s",
            }}>
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {tab === "apparence"        && <ApparenceTab    draft={draft} update={update} />}
          {tab === "securite"         && <SecuriteTab     draft={draft} update={update} />}
          {tab === "coffre"           && <CoffreTab       draft={draft} update={update} dbPath={dbPath} />}
          {tab === "authentification" && <AuthTab         settings={settings} />}
          {tab === "tags"             && <CategoriesTab   draft={draft} update={update} />}
          {tab === "systeme"          && <SystemeTab      draft={draft} update={update} onReset={handleReset} />}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={handleClose}>Fermer</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!dirty}>
            <SaveIcon size={13} /> Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Apparence ─────────────────────────────────────────────────────────────────
function ApparenceTab({ draft, update }: { draft: AppSettings; update: (p: Partial<AppSettings>) => void }) {
  const [showAdvanced, setShowAdvanced] = useState(() => Object.keys(draft.customThemeVars).length > 0);
  const currentPreset = THEME_PRESETS.find(p => p.id === draft.themeId) ?? THEME_PRESETS[0];

  return (
    <div className="modal-body" style={{ gap: 20 }}>
      <div>
        <div className="field-label" style={{ marginBottom: 10 }}>Thème</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
          {THEME_PRESETS.map(preset => (
            <button
              key={preset.id}
              onClick={() => update({ themeId: preset.id, customThemeVars: {} })}
              style={{
                border: `2px solid ${draft.themeId === preset.id && Object.keys(draft.customThemeVars).length === 0 ? "var(--accent)" : "var(--border-light)"}`,
                borderRadius: 10, padding: "10px 8px", cursor: "pointer",
                background: preset.vars["--bg-card"] ?? "var(--bg-card)",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                transition: "border-color 0.15s",
              }}
            >
              {/* Mini preview */}
              <div style={{ width: "100%", height: 36, borderRadius: 6, background: preset.vars["--bg-primary"] ?? "#000", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, top: 0, width: "40%", height: "100%", background: preset.vars["--bg-card"] ?? "#111" }} />
                <div style={{ position: "absolute", right: 6, top: 8, width: "50%", height: 8, borderRadius: 3, background: preset.vars["--accent"] ?? "#3b82f6" }} />
                <div style={{ position: "absolute", right: 6, top: 20, width: "38%", height: 6, borderRadius: 3, background: preset.vars["--text-3"] ?? "#64748b", opacity: 0.6 }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 500, color: preset.vars["--text-1"] ?? "var(--text-1)" }}>{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Zebra stripes */}
      <SettingRow icon={<StripesIcon size={15} />} label="Lignes alternées" description="Colore une ligne sur deux dans la liste des entrées pour améliorer la lisibilité">
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => update({ zebraStripes: true })} className={draft.zebraStripes ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Activées</button>
          <button onClick={() => update({ zebraStripes: false })} className={!draft.zebraStripes ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Désactivées</button>
        </div>
      </SettingRow>

      {/* Advanced editor toggle */}
      <div>
        <button
          className="btn btn-ghost btn-sm"
          style={{ width: "100%", justifyContent: "space-between" }}
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ToolIcon size={13} /> Apparence avancée — personnaliser les couleurs
          </span>
          <ChevronIcon size={13} style={{ transform: showAdvanced ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        </button>

        {showAdvanced && (
          <AdvancedThemeEditor
            currentPreset={currentPreset}
            customVars={draft.customThemeVars}
            onChange={vars => update({ customThemeVars: vars })}
            onReset={() => update({ customThemeVars: {} })}
          />
        )}
      </div>
    </div>
  );
}

function AdvancedThemeEditor({ currentPreset, customVars, onChange, onReset }: {
  currentPreset: typeof THEME_PRESETS[number];
  customVars: Record<string, string>;
  onChange: (vars: Record<string, string>) => void;
  onReset: () => void;
}) {
  const effectiveVars = { ...currentPreset.vars, ...customVars };

  const handleColorChange = (key: string, value: string) => {
    onChange({ ...customVars, [key]: value });
  };

  // Only show solid colors that can be edited with color picker
  const editableKeys = EDITABLE_VARS.filter(v => {
    const val = effectiveVars[v.key];
    return val && !val.startsWith("rgba");
  });

  return (
    <div style={{
      marginTop: 10, border: "1px solid var(--border-light)", borderRadius: 10,
      padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ fontSize: 11, color: "var(--text-3)" }}>
        Modifiez les couleurs ci-dessous — l'aperçu est immédiat. Sauvegardez pour conserver.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {editableKeys.map(({ key, label }) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="color"
              value={effectiveVars[key] ?? "#000000"}
              onChange={e => handleColorChange(key, e.target.value)}
              style={{ width: 28, height: 28, border: "1px solid var(--border-light)", borderRadius: 6, cursor: "pointer", padding: 2, background: "var(--bg-hover)" }}
            />
            <div>
              <div style={{ fontSize: 12, color: "var(--text-1)" }}>{label}</div>
              <div style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "monospace" }}>{effectiveVars[key]}</div>
            </div>
            {customVars[key] && (
              <button className="btn-icon" style={{ marginLeft: "auto" }} onClick={() => {
                const next = { ...customVars };
                delete next[key];
                onChange(next);
              }} title="Réinitialiser">
                <XIcon size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
      {Object.keys(customVars).length > 0 && (
        <button className="btn btn-ghost btn-sm" onClick={onReset} style={{ alignSelf: "flex-start" }}>
          Réinitialiser tous les personnalisations
        </button>
      )}
    </div>
  );
}

// ── Sécurité ──────────────────────────────────────────────────────────────────
function SecuriteTab({ draft, update }: { draft: AppSettings; update: (p: Partial<AppSettings>) => void }) {
  const QUICK = [5, 15, 30, 60];
  const [customTimeout, setCustomTimeout] = useState<string>(() =>
    QUICK.includes(draft.lockTimeoutMinutes) || draft.lockTimeoutMinutes === 0
      ? ""
      : String(draft.lockTimeoutMinutes)
  );

  // Change master password state
  const [showChangePw, setShowChangePw] = useState(false);
  const [cpCurrent, setCpCurrent] = useState("");
  const [cpNew, setCpNew] = useState("");
  const [cpConfirm, setCpConfirm] = useState("");
  const [cpLoading, setCpLoading] = useState(false);
  const [cpError, setCpError] = useState("");
  const [cpSuccess, setCpSuccess] = useState("");
  const [showCpCurrent, setShowCpCurrent] = useState(false);
  const [showCpNew, setShowCpNew] = useState(false);

  const cpStrength = (() => {
    const pw = cpNew;
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 14) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;
    return Math.min(4, Math.max(0, score - 1));
  })();

  const cpStrengthLabel = ["Très faible", "Faible", "Moyen", "Fort", "Très fort"][cpStrength];
  const cpStrengthColor = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#16a34a"][cpStrength];

  const handleChangePw = async () => {
    setCpError("");
    if (!cpCurrent) { setCpError("Entrez le mot de passe actuel."); return; }
    if (cpNew.length < 6) { setCpError("Le nouveau mot de passe doit faire au moins 6 caractères."); return; }
    if (cpNew !== cpConfirm) { setCpError("Les mots de passe ne correspondent pas."); return; }
    setCpLoading(true);
    try {
      await invoke("change_master_password", { currentPassword: cpCurrent, newPassword: cpNew });
      setCpSuccess("Mot de passe maître changé avec succès.");
      setCpCurrent(""); setCpNew(""); setCpConfirm("");
      setTimeout(() => { setShowChangePw(false); setCpSuccess(""); }, 2500);
    } catch (e) {
      setCpError(String(e));
    } finally {
      setCpLoading(false);
    }
  };

  return (
    <div className="modal-body" style={{ gap: 18 }}>

      {/* Lock timeout */}
      <SettingRow icon={<ClockIcon size={15} />} label="Verrouillage automatique" description="Durée d'inactivité avant le verrouillage du coffre">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {QUICK.map(v => (
            <button key={v} onClick={() => update({ lockTimeoutMinutes: v })}
              className={draft.lockTimeoutMinutes === v ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>
              {v < 60 ? `${v} min` : "1 heure"}
            </button>
          ))}
          <button onClick={() => update({ lockTimeoutMinutes: 0 })}
            className={draft.lockTimeoutMinutes === 0 ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>
            Jamais
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              className="input" style={{ width: 70, padding: "5px 8px" }}
              placeholder="min"
              value={customTimeout}
              onChange={e => {
                const v = e.target.value.replace(/\D/g, "");
                setCustomTimeout(v);
                if (v) update({ lockTimeoutMinutes: Number(v) });
              }}
              title="Valeur personnalisée en minutes"
            />
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>min</span>
          </div>
        </div>
        {draft.lockTimeoutMinutes > 0 && !QUICK.includes(draft.lockTimeoutMinutes) && (
          <div style={{ fontSize: 11, color: "var(--accent)" }}>Verrouillage dans {draft.lockTimeoutMinutes} minutes</div>
        )}
      </SettingRow>

      <div className="divider" />

      {/* Clipboard auto-clear */}
      <SettingRow icon={<ClipboardIcon size={15} />} label="Effacement automatique du presse-papiers" description="Efface le contenu copié après le délai configuré (0 = désactivé)">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {[0, 15, 30, 60, 120].map(v => (
            <button key={v}
              onClick={() => update({ clipboardClearSeconds: v })}
              className={draft.clipboardClearSeconds === v ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>
              {v === 0 ? "Désactivé" : v < 60 ? `${v} s` : `${v / 60} min`}
            </button>
          ))}
        </div>
        {draft.clipboardClearSeconds > 0 && (
          <div style={{ fontSize: 11, color: "var(--accent)" }}>
            Le presse-papiers sera effacé {draft.clipboardClearSeconds}s après chaque copie.
          </div>
        )}
      </SettingRow>

      <SettingRow icon={<LockClipIcon size={15} />} label="Effacer au verrouillage" description="Vide le presse-papiers à chaque verrouillage ou fermeture du coffre">
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => update({ clipboardClearOnLock: true })} className={draft.clipboardClearOnLock ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Activé</button>
          <button onClick={() => update({ clipboardClearOnLock: false })} className={!draft.clipboardClearOnLock ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Désactivé</button>
        </div>
      </SettingRow>

      <SettingRow icon={<MinimizeIcon size={15} />} label="Réduire la fenêtre au verrouillage" description="Minimise automatiquement la fenêtre à chaque verrouillage du coffre">
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => update({ minimizeOnLock: true })} className={draft.minimizeOnLock ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Activé</button>
          <button onClick={() => update({ minimizeOnLock: false })} className={!draft.minimizeOnLock ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Désactivé</button>
        </div>
      </SettingRow>

      <SettingRow icon={<ClockXIcon size={15} />} label="Masquer les entrées expirées" description="Exclut les fiches expirées de toutes les vues (sauf la catégorie « Expirés »)">
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => update({ excludeExpiredFromSearch: true })} className={draft.excludeExpiredFromSearch ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Activé</button>
          <button onClick={() => update({ excludeExpiredFromSearch: false })} className={!draft.excludeExpiredFromSearch ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Désactivé</button>
        </div>
      </SettingRow>

      <div className="divider" />

      {/* Security info */}
      <div className="info-msg" style={{ fontSize: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Niveau de sécurité du chiffrement</div>
        <div style={{ lineHeight: 1.7 }}>
          <b>AES-256-GCM</b> — identique à FIPS 197 / chiffrement militaire, avec authentification intégrée (AEAD).<br />
          <b>Argon2id</b> — dérivation de clé mémoire-intensive, résistante aux attaques GPU/ASIC et rainbow tables.
        </div>
      </div>

      <div className="divider" />

      {/* KDF params */}
      <SettingRow icon={<ShieldIcon size={15} />} label="Paramètres Argon2id" description="Résistance aux attaques par force brute — valeurs plus élevées = plus lent à déverrouiller">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="field-group">
            <label className="field-label">Mémoire (KiB) — actuel : {(draft.kdfMemory / 1024).toFixed(0)} MiB</label>
            <input type="range" className="range-input" min={16384} max={524288} step={16384}
              value={draft.kdfMemory} onChange={e => update({ kdfMemory: Number(e.target.value) })} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-3)" }}>
              <span>16 MiB (rapide)</span><span>512 MiB (très sûr)</span>
            </div>
          </div>
          <div className="field-group">
            <label className="field-label">Itérations — actuel : {draft.kdfTime}</label>
            <input type="range" className="range-input" min={1} max={10} step={1}
              value={draft.kdfTime} onChange={e => update({ kdfTime: Number(e.target.value) })} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-3)" }}>
              <span>1 (rapide)</span><span>10 (lent)</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: "Rapide",    mem: 32768,  time: 2 },
              { label: "Équilibré", mem: 65536,  time: 3 },
              { label: "Fort",      mem: 131072, time: 4 },
              { label: "Maximum",   mem: 262144, time: 6 },
            ].map(p => (
              <button key={p.label}
                onClick={() => update({ kdfMemory: p.mem, kdfTime: p.time })}
                className={draft.kdfMemory === p.mem && draft.kdfTime === p.time ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="info-msg" style={{ fontSize: 11 }}>
            <b>Conseil :</b> 64 MiB + 3 itérations est le bon équilibre sécurité/vitesse. Ces paramètres ne s'appliquent qu'aux nouvelles bases créées.
          </div>
        </div>
      </SettingRow>

      <div className="divider" />

      {/* Change master password */}
      <SettingRow icon={<KeyIcon size={15} />} label="Changer le mot de passe maître" description="Re-chiffre le coffre avec un nouveau mot de passe et un nouveau sel Argon2">
        {!showChangePw ? (
          <button className="btn btn-ghost btn-sm" onClick={() => { setShowChangePw(true); setCpError(""); setCpSuccess(""); }}>
            Modifier…
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
            {/* Current password */}
            <div className="field-group">
              <label className="field-label">Mot de passe actuel</label>
              <div className="input-wrap">
                <input
                  className="input"
                  type={showCpCurrent ? "text" : "password"}
                  value={cpCurrent}
                  onChange={e => setCpCurrent(e.target.value)}
                  placeholder="Mot de passe actuel"
                  disabled={cpLoading}
                  autoComplete="current-password"
                />
                <div className="input-wrap-actions">
                  <button className="btn-icon" type="button" onClick={() => setShowCpCurrent(v => !v)}>
                    {showCpCurrent ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
                  </button>
                </div>
              </div>
            </div>

            {/* New password */}
            <div className="field-group">
              <label className="field-label">Nouveau mot de passe</label>
              <div className="input-wrap">
                <input
                  className="input"
                  type={showCpNew ? "text" : "password"}
                  value={cpNew}
                  onChange={e => setCpNew(e.target.value)}
                  placeholder="Nouveau mot de passe"
                  disabled={cpLoading}
                  autoComplete="new-password"
                />
                <div className="input-wrap-actions">
                  <button className="btn-icon" type="button" onClick={() => setShowCpNew(v => !v)}>
                    {showCpNew ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
                  </button>
                </div>
              </div>
              {cpNew.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ display: "flex", gap: 3, marginBottom: 3 }}>
                    {[0,1,2,3].map(i => (
                      <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= cpStrength - 1 ? cpStrengthColor : "var(--border)", transition: "background 0.2s" }} />
                    ))}
                  </div>
                  <span style={{ fontSize: 11, color: cpStrengthColor }}>{cpStrengthLabel}</span>
                </div>
              )}
            </div>

            {/* Confirm new password */}
            <div className="field-group">
              <label className="field-label">Confirmer le nouveau mot de passe</label>
              <div className="input-wrap">
                <input
                  className="input"
                  type="password"
                  value={cpConfirm}
                  onChange={e => setCpConfirm(e.target.value)}
                  placeholder="Confirmer le nouveau mot de passe"
                  disabled={cpLoading}
                  autoComplete="new-password"
                  onKeyDown={e => e.key === "Enter" && handleChangePw()}
                />
              </div>
            </div>

            {cpError && (
              <div className="error-msg">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {cpError}
              </div>
            )}
            {cpSuccess && (
              <div className="success-msg">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                {cpSuccess}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={handleChangePw} disabled={cpLoading || !cpCurrent || !cpNew || !cpConfirm}>
                {cpLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null}
                {cpLoading ? "Changement…" : "Valider"}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowChangePw(false); setCpCurrent(""); setCpNew(""); setCpConfirm(""); setCpError(""); }} disabled={cpLoading}>
                Annuler
              </button>
            </div>
          </div>
        )}
      </SettingRow>
    </div>
  );
}

// ── Authentification ──────────────────────────────────────────────────────────
function AuthTab({ settings: _settings }: { settings: AppSettings }) {
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricRegistered, setBiometricRegistered] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [bioError, setBioError] = useState("");
  const [bioSuccess, setBioSuccess] = useState("");
  const [showBioPw, setShowBioPw] = useState(false);
  const [bioPw, setBioPw] = useState("");

  // TOTP state
  const [totpRegistered, setTotpRegistered] = useState(false);
  const [totpStep, setTotpStep] = useState<"idle" | "setup" | "verify">("idle");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpMasterPw, setTotpMasterPw] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);
  const [totpError, setTotpError] = useState("");
  const [totpSuccess, setTotpSuccess] = useState("");

  useEffect(() => {
    invoke<boolean>("is_biometric_available").then(setBiometricAvailable).catch(() => {});
    invoke<boolean>("is_biometric_registered").then(setBiometricRegistered).catch(() => {});
    invoke<boolean>("is_totp_registered").then(setTotpRegistered).catch(() => {});
  }, []);

  // ── Biometric handlers ────────────────────────────────────────────────────
  const handleRegisterBio = async () => {
    if (!bioPw) { setShowBioPw(true); return; }
    setBioLoading(true); setBioError("");
    try {
      await invoke("register_biometric", { masterPassword: bioPw });
      setBiometricRegistered(true); setShowBioPw(false); setBioPw("");
      setBioSuccess("Biométrie activée !"); setTimeout(() => setBioSuccess(""), 3000);
    } catch (e) { setBioError(String(e)); }
    finally { setBioLoading(false); }
  };

  const [showBioDisable, setShowBioDisable] = useState(false);
  const [bioDisablePw, setBioDisablePw] = useState("");

  const handleUnregisterBio = () => {
    setShowBioDisable(true);
    setBioDisablePw("");
    setBioError("");
  };

  const handleConfirmUnregisterBio = async () => {
    if (!bioDisablePw) return;
    setBioLoading(true); setBioError("");
    try {
      await invoke("verify_master_password", { masterPassword: bioDisablePw });
      await invoke("unregister_biometric");
      setBiometricRegistered(false);
      setShowBioDisable(false); setBioDisablePw("");
      setBioSuccess("Biométrie désactivée."); setTimeout(() => setBioSuccess(""), 3000);
    } catch (e) { setBioError(String(e)); }
    finally { setBioLoading(false); }
  };

  // ── TOTP handlers ─────────────────────────────────────────────────────────
  const handleInitTotp = async () => {
    if (!totpMasterPw) return;
    setTotpLoading(true); setTotpError("");
    try {
      const result = await invoke<{ secret: string; uri: string }>("setup_totp_unlock_init", { masterPassword: totpMasterPw });
      setTotpSecret(result.secret);
      setTotpUri(result.uri);
      setTotpStep("setup");
    } catch (e) { setTotpError(String(e)); }
    finally { setTotpLoading(false); }
  };

  const handleConfirmTotp = async () => {
    if (!totpCode || totpCode.length !== 6) return;
    setTotpLoading(true); setTotpError("");
    try {
      await invoke("setup_totp_unlock_confirm", { masterPassword: totpMasterPw, totpCode, secret: totpSecret });
      setTotpRegistered(true);
      setTotpStep("idle"); setTotpMasterPw(""); setTotpSecret(""); setTotpCode("");
      setTotpSuccess("Application TOTP activée !"); setTimeout(() => setTotpSuccess(""), 4000);
    } catch (e) { setTotpError(String(e)); }
    finally { setTotpLoading(false); }
  };

  const [showTotpDisable, setShowTotpDisable] = useState(false);
  const [totpDisableCode, setTotpDisableCode] = useState("");

  const handleDisableTotp = () => {
    setShowTotpDisable(true);
    setTotpDisableCode("");
    setTotpError("");
  };

  const handleConfirmDisableTotp = async () => {
    if (totpDisableCode.length !== 6) return;
    setTotpLoading(true); setTotpError("");
    try {
      // Verify the current TOTP code before disabling
      await invoke("unlock_with_totp", { totpCode: totpDisableCode });
      await invoke("disable_totp_unlock");
      setTotpRegistered(false);
      setShowTotpDisable(false); setTotpDisableCode("");
      setTotpSuccess("TOTP désactivé."); setTimeout(() => setTotpSuccess(""), 3000);
    } catch (e) { setTotpError(String(e)); }
    finally { setTotpLoading(false); }
  };

  return (
    <div className="modal-body" style={{ gap: 12 }}>
      <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.7 }}>
        Combinez votre mot de passe maître avec une méthode d'authentification rapide pour déverrouiller le coffre sans le ressaisir.
      </div>

      {/* ── Biométrie ── */}
      <AuthCard
        icon={<FingerprintIcon size={18} />}
        title="Biométrie / Windows Hello"
        description={biometricAvailable
          ? "Empreinte digitale ou reconnaissance faciale (Windows Hello)"
          : "Aucun capteur biométrique détecté sur cet appareil"}
        available={biometricAvailable}
        registered={biometricRegistered}
        unavailableMsg="Non disponible sur cet appareil"
        onEnable={() => setShowBioPw(!showBioPw)}
        onDisable={handleUnregisterBio}
        loading={bioLoading}
      >
        {showBioPw && !biometricRegistered && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>Entrez votre mot de passe maître pour l'associer :</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" type="password" value={bioPw} onChange={e => setBioPw(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleRegisterBio()} placeholder="Mot de passe maître" autoFocus />
              <button className="btn btn-primary btn-sm" onClick={handleRegisterBio} disabled={bioLoading || !bioPw}>
                {bioLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : "Confirmer"}
              </button>
            </div>
          </div>
        )}
        {showBioDisable && biometricRegistered && (
          <div style={{ marginTop: 10, border: "1px solid var(--danger)", borderRadius: 8, padding: "12px 14px",
            background: "rgba(239,68,68,0.04)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 600 }}>Confirmer la désactivation</div>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>Entrez votre mot de passe maître pour confirmer :</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" type="password" value={bioDisablePw} onChange={e => setBioDisablePw(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleConfirmUnregisterBio()}
                placeholder="Mot de passe maître" autoFocus />
              <button className="btn btn-danger btn-sm" onClick={handleConfirmUnregisterBio} disabled={bioLoading || !bioDisablePw}>
                {bioLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : "Désactiver"}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowBioDisable(false); setBioDisablePw(""); setBioError(""); }}>
                Annuler
              </button>
            </div>
          </div>
        )}
        {bioError && <div className="error-msg" style={{ marginTop: 8 }}><span>⚠</span>{bioError}</div>}
        {bioSuccess && <div style={{ marginTop: 8, fontSize: 12, color: "var(--success)" }}>{bioSuccess}</div>}
      </AuthCard>

      {/* ── TOTP ── */}
      <AuthCard
        icon={<PhoneIcon size={18} />}
        title="Application d'authentification (TOTP)"
        description="Google Authenticator, Microsoft Authenticator, Authy, Bitwarden Authenticator…"
        available={true}
        registered={totpRegistered}
        unavailableMsg=""
        onEnable={() => setTotpStep(totpStep === "idle" ? "setup" : "idle")}
        onDisable={handleDisableTotp}
        loading={totpLoading}
      >
        {/* Step 0 : enter master pw before generating secret */}
        {totpStep === "setup" && !totpSecret && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>Entrez votre mot de passe maître :</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" type="password" value={totpMasterPw} onChange={e => setTotpMasterPw(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleInitTotp()} placeholder="Mot de passe maître" autoFocus />
              <button className="btn btn-primary btn-sm" onClick={handleInitTotp} disabled={totpLoading || !totpMasterPw}>
                {totpLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : "Générer"}
              </button>
            </div>
          </div>
        )}

        {/* Step 1 : QR code + secret fallback */}
        {totpStep === "setup" && totpSecret && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="info-msg" style={{ fontSize: 12 }}>
              Scannez ce QR code avec votre application (Google Authenticator, Authy…), puis saisissez le code à 6 chiffres affiché.
            </div>

            {/* QR Code */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{
                background: "#ffffff", padding: 12, borderRadius: 10,
                border: "1px solid var(--border-light)", display: "inline-block",
              }}>
                <QRCodeSVG value={totpUri} size={180} bgColor="#ffffff" fgColor="#000000" level="M" />
              </div>
            </div>

            {/* Fallback: show secret */}
            <details style={{ fontSize: 11 }}>
              <summary style={{ cursor: "pointer", color: "var(--text-3)", userSelect: "none" }}>
                Impossible de scanner ? Saisissez manuellement le secret
              </summary>
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{
                  flex: 1, fontFamily: "monospace", fontSize: 12, letterSpacing: 2, fontWeight: 700,
                  background: "var(--bg-primary)", border: "1px solid var(--border-light)",
                  borderRadius: 8, padding: "6px 10px", color: "var(--accent)", wordBreak: "break-all",
                }}>
                  {totpSecret}
                </code>
                <button className="btn-icon" onClick={() => navigator.clipboard?.writeText(totpSecret)} title="Copier le secret">
                  <CopyIcon size={13} />
                </button>
              </div>
            </details>

            <div className="divider" />

            <div className="field-group">
              <div className="field-label">Code de vérification (6 chiffres)</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input input-mono" placeholder="000000" maxLength={6}
                  value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={e => e.key === "Enter" && handleConfirmTotp()}
                  style={{ letterSpacing: 4, fontSize: 18, textAlign: "center", maxWidth: 140 }}
                  autoFocus />
                <button className="btn btn-primary btn-sm" onClick={handleConfirmTotp}
                  disabled={totpLoading || totpCode.length !== 6}>
                  {totpLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : "Vérifier & Activer"}
                </button>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => { setTotpStep("idle"); setTotpMasterPw(""); setTotpSecret(""); setTotpCode(""); }}>
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}
        {showTotpDisable && totpRegistered && (
          <div style={{ marginTop: 10, border: "1px solid var(--danger)", borderRadius: 8, padding: "12px 14px",
            background: "rgba(239,68,68,0.04)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 600 }}>Confirmer la désactivation</div>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>Entrez le code TOTP actuel (6 chiffres) pour confirmer :</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input input-mono" placeholder="000000" maxLength={6}
                value={totpDisableCode} onChange={e => setTotpDisableCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={e => e.key === "Enter" && handleConfirmDisableTotp()}
                style={{ letterSpacing: 4, textAlign: "center", maxWidth: 120 }} autoFocus />
              <button className="btn btn-danger btn-sm" onClick={handleConfirmDisableTotp}
                disabled={totpLoading || totpDisableCode.length !== 6}>
                {totpLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : "Désactiver"}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowTotpDisable(false); setTotpDisableCode(""); setTotpError(""); }}>
                Annuler
              </button>
            </div>
          </div>
        )}
        {totpError && <div className="error-msg" style={{ marginTop: 8 }}><span>⚠</span>{totpError}</div>}
        {totpSuccess && <div style={{ marginTop: 8, fontSize: 12, color: "var(--success)" }}>{totpSuccess}</div>}
      </AuthCard>

      {/* ── FIDO2 / YubiKey ── */}
      <AuthCard
        icon={<KeyIcon size={18} />}
        title="Clé de sécurité FIDO2 / YubiKey"
        description="Clé matérielle USB ou NFC compatible FIDO2 (YubiKey 5, Google Titan, Nitrokey…)"
        available={false}
        registered={false}
        unavailableMsg="Nécessite le gestionnaire yubikey — prochainement"
        onEnable={() => {}}
        onDisable={() => {}}
        loading={false}
      />
    </div>
  );
}

function AuthCard({ icon, title, description, available, registered, unavailableMsg, onEnable, onDisable, loading, children }: {
  icon: React.ReactNode; title: string; description: string;
  available: boolean; registered: boolean; unavailableMsg: string;
  onEnable: () => void; onDisable: () => void; loading: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ border: "1px solid var(--border-light)", borderRadius: 10, padding: "14px 16px", opacity: available ? 1 : 0.65 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          background: registered ? "rgba(34,197,94,0.12)" : "var(--bg-hover)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: registered ? "var(--success)" : "var(--text-3)",
        }}>
          {icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-1)", display: "flex", alignItems: "center", gap: 8 }}>
            {title}
            {registered && <span className="badge badge-ok">Activé</span>}
            {!available && <span className="badge badge-warn">{unavailableMsg}</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 3 }}>{description}</div>
        </div>
        {available && (
          <button
            className={registered ? "btn btn-danger btn-sm" : "btn btn-ghost btn-sm"}
            onClick={registered ? onDisable : onEnable}
            disabled={loading}
            style={{ flexShrink: 0 }}
          >
            {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : registered ? "Désactiver" : "Activer"}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Tags ──────────────────────────────────────────────────────────────────────
const BUILTIN_CATEGORIES = ["Travail", "Personnel", "Social"];

function TagRow({ name, color, onColorChange, onRemove }: {
  name: string; color: string; onColorChange: (c: string) => void; onRemove?: () => void;
}) {
  const [hexInput, setHexInput] = useState(color || "#888888");

  useEffect(() => {
    setHexInput(color || "#888888");
  }, [color]);

  const handleHex = (v: string) => {
    setHexInput(v);
    if (/^#[0-9a-fA-F]{6}$/.test(v)) onColorChange(v);
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "7px 12px", borderRadius: 8, background: "var(--bg-hover)",
      border: "1px solid var(--border)",
    }}>
      {/* Color swatch — clicking opens native color picker */}
      <label title="Changer la couleur" style={{ cursor: "pointer", flexShrink: 0, position: "relative", width: 22, height: 22 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 5, border: "2px solid var(--border)",
          background: color || "#888888", cursor: "pointer",
        }} />
        <input
          type="color"
          value={color || "#888888"}
          onChange={e => onColorChange(e.target.value)}
          style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}
        />
      </label>
      {/* Hex code text input */}
      <input
        type="text"
        value={hexInput}
        onChange={e => handleHex(e.target.value)}
        maxLength={7}
        spellCheck={false}
        style={{
          width: 76, fontFamily: "monospace", fontSize: 12,
          background: "var(--bg-primary)", border: "1px solid var(--border-light)",
          borderRadius: 5, padding: "3px 7px", color: color || "var(--text-2)",
          outline: "none", flexShrink: 0,
        }}
        onFocus={e => (e.currentTarget.style.borderColor = "var(--accent)")}
        onBlur={e => (e.currentTarget.style.borderColor = "var(--border-light)")}
      />
      <span style={{ flex: 1, fontSize: 13, color: color || "var(--text-1)" }}>{name}</span>
      {onRemove && (
        <button className="btn-icon" onClick={onRemove} title="Supprimer" style={{ color: "var(--danger)" }}>
          <TrashIcon size={13} />
        </button>
      )}
    </div>
  );
}

function CategoriesTab({ draft, update }: { draft: AppSettings; update: (p: Partial<AppSettings>) => void }) {
  const [newCat, setNewCat] = useState("");
  const allCustom = draft.customCategories;
  const tagColors = draft.tagColors ?? {};

  const setColor = (tag: string, color: string) => {
    update({ tagColors: { ...tagColors, [tag]: color } });
  };

  const addCat = () => {
    const name = newCat.trim();
    if (!name || allCustom.includes(name) || BUILTIN_CATEGORIES.includes(name)) return;
    update({ customCategories: [...allCustom, name] });
    setNewCat("");
  };

  const removeCat = (cat: string) => {
    const next = { ...tagColors };
    delete next[cat];
    update({ customCategories: allCustom.filter(c => c !== cat), tagColors: next });
  };

  return (
    <div className="modal-body" style={{ gap: 16 }}>
      <div>
        <div className="field-label" style={{ marginBottom: 8 }}>Tags intégrés</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {BUILTIN_CATEGORIES.map(cat => (
            <TagRow key={cat} name={cat} color={tagColors[cat] ?? ""} onColorChange={c => setColor(cat, c)} />
          ))}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>Ces tags sont toujours disponibles. Cliquez sur la pastille de couleur pour la personnaliser.</div>
      </div>

      <div className="divider" />

      <div>
        <div className="field-label" style={{ marginBottom: 8 }}>Mes tags personnalisés</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input className="input" placeholder="Nouveau tag…" value={newCat}
            onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key === "Enter" && addCat()} />
          <button className="btn btn-primary btn-sm" onClick={addCat} disabled={!newCat.trim()}>
            <PlusIcon size={13} /> Ajouter
          </button>
        </div>
        {allCustom.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic" }}>Aucun tag personnalisé.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {allCustom.map(cat => (
              <TagRow key={cat} name={cat} color={tagColors[cat] ?? ""} onColorChange={c => setColor(cat, c)} onRemove={() => removeCat(cat)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Coffre (Sauvegarde + Compression + Coffres récents) ───────────────────────
function CoffreTab({ draft, update, dbPath }: {
  draft: AppSettings;
  update: (p: Partial<AppSettings>) => void;
  dbPath?: string;
}) {
  const [backupMsg, setBackupMsg] = useState("");
  const [backupError, setBackupError] = useState("");
  const [backing, setBacking] = useState(false);
  // Initialise depuis la valeur stockée si ce n'est pas un preset
  const PRESET_HOURS = [0.5, 1, 6, 24, 168];
  const [customMinutes, setCustomMinutes] = useState<string>(() =>
    PRESET_HOURS.includes(draft.backupIntervalHours) || draft.backupIntervalHours <= 0
      ? ""
      : String(Math.round(draft.backupIntervalHours * 60))
  );

  const browsePath = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: "Choisir le dossier de sauvegarde" });
      if (selected && typeof selected === "string") {
        update({ backupPath: selected });
      }
    } catch { /* user cancelled */ }
  };

  const runBackupNow = async () => {
    if (!dbPath) { setBackupError("Base non disponible."); return; }
    if (!draft.backupPath) { setBackupError("Veuillez d'abord définir un chemin de sauvegarde."); return; }
    setBacking(true); setBackupError(""); setBackupMsg("");
    try {
      await invoke("backup_database", {
        backupDir: draft.backupPath,
        maxCount: draft.backupMaxCount || 0,
        namePattern: draft.backupNamePattern || "{date}_{time}_{name}",
      });
      if (dbPath) localStorage.setItem(`vaultix_last_backup_${dbPath}`, String(Date.now()));
      setBackupMsg("Sauvegarde effectuée avec succès !");
      setTimeout(() => setBackupMsg(""), 4000);
    } catch (e) {
      setBackupError(String(e));
    } finally {
      setBacking(false);
    }
  };

  const INTERVALS = [
    { label: "30 min", value: 0.5 },
    { label: "1 heure", value: 1 },
    { label: "6 heures", value: 6 },
    { label: "Quotidien", value: 24 },
    { label: "Hebdomadaire", value: 168 },
  ];
  const isCustomInterval = !INTERVALS.some(iv => iv.value === draft.backupIntervalHours);

  return (
    <div className="modal-body" style={{ gap: 18 }}>
      {/* Enable toggle */}
      <SettingRow icon={<HardDriveIcon size={15} />} label="Sauvegarde automatique" description="Copie la base chiffrée vers un dossier de votre choix">
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => update({ backupEnabled: true })} className={draft.backupEnabled ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Activée</button>
          <button onClick={() => update({ backupEnabled: false })} className={!draft.backupEnabled ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Désactivée</button>
        </div>
      </SettingRow>

      <div className="divider" />

      {/* Backup sub-options — disabled/grayed when backup is off */}
      <div style={{ opacity: draft.backupEnabled ? 1 : 0.45, pointerEvents: draft.backupEnabled ? undefined : "none", transition: "opacity 0.2s", display: "flex", flexDirection: "column", gap: 18 }}>

      {/* Backup path */}
      <SettingRow icon={<FolderIcon size={15} />} label="Chemin de sauvegarde" description="Dossier local, réseau (\\serveur\partage), OneDrive, Dropbox, etc.">
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input" style={{ flex: 1, fontSize: 12 }}
            value={draft.backupPath}
            onChange={e => update({ backupPath: e.target.value })}
            placeholder="C:\Sauvegardes  ou  \\serveur\partage"
          />
          <button className="btn btn-ghost btn-sm" onClick={browsePath} title="Parcourir">
            <FolderIcon size={13} /> Parcourir
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
          Fonctionne avec tout chemin accessible : local, réseau UNC, lecteur cloud monté (OneDrive, Dropbox, ProtonDrive…).
        </div>
      </SettingRow>

      <div className="divider" />

      {/* Interval */}
      <SettingRow icon={<ClockIcon size={15} />} label="Fréquence" description="Intervalle entre deux sauvegardes automatiques">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {INTERVALS.map(iv => (
            <button key={iv.value} onClick={() => { update({ backupIntervalHours: iv.value }); setCustomMinutes(""); }}
              className={draft.backupIntervalHours === iv.value ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
              style={{ fontSize: 11 }}>
              {iv.label}
            </button>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              className="input"
              style={{ width: 72, padding: "5px 8px", border: isCustomInterval ? "1px solid var(--accent)" : undefined }}
              placeholder="min"
              value={customMinutes}
              onChange={e => {
                const v = e.target.value.replace(/\D/g, "");
                setCustomMinutes(v);
                if (v && Number(v) > 0) update({ backupIntervalHours: Number(v) / 60 });
              }}
              title="Valeur personnalisée en minutes"
            />
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>min</span>
          </div>
        </div>
        {isCustomInterval && draft.backupIntervalHours > 0 && (
          <div style={{ fontSize: 11, color: "var(--accent)" }}>
            Intervalle personnalisé : {Math.round(draft.backupIntervalHours * 60)} min
          </div>
        )}
      </SettingRow>

      <div className="divider" />

      {/* Max count */}
      <SettingRow icon={<ArchiveIcon size={15} />} label="Nombre maximum de sauvegardes" description="Les sauvegardes les plus anciennes sont supprimées automatiquement (0 = illimité)">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input type="range" className="range-input" min={0} max={50} step={1}
            value={draft.backupMaxCount}
            onChange={e => update({ backupMaxCount: Number(e.target.value) })} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", fontFamily: "monospace", minWidth: 24 }}>
            {draft.backupMaxCount === 0 ? "∞" : draft.backupMaxCount}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
          <span>0 (illimité)</span><span>50</span>
        </div>
      </SettingRow>

      <div className="divider" />

      {/* Filename pattern */}
      <SettingRow icon={<ToolIcon size={15} />} label="Nom des fichiers de sauvegarde" description="Variables disponibles : {name} (coffre), {date} (AAAAMMJJ), {time} (HHMMSS)">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="input" style={{ flex: 1, fontSize: 12, fontFamily: "monospace" }}
              value={draft.backupNamePattern ?? "{date}_{time}_{name}"}
              onChange={e => update({ backupNamePattern: e.target.value })}
              placeholder="{date}_{time}_{name}"
              spellCheck={false}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => update({ backupNamePattern: "{date}_{time}_{name}" })} title="Réinitialiser">
              ↺
            </button>
          </div>
          {/* Live preview */}
          <div style={{ fontSize: 11, color: "var(--text-2)", fontFamily: "monospace" }}>
            Aperçu : <span style={{ color: "var(--accent)" }}>
              {(draft.backupNamePattern || "{date}_{time}_{name}")
                .replace("{name}", "MonCoffre")
                .replace("{date}", new Date().toISOString().slice(0,10).replace(/-/g,""))
                .replace("{time}", new Date().toTimeString().slice(0,8).replace(/:/g,""))
              }.kv
            </span>
          </div>
        </div>
      </SettingRow>

      <div className="divider" />

      {/* Manual backup */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-ghost" onClick={runBackupNow} disabled={backing || !draft.backupPath}>
          {backing ? <><span className="spinner" style={{ width: 12, height: 12 }} /> En cours…</> : <><HardDriveIcon size={13} /> Sauvegarder maintenant</>}
        </button>
        {backupMsg && <span style={{ fontSize: 12, color: "var(--success)" }}>{backupMsg}</span>}
        {backupError && <span style={{ fontSize: 12, color: "var(--danger)" }}>⚠ {backupError}</span>}
      </div>

      <div className="info-msg" style={{ fontSize: 11 }}>
        <b>Pattern :</b> Combinez librement <code>{'{name}'}</code>, <code>{'{date}'}</code> et <code>{'{time}'}</code>. Exemple : <code>{'{name}_{date}'}</code> → <code>MonCoffre_20260322.kv</code>
      </div>

      </div>{/* end backup sub-options */}

      <div className="divider" />

      {/* Compression */}
      <SettingRow icon={<ZipIcon size={15} />} label="Compression des données" description="Compresse le contenu avant chiffrement (réduit la taille, aucun impact sur la sécurité)">
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => update({ compression: true })} className={draft.compression ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Activée (recommandé)</button>
          <button onClick={() => update({ compression: false })} className={!draft.compression ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Désactivée</button>
        </div>
      </SettingRow>

      <div className="divider" />

      {/* Recent vaults count */}
      <SettingRow icon={<HistoryIcon size={15} />} label="Coffres récents" description="Nombre de coffres récemment ouverts affichés sur l'écran d'accueil">
        <div style={{ display: "flex", gap: 8 }}>
          {[3, 5, 10].map(v => (
            <button key={v} onClick={() => update({ recentDbsCount: v })}
              className={draft.recentDbsCount === v ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>
              {v} derniers
            </button>
          ))}
        </div>
      </SettingRow>
    </div>
  );
}

function SystemeTab({ draft, update, onReset }: { draft: AppSettings; update: (p: Partial<AppSettings>) => void; onReset: () => void }) {

  const handlePickLogPath = async () => {
    const path = await saveDialog({
      filters: [{ name: "Fichier log", extensions: ["log", "txt"] }],
      defaultPath: "vaultix.log",
    });
    if (path) update({ logPath: path });
  };

  const handleDefaultLogPath = async () => {
    const path = await invoke<string>("get_default_log_path");
    if (path) update({ logPath: path });
  };

  const handleToggleDebug = async (enable: boolean) => {
    if (enable && !draft.logPath) {
      // Auto-fill default path when enabling with no path set
      const defaultPath = await invoke<string>("get_default_log_path").catch(() => "");
      update({ debugMode: true, logPath: defaultPath });
    } else {
      update({ debugMode: enable });
    }
  };

  const handleOpenLog = async () => {
    if (!draft.logPath) return;
    await invoke("open_log_file", { path: draft.logPath }).catch(() => {});
  };

  const handleClearLog = async () => {
    if (!draft.logPath) return;
    await invoke("clear_log_file", { path: draft.logPath }).catch(() => {});
  };

  const [confirmReset, setConfirmReset] = useState(false);

  // ── Update check ────────────────────────────────────────────────────────────
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<
    null | { version: string; notes?: string } | "up_to_date" | string
  >(null);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateResult(null);
    try {
      const result = await invoke<{ version: string; notes?: string } | null>("check_update");
      setUpdateResult(result ?? "up_to_date");
    } catch (e) {
      setUpdateResult(`Erreur : ${String(e)}`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <div className="modal-body" style={{ gap: 18 }}>

      {/* System tray */}
      <SettingRow icon={<TrayIconSvg size={15} />} label="Icône dans la barre système" description="Affiche une icône dans le systray — fermer la fenêtre la minimise au lieu de quitter">
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => update({ systemTrayEnabled: true })} className={draft.systemTrayEnabled ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Activée</button>
          <button onClick={() => update({ systemTrayEnabled: false })} className={!draft.systemTrayEnabled ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Désactivée</button>
        </div>
        {draft.systemTrayEnabled && (
          <div style={{ fontSize: 11, color: "var(--text-2)" }}>
            Clic sur l'icône : restaurer la fenêtre. Menu clic droit : Ouvrir, Verrouiller, Quitter.
          </div>
        )}
      </SettingRow>

      <div className="divider" />

      {/* Debug / logs */}
      <SettingRow icon={<BugIcon size={15} />} label="Mode debug" description="Enregistre les événements internes (tray, fenêtre, BDD, sauvegardes…) dans un fichier journal">
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => handleToggleDebug(true)}  className={draft.debugMode  ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Activé</button>
          <button onClick={() => handleToggleDebug(false)} className={!draft.debugMode ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Désactivé</button>
        </div>
      </SettingRow>

      {draft.debugMode && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", background: "var(--bg-hover)", borderRadius: 10, border: "1px solid var(--border-light)" }}>
          <div className="field-label" style={{ marginBottom: 0 }}>Fichier de log</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={draft.logPath}
              onChange={e => update({ logPath: e.target.value })}
              placeholder="Aucun chemin défini…"
              style={{ flex: 1, fontSize: 11, fontFamily: "monospace", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", color: "var(--text-1)", outline: "none" }}
            />
            <button className="btn btn-ghost btn-sm" onClick={handlePickLogPath} title="Choisir un emplacement">
              <FolderIcon size={12} /> Parcourir…
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn btn-ghost btn-sm" onClick={handleDefaultLogPath} title="Remettre le chemin par défaut (%AppData%\vaultix\logs\vaultix.log)">
              <RefreshIcon size={12} /> Réinitialiser
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleOpenLog} disabled={!draft.logPath} title="Ouvrir dans l'éditeur système">
              <EyeIcon size={12} /> Ouvrir les logs
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleClearLog} disabled={!draft.logPath}
              style={{ color: draft.logPath ? "var(--danger)" : undefined }}>
              <TrashIcon size={12} /> Effacer les logs
            </button>
          </div>
          {!draft.logPath && (
            <div style={{ fontSize: 11, color: "var(--warning)", display: "flex", alignItems: "center", gap: 5 }}>
              ⚠ Définissez un chemin de fichier pour activer la journalisation, puis cliquez sur <b>Enregistrer</b>.
            </div>
          )}
          {draft.logPath && (
            <div style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "monospace", wordBreak: "break-all" }}>
              {draft.logPath}
            </div>
          )}
        </div>
      )}

      <div className="divider" />

      {/* Mises à jour */}
      <SettingRow
        icon={<RefreshIcon size={15} />}
        label="Mises à jour automatiques"
        description="Vérifie les nouvelles versions au démarrage et affiche une notification si une mise à jour est disponible"
      >
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => update({ autoUpdateEnabled: true })}  className={draft.autoUpdateEnabled  ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Activées</button>
          <button onClick={() => update({ autoUpdateEnabled: false })} className={!draft.autoUpdateEnabled ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>Désactivées</button>
        </div>
      </SettingRow>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleCheckUpdate}
          disabled={checkingUpdate}
        >
          <RefreshIcon size={12} />
          {checkingUpdate ? "Vérification…" : "Vérifier maintenant"}
        </button>
        {updateResult === "up_to_date" && (
          <span style={{ fontSize: 11, color: "var(--text-2)" }}>✓ Vous êtes à jour.</span>
        )}
        {updateResult && typeof updateResult === "object" && (
          <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 500 }}>
            🔄 Nouvelle version disponible : v{updateResult.version}
          </span>
        )}
        {updateResult && typeof updateResult === "string" && updateResult !== "up_to_date" && (
          <span style={{ fontSize: 11, color: "var(--danger)" }}>{updateResult}</span>
        )}
      </div>

      <div className="divider" />

      {/* Réinitialisation */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <RefreshIcon size={15} /> Réinitialiser les paramètres
        </div>
        <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 10 }}>
          Remet tous les paramètres aux valeurs par défaut. Les méthodes d'authentification (biométrie, TOTP) ne sont pas affectées.
        </div>
        {!confirmReset ? (
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: "var(--danger)", borderColor: "rgba(239,68,68,0.35)" }}
            onClick={() => setConfirmReset(true)}
          >
            <RefreshIcon size={13} /> Réinitialiser…
          </button>
        ) : (
          <div style={{
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            padding: "10px 14px", borderRadius: 8,
            background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.3)",
          }}>
            <span style={{ fontSize: 12, color: "var(--danger)", flex: 1 }}>
              Tous les paramètres seront remis à zéro. Continuer ?
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(false)}>Annuler</button>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => { onReset(); setConfirmReset(false); }}
            >
              Confirmer
            </button>
          </div>
        )}
      </div>

      <div className="divider" />

      {/* Raccourcis clavier */}
      <ShortcutsSection draft={draft} update={update} />

    </div>
  );
}

function ShortcutsSection({ draft, update }: { draft: AppSettings; update: (p: Partial<AppSettings>) => void }) {
  const SHORTCUT_ORDER: ShortcutAction[] = [
    "navigate_up", "navigate_down",
    "focus_search", "new_entry", "edit_entry", "delete_entry",
    "copy_password", "copy_username", "open_entry",
    "copy_entry", "paste_entry",
  ];
  const sc: ShortcutMap = { ...DEFAULT_SHORTCUTS, ...(draft.shortcuts ?? {}) };
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") { setRecording(null); setConflict(null); return; }
      const key = parseShortcut(e);
      if (!key) return;
      const conflictAction = (Object.entries(sc) as [ShortcutAction, string][])
        .find(([a, k]) => k === key && a !== recording);
      if (conflictAction) { setConflict(`Conflit avec "${SHORTCUT_LABELS[conflictAction[0]]}"`); return; }
      setConflict(null);
      update({ shortcuts: { ...sc, [recording]: key } });
      setRecording(null);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording, sc, update]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", display: "flex", alignItems: "center", gap: 8 }}>
            <KeyboardIcon size={15} /> Raccourcis clavier
          </div>
          <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>
            Cliquez sur un raccourci pour le modifier. <kbd style={kbdStyle}>Echap</kbd> pour annuler.
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => update({ shortcuts: { ...DEFAULT_SHORTCUTS } })}>Réinitialiser</button>
      </div>

      {recording && conflict && (
        <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: "#ef4444", marginBottom: 6 }}>
          ⚠ {conflict} — choisissez une autre combinaison ou <button
            style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", textDecoration: "underline", padding: 0, fontSize: 12 }}
            onClick={() => setConflict(null)}>ignorer</button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {SHORTCUT_ORDER.map(action => {
          const isRecording = recording === action;
          const current = sc[action];
          return (
            <div key={action} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 12px", borderRadius: 8,
              background: isRecording ? "var(--accent-dim)" : "transparent",
              border: `1px solid ${isRecording ? "var(--accent)" : "transparent"}`,
              transition: "background 0.12s",
            }}>
              <span style={{ fontSize: 13, color: "var(--text-1)" }}>{SHORTCUT_LABELS[action]}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={() => { setConflict(null); setRecording(isRecording ? null : action); }}
                  style={{
                    background: isRecording ? "var(--accent)" : "var(--bg-hover)",
                    border: `1px solid ${isRecording ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 6, padding: "4px 10px", cursor: "pointer",
                    color: isRecording ? "#fff" : "var(--text-1)",
                    fontFamily: "monospace", fontSize: 12, minWidth: 120, textAlign: "center",
                    transition: "all 0.12s",
                  }}
                >
                  {isRecording ? "Appuyez sur une touche…" : formatShortcutDisplay(current)}
                </button>
                <button
                  onClick={() => update({ shortcuts: { ...sc, [action]: DEFAULT_SHORTCUTS[action] } })}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", padding: 2, lineHeight: 1 }}
                  title="Réinitialiser ce raccourci"
                >↺</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 4,
  padding: "1px 5px", fontFamily: "monospace", fontSize: 11,
};

// ── Shared ────────────────────────────────────────────────────────────────────
function SettingRow({ icon, label, description, children }: {
  icon: React.ReactNode; label: string; description: string; children?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ color: "var(--accent)", opacity: 0.8, flexShrink: 0 }}>{icon}</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{label}</div>
          <div style={{ fontSize: 12, color: "var(--text-2)" }}>{description}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function SettingsIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>; }
function XIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
function SunIcon({ size = 12 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>; }
function ShieldIcon({ size = 12 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
function FingerprintIcon({ size = 12 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 17c2.93-3.93 5-6 8-6 2.5 0 4 1.5 4 4"/><path d="M5 22c1.13-1.8 2-3.5 2.5-5"/><path d="M22 12c0 1-.08 2-.22 3"/></svg>; }
function TagIcon({ size = 12 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>; }
function ToolIcon({ size = 12 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>; }
function ChevronIcon({ size = 12, style }: { size?: number; style?: React.CSSProperties }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}><polyline points="6 9 12 15 18 9"/></svg>; }
function ClockIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function ZipIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>; }
function SaveIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>; }
function PhoneIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>; }
function KeyIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>; }
function CopyIcon({ size = 13 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>; }
function PlusIcon({ size = 13 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function TrashIcon({ size = 13 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>; }
function HardDriveIcon({ size = 13 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>; }
function FolderIcon({ size = 13 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>; }
function ArchiveIcon({ size = 13 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>; }
function EyeIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>; }
function EyeOffIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>; }
function KeyboardIcon({ size = 12 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6.01" y2="10"/><line x1="10" y1="10" x2="10.01" y2="10"/><line x1="14" y1="10" x2="14.01" y2="10"/><line x1="18" y1="10" x2="18.01" y2="10"/><line x1="6" y1="14" x2="6.01" y2="14"/><line x1="18" y1="14" x2="18.01" y2="14"/><line x1="10" y1="14" x2="14" y2="14"/></svg>; }
function ClipboardIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>; }
function LockClipIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><line x1="12" y1="15" x2="12" y2="17"/></svg>; }
function MinimizeIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>; }
function ClockXIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><line x1="15" y1="9" x2="19" y2="13"/><line x1="19" y1="9" x2="15" y2="13"/></svg>; }
function StripesIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>; }
function HistoryIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>; }
function TrayIconSvg({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M12 14V3"/><polyline points="8 7 12 3 16 7"/><circle cx="18" cy="18" r="1" fill="currentColor" stroke="none"/></svg>; }
function BugIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2l1.88 1.88"/><path d="M14.12 3.88L16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>; }
function RefreshIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>; }
