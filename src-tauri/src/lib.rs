mod crypto;
mod database;
mod generator;
mod updater;

use database::{DatabaseMeta, PasswordEntry, Vault};
use generator::{GeneratorOptions, GeneratorResult};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

// ── App state ─────────────────────────────────────────────────────────────────

pub struct AppState {
    pub vault: Mutex<Vault>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState { vault: Mutex::new(Vault::default()) }
    }
}

// ── Tray state ────────────────────────────────────────────────────────────────

pub struct TrayState {
    pub icon: Mutex<Option<tauri::tray::TrayIcon>>,
    pub enabled: AtomicBool,
}

impl Default for TrayState {
    fn default() -> Self {
        TrayState {
            icon: Mutex::new(None),
            enabled: AtomicBool::new(false),
        }
    }
}

// ── Debug / log state ─────────────────────────────────────────────────────────
//
// Uses a process-wide static so any function can call app_log("msg") without
// needing to thread a State<DebugState> through every Tauri command.

use std::sync::OnceLock;

static DBG: OnceLock<Mutex<(bool, String)>> = OnceLock::new();

fn dbg_state() -> &'static Mutex<(bool, String)> {
    DBG.get_or_init(|| Mutex::new((false, String::new())))
}

/// Write a timestamped line to the debug log file.
/// No-op when debug mode is off or no log path has been configured.
pub fn app_log(msg: &str) {
    let (enabled, path) = {
        let g = dbg_state().lock().unwrap();
        (g.0, g.1.clone())
    };
    if !enabled || path.is_empty() { return; }
    let p = std::path::Path::new(&path);
    // Create parent directories if they don't exist (e.g. %AppData%\vaultix\logs\)
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let _ = writeln!(f, "[{}] {}", ts, msg);
    }
}

// Keep DebugState as a Tauri-managed type so set_debug_mode and write_log
// commands work through the normal invoke path.
pub struct DebugState;
impl Default for DebugState { fn default() -> Self { DebugState } }

// ── Tauri commands ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct AppStateResult {
    db_path: Option<String>,
    is_unlocked: bool,
}

#[tauri::command]
fn get_app_state(state: State<AppState>) -> AppStateResult {
    let vault = state.vault.lock().unwrap();
    AppStateResult {
        db_path: vault.path.clone(),
        is_unlocked: vault.is_open(),
    }
}

#[tauri::command]
fn create_database(
    state: State<AppState>,
    path: String,
    name: String,
    master_password: String,
) -> Result<(), String> {
    app_log(&format!("[DB] create_database: path={} name={}", path, name));
    let mut vault = state.vault.lock().unwrap();
    let r = vault.create(&path, &name, &master_password);
    app_log(&format!("[DB] create_database => {}", if r.is_ok() { "OK" } else { r.as_ref().unwrap_err() }));
    r
}

#[tauri::command]
fn open_database(state: State<AppState>, path: String) -> Result<(), String> {
    app_log(&format!("[DB] open_database: path={}", path));
    let mut vault = state.vault.lock().unwrap();
    vault.set_path(&path);
    Ok(())
}

#[tauri::command]
fn unlock_database(state: State<AppState>, master_password: String) -> Result<(), String> {
    app_log("[DB] unlock_database: attempt");
    let mut vault = state.vault.lock().unwrap();
    let r = vault.unlock(&master_password);
    app_log(&format!("[DB] unlock_database => {}", if r.is_ok() { "OK" } else { "FAILED (wrong password?)" }));
    r
}

#[tauri::command]
fn lock_database(state: State<AppState>) {
    app_log("[DB] lock_database");
    let mut vault = state.vault.lock().unwrap();
    vault.lock();
    app_log("[DB] lock_database => done");
}

#[tauri::command]
fn close_database(state: State<AppState>) {
    app_log("[DB] close_database");
    let mut vault = state.vault.lock().unwrap();
    vault.lock();
    vault.path = None;
}

#[tauri::command]
fn get_db_meta(state: State<AppState>) -> Result<DatabaseMeta, String> {
    let vault = state.vault.lock().unwrap();
    vault.meta.clone().ok_or("Base de données non déverrouillée.".into())
}

#[tauri::command]
fn get_entries(state: State<AppState>) -> Result<Vec<PasswordEntry>, String> {
    let vault = state.vault.lock().unwrap();
    if !vault.is_open() {
        return Err("Base de données verrouillée.".into());
    }
    Ok(vault.get_entries().to_vec())
}

fn default_entry_type() -> String { "login".to_string() }

#[derive(Deserialize)]
struct SaveEntryPayload {
    id: Option<String>,
    title: String,
    username: String,
    password: String,
    url: String,
    notes: String,
    category: String,
    #[serde(default)]
    folder: String,
    tags: Vec<String>,
    totp_secret: Option<String>,
    favorite: bool,
    #[serde(default = "default_entry_type")]
    entry_type: String,
    #[serde(default)]
    extra_fields: Vec<(String, String)>,
    #[serde(default)]
    expires_at: Option<i64>,
}

#[tauri::command]
fn save_entry(state: State<AppState>, entry: SaveEntryPayload) -> Result<String, String> {
    app_log(&format!("[DB] save_entry: id={:?} title={}", entry.id, entry.title));
    let mut vault = state.vault.lock().unwrap();
    vault.upsert_entry(
        entry.id.as_deref(),
        &entry.title,
        &entry.username,
        &entry.password,
        &entry.url,
        &entry.notes,
        &entry.category,
        &entry.folder,
        entry.tags,
        entry.totp_secret,
        entry.favorite,
        &entry.entry_type,
        entry.extra_fields,
        entry.expires_at,
    )
}

#[tauri::command]
fn delete_entry(state: State<AppState>, id: String) -> Result<(), String> {
    app_log(&format!("[DB] delete_entry: id={}", id));
    let mut vault = state.vault.lock().unwrap();
    let r = vault.delete_entry(&id);
    app_log(&format!("[DB] delete_entry => {}", if r.is_ok() { "OK" } else { r.as_ref().unwrap_err() }));
    r
}

#[tauri::command]
fn generate_password(options: GeneratorOptions) -> Result<GeneratorResult, String> {
    generator::generate(&options)
}

// ── TOTP ──────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct TotpResult {
    code: String,
    remaining_seconds: u64,
}

#[tauri::command]
fn get_totp_code(secret: String) -> Result<TotpResult, String> {
    use totp_rs::{Algorithm, TOTP};

    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret.as_bytes().to_vec(),
        None,
        "vaultix".to_string(),
    )
    .map_err(|e| format!("TOTP: {e}"))?;

    let code = totp.generate_current().map_err(|e| format!("TOTP generate: {e}"))?;
    let step = totp.step;
    let remaining = step - (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        % step);

    Ok(TotpResult { code, remaining_seconds: remaining })
}

// ── Biometric ─────────────────────────────────────────────────────────────────

#[tauri::command]
fn is_biometric_available() -> bool {
    #[cfg(target_os = "windows")]
    {
        // Check if Windows Biometric Framework has any enrolled sensors
        // by querying WMI for Win32_BiometricSensor instances.
        let output = std::process::Command::new("powershell")
            .args([
                "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
                "-Command",
                "(Get-WmiObject -Class Win32_BiometricSensor -ErrorAction SilentlyContinue | Measure-Object).Count",
            ])
            .output();
        match output {
            Ok(o) => {
                let s = String::from_utf8_lossy(&o.stdout);
                s.trim().parse::<u32>().unwrap_or(0) > 0
            }
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "windows"))]
    { false }
}

#[tauri::command]
fn unlock_with_biometric(state: State<AppState>) -> Result<(), String> {
    // Retrieve master password stored in OS keyring after first successful unlock
    let vault_guard = state.vault.lock().unwrap();
    let path = vault_guard.path.clone().ok_or("Aucune base sélectionnée.")?;
    drop(vault_guard);

    let entry = keyring::Entry::new("vaultix", &path)
        .map_err(|e| format!("Keyring: {e}"))?;
    let pw = entry.get_password()
        .map_err(|_| "Aucun mot de passe biométrique enregistré pour cette base. Déverrouillez d'abord avec votre mot de passe maître.".to_string())?;

    let mut vault = state.vault.lock().unwrap();
    vault.unlock(&pw)
}

#[tauri::command]
fn is_biometric_registered(state: State<AppState>) -> bool {
    let vault = state.vault.lock().unwrap();
    let path = match &vault.path {
        Some(p) => p.clone(),
        None => return false,
    };
    drop(vault);
    keyring::Entry::new("vaultix", &path)
        .ok()
        .and_then(|e| e.get_password().ok())
        .is_some()
}

#[tauri::command]
fn unregister_biometric(state: State<AppState>) -> Result<(), String> {
    let vault = state.vault.lock().unwrap();
    let path = vault.path.clone().ok_or("Aucune base sélectionnée.")?;
    drop(vault);
    let entry = keyring::Entry::new("vaultix", &path)
        .map_err(|e| format!("Keyring: {e}"))?;
    entry.delete_credential()
        .map_err(|e| format!("Keyring delete: {e}"))
}

/// Store the master password in the OS keyring after a successful unlock (opt-in).
#[tauri::command]
fn register_biometric(state: State<AppState>, master_password: String) -> Result<(), String> {
    let vault = state.vault.lock().unwrap();
    let path = vault.path.as_ref().ok_or("Aucune base sélectionnée.")?;
    let entry = keyring::Entry::new("vaultix", path)
        .map_err(|e| format!("Keyring: {e}"))?;
    entry.set_password(&master_password)
        .map_err(|e| format!("Keyring set: {e}"))
}

// ── TOTP Unlock setup ─────────────────────────────────────────────────────────

#[derive(Serialize)]
struct TotpInitResult {
    secret: String,
    uri: String,
}

/// Generate a TOTP secret for unlock. Returns the base32 secret + otpauth URI.
#[tauri::command]
fn setup_totp_unlock_init(
    state: State<AppState>,
    master_password: String,
) -> Result<TotpInitResult, String> {
    use totp_rs::{Algorithm, TOTP};

    let vault = state.vault.lock().unwrap();
    let path = vault.path.clone().ok_or("Aucune base sélectionnée.")?;
    drop(vault);

    // Verify master password before proceeding
    {
        let mut vault = state.vault.lock().unwrap();
        if !vault.is_open() {
            // Quick check: try to unlock, then re-lock if it was locked
            vault.unlock(&master_password)?;
        }
    }

    use rand::RngCore;
    let mut sb = [0u8; 20];
    rand::thread_rng().fill_bytes(&mut sb);

    let totp = TOTP::new(
        Algorithm::SHA1, 6, 1, 30,
        sb.to_vec(),
        None,
        "vaultix".to_string(),
    ).map_err(|e| format!("TOTP: {e}"))?;

    let secret_b32 = totp.get_secret_base32();
    let uri = totp.get_url();

    // Store master password + secret temporarily (confirm will finalise)
    let entry_pw = keyring::Entry::new("vaultix_totp_pw", &path)
        .map_err(|e| format!("Keyring: {e}"))?;
    entry_pw.set_password(&master_password).map_err(|e| format!("Keyring set pw: {e}"))?;

    let entry_secret = keyring::Entry::new("vaultix_totp_secret_tmp", &path)
        .map_err(|e| format!("Keyring: {e}"))?;
    entry_secret.set_password(&secret_b32).map_err(|e| format!("Keyring set secret: {e}"))?;

    Ok(TotpInitResult { secret: secret_b32, uri })
}

/// Verify the 6-digit code and finalize TOTP registration.
#[tauri::command]
fn setup_totp_unlock_confirm(
    state: State<AppState>,
    master_password: String,
    totp_code: String,
    secret: String,
) -> Result<(), String> {
    use totp_rs::{Algorithm, TOTP};
    use base32::Alphabet;

    let vault = state.vault.lock().unwrap();
    let path = vault.path.clone().ok_or("Aucune base sélectionnée.")?;
    drop(vault);

    // Decode secret
    let secret_bytes = base32::decode(Alphabet::RFC4648 { padding: false }, &secret)
        .ok_or("Secret TOTP invalide.")?;

    let totp = TOTP::new(Algorithm::SHA1, 6, 1, 30, secret_bytes, None, "vaultix".to_string())
        .map_err(|e| format!("TOTP: {e}"))?;

    let expected = totp.generate_current().map_err(|e| format!("TOTP generate: {e}"))?;
    if totp_code.trim() != expected {
        return Err("Code TOTP incorrect — vérifiez l'heure de votre appareil.".into());
    }

    // Store permanently
    let entry_pw = keyring::Entry::new("vaultix_totp_pw", &path)
        .map_err(|e| format!("Keyring: {e}"))?;
    entry_pw.set_password(&master_password).map_err(|e| format!("Keyring: {e}"))?;

    let entry_secret = keyring::Entry::new("vaultix_totp_secret", &path)
        .map_err(|e| format!("Keyring: {e}"))?;
    entry_secret.set_password(&secret).map_err(|e| format!("Keyring: {e}"))?;

    // Clean up tmp
    let _ = keyring::Entry::new("vaultix_totp_secret_tmp", &path).map(|e| e.delete_credential());

    Ok(())
}

#[tauri::command]
fn is_totp_registered(state: State<AppState>) -> bool {
    let vault = state.vault.lock().unwrap();
    let path = match &vault.path { Some(p) => p.clone(), None => return false };
    drop(vault);
    keyring::Entry::new("vaultix_totp_secret", &path)
        .ok().and_then(|e| e.get_password().ok()).is_some()
}

#[tauri::command]
fn disable_totp_unlock(state: State<AppState>) -> Result<(), String> {
    let vault = state.vault.lock().unwrap();
    let path = vault.path.clone().ok_or("Aucune base.")?;
    drop(vault);
    let _ = keyring::Entry::new("vaultix_totp_secret", &path).map(|e| e.delete_credential());
    let _ = keyring::Entry::new("vaultix_totp_pw", &path).map(|e| e.delete_credential());
    Ok(())
}

#[tauri::command]
fn unlock_with_totp(state: State<AppState>, totp_code: String) -> Result<(), String> {
    use totp_rs::{Algorithm, TOTP};
    use base32::Alphabet;

    let vault = state.vault.lock().unwrap();
    let path = vault.path.clone().ok_or("Aucune base sélectionnée.")?;
    drop(vault);

    let secret_b32 = keyring::Entry::new("vaultix_totp_secret", &path)
        .map_err(|e| format!("Keyring: {e}"))?
        .get_password()
        .map_err(|_| "TOTP non configuré pour cette base.".to_string())?;

    let secret_bytes = base32::decode(Alphabet::RFC4648 { padding: false }, &secret_b32)
        .ok_or("Secret TOTP corrompu.")?;

    let totp = TOTP::new(Algorithm::SHA1, 6, 1, 30, secret_bytes, None, "vaultix".to_string())
        .map_err(|e| format!("TOTP: {e}"))?;

    let expected = totp.generate_current().map_err(|e| format!("TOTP: {e}"))?;
    if totp_code.trim() != expected {
        return Err("Code TOTP incorrect.".into());
    }

    let master_pw = keyring::Entry::new("vaultix_totp_pw", &path)
        .map_err(|e| format!("Keyring: {e}"))?
        .get_password()
        .map_err(|_| "Mot de passe maître non trouvé — reconfigurer TOTP.".to_string())?;

    let mut vault = state.vault.lock().unwrap();
    vault.unlock(&master_pw)
}

// ── HIBP breach check ─────────────────────────────────────────────────────────

/// Check how many times a password has been found in data breaches via HaveIBeenPwned.
/// Uses k-anonymity: only the first 5 hex chars of the SHA-1 hash are sent.
/// Returns the breach count (0 = not found).
#[tauri::command]
async fn check_hibp_password(password: String) -> Result<u64, String> {
    use sha1::{Sha1, Digest};

    let mut hasher = Sha1::new();
    hasher.update(password.as_bytes());
    let hash = format!("{:X}", hasher.finalize());
    let prefix = &hash[..5];
    let suffix = &hash[5..];

    let url = format!("https://api.pwnedpasswords.com/range/{}", prefix);
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("Requête HIBP échouée: {e}"))?;
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Réponse HIBP invalide: {e}"))?;

    for line in body.lines() {
        if let Some((s, count)) = line.split_once(':') {
            if s == suffix {
                return Ok(count.trim().parse::<u64>().unwrap_or(1));
            }
        }
    }
    Ok(0)
}

// ── Backup ─────────────────────────────────────────────────────────────────────

/// Copy the current database file to backup_dir using a configurable name pattern.
/// Supported variables in pattern: {name}, {date} (YYYYMMDD), {time} (HHMMSS).
/// Keeps at most max_count backups (0 = unlimited).
#[tauri::command]
fn backup_database(
    state: State<AppState>,
    backup_dir: String,
    max_count: u32,
    name_pattern: String,
) -> Result<String, String> {
    app_log(&format!("[Backup] backup_database: dir={} max_count={} pattern={}", backup_dir, max_count, name_pattern));
    let vault = state.vault.lock().unwrap();
    let src = vault.path.as_ref().ok_or("Aucune base ouverte.")?.clone();
    drop(vault);

    let stem = std::path::Path::new(&src)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("backup");

    let now = chrono::Local::now();
    let date_str = now.format("%Y%m%d").to_string();
    let time_str = now.format("%H%M%S").to_string();

    // Use pattern if non-empty, else fall back to default
    let pattern = if name_pattern.trim().is_empty() {
        "{date}_{time}_{name}".to_string()
    } else {
        name_pattern.clone()
    };
    let filename = pattern
        .replace("{name}", stem)
        .replace("{date}", &date_str)
        .replace("{time}", &time_str);

    // Sanitize: remove characters forbidden in Windows filenames
    let safe_filename: String = filename.chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let dest = format!("{}\\{}.kv", backup_dir.trim_end_matches('\\'), safe_filename);

    app_log(&format!("[Backup] src={} dest={}", src, dest));
    std::fs::create_dir_all(&backup_dir).map_err(|e| format!("Création dossier: {e}"))?;
    std::fs::copy(&src, &dest).map_err(|e| {
        app_log(&format!("[Backup] ERROR copy: {}", e));
        format!("Copie échouée: {e}")
    })?;
    app_log("[Backup] copy OK");

    // Prune old backups — match files that contain the vault name
    if max_count > 0 {
        if let Ok(entries) = std::fs::read_dir(&backup_dir) {
            let mut files: Vec<_> = entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.path().extension().and_then(|x| x.to_str()) == Some("kv")
                        && e.file_name().to_str()
                            .map(|n| n.contains(stem))
                            .unwrap_or(false)
                })
                .collect();
            files.sort_by_key(|e| e.path());
            let excess = files.len().saturating_sub(max_count as usize);
            for f in files.iter().take(excess) {
                let _ = std::fs::remove_file(f.path());
            }
        }
    }

    Ok(dest)
}

// ── Utilities ─────────────────────────────────────────────────────────────────

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

/// Verify the master password by re-decrypting the database file.
#[tauri::command]
fn verify_master_password(state: State<AppState>, master_password: String) -> Result<(), String> {
    let vault = state.vault.lock().unwrap();
    let path = vault.path.clone().ok_or("Aucune base sélectionnée.")?;
    drop(vault);
    let data = std::fs::read(&path).map_err(|e| format!("Lecture fichier: {e}"))?;
    crate::crypto::decrypt_file(&master_password, &data).map(|_| ())
}

/// Change the master password: verify current password, re-encrypt DB with new one,
/// and update any keyring entries (biometric / TOTP) so they stay in sync.
#[tauri::command]
fn change_master_password(
    state: State<AppState>,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    app_log("[Auth] change_master_password: attempt");
    // 1. Verify current password by attempting to decrypt the file
    {
        let vault = state.vault.lock().unwrap();
        let path = vault.path.clone().ok_or("Aucune base sélectionnée.")?;
        drop(vault);
        let data = std::fs::read(&path).map_err(|e| format!("Lecture fichier: {e}"))?;
        crate::crypto::decrypt_file(&current_password, &data)
            .map_err(|_| "Mot de passe actuel incorrect.".to_string())?;
    }

    // 2. Re-encrypt the database with the new password
    {
        let mut vault = state.vault.lock().unwrap();
        vault.change_master_password(&new_password)?;
    }

    // 3. Update biometric keyring entry if registered
    {
        let vault = state.vault.lock().unwrap();
        let path = vault.path.clone().unwrap_or_default();
        drop(vault);
        if let Ok(entry) = keyring::Entry::new("vaultix", &path) {
            if entry.get_password().is_ok() {
                let _ = entry.set_password(&new_password);
            }
        }
    }

    // 4. Update TOTP keyring entry if registered
    {
        let vault = state.vault.lock().unwrap();
        let path = vault.path.clone().unwrap_or_default();
        drop(vault);
        if let Ok(entry) = keyring::Entry::new("vaultix_totp_pw", &path) {
            if entry.get_password().is_ok() {
                let _ = entry.set_password(&new_password);
            }
        }
    }

    Ok(())
}

// ── Protocol connection launcher ──────────────────────────────────────────────

/// Launch the appropriate system application for a protocol entry.
/// RDP  → mstsc.exe /v:host:port
/// SSH  → Windows Terminal (wt) or PowerShell fallback
/// Telnet → telnet.exe or cmd fallback
/// Other protocols return an error so the caller can fall back to openUrl.
#[tauri::command]
fn open_connection(
    entry_type: String,   // JS sends entryType → Tauri 2 auto-maps to snake_case
    host: String,
    port: Option<String>,
    username: Option<String>,
) -> Result<(), String> {
    let host = host.trim().to_string();
    let username = username.unwrap_or_default();

    match entry_type.as_str() {
        "rdp" => {
            let p = port.as_deref().unwrap_or("3389");
            // mstsc.exe is always available on Windows
            std::process::Command::new("mstsc")
                .arg(format!("/v:{}:{}", host, p))
                .spawn()
                .map_err(|e| format!("Impossible de lancer MSTSC : {e}"))?;
        }
        "ssh" => {
            let p = port.as_deref().unwrap_or("22");
            let target = if username.is_empty() {
                host.clone()
            } else {
                format!("{}@{}", username, host)
            };
            // Prefer Windows Terminal; fall back to PowerShell; then plain cmd
            let wt = std::process::Command::new("wt")
                .args(["--", "ssh", &target, "-p", p])
                .spawn();
            if wt.is_err() {
                let ssh_cmd = format!("ssh {} -p {}", target, p);
                let ps = std::process::Command::new("powershell")
                    .args(["-NoExit", "-Command", &ssh_cmd])
                    .spawn();
                if ps.is_err() {
                    std::process::Command::new("cmd")
                        .args(["/c", "start", "cmd", "/k",
                               &format!("ssh {} -p {}", target, p)])
                        .spawn()
                        .map_err(|e| format!("Impossible d'ouvrir SSH : {e}"))?;
                }
            }
        }
        "telnet" => {
            let p = port.as_deref().unwrap_or("23");
            let result = std::process::Command::new("telnet")
                .args([&host, p])
                .spawn();
            if result.is_err() {
                std::process::Command::new("cmd")
                    .args(["/c", "start", "telnet", &host, p])
                    .spawn()
                    .map_err(|e| format!("Impossible d'ouvrir Telnet : {e}"))?;
            }
        }
        t => return Err(format!("open_connection: type '{t}' non pris en charge")),
    }
    Ok(())
}

// ── Tray command ──────────────────────────────────────────────────────────────

// ── Debug / log commands ──────────────────────────────────────────────────────

/// Enable/disable debug logging and set the log file path.
/// Called from the frontend whenever the debug settings change.
#[tauri::command]
fn set_debug_mode(_state: State<DebugState>, enabled: bool, log_path: String) {
    {
        let mut g = dbg_state().lock().unwrap();
        *g = (enabled, log_path.clone());
    }
    if enabled && !log_path.is_empty() {
        app_log("═══════════════════════════════════════════════════════");
        app_log("  Vaultix debug session started");
        app_log(&format!("  log_path = {}", log_path));
        app_log("═══════════════════════════════════════════════════════");
    }
}

/// Write a single log line (called from JS for frontend events).
#[tauri::command]
fn write_log(_state: State<DebugState>, message: String) {
    app_log(&message);
}

/// Return the platform default log directory path (e.g. %APPDATA%\io.github.lordluffy.vaultix\logs\vaultix.log).
#[tauri::command]
fn get_default_log_path(app: tauri::AppHandle) -> String {
    app.path()
        .app_log_dir()
        .map(|p| p.join("vaultix.log").to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Erase the log file content.
#[tauri::command]
fn clear_log_file(path: String) -> Result<(), String> {
    std::fs::write(&path, "").map_err(|e| e.to_string())
}

/// Open the log file in the system default editor.
#[tauri::command]
fn open_log_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(&path, None::<&str>).map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────────────────────────────────────

/// Show or hide the system tray icon. Called from the frontend when the setting changes.
/// When enabled, also removes the window from the taskbar so only the tray icon is visible.
#[tauri::command]
fn set_tray_visible(app: tauri::AppHandle, visible: bool) {
    app_log(&format!("set_tray_visible(visible={})", visible));

    let state = app.state::<TrayState>();
    state.enabled.store(visible, Ordering::Relaxed);
    let guard = state.icon.lock().unwrap();
    if let Some(icon) = guard.as_ref() {
        let r = icon.set_visible(visible);
        app_log(&format!("  tray icon set_visible => {:?}", r));
    }
    drop(guard);
    // Remove/restore window taskbar entry when tray is toggled
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_skip_taskbar(visible);
        app_log(&format!("  set_skip_taskbar({})", visible));
        // If disabling tray, restore window if it was minimised to tray
        // Note: is_visible() returns true for minimised windows, so check both.
        if !visible {
            let hidden    = !w.is_visible().unwrap_or(true);
            let minimised = w.is_minimized().unwrap_or(false);
            app_log(&format!("  disabling tray: window hidden={} minimised={}", hidden, minimised));
            if hidden || minimised {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
                app_log("  -> unminimized + show + focus");
            }
        }
    } else {
        app_log("  WARNING: get_webview_window('main') returned None");
    }
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .manage(TrayState::default())
        .manage(DebugState::default())
        .setup(|app| {
            // ── Build tray menu ───────────────────────────────────────────────
            let show_i = MenuItem::with_id(app, "show", "Ouvrir Vaultix", true, None::<&str>)?;
            let lock_i = MenuItem::with_id(app, "lock", "Verrouiller", true, None::<&str>)?;
            let sep   = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &lock_i, &sep, &quit_i])?;

            // ── Create tray icon (hidden by default) ──────────────────────────
            let mut builder = TrayIconBuilder::new()
                .tooltip("Vaultix")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    app_log(&format!("TrayMenuEvent: id={}", event.id.as_ref()));
                    match event.id.as_ref() {
                        "show" => {
                            let r = app.emit("tray-show", ());
                            app_log(&format!("  emit tray-show => {:?}", r));
                        }
                        "lock" => { let _ = app.emit("tray-lock", ()); }
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // On Windows a double-click fires two Click(Up) events then DoubleClick.
                    // Emit a show event for any left-button-up or double-click; the JS handler
                    // does the actual show/focus so Windows focus rules are respected.
                    let event_name = match &event {
                        TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }   => "Click(Left,Up)",
                        TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Down, .. } => "Click(Left,Down)",
                        TrayIconEvent::Click { .. }           => "Click(Other)",
                        TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => "DoubleClick(Left)",
                        TrayIconEvent::DoubleClick { .. }     => "DoubleClick(Other)",
                        TrayIconEvent::Enter { .. }           => "Enter",
                        TrayIconEvent::Move  { .. }           => "Move",
                        TrayIconEvent::Leave { .. }           => "Leave",
                        _ => "Unknown",
                    };
                    let should_show = matches!(event_name, "Click(Left,Up)" | "DoubleClick(Left)");
                    app_log(&format!("TrayIconEvent: {} should_show={}", event_name, should_show));
                    if should_show {
                        let r = tray.app_handle().emit("tray-show", ());
                        app_log(&format!("  emit tray-show => {:?}", r));
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                builder = builder.icon(icon);
            }

            let tray = builder.build(app)?;
            // Hidden by default — JS will call set_tray_visible(true) if enabled
            let _ = tray.set_visible(false);
            *app.state::<TrayState>().icon.lock().unwrap() = Some(tray);

            // ── Close-to-tray: intercept window close when tray is enabled ────
            let app_handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let enabled = app_handle
                            .state::<TrayState>()
                            .enabled
                            .load(Ordering::Relaxed);
                        app_log(&format!("WindowEvent::CloseRequested tray_enabled={}", enabled));
                        if enabled {
                            api.prevent_close();
                            app_log("  prevent_close + set_skip_taskbar(true) + minimize()");
                            // Do NOT call hide() — it suspends the WebView2 IPC bus on
                            // Windows (Chrome_WidgetWin_0 Error 1412) which prevents the
                            // "tray-show" event from reaching the JS listener.
                            // minimize() keeps the V8 runtime alive so events still fire.
                            let r_skip = window_clone.set_skip_taskbar(true);
                            let r_min  = window_clone.minimize();
                            app_log(&format!("  set_skip_taskbar={:?}  minimize={:?}", r_skip, r_min));
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            create_database,
            open_database,
            unlock_database,
            lock_database,
            close_database,
            get_db_meta,
            get_entries,
            save_entry,
            delete_entry,
            generate_password,
            get_totp_code,
            is_biometric_available,
            is_biometric_registered,
            unlock_with_biometric,
            register_biometric,
            unregister_biometric,
            setup_totp_unlock_init,
            setup_totp_unlock_confirm,
            is_totp_registered,
            disable_totp_unlock,
            unlock_with_totp,
            check_hibp_password,
            backup_database,
            file_exists,
            verify_master_password,
            change_master_password,
            open_connection,
            set_tray_visible,
            set_debug_mode,
            write_log,
            get_default_log_path,
            clear_log_file,
            open_log_file,
            updater::check_update,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
