/// Cryptographic primitives for Vaultix
///
/// Key derivation  : Argon2id  (memory-hard, side-channel resistant)
/// Supported ciphers:
///   0 = AES-256-GCM          (12-byte nonce)
///   1 = AES-256-GCM-SIV      (12-byte nonce, nonce-misuse resistant)
///   2 = XChaCha20-Poly1305   (24-byte nonce)
///
/// File format v1 (legacy, read-only):
///   [4 bytes magic "KVT\x01"]
///   [4 bytes version = 1 as le u32]
///   [32 bytes Argon2 salt]
///   [4 bytes Argon2 memory_cost as le u32]
///   [4 bytes Argon2 time_cost   as le u32]
///   [4 bytes Argon2 parallelism as le u32]
///   [12 bytes AES-GCM nonce]
///   [remaining: AES-GCM ciphertext + 16-byte GCM tag]
///
/// File format v2:
///   [4 bytes magic "KVT\x01"]
///   [4 bytes version = 2 as le u32]
///   [1 byte cipher_id: 0=GCM, 1=GCM-SIV, 2=XChaCha20]
///   [32 bytes Argon2 salt]
///   [4 bytes Argon2 memory_cost as le u32]
///   [4 bytes Argon2 time_cost   as le u32]
///   [4 bytes Argon2 parallelism as le u32]
///   [12 or 24 bytes nonce (12 for GCM/GCM-SIV, 24 for XChaCha20)]
///   [remaining: ciphertext + 16-byte authentication tag]

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key as AesKey, Nonce as AesNonce,
};
use aes_gcm_siv::{Aes256GcmSiv, Nonce as SivNonce};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use zeroize::Zeroize;

pub const MAGIC: &[u8; 4] = b"KVT\x01";
pub const FILE_VERSION: u32 = 2;
pub const ARGON2_MEM:      u32 = 65536; // 64 MiB
pub const ARGON2_TIME:     u32 = 3;
pub const ARGON2_PARALLEL: u32 = 4;

/// Cipher identifier stored in the v2 file header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CipherId {
    Gcm     = 0,
    GcmSiv  = 1,
    XChaCha = 2,
}

impl CipherId {
    pub fn from_u8(b: u8) -> Result<Self, String> {
        match b {
            0 => Ok(CipherId::Gcm),
            1 => Ok(CipherId::GcmSiv),
            2 => Ok(CipherId::XChaCha),
            _ => Err(format!("Unknown cipher id: {b}")),
        }
    }

    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "aes-256-gcm"     => Ok(CipherId::Gcm),
            "aes-256-gcm-siv" => Ok(CipherId::GcmSiv),
            "xchacha20"       => Ok(CipherId::XChaCha),
            _ => Err(format!("Unknown cipher: {s}")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            CipherId::Gcm     => "aes-256-gcm",
            CipherId::GcmSiv  => "aes-256-gcm-siv",
            CipherId::XChaCha => "xchacha20",
        }
    }

    pub fn nonce_size(self) -> usize {
        match self {
            CipherId::Gcm | CipherId::GcmSiv => 12,
            CipherId::XChaCha                => 24,
        }
    }
}

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

/// Encrypt plaintext with the chosen cipher. Returns (nonce_bytes, ciphertext).
fn cipher_encrypt(
    cipher_id: CipherId,
    key: &[u8; 32],
    plaintext: &[u8],
) -> Result<(Vec<u8>, Vec<u8>), String> {
    let nonce_len = cipher_id.nonce_size();
    let mut nonce_bytes = vec![0u8; nonce_len];
    rand::rng().fill_bytes(&mut nonce_bytes);

    let ciphertext = match cipher_id {
        CipherId::Gcm => {
            let cipher = Aes256Gcm::new(AesKey::<Aes256Gcm>::from_slice(key));
            let nonce = AesNonce::from_slice(&nonce_bytes);
            cipher.encrypt(nonce, plaintext)
                .map_err(|e| format!("AES-256-GCM encrypt: {e}"))?
        }
        CipherId::GcmSiv => {
            let cipher = Aes256GcmSiv::new(AesKey::<Aes256GcmSiv>::from_slice(key));
            let nonce = SivNonce::from_slice(&nonce_bytes);
            cipher.encrypt(nonce, plaintext)
                .map_err(|e| format!("AES-256-GCM-SIV encrypt: {e}"))?
        }
        CipherId::XChaCha => {
            let cipher = XChaCha20Poly1305::new(chacha20poly1305::Key::from_slice(key));
            let nonce = XNonce::from_slice(&nonce_bytes);
            cipher.encrypt(nonce, plaintext)
                .map_err(|e| format!("XChaCha20-Poly1305 encrypt: {e}"))?
        }
    };

    Ok((nonce_bytes, ciphertext))
}

/// Decrypt ciphertext with the chosen cipher.
fn cipher_decrypt(
    cipher_id: CipherId,
    key: &[u8; 32],
    nonce: &[u8],
    ciphertext: &[u8],
) -> Result<Vec<u8>, String> {
    let err = "Decryption failed — wrong password or corrupted file.";
    match cipher_id {
        CipherId::Gcm => {
            let cipher = Aes256Gcm::new(AesKey::<Aes256Gcm>::from_slice(key));
            let n = AesNonce::from_slice(nonce);
            cipher.decrypt(n, ciphertext).map_err(|_| err.into())
        }
        CipherId::GcmSiv => {
            let cipher = Aes256GcmSiv::new(AesKey::<Aes256GcmSiv>::from_slice(key));
            let n = SivNonce::from_slice(nonce);
            cipher.decrypt(n, ciphertext).map_err(|_| err.into())
        }
        CipherId::XChaCha => {
            let cipher = XChaCha20Poly1305::new(chacha20poly1305::Key::from_slice(key));
            let n = XNonce::from_slice(nonce);
            cipher.decrypt(n, ciphertext).map_err(|_| err.into())
        }
    }
}

/// Build the full binary file (v2 format) from a master password + JSON plaintext.
pub fn build_encrypted_file(
    master_password: &str,
    plaintext: &[u8],
    cipher_id: CipherId,
) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; 32];
    rand::rng().fill_bytes(&mut salt);

    let mut key = derive_key(master_password, &salt, ARGON2_MEM, ARGON2_TIME, ARGON2_PARALLEL)?;
    let (nonce, ciphertext) = cipher_encrypt(cipher_id, &key, plaintext)?;
    key.zeroize();

    let nonce_len = cipher_id.nonce_size();
    let mut file = Vec::with_capacity(4 + 4 + 1 + 32 + 4 + 4 + 4 + nonce_len + ciphertext.len());
    file.extend_from_slice(MAGIC);
    file.extend_from_slice(&FILE_VERSION.to_le_bytes()); // version = 2
    file.push(cipher_id as u8);                          // cipher_id byte
    file.extend_from_slice(&salt);
    file.extend_from_slice(&ARGON2_MEM.to_le_bytes());
    file.extend_from_slice(&ARGON2_TIME.to_le_bytes());
    file.extend_from_slice(&ARGON2_PARALLEL.to_le_bytes());
    file.extend_from_slice(&nonce);
    file.extend_from_slice(&ciphertext);

    Ok(file)
}

/// Parse and decrypt a file produced by `build_encrypted_file`.
/// Supports both v1 (legacy AES-256-GCM) and v2 (multi-cipher) formats.
pub fn decrypt_file(master_password: &str, data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 64 {
        return Err("File too short or corrupted.".into());
    }
    if &data[0..4] != MAGIC {
        return Err("Unrecognized file format.".into());
    }

    let version = u32::from_le_bytes(data[4..8].try_into().unwrap());

    let (cipher_id, header_extra, kdf_offset) = if version == 1 {
        // v1: no cipher byte, AES-GCM assumed, salt starts at byte 8
        (CipherId::Gcm, 0usize, 8usize)
    } else if version == 2 {
        // v2: cipher byte at position 8, salt starts at byte 9
        let cid = CipherId::from_u8(data[8])?;
        (cid, 1usize, 9usize)
    } else {
        return Err(format!("Unsupported file version: {version}"));
    };

    let salt_end    = kdf_offset + 32;
    let kdf_end     = salt_end + 12; // 3 × u32
    let nonce_size  = cipher_id.nonce_size();
    let nonce_end   = kdf_end + nonce_size;

    if data.len() < nonce_end + 1 {
        return Err("File too short or corrupted.".into());
    }

    let salt: [u8; 32] = data[kdf_offset..salt_end].try_into().unwrap();
    let memory   = u32::from_le_bytes(data[salt_end     ..salt_end + 4 ].try_into().unwrap());
    let time     = u32::from_le_bytes(data[salt_end + 4 ..salt_end + 8 ].try_into().unwrap());
    let parallel = u32::from_le_bytes(data[salt_end + 8 ..salt_end + 12].try_into().unwrap());
    let nonce      = &data[kdf_end..nonce_end];
    let ciphertext = &data[nonce_end..];

    let _ = header_extra; // used only to document the layout difference

    let mut key = derive_key(master_password, &salt, memory, time, parallel)?;
    let plaintext = cipher_decrypt(cipher_id, &key, nonce, ciphertext)?;
    key.zeroize();

    Ok(plaintext)
}

/// Return the cipher id stored in a file header (without decrypting).
/// Used by `Vault::unlock` to populate `Vault::cipher`.
pub fn detect_cipher(data: &[u8]) -> Result<CipherId, String> {
    if data.len() < 9 {
        return Err("File too short.".into());
    }
    if &data[0..4] != MAGIC {
        return Err("Unrecognized file format.".into());
    }
    let version = u32::from_le_bytes(data[4..8].try_into().unwrap());
    match version {
        1 => Ok(CipherId::Gcm),
        2 => CipherId::from_u8(data[8]),
        v => Err(format!("Unsupported file version: {v}")),
    }
}
