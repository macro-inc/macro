//! Implementations of preview transport capabilities.
/// Open forwarded channels on a registered SSH connection.
pub mod ssh_tunnel;

/// Postgres preview ownership and credentials.
pub mod postgres;

/// Direct replica transport.
pub mod peer;
