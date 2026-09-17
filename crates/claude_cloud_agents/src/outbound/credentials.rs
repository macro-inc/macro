//! Legacy private-file and memory adapters for standalone smoke tests.
pub use crate::domain::credentials::AccountCredentials;
use crate::domain::{
    credentials::{ConnectionState, GrantRepository, GrantTransaction, RefreshGrant},
    model::{Credentials, Error, Result, Secret},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{io::AsyncWriteExt, sync::Mutex};

/// Public OAuth client used by Claude Code Desktop.
pub const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
/// Compatibility name for the standalone smoke runner.
pub type FileCredentials = AccountCredentials;

#[derive(Default, Serialize, Deserialize)]
struct FileData {
    users: BTreeMap<String, Credentials>,
    #[serde(default)]
    connections: BTreeMap<String, ConnectionState>,
}
struct FileRepository {
    path: Option<PathBuf>,
    data: Arc<Mutex<FileData>>,
}

impl AccountCredentials {
    /// Empty process-local store for tests. Reads no existing credentials.
    pub fn memory() -> Result<Self> {
        Ok(Self::new(
            Arc::new(FileRepository {
                path: None,
                data: Arc::default(),
            }),
            Arc::new(ClaudeRefresh::new()?),
        ))
    }
    /// Explicit private-file opt-in for standalone experiments only.
    pub async fn open(path: PathBuf) -> Result<Self> {
        check_private(&path, false).await?;
        check_private(path.parent().ok_or(Error::Credentials)?, true).await?;
        let bytes = zeroize::Zeroizing::new(
            tokio::fs::read(&path)
                .await
                .map_err(|_| Error::Credentials)?,
        );
        if bytes.len() > 2_000_000 {
            return Err(Error::Credentials);
        }
        let data: FileData = serde_json::from_slice(&bytes).map_err(|_| Error::Credentials)?;
        for owner in data.users.keys().chain(data.connections.keys()) {
            if owner.trim() != owner || !owner.starts_with("macro|") || owner.contains('\0') {
                return Err(Error::Credentials);
            }
        }
        for grant in data.users.values().chain(
            data.connections
                .values()
                .filter_map(|state| state.grant.as_ref()),
        ) {
            uuid::Uuid::parse_str(&grant.organization_id).map_err(|_| Error::Credentials)?;
            if !grant.environment_id.starts_with("env_")
                || !grant
                    .environment_id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_')
            {
                return Err(Error::Credentials);
            }
        }
        Ok(Self::new(
            Arc::new(FileRepository {
                path: Some(path),
                data: Arc::new(Mutex::new(data)),
            }),
            Arc::new(ClaudeRefresh::new()?),
        ))
    }
}

impl FileRepository {
    async fn persist(path: &Option<PathBuf>, data: &FileData) -> Result<()> {
        let Some(path) = path else {
            return Ok(());
        };
        let bytes =
            zeroize::Zeroizing::new(serde_json::to_vec(data).map_err(|_| Error::Credentials)?);
        let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::now_v7()));
        let mut options = tokio::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&temp).await.map_err(|_| Error::Credentials)?;
        file.write_all(&bytes)
            .await
            .map_err(|_| Error::Credentials)?;
        file.sync_all().await.map_err(|_| Error::Credentials)?;
        tokio::fs::rename(&temp, path)
            .await
            .map_err(|_| Error::Credentials)
    }
}
struct FileTransaction {
    data: tokio::sync::OwnedMutexGuard<FileData>,
    path: Option<PathBuf>,
    owner: String,
    state: ConnectionState,
}
#[async_trait::async_trait]
impl GrantRepository for FileRepository {
    async fn lock(&self, owner: &str) -> Result<Box<dyn GrantTransaction>> {
        let data = self.data.clone().lock_owned().await;
        let state = data
            .connections
            .get(owner)
            .cloned()
            .unwrap_or_else(|| ConnectionState {
                grant: data.users.get(owner).cloned(),
                ..Default::default()
            });
        Ok(Box::new(FileTransaction {
            data,
            path: self.path.clone(),
            owner: owner.to_owned(),
            state,
        }))
    }
}
#[async_trait::async_trait]
impl GrantTransaction for FileTransaction {
    fn state(&mut self) -> &mut ConnectionState {
        &mut self.state
    }
    async fn commit(self: Box<Self>) -> Result<()> {
        let Self {
            mut data,
            path,
            owner,
            state,
        } = *self;
        let previous = data.connections.insert(owner.clone(), state);
        let legacy = data.users.remove(&owner);
        if let Err(error) = FileRepository::persist(&path, &data).await {
            match previous {
                Some(value) => {
                    data.connections.insert(owner.clone(), value);
                }
                None => {
                    data.connections.remove(&owner);
                }
            }
            if let Some(value) = legacy {
                data.users.insert(owner, value);
            }
            return Err(error);
        }
        Ok(())
    }
}

/// Fixed-origin token-refresh transport.
pub struct ClaudeRefresh {
    http: reqwest::Client,
}
impl ClaudeRefresh {
    /// Construct without redirects or automatic retries.
    pub fn new() -> Result<Self> {
        Ok(Self {
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .map_err(|_| Error::Network)?,
        })
    }
}
#[async_trait::async_trait]
impl RefreshGrant for ClaudeRefresh {
    async fn refresh(&self, current: &Credentials) -> Result<Credentials> {
        let refresh = current.refresh_token.as_ref().ok_or(Error::Authorization)?;
        let response = self.http.post(TOKEN_URL).json(&serde_json::json!({
            "grant_type":"refresh_token", "refresh_token":refresh.expose(), "client_id":CLIENT_ID,
            "scope":"user:inference user:profile user:sessions:claude_code"
        })).send().await.map_err(|_| Error::Network)?;
        if !response.status().is_success() {
            return Err(Error::Authorization);
        }
        #[derive(Deserialize)]
        struct Refresh {
            access_token: Secret,
            refresh_token: Option<Secret>,
            expires_in: u64,
        }
        let refreshed: Refresh = response.json().await.map_err(|_| Error::Protocol)?;
        if refreshed.expires_in < 1 {
            return Err(Error::Authorization);
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| Error::Credentials)?
            .as_secs();
        let mut updated = current.clone();
        updated.access_token = refreshed.access_token;
        updated.refresh_token = refreshed.refresh_token.or(updated.refresh_token);
        updated.expires_at = now.saturating_add(refreshed.expires_in);
        Ok(updated)
    }
}
async fn check_private(path: &Path, directory: bool) -> Result<()> {
    let metadata = tokio::fs::symlink_metadata(path)
        .await
        .map_err(|_| Error::Credentials)?;
    if metadata.file_type().is_symlink()
        || (directory && !metadata.is_dir())
        || (!directory && !metadata.is_file())
    {
        return Err(Error::Credentials);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(Error::Credentials);
        }
    }
    #[cfg(not(unix))]
    return Err(Error::Credentials);
    Ok(())
}
#[cfg(test)]
mod test;
