//! Vault setup adapters.
use crate::domain::{
    models::TeamId,
    ports::{Provisioned, SetupError, VaultSetup},
};
use async_trait::async_trait;

/// No provisioner: a missing namespace stays `NotProvisioned`, as before
/// automatic setup existed, and no setup state is recorded.
pub struct NoVaultSetup;
#[async_trait]
impl VaultSetup for NoVaultSetup {
    fn configured(&self) -> bool {
        false
    }
    async fn provision(
        &self,
        _team: TeamId,
        _deadline: std::time::Duration,
    ) -> Result<Provisioned, SetupError> {
        Err(SetupError::Unavailable)
    }
    async fn namespace_exists(&self, _team: TeamId) -> Result<bool, SetupError> {
        Err(SetupError::Unavailable)
    }
}
