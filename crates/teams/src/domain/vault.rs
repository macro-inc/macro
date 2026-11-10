//! Vault cleanup required before deleting a team's identity and metadata.
use std::{fmt::Debug, future::Future, pin::Pin};
use uuid::Uuid;

/// Failure to complete a vault lifecycle operation, without provider details.
#[derive(Debug, Clone, Copy, thiserror::Error)]
pub enum VaultLifecycleError {
    /// The provider started erasure but has not acknowledged completion yet.
    #[error("vault cleanup pending")]
    Busy,

    /// Vault cleanup was not completed; the team must remain retryable.
    #[error("vault cleanup unavailable")]
    Unavailable,
}

/// Completion of namespace erasure, implemented by the vault's owning service.
pub type VaultCleanupFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), VaultLifecycleError>> + Send + 'a>>;

/// Team deletion cannot proceed until the vault's owning service acknowledges erasure.
pub trait VaultCleanup: Debug + Send + Sync {
    /// Erase the namespace and its metadata, or fail without claiming completion.
    fn purge(&self, team: Uuid) -> VaultCleanupFuture<'_>;
}

/// Refuse deletion when the composition root has not supplied vault cleanup.
#[derive(Debug)]
pub struct UnwiredVaultCleanup;
impl VaultCleanup for UnwiredVaultCleanup {
    fn purge(&self, _: Uuid) -> VaultCleanupFuture<'_> {
        Box::pin(async { Err(VaultLifecycleError::Unavailable) })
    }
}

/// Why a membership is being revoked; account deletion is administrative.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberRemovalMode {
    /// A person may leave only after disposing of their live vault items.
    Voluntary,
    /// Removal must revoke access without depending on the provider's availability.
    Administrative,
}
