//! Root-owned token storage for the unprivileged computer daemon. Enrollment
//! installs the helper; only the daemon's Unix uid may connect to its socket.

use std::os::unix::fs::PermissionsExt as _;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rootcause::option_ext::OptionExt as _;
use rootcause::prelude::ResultExt as _;
use tokio::io::{AsyncBufReadExt as _, AsyncReadExt as _, AsyncWriteExt as _, BufReader};
use tokio::net::{UnixListener, UnixStream};

pub(crate) const SOCKET: &str = "/run/macrod/claude-token.sock";
const TOKEN: &str = "/var/lib/macrod/claude-token";
const MAX_FRAME: u64 = 8192;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
enum Request {
    Load,
    Save { token: String },
    Delete,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum Reply {
    Loaded { token: Option<String> },
    Saved,
    Deleted,
    Failed,
}

pub(crate) struct TokenStore {
    socket: PathBuf,
}

impl TokenStore {
    pub(crate) fn new() -> Self {
        Self {
            socket: SOCKET.into(),
        }
    }

    pub(crate) async fn load(&self) -> rootcause::Result<Option<String>> {
        match self.request(Request::Load).await? {
            Reply::Loaded { token } => Ok(token),
            _ => rootcause::bail!("could not load the private Claude token"),
        }
    }

    pub(crate) async fn save(&self, token: String) -> rootcause::Result<()> {
        match self.request(Request::Save { token }).await? {
            Reply::Saved => Ok(()),
            _ => rootcause::bail!("could not save the private Claude token"),
        }
    }

    pub(crate) async fn delete(&self) -> rootcause::Result<()> {
        match self.request(Request::Delete).await? {
            Reply::Deleted => Ok(()),
            _ => rootcause::bail!("could not delete the private Claude token"),
        }
    }

    async fn request(&self, request: Request) -> rootcause::Result<Reply> {
        tokio::time::timeout(REQUEST_TIMEOUT, async {
            let mut socket = UnixStream::connect(&self.socket)
                .await
                .context("the root token store is unavailable; run macrod enroll as root")?;
            if socket
                .peer_cred()
                .context("could not verify the token store")?
                .uid()
                != 0
            {
                rootcause::bail!("the token store must run as root");
            }
            write_frame(&mut socket, &request).await?;
            read_frame(&mut socket).await
        })
        .await
        .context("the token store timed out")?
    }
}

/// Run only as root; the agent process itself keeps its unprivileged uid.
pub(crate) async fn run(owner: u32) -> rootcause::Result<()> {
    if !rustix::process::geteuid().is_root() {
        rootcause::bail!("the computer token store must run as root");
    }
    let socket_path = Path::new(SOCKET);
    let parent = socket_path
        .parent()
        .context("the socket needs a directory")?;
    std::fs::create_dir_all(parent).context("could not create the token socket directory")?;
    match std::fs::remove_file(socket_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(rootcause::report!(
                "could not replace the token socket: {error}"
            ));
        }
    }
    let listener = UnixListener::bind(socket_path).context("could not bind the token socket")?;
    std::fs::set_permissions(socket_path, std::fs::Permissions::from_mode(0o600))
        .context("could not protect the token socket")?;
    std::os::unix::fs::chown(socket_path, Some(owner), None)
        .context("could not assign the token socket")?;
    loop {
        let (mut socket, _) = listener
            .accept()
            .await
            .context("could not accept a token request")?;
        if socket
            .peer_cred()
            .context("could not verify the token caller")?
            .uid()
            != owner
        {
            continue;
        }
        match tokio::time::timeout(REQUEST_TIMEOUT, serve(&mut socket, Path::new(TOKEN))).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => tracing::warn!(error = ?error, "token store request failed"),
            Err(_) => tracing::warn!("token store request timed out"),
        }
    }
}

async fn serve(socket: &mut UnixStream, path: &Path) -> rootcause::Result<()> {
    let request = read_frame(socket).await?;
    let reply = match execute(request, path) {
        Ok(reply) => reply,
        Err(error) => {
            tracing::warn!(error = ?error, "private token operation failed");
            Reply::Failed
        }
    };
    write_frame(socket, &reply).await
}

fn execute(request: Request, path: &Path) -> rootcause::Result<Reply> {
    match request {
        Request::Load => {
            let token = match std::fs::read_to_string(path) {
                Ok(token) if !token.trim().is_empty() => Some(token.trim().to_owned()),
                Ok(_) => rootcause::bail!("the private token file is empty"),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => {
                    return Err(rootcause::report!(
                        "could not read the private token: {error}"
                    ));
                }
            };
            Ok(Reply::Loaded { token })
        }
        Request::Save { token } => {
            crate::enroll::write_private(path, &format!("{token}\n"))?;
            Ok(Reply::Saved)
        }
        Request::Delete => {
            match std::fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(rootcause::report!(
                        "could not delete the private token: {error}"
                    ));
                }
            }
            Ok(Reply::Deleted)
        }
    }
}

async fn read_frame<T: serde::de::DeserializeOwned>(
    socket: &mut UnixStream,
) -> rootcause::Result<T> {
    let mut bytes = Vec::new();
    BufReader::new(socket.take(MAX_FRAME + 1))
        .read_until(b'\n', &mut bytes)
        .await
        .context("could not read a token-store frame")?;
    if bytes.len() as u64 > MAX_FRAME || bytes.last() != Some(&b'\n') {
        rootcause::bail!("invalid token-store frame length");
    }
    // Never attach serde errors: they may contain a secret from an invalid tag.
    serde_json::from_slice(&bytes).map_err(|_| rootcause::report!("invalid token-store frame"))
}

async fn write_frame(
    socket: &mut UnixStream,
    frame: &impl serde::Serialize,
) -> rootcause::Result<()> {
    let mut bytes = serde_json::to_vec(frame)
        .map_err(|_| rootcause::report!("could not encode token-store frame"))?;
    bytes.push(b'\n');
    socket
        .write_all(&bytes)
        .await
        .context("could not write a token-store frame")?;
    Ok(())
}

#[cfg(test)]
mod test;
