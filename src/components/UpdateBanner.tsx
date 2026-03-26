import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  version: string;
  notes?: string;
  onDismiss: () => void;
}

export default function UpdateBanner({ version, notes, onDismiss }: Props) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInstall = async () => {
    setInstalling(true);
    setError(null);
    try {
      await invoke("install_update");
      // app.restart() is called by Rust — this line won't be reached
    } catch (e) {
      setError(String(e));
      setInstalling(false);
    }
  };

  return (
    <div style={{
      margin: "6px 10px 2px",
      borderRadius: 10,
      border: "1px solid rgba(59,130,246,0.35)",
      background: "rgba(59,130,246,0.08)",
      padding: "10px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14 }}>🔄</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
            Mise à jour disponible
          </div>
          <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 500 }}>
            v{version}
          </div>
        </div>
        <button
          onClick={onDismiss}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-3)",
            fontSize: 14,
            padding: "2px 4px",
            lineHeight: 1,
          }}
          title="Ignorer"
        >
          ✕
        </button>
      </div>

      {/* Release notes (if any) */}
      {notes && (
        <div style={{
          fontSize: 10,
          color: "var(--text-2)",
          maxHeight: 52,
          overflowY: "auto",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          borderTop: "1px solid rgba(59,130,246,0.18)",
          paddingTop: 6,
        }}>
          {notes}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ fontSize: 10, color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onDismiss}
          disabled={installing}
          style={{ fontSize: 11 }}
        >
          Plus tard
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleInstall}
          disabled={installing}
          style={{ fontSize: 11, minWidth: 80 }}
        >
          {installing ? "Installation…" : "Installer"}
        </button>
      </div>
    </div>
  );
}
