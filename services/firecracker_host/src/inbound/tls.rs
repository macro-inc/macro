//! The listener's TLS: our self-signed certificate, and only the pinned
//! control-plane client certificates (`pinned_tls`).

use std::path::{Path, PathBuf};

use rustls::ServerConfig;

use crate::config::TlsConfig;

/// The TLS material could not be used.
#[derive(Debug, thiserror::Error)]
pub enum TlsError {
    /// A PEM file could not be read.
    #[error("{path}: {source}")]
    Read {
        /// The file.
        path: PathBuf,
        /// Why.
        source: std::io::Error,
    },
    /// The certificates or key are unusable.
    #[error(transparent)]
    Credentials(#[from] pinned_tls::InvalidCredentials),
}

fn read(path: &Path) -> Result<String, TlsError> {
    std::fs::read_to_string(path).map_err(|source| TlsError::Read {
        path: path.to_owned(),
        source,
    })
}

/// The server configuration for `tls`.
pub fn server_config(tls: &TlsConfig) -> Result<ServerConfig, TlsError> {
    let clients = tls
        .client_certificates
        .iter()
        .map(|path| read(path))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(pinned_tls::server_config(
        &read(&tls.certificate)?,
        &read(&tls.key)?,
        &clients,
    )?)
}
