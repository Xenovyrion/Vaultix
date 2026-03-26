import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

interface Props {
  onClose: () => void;
  onUse: (password: string) => void;
}

type Mode = "charset" | "passphrase" | "pattern";

interface GeneratorResult {
  password: string;
  entropy_bits: number;
}

function entropyLabel(bits: number): { label: string; color: string } {
  if (bits < 28) return { label: "Catastrophique", color: "#ef4444" };
  if (bits < 36) return { label: "Très faible",    color: "#ef4444" };
  if (bits < 50) return { label: "Faible",          color: "#f97316" };
  if (bits < 64) return { label: "Moyen",           color: "#f59e0b" };
  if (bits < 80) return { label: "Fort",            color: "#22c55e" };
  return                { label: "Très fort",       color: "#10b981" };
}

export default function GeneratorModal({ onClose, onUse }: Props) {
  const [mode, setMode] = useState<Mode>("charset");
  const [result, setResult] = useState<GeneratorResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Charset options
  const [length, setLength] = useState(20);
  const [uppercase, setUppercase] = useState(true);
  const [lowercase, setLowercase] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(true);
  const [extraChars, setExtraChars] = useState("");

  // Passphrase options
  const [wordCount, setWordCount] = useState(6);
  const [separator, setSeparator] = useState("-");
  const [capitalize, setCapitalize] = useState(false);
  const [appendNumber, setAppendNumber] = useState(true);
  const [appendSymbol, setAppendSymbol] = useState(false);

  // Pattern options
  const [pattern, setPattern] = useState("XXxx-dddd-ssxx");

  const buildOptions = useCallback(() => {
    if (mode === "charset") {
      return { mode: "charset", length, uppercase, lowercase, digits, symbols,
               exclude_ambiguous: excludeAmbiguous, extra_chars: extraChars };
    }
    if (mode === "passphrase") {
      return { mode: "passphrase", word_count: wordCount, separator,
               capitalize, append_number: appendNumber, append_symbol: appendSymbol };
    }
    return { mode: "pattern", pattern };
  }, [mode, length, uppercase, lowercase, digits, symbols, excludeAmbiguous, extraChars,
      wordCount, separator, capitalize, appendNumber, appendSymbol, pattern]);

  const generate = useCallback(async () => {
    setGenerating(true);
    try {
      const r = await invoke<GeneratorResult>("generate_password", { options: buildOptions() });
      setResult(r);
    } catch (e) {
      setResult({ password: `Erreur: ${e}`, entropy_bits: 0 });
    } finally {
      setGenerating(false);
    }
  }, [buildOptions]);

  useEffect(() => { generate(); }, [generate]);

  const handleCopy = async () => {
    if (!result) return;
    await writeText(result.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const pw = result?.password ?? "";
  const bits = result?.entropy_bits ?? 0;
  const { label: entLabel, color: entColor } = entropyLabel(bits);

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 440, height: 620, display: "flex", flexDirection: "column" }}>
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <div style={{ width: 32, height: 32, background: "var(--accent-dim)", borderRadius: 8,
                        display: "flex", alignItems: "center", justifyContent: "center" }}>
            <KeyIcon size={16} />
          </div>
          <h2>Générateur de mot de passe</h2>
          <button className="btn-icon" onClick={onClose}><XIcon /></button>
        </div>

        <div className="modal-body" style={{ flex: 1, overflowY: "auto" }}>
          {/* Mode tabs */}
          <div style={{ display: "flex", gap: 2, marginBottom: 12, background: "var(--bg-primary)", borderRadius: 8, padding: 3 }}>
            {([["charset","Jeu de chars"],["passphrase","Phrase secrète"],["pattern","Motif"]] as [Mode,string][]).map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1, padding: "5px 0", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 500,
                background: mode === m ? "var(--bg-secondary)" : "transparent",
                color: mode === m ? "var(--text-1)" : "var(--text-3)",
                transition: "all 0.15s",
              }}>{label}</button>
            ))}
          </div>

          {/* Output */}
          <div className="generator-output">
            <span style={{ flex: 1, overflowWrap: "anywhere", fontFamily: mode === "charset" ? "monospace" : "inherit" }}>
              {generating ? "Génération…" : pw}
            </span>
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button className="btn-icon" onClick={generate} title="Régénérer"><RefreshIcon size={15} /></button>
              <button className="btn-icon" onClick={handleCopy} title="Copier" style={{ color: copied ? "var(--success)" : undefined }}>
                {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
              </button>
            </div>
          </div>

          {/* Entropy bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <div style={{ flex: 1, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 3,
                background: entColor,
                width: `${Math.min(100, (bits / 128) * 100)}%`,
                transition: "width 0.3s, background 0.3s",
              }} />
            </div>
            <span style={{ fontSize: 11, color: entColor, minWidth: 100, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {bits > 0 ? `${bits.toFixed(1)} bits · ` : ""}{entLabel}
            </span>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 10 }}>
            {bits >= 80 ? "✓ Recommandé pour tout usage" : bits >= 64 ? "✓ Acceptable pour la plupart des comptes" : bits >= 50 ? "⚠ Minimum recommandé" : "✗ Trop faible"}
          </div>

          {/* ── Charset mode ── */}
          {mode === "charset" && (
            <>
              <div className="field-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label className="field-label">Longueur</label>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", fontFamily: "monospace" }}>{length}</span>
                </div>
                <input type="range" className="range-input" min={4} max={128} value={length} onChange={e => setLength(Number(e.target.value))} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
                  <span>4</span><span>128</span>
                </div>
              </div>
              <div>
                <div className="field-label" style={{ marginBottom: 6 }}>Types de caractères</div>
                {[
                  { label: "Majuscules (A–Z)", value: uppercase, set: setUppercase },
                  { label: "Minuscules (a–z)", value: lowercase, set: setLowercase },
                  { label: "Chiffres (0–9)", value: digits, set: setDigits },
                  { label: "Symboles (!@#$…)", value: symbols, set: setSymbols },
                  { label: "Exclure ambigus (0O1Ii|)", value: excludeAmbiguous, set: setExcludeAmbiguous },
                ].map(opt => (
                  <div key={opt.label} className="toggle-row">
                    <span style={{ fontSize: 13, color: "var(--text-2)" }}>{opt.label}</span>
                    <label className="toggle">
                      <input type="checkbox" checked={opt.value} onChange={e => opt.set(e.target.checked)} />
                      <div className="toggle-track" /><div className="toggle-thumb" />
                    </label>
                  </div>
                ))}
              </div>
              <div className="field-group" style={{ marginTop: 8 }}>
                <label className="field-label">Caractères personnalisés supplémentaires</label>
                <input className="input input-mono" value={extraChars} onChange={e => setExtraChars(e.target.value)} placeholder="ex: éàü€£" style={{ fontSize: 13 }} />
              </div>
            </>
          )}

          {/* ── Passphrase mode ── */}
          {mode === "passphrase" && (
            <>
              <div className="field-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label className="field-label">Nombre de mots</label>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", fontFamily: "monospace" }}>{wordCount}</span>
                </div>
                <input type="range" className="range-input" min={2} max={12} value={wordCount} onChange={e => setWordCount(Number(e.target.value))} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
                  <span>2</span><span>12</span>
                </div>
              </div>
              <div className="field-group">
                <label className="field-label">Séparateur</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[["-","tiret"],["_","souligné"],[".","."],["","aucun"],[" ","espace"]].map(([v, label]) => (
                    <button key={v} onClick={() => setSeparator(v)}
                      className={`btn btn-sm ${separator === v ? "btn-primary" : "btn-ghost"}`}
                      style={{ fontSize: 12, padding: "3px 10px" }}>
                      {v === "" ? "Aucun" : v === " " ? "Espace" : v}{v !== "" && v !== " " ? "" : ""} <span style={{ color: "var(--text-3)", fontSize: 10 }}>({label})</span>
                    </button>
                  ))}
                  <input className="input" value={!["-","_","."," ",""].includes(separator) ? separator : ""}
                    onChange={e => setSeparator(e.target.value)} placeholder="Autre…"
                    style={{ width: 70, fontSize: 12, padding: "3px 8px", display: "inline-flex" }} />
                </div>
              </div>
              {[
                { label: "Majuscule sur chaque mot", value: capitalize, set: setCapitalize },
                { label: "Ajouter un nombre (ex: 42)", value: appendNumber, set: setAppendNumber },
                { label: "Ajouter un symbole (!@#…)", value: appendSymbol, set: setAppendSymbol },
              ].map(opt => (
                <div key={opt.label} className="toggle-row">
                  <span style={{ fontSize: 13, color: "var(--text-2)" }}>{opt.label}</span>
                  <label className="toggle">
                    <input type="checkbox" checked={opt.value} onChange={e => opt.set(e.target.checked)} />
                    <div className="toggle-track" /><div className="toggle-thumb" />
                  </label>
                </div>
              ))}
            </>
          )}

          {/* ── Pattern mode ── */}
          {mode === "pattern" && (
            <>
              <div className="field-group">
                <label className="field-label">Motif</label>
                <input className="input input-mono" value={pattern} onChange={e => setPattern(e.target.value)} placeholder="XXxx-dddd-ssxx" />
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 5, lineHeight: 1.7 }}>
                  <code style={{ color: "var(--accent)" }}>x</code> = minuscule &nbsp;
                  <code style={{ color: "var(--accent)" }}>X</code> = majuscule &nbsp;
                  <code style={{ color: "var(--accent)" }}>d</code> = chiffre &nbsp;
                  <code style={{ color: "var(--accent)" }}>s</code> = symbole &nbsp;
                  <code style={{ color: "var(--accent)" }}>*</code> = n'importe quel &nbsp;
                  <code style={{ color: "var(--accent)" }}>\c</code> = littéral c
                </div>
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>Exemples rapides :</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {["XXxx-dddd-ssxx","****-****-****-****","Xxxd-Xxxd","XXXXdddd!"].map(p => (
                      <button key={p} onClick={() => setPattern(p)}
                        className="btn btn-ghost btn-sm" style={{ fontSize: 11, fontFamily: "monospace", padding: "2px 8px" }}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer" style={{ flexShrink: 0 }}>
          <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
          <button className="btn btn-primary" onClick={() => { onUse(pw); onClose(); }} disabled={!pw}>
            <CheckIcon size={14} /> Utiliser
          </button>
          <button className="btn btn-primary" onClick={handleCopy} disabled={!pw}>
            {copied ? <><CheckIcon size={14} /> Copié !</> : <><CopyIcon size={14} /> Copier</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function KeyIcon({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>; }
function XIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
function RefreshIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>; }
function CopyIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>; }
function CheckIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>; }
