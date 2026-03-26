/// Cryptographic primitives for Vaultix
///
/// Key derivation  : Argon2id  (memory-hard, side-channel resistant)
/// Database cipher : AES-256-GCM (authenticated encryption)
/// Per-field extra : ChaCha20-Poly1305 (for password fields inside the DB)
///
/// Layout of an encrypted database file:
///   [4 bytes magic "KVT\x01"]
///   [4 bytes version = 1 as le u32]
///   [32 bytes Argon2 salt]
///   [4 bytes Argon2 memory_cost as le u32]
///   [4 bytes Argon2 time_cost   as le u32]
///   [4 bytes Argon2 parallelism as le u32]
///   [12 bytes AES-GCM nonce]
///   [remaining: AES-GCM ciphertext + 16-byte GCM tag]

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key as AesKey, Nonce as AesNonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use zeroize::Zeroize;

pub const MAGIC: &[u8; 4] = b"KVT\x01";
pub const FILE_VERSION: u32 = 1;
pub const ARGON2_MEM:     u32 = 65536; // 64 MiB
pub const ARGON2_TIME:    u32 = 3;
pub const ARGON2_PARALLEL: u32 = 4;

/// Derive a 32-byte encryption key from a master password + salt using Argon2id.
pub fn derive_key(
    password: &str,
    salt: &[u8; 32],
    memory: u32,
    time: u32,
    parallelism: u32,
) -> Result<[u8; 32], String> {
    let params = Params::new(memory, time, parallelism, Some(32))
        .map_err(|e| format!("Argon2 params: {e}"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Argon2 hash: {e}"))?;
    Ok(key)
}

/// Encrypt plaintext bytes with AES-256-GCM. Returns nonce ++ ciphertext.
pub fn aes_encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    let cipher = Aes256Gcm::new(AesKey::<Aes256Gcm>::from_slice(key));
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = AesNonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("AES-GCM encrypt: {e}"))?;
    Ok((nonce_bytes.to_vec(), ciphertext))
}

/// Decrypt AES-256-GCM ciphertext.
pub fn aes_decrypt(key: &[u8; 32], nonce: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(AesKey::<Aes256Gcm>::from_slice(key));
    let nonce = AesNonce::from_slice(nonce);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Déchiffrement échoué — mot de passe incorrect ou fichier corrompu.".into())
}

/// Build the full binary file from a master password + JSON plaintext.
pub fn build_encrypted_file(master_password: &str, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    // Random salt
    let mut salt = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut salt);

    // Derive key
    let mut key = derive_key(master_password, &salt, ARGON2_MEM, ARGON2_TIME, ARGON2_PARALLEL)?;

    // Encrypt
    let (nonce, ciphertext) = aes_encrypt(&key, plaintext)?;
    key.zeroize();

    // Assemble file
    let mut file = Vec::with_capacity(4 + 4 + 32 + 4 + 4 + 4 + 12 + ciphertext.len());
    file.extend_from_slice(MAGIC);
    file.extend_from_slice(&FILE_VERSION.to_le_bytes());
    file.extend_from_slice(&salt);
    file.extend_from_slice(&ARGON2_MEM.to_le_bytes());
    file.extend_from_slice(&ARGON2_TIME.to_le_bytes());
    file.extend_from_slice(&ARGON2_PARALLEL.to_le_bytes());
    file.extend_from_slice(&nonce);
    file.extend_from_slice(&ciphertext);

    Ok(file)
}

/// Parse and decrypt a file produced by `build_encrypted_file`.
/// Returns the plaintext bytes on success.
pub fn decrypt_file(master_password: &str, data: &[u8]) -> Result<Vec<u8>, String> {
    // Minimum header size: 4+4+32+4+4+4+12 = 64 bytes
    if data.len() < 64 {
        return Err("Fichier trop court ou corrompu.".into());
    }

    // Check magic
    if &data[0..4] != MAGIC {
        return Err("Format de fichier non reconnu.".into());
    }

    let _version = u32::from_le_bytes(data[4..8].try_into().unwrap());
    let salt: [u8; 32] = data[8..40].try_into().unwrap();
    let memory   = u32::from_le_bytes(data[40..44].try_into().unwrap());
    let time     = u32::from_le_bytes(data[44..48].try_into().unwrap());
    let parallel = u32::from_le_bytes(data[48..52].try_into().unwrap());
    let nonce    = &data[52..64];
    let ciphertext = &data[64..];

    let mut key = derive_key(master_password, &salt, memory, time, parallel)?;
    let plaintext = aes_decrypt(&key, nonce, ciphertext)?;
    key.zeroize();

    Ok(plaintext)
}
