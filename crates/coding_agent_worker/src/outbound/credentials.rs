//! The daemon's persisted identity: which harness this machine is, and the
//! bearer token that proves it.
//!
//! Written once by pairing and read at every boot, in a state file next to
//! the config. Losing the file is recoverable by pairing again.

use std::path::{Path, PathBuf};

use harness_id::HarnessId;
use rootcause::prelude::ResultExt as _;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// Whether the harness is private to its owner or shared with a team.
///
/// Persisted because the event stream must live in the matching workspace: a
/// team harness listens in the team workspace so teammates' agents' triggers
/// reach it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HarnessScope {
    /// Owned by one user.
    User,
    /// Owned by a team.
    Team,
}

/// The credential pairing minted for this daemon.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessCredentials {
    /// The registered harness this daemon serves.
    pub harness_id: HarnessId,
    /// The bearer token (`mhns_...`).
    pub token: String,
    /// The harness's ownership scope.
    pub scope: HarnessScope,
}

/// Where credentials live and how they are read back.
pub trait CredentialStore {
    /// The persisted credentials, or `None` before the first pairing.
    fn load(&self) -> rootcause::Result<Option<HarnessCredentials>>;

    /// Persist newly minted credentials.
    fn save(&self, credentials: &HarnessCredentials) -> rootcause::Result<()>;
}

/// Credentials in a mode-600 JSON file next to the config.
pub struct FileCredentialStore {
    path: PathBuf,
}

impl FileCredentialStore {
    /// The store for the daemon config at `config_path`.
    pub fn for_config(config_path: &Path) -> Self {
        Self {
            path: credentials_path(config_path),
        }
    }

    /// Where the file lives, so tests can inspect and corrupt it.
    #[cfg(test)]
    pub fn path(&self) -> &Path {
        &self.path
    }

    fn failure(&self) -> String {
        format!(
            "failed to use the credentials file at {}",
            self.path.display()
        )
    }
}

/// Where the credentials live: next to the config they belong to.
pub fn credentials_path(config_path: &Path) -> PathBuf {
    config_path.with_extension("credentials.json")
}

impl CredentialStore for FileCredentialStore {
    fn load(&self) -> rootcause::Result<Option<HarnessCredentials>> {
        let found = std::fs::read_to_string(&self.path);
        if let Err(error) = &found
            && error.kind() == std::io::ErrorKind::NotFound
        {
            return Ok(None);
        }
        let raw = found.context(self.failure())?;
        // Credentials we cannot parse are credentials we do not have; the
        // caller sends the user back through pairing.
        Ok(serde_json::from_str(&raw).ok())
    }

    fn save(&self, credentials: &HarnessCredentials) -> rootcause::Result<()> {
        let raw = serde_json::to_string_pretty(credentials).expect("a serializable credential");
        std::fs::write(&self.path, raw).context(self.failure())?;
        // The token authenticates this harness; keep it out of other users' reach.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let _ = std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }
}
