import { invoke } from "@tauri-apps/api/core";

/**
 * Initialise (ou désactive) le mode debug côté Rust.
 * À appeler dès que debugMode ou logPath changent dans les settings.
 */
export function initLogger(enabled: boolean, logPath: string): void {
  invoke("set_debug_mode", { enabled, logPath }).catch(() => {});
}

/**
 * Écrit une ligne dans le fichier de log (no-op si debug désactivé côté Rust).
 * @param component  Nom du composant/module source (ex: "App", "Vault", "Tray")
 * @param message    Message à journaliser
 */
export function log(component: string, message: string): void {
  invoke("write_log", { message: `[${component}] ${message}` }).catch(() => {});
}
