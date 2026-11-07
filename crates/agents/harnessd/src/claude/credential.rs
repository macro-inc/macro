//! Claude's token on this computer: `<state>/claude/credential.json`, owner
//! only, which the image's `claude` wrapper reads for sessions.

use chrono::{DateTime, Utc};
use harnessd_protocol::ClaudeAccount;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};

/// The stored file.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Credential {
    pub token: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl std::fmt::Debug for Credential {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Credential")
            .field("token", &"<redacted>")
            .field("expires_at", &self.expires_at)
            .field("created_at", &self.created_at)
            .finish()
    }
}

impl Credential {
    /// What the control plane learns about it: never the token.
    pub fn account(&self) -> ClaudeAccount {
        ClaudeAccount {
            credential_id: credential_id(&self.token),
            expires_at: self.expires_at,
        }
    }
}

/// Separates the fingerprint from any other SHA-256 of the token.
const FINGERPRINT_DOMAIN: &[u8] = b"harnessd claude credential v1\0";

/// `sha256:` and the first 32 hex digits of the SHA-256 of
/// [`FINGERPRINT_DOMAIN`] followed by the token.
pub fn credential_id(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(FINGERPRINT_DOMAIN);
    hasher.update(token.as_bytes());
    let digest = hex::encode(hasher.finalize());
    format!("sha256:{}", &digest[..32])
}

/// Where Claude's credential lives under harnessd's state directory.
pub struct CredentialStore {
    directory: PathBuf,
}

impl CredentialStore {
    pub fn new(state_directory: &Path) -> Self {
        Self {
            directory: state_directory.join("claude"),
        }
    }

    pub fn path(&self) -> PathBuf {
        self.directory.join("credential.json")
    }

    /// The stored credential, if any.
    pub fn read(&self) -> std::io::Result<Option<Credential>> {
        let contents = match std::fs::read(self.path()) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        serde_json::from_slice(&contents)
            .map(Some)
            .map_err(std::io::Error::other)
    }

    /// Replace the credential atomically: a 0600 temporary file renamed over
    /// the old one, in a 0700 directory.
    pub fn write(&self, credential: &Credential) -> std::io::Result<()> {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&self.directory)?;
        std::fs::set_permissions(&self.directory, std::fs::Permissions::from_mode(0o700))?;

        let contents = serde_json::to_vec(credential).map_err(std::io::Error::other)?;
        // tempfile creates the file 0600.
        let mut file = tempfile::NamedTempFile::new_in(&self.directory)?;
        file.write_all(&contents)?;
        file.as_file().sync_all()?;
        file.persist(self.path()).map_err(|error| error.error)?;
        Ok(())
    }

    /// Forget the credential; nothing to forget is fine.
    pub fn delete(&self) -> std::io::Result<()> {
        match std::fs::remove_file(self.path()) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        }
    }
}
