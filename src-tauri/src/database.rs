use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroize;

use crate::crypto;

// ── Data model ────────────────────────────────────────────────────────────────

fn default_entry_type() -> String { "login".to_string() }

/// A full snapshot of an entry's state before a change.
/// Recorded whenever any field changes; `changed_fields` lists what changed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryHistorySnapshot {
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: String,
    pub notes: String,
    pub category: String,
    pub changed_at: i64,
    pub changed_fields: Vec<String>,
    #[serde(default = "default_entry_type")]
    pub entry_type: String,
    #[serde(default)]
    pub extra_fields: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordEntry {
    pub id: String,
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: String,
    pub notes: String,
    pub category: String,
    pub tags: Vec<String>,
    /// Folder path using "/" as separator. Empty string = root. e.g. "Travail" or "Travail/Projets"
    #[serde(default)]
    pub folder: String,
    pub totp_secret: Option<String>,
    pub favorite: bool,
    pub strength: u8,
    pub created_at: i64,
    pub updated_at: i64,
    /// Full history of all field changes (most recent last), max 30 entries.
    #[serde(default)]
    pub history: Vec<EntryHistorySnapshot>,
    /// Entry type: "login" | "card" | "identity" | "note" | "ssh"
    #[serde(default = "default_entry_type")]
    pub entry_type: String,
    /// Extra type-specific fields as key-value pairs (card number, SSH keys, etc.)
    #[serde(default)]
    pub extra_fields: Vec<(String, String)>,
    /// Expiry date as unix timestamp. None = no expiry.
    #[serde(default)]
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseMeta {
    pub name: String,
    pub description: String,
    pub created_at: i64,
    pub modified_at: i64,
    pub entry_count: usize,
    pub kdf: String,
    pub cipher: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct DatabaseFile {
    pub meta: DatabaseMeta,
    pub entries: Vec<PasswordEntry>,
}

// ── Runtime vault ─────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct Vault {
    pub path: Option<String>,
    pub meta: Option<DatabaseMeta>,
    pub entries: Vec<PasswordEntry>,
    /// The master password kept only as long as the vault is unlocked.
    master_password: Option<String>,
}

impl Vault {
    pub fn is_open(&self) -> bool {
        self.master_password.is_some()
    }

    /// Create a brand-new database and write it to `path`.
    pub fn create(&mut self, path: &str, name: &str, master_password: &str) -> Result<(), String> {
        let now = Utc::now().timestamp();
        let meta = DatabaseMeta {
            name: name.to_string(),
            description: String::new(),
            created_at: now,
            modified_at: now,
            entry_count: 0,
            kdf: "argon2id".into(),
            cipher: "aes-256-gcm".into(),
        };
        let db = DatabaseFile { meta: meta.clone(), entries: vec![] };
        let json = serde_json::to_vec(&db).map_err(|e| e.to_string())?;
        let file_bytes = crypto::build_encrypted_file(master_password, &json)?;
        std::fs::write(path, &file_bytes).map_err(|e| e.to_string())?;

        self.path = Some(path.to_string());
        self.meta = Some(meta);
        self.entries = vec![];
        self.master_password = Some(master_password.to_string());
        Ok(())
    }

    /// Set the database path without unlocking (after open dialog).
    pub fn set_path(&mut self, path: &str) {
        // Lock any currently open vault
        self.lock();
        self.path = Some(path.to_string());
        self.meta = None;
        self.entries = vec![];
    }

    /// Unlock the vault with the master password.
    pub fn unlock(&mut self, master_password: &str) -> Result<(), String> {
        let path = self.path.as_ref().ok_or("Aucune base de données sélectionnée.")?;
        let data = std::fs::read(path).map_err(|e| format!("Lecture fichier: {e}"))?;
        let plaintext = crypto::decrypt_file(master_password, &data)?;
        let db: DatabaseFile = serde_json::from_slice(&plaintext).map_err(|e| format!("JSON: {e}"))?;
        self.meta = Some(db.meta);
        self.entries = db.entries;
        self.master_password = Some(master_password.to_string());
        Ok(())
    }

    /// Lock the vault — clears sensitive data from memory.
    pub fn lock(&mut self) {
        if let Some(mut pw) = self.master_password.take() {
            pw.zeroize();
        }
        for e in &mut self.entries {
            e.password.zeroize();
            for h in &mut e.history {
                h.password.zeroize();
            }
        }
        self.entries.clear();
        self.meta = None;
    }

    /// Persist current state to disk.
    pub fn save(&mut self) -> Result<(), String> {
        let path = self.path.as_ref().ok_or("Pas de chemin de fichier.")?;
        let pw = self.master_password.as_ref().ok_or("Vault verrouillé.")?;
        let now = Utc::now().timestamp();
        if let Some(meta) = &mut self.meta {
            meta.modified_at = now;
            meta.entry_count = self.entries.len();
        }
        let db = DatabaseFile {
            meta: self.meta.clone().unwrap(),
            entries: self.entries.clone(),
        };
        let json = serde_json::to_vec(&db).map_err(|e| e.to_string())?;
        let file_bytes = crypto::build_encrypted_file(pw, &json)?;
        std::fs::write(path, &file_bytes).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_entries(&self) -> &[PasswordEntry] {
        &self.entries
    }

    /// Add or update an entry.
    pub fn upsert_entry(
        &mut self,
        id: Option<&str>,
        title: &str,
        username: &str,
        password: &str,
        url: &str,
        notes: &str,
        category: &str,
        folder: &str,
        tags: Vec<String>,
        totp_secret: Option<String>,
        favorite: bool,
        entry_type: &str,
        extra_fields: Vec<(String, String)>,
        expires_at: Option<i64>,
    ) -> Result<String, String> {
        let now = Utc::now().timestamp();
        let strength = calc_strength(password);

        if let Some(id_str) = id {
            // Update
            let entry = self.entries.iter_mut().find(|e| e.id == id_str)
                .ok_or("Entrée introuvable.")?;

            // Collect changed fields and record a history snapshot if anything changed
            let mut changed_fields: Vec<String> = vec![];
            if entry.title    != title    { changed_fields.push("title".into()); }
            if entry.username != username { changed_fields.push("username".into()); }
            if entry.password != password { changed_fields.push("password".into()); }
            if entry.url      != url      { changed_fields.push("url".into()); }
            if entry.notes    != notes    { changed_fields.push("notes".into()); }
            if entry.category != category { changed_fields.push("category".into()); }
            if entry.folder   != folder   { changed_fields.push("folder".into()); }

            if entry.entry_type != entry_type   { changed_fields.push("entry_type".into()); }
            if entry.extra_fields != extra_fields { changed_fields.push("extra_fields".into()); }

            if !changed_fields.is_empty() {
                let snapshot = EntryHistorySnapshot {
                    title:          entry.title.clone(),
                    username:       entry.username.clone(),
                    password:       entry.password.clone(),
                    url:            entry.url.clone(),
                    notes:          entry.notes.clone(),
                    category:       entry.category.clone(),
                    changed_at:     entry.updated_at,
                    changed_fields,
                    entry_type:     entry.entry_type.clone(),
                    extra_fields:   entry.extra_fields.clone(),
                };
                entry.history.push(snapshot);
                while entry.history.len() > 30 {
                    entry.history.remove(0);
                }
            }

            entry.title        = title.to_string();
            entry.username     = username.to_string();
            entry.password     = password.to_string();
            entry.url          = url.to_string();
            entry.notes        = notes.to_string();
            entry.category     = category.to_string();
            entry.folder       = folder.to_string();
            entry.tags         = tags;
            entry.totp_secret  = totp_secret;
            entry.favorite     = favorite;
            entry.strength     = strength;
            entry.entry_type   = entry_type.to_string();
            entry.extra_fields = extra_fields;
            entry.expires_at   = expires_at;
            entry.updated_at   = now;
            let id_ret = id_str.to_string();
            self.save()?;
            Ok(id_ret)
        } else {
            // Create
            let entry = PasswordEntry {
                id:          Uuid::new_v4().to_string(),
                title:       title.to_string(),
                username:    username.to_string(),
                password:    password.to_string(),
                url:         url.to_string(),
                notes:       notes.to_string(),
                category:    category.to_string(),
                folder:      folder.to_string(),
                tags,
                totp_secret,
                favorite,
                strength,
                created_at:   now,
                updated_at:   now,
                history:      vec![],
                entry_type:   entry_type.to_string(),
                extra_fields,
                expires_at,
            };
            let id_ret = entry.id.clone();
            self.entries.push(entry);
            self.save()?;
            Ok(id_ret)
        }
    }

    pub fn delete_entry(&mut self, id: &str) -> Result<(), String> {
        let before = self.entries.len();
        self.entries.retain(|e| e.id != id);
        if self.entries.len() == before {
            return Err("Entrée introuvable.".into());
        }
        self.save()
    }

    /// Re-encrypt the database with a new master password and a fresh Argon2 salt.
    /// The caller must have already verified that the current password is correct.
    pub fn change_master_password(&mut self, new_password: &str) -> Result<(), String> {
        // Swap in the new password, save, restore on failure
        let old = self.master_password.take().ok_or("Vault verrouillé.")?;
        self.master_password = Some(new_password.to_string());
        match self.save() {
            Ok(()) => {
                let mut o = old;
                o.zeroize();
                Ok(())
            }
            Err(e) => {
                self.master_password = Some(old);
                Err(e)
            }
        }
    }
}

impl Drop for Vault {
    fn drop(&mut self) {
        self.lock();
    }
}

// ── Password strength ─────────────────────────────────────────────────────────

pub fn calc_strength(pw: &str) -> u8 {
    let mut score: u8 = 0;
    if pw.len() >= 8  { score += 1; }
    if pw.len() >= 14 { score += 1; }
    if pw.chars().any(|c| c.is_uppercase()) && pw.chars().any(|c| c.is_lowercase()) { score += 1; }
    if pw.chars().any(|c| c.is_ascii_digit()) { score += 1; }
    if pw.chars().any(|c| !c.is_alphanumeric()) { score += 1; }
    score.saturating_sub(1).min(4)
}
