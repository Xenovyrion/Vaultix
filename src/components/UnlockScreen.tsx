import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  dbPath: string;
  onUnlocked: () => void;
  onClose: () => void;
}

export default function UnlockScreen({ dbPath, onUnlocked, onClose }: Props) {
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Available methods
  const [biometricRegistered, setBiometricRegistered] = useState(false);
  const [totpRegistered, setTotpRegistered] = useState(false);

  // TOTP unlock state
  const [showTotp, setShowTotp] = useState(false);
  const [totpCode, setTotpCode] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const totpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    invoke<boolean>("is_biometric_registered").then(setBiometricRegistered).catch(() => {});
    invoke<boolean>("is_totp_registered").then(setTotpRegistered).catch(() => {});
  }, []);

  const handleUnlock = async () => {
    if (!password) return;
    setError("");
    setLoading(true);
    try {
      await invoke("unlock_database", { masterPassword: password });
      onUnlocked();
    } catch {
      setError("Mot de passe incorrect.");
      setPassword("");
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleBiometric = async () => {
    setError("");
    setLoading(true);
    try {
      await invoke("unlock_with_biometric");
      onUnlocked();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleTotpUnlock = async () => {
    if (totpCode.length !== 6) return;
    setError("");
    setLoading(true);
    try {
      await invoke("unlock_with_totp", { totpCode });
      onUnlocked();
    } catch (e) {
      setError("Code TOTP incorrect ou expiré.");
      setTotpCode("");
      totpRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const openTotp = () => {
    setShowTotp(true);
    setError("");
    setTimeout(() => totpRef.current?.focus(), 50);
  };

  const closeTotp = () => {
    setShowTotp(false);
    setTotpCode("");
    setError("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const dbName = dbPath.split(/[\\/]/).pop()?.replace(".kv", "") ?? dbPath;

  return (
    <div className="unlock-screen">
      <div className="unlock-card">
        {/* Logo */}
        <div className="unlock-logo">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <div className="unlock-title">Vaultix</div>
        <div className="unlock-sub">{dbName}</div>

        <div className="unlock-form">
          {!showTotp ? (
            <>
              {/* Master password */}
              <div className="field-group">
                <label className="field-label">Mot de passe maître</label>
                <div className="input-wrap">
                  <input
                    ref={inputRef}
                    className="input"
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleUnlock()}
                    placeholder="Entrer le mot de passe maître"
                    autoComplete="current-password"
                    disabled={loading}
                  />
                  <div className="input-wrap-actions">
                    <button className="btn-icon" onClick={() => setShowPw(!showPw)} type="button">
                      {showPw ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <div className="error-msg">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {error}
                </div>
              )}

              <button className="btn btn-primary" onClick={handleUnlock} disabled={loading || !password}>
                {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null}
                {loading ? "Déverrouillage..." : "Déverrouiller"}
              </button>

              {/* Dynamic alternative methods */}
              {(biometricRegistered || totpRegistered) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
                    <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>ou</span>
                    <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                  </div>

                  {biometricRegistered && (
                    <button className="btn btn-ghost" onClick={handleBiometric} disabled={loading}>
                      <FingerprintIcon size={15} />
                      Windows Hello
                    </button>
                  )}

                  {totpRegistered && (
                    <button className="btn btn-ghost" onClick={openTotp} disabled={loading}>
                      <TotpIcon size={15} />
                      Code d'authentification (TOTP)
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {/* TOTP unlock form */}
              <div style={{ textAlign: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 4 }}>
                  Code d'authentification
                </div>
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                  Entrez le code à 6 chiffres de votre application
                </div>
              </div>

              <div className="field-group">
                <input
                  ref={totpRef}
                  className="input input-mono"
                  placeholder="000000"
                  maxLength={6}
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={e => e.key === "Enter" && handleTotpUnlock()}
                  disabled={loading}
                  style={{ letterSpacing: 8, fontSize: 22, textAlign: "center" }}
                />
              </div>

              {error && (
                <div className="error-msg">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {error}
                </div>
              )}

              <button className="btn btn-primary" onClick={handleTotpUnlock} disabled={loading || totpCode.length !== 6}>
                {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null}
                {loading ? "Vérification..." : "Vérifier"}
              </button>

              <button className="btn btn-ghost btn-sm" onClick={closeTotp} disabled={loading}>
                ← Retour au mot de passe
              </button>
            </>
          )}

          <div className="divider" />

          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ color: "var(--text-3)" }}>
            Changer de base de données
          </button>
        </div>
      </div>
    </div>
  );
}

function EyeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function FingerprintIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
      <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
      <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
      <path d="M2 12a10 10 0 0 1 18-6" />
      <path d="M2 17c2.93-3.93 5-6 8-6 2.5 0 4 1.5 4 4" />
      <path d="M5 22c1.13-1.8 2-3.5 2.5-5" />
      <path d="M22 12c0 1-.08 2-.22 3" />
    </svg>
  );
}

function TotpIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
