//! `harnessd serve`'s unix socket: a JSONL loop per connection over shared
//! adapters, so a cancel on one connection interrupts a complete waiting on
//! another.

use crate::auth::{AgentAuth, Agents};
use crate::jsonl::serve_connection;
use std::os::unix::fs::{FileTypeExt, PermissionsExt};
use std::path::Path;
use std::sync::Arc;
use tokio::io::BufReader;
use tokio::net::UnixListener;

#[cfg(test)]
mod test;

/// Listen on `path`, owner-only, replacing a socket a previous run left.
pub fn listen(path: &Path) -> std::io::Result<UnixListener> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_socket() => std::fs::remove_file(path)?,
        Ok(_) => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!("{} exists and is not a socket", path.display()),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    // The socket is connectable from bind on, so only a directory nobody
    // else can enter keeps it private; chmod after bind would leave a gap.
    let directory = path.parent().unwrap_or(Path::new("."));
    let mode = std::fs::metadata(directory)?.permissions().mode();
    if mode & 0o077 != 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!(
                "{} must not be accessible to group or others (mode {:o})",
                directory.display(),
                mode & 0o777
            ),
        ));
    }

    let listener = UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

/// Serve every connection to `listener`, each on its own task.
pub async fn serve<Claude: AgentAuth>(
    listener: UnixListener,
    agents: Arc<Agents<Claude>>,
) -> std::io::Result<()> {
    loop {
        let (stream, _) = listener.accept().await?;
        let agents = Arc::clone(&agents);
        tokio::spawn(async move {
            let (reader, writer) = stream.into_split();
            if let Err(error) = serve_connection(&agents, BufReader::new(reader), writer).await {
                tracing::debug!(%error, "connection ended");
            }
        });
    }
}
