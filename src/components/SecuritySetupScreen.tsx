import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";

interface Props {
  masterPassword: string;
  onDone: () => void;
}

export default function SecuritySetupScreen({ masterPassword, onDone }: Props) {
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricDone, setBiometricDone] = useState(false);
  const [totpDone, setTotpDone] = useState(false);

  // Biometric state
  const [bioLoading, setBioLoading] = useState(false);
  const [bioError, setBioError] = useState("");

  // TOTP state
  const [totpExpanded, setTotpExpanded] = useState(false);
  const [totpSecret, setTotpSecret] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);
  const [totpError, setTotpError] = useState("");
  const [totpStep, setTotpStep] = useState<"idle" | "show">("idle");

  useEffect(() => {
    invoke<boolean>("is_biometric_available").then(setBiometricAvailable).catch(() => {});
  }, []);

  const anyDone = biometricDone || totpDone;

  // ── Biometric ──────────────────────────────────────────────────────────────
  const handleRegisterBio = async () => {
    setBioLoading(true); setBioError("");
    try {
      await invoke("register_biometric", { masterPassword });
      setBiometricDone(true);
    } catch (e) {
      setBioError(String(e));
    } finally {
      setBioLoading(false);
    }
  };

  // ── TOTP ───────────────────────────────────────────────────────────────────
  const handleInitTotp = async () => {
    setTotpLoading(true); setTotpError("");
    try {
      const r = await invoke<{ secret: string; uri: string }>("setup_totp_unlock_init", { masterPassword });
      setTotpSecret(r.secret);
      setTotpUri(r.uri);
      setTotpStep("show");
    } catch (e) {
      setTotpError(String(e));
    } finally {
      setTotpLoading(false);
    }
  };

  const handleConfirmTotp = async () => {
    if (totpCode.length !== 6) return;
    setTotpLoading(true); setTotpError("");
    try {
      await invoke("setup_totp_unlock_confirm", { masterPassword, totpCode, secret: totpSecret });
      setTotpDone(true);
      setTotpStep("idle");
      setTotpExpanded(false);
    } catch (e) {
      setTotpError(String(e));
    } finally {
      setTotpLoading(false);
    }
  };

  const handleExpandTotp = () => {
    setTotpExpanded(true);
    if (totpStep === "idle") handleInitTotp();
  };

  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg-primary)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{
        width: "100%", maxWidth: 500,
        background: "var(--bg-card)", borderRadius: 16,
        border: "1px solid var(--border)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "28px 28px 20px", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, background: "var(--accent-dim)",
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px",
            color: "var(--accent)",
          }}>
            <ShieldIcon size={26} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)" }}>Sécurisez votre base</div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6, lineHeight: 1.6 }}>
            Configurez une méthode d'authentification rapide pour déverrouiller votre coffre sans ressaisir votre mot de passe maître.
          </div>
        </div>

        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* ── Biometric card ── */}
          {biometricAvailable && (
            <SetupCard
              icon={<FingerprintIcon size={20} />}
              title="Biométrie / Windows Hello"
              description="Empreinte digitale, visage ou code PIN Windows"
              done={biometricDone}
            >
              {biometricDone ? (
                <div style={{ fontSize: 12, color: "var(--success)" }}>✓ Biométrie activée avec succès</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={handleRegisterBio} disabled={bioLoading} style={{ alignSelf: "flex-start" }}>
                    {bioLoading ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Activation…</> : "Activer la biométrie"}
                  </button>
                  {bioError && <div className="error-msg" style={{ fontSize: 11 }}><span>⚠</span>{bioError}</div>}
                </div>
              )}
            </SetupCard>
          )}

          {/* ── TOTP card ── */}
          <SetupCard
            icon={<PhoneIcon size={20} />}
            title="Application d'authentification (TOTP)"
            description="Google Authenticator, Authy, Microsoft Authenticator…"
            done={totpDone}
          >
            {totpDone ? (
              <div style={{ fontSize: 12, color: "var(--success)" }}>✓ Application TOTP liée avec succès</div>
            ) : !totpExpanded ? (
              <button className="btn btn-ghost btn-sm" onClick={handleExpandTotp} disabled={totpLoading} style={{ alignSelf: "flex-start" }}>
                {totpLoading ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Génération…</> : "Configurer TOTP"}
              </button>
            ) : totpStep === "show" && totpUri ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="info-msg" style={{ fontSize: 11 }}>
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

                {/* Verification code */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>
                    Code de vérification (6 chiffres)
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      className="input input-mono"
                      placeholder="000000"
                      maxLength={6}
                      value={totpCode}
                      onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))}
                      onKeyDown={e => e.key === "Enter" && handleConfirmTotp()}
                      autoFocus
                      style={{ letterSpacing: 4, fontSize: 18, textAlign: "center", maxWidth: 140 }}
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleConfirmTotp}
                      disabled={totpLoading || totpCode.length !== 6}
                    >
                      {totpLoading
                        ? <span className="spinner" style={{ width: 12, height: 12 }} />
                        : "Vérifier & Activer"
                      }
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setTotpExpanded(false); setTotpStep("idle"); setTotpCode(""); }}>
                      Annuler
                    </button>
                  </div>
                </div>

                {totpError && <div className="error-msg" style={{ fontSize: 11 }}><span>⚠</span>{totpError}</div>}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-3)", fontSize: 12 }}>
                <span className="spinner" style={{ width: 14, height: 14 }} /> Génération du QR code…
              </div>
            )}
          </SetupCard>

          {/* Footer */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            {anyDone ? (
              <div style={{ fontSize: 12, color: "var(--success)" }}>✓ Méthode configurée — votre coffre est bien sécurisé.</div>
            ) : (
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                Configurable à tout moment dans Paramètres → Auth.
              </div>
            )}
            <button
              className={anyDone ? "btn btn-primary" : "btn btn-ghost btn-sm"}
              onClick={onDone}
              style={{ flexShrink: 0 }}
            >
              {anyDone ? "Accéder au coffre →" : "Passer pour l'instant"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared ─────────────────────────────────────────────────────────────────────
function SetupCard({ icon, title, description, done, children }: {
  icon: React.ReactNode; title: string; description: string;
  done: boolean; children: React.ReactNode;
}) {
  return (
    <div style={{
      border: `1px solid ${done ? "var(--success)" : "var(--border-light)"}`,
      borderRadius: 10, padding: "14px 16px",
      background: done ? "rgba(34,197,94,0.04)" : "transparent",
      transition: "border-color 0.2s",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          background: done ? "rgba(34,197,94,0.12)" : "var(--bg-hover)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: done ? "var(--success)" : "var(--text-3)",
        }}>
          {icon}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-1)", display: "flex", alignItems: "center", gap: 8 }}>
            {title} {done && <span className="badge badge-ok">Activé</span>}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{description}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function ShieldIcon({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
function FingerprintIcon({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 17c2.93-3.93 5-6 8-6 2.5 0 4 1.5 4 4"/><path d="M5 22c1.13-1.8 2-3.5 2.5-5"/><path d="M22 12c0 1-.08 2-.22 3"/></svg>; }
function PhoneIcon({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>; }
function CopyIcon({ size = 12 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>; }
