//! Stable, sanitized account-health reasons, distinct from send failures.
use super::{connection::ConnectionStatus, models::MessagingError};

/// Recovery action for a failed connection check. Raw provider bodies are never stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionFailure {
    /// The stored Meta authorization has expired or been revoked.
    Authorization,
    /// The app/account lacks Meta API access, possibly pending account confirmation.
    MetaAccess,
    /// The authorizing Macro administrator no longer has the required team role.
    Administrator,
    /// Retryable transport or infrastructure problem.
    Temporary,
    /// Server configuration must be corrected before reconnecting.
    Configuration,
    /// Definitive provider rejection without a more specific supported recovery code.
    Provider,
}
impl ConnectionFailure {
    /// Map domain errors without exposing low-level causes or guessing that all failures need OAuth.
    pub fn from_error(error: &MessagingError) -> Self {
        match error {
            MessagingError::Disconnected => Self::Authorization,
            MessagingError::ProviderAccessRequired => Self::MetaAccess,
            MessagingError::Forbidden => Self::Administrator,
            MessagingError::Unavailable => Self::Temporary,
            MessagingError::Invalid(_) => Self::Configuration,
            _ => Self::Provider,
        }
    }
    /// Stable persisted code consumed by account settings and import eligibility.
    pub const fn code(self) -> &'static str {
        match self {
            Self::Authorization => "meta_authorization_expired_or_revoked",
            Self::MetaAccess => "meta_access_required",
            Self::Administrator => "connecting_admin_access_lost",
            Self::Temporary => "connection_temporarily_unavailable",
            Self::Configuration => "connection_configuration_required",
            Self::Provider => "provider_connection_rejected",
        }
    }
    /// Lost authority requires a new grant; transient/provider failures remain retryable checks.
    pub const fn status(self) -> ConnectionStatus {
        match self {
            Self::Authorization | Self::Administrator => ConnectionStatus::Revoked,
            _ => ConnectionStatus::Error,
        }
    }
}
