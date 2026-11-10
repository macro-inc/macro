//! Composition bridge: membership and vault metadata share one MacroDB transaction.
use passwords::{
    domain::{
        lifecycle::Departure,
        models::{Error, TeamId},
    },
    outbound::postgres::PgRepository,
};
use sqlx::PgConnection;
use teams::{
    domain::{model::RemoveUserFromTeamError, vault::MemberRemovalMode},
    outbound::member_vault::{MemberVault, MemberVaultFuture},
};
use uuid::Uuid;

/// Metadata-only revocation; provider erasure is handled by the durable vault worker.
pub struct PasswordMemberVault;
impl MemberVault for PasswordMemberVault {
    fn finish<'a>(
        &'a self,
        connection: &'a mut PgConnection,
        team: Uuid,
        user: &'a str,
    ) -> MemberVaultFuture<'a> {
        Box::pin(async move {
            PgRepository::finish_member_removal(connection, TeamId(team), user)
                .await
                .map_err(|_| RemoveUserFromTeamError::VaultUnavailable)
        })
    }
    fn rollback<'a>(
        &'a self,
        connection: &'a mut PgConnection,
        team: Uuid,
        user: &'a str,
    ) -> MemberVaultFuture<'a> {
        Box::pin(async move {
            PgRepository::rollback_member_removal(connection, TeamId(team), user)
                .await
                .map_err(|_| RemoveUserFromTeamError::VaultUnavailable)
        })
    }
    fn prepare<'a>(
        &'a self,
        connection: &'a mut PgConnection,
        team: Uuid,
        user: &'a str,
        owner: &'a str,
        mode: MemberRemovalMode,
    ) -> MemberVaultFuture<'a> {
        Box::pin(async move {
            let departure = match mode {
                MemberRemovalMode::Voluntary => Departure::Voluntary,
                MemberRemovalMode::Administrative => Departure::Administrative,
            };
            PgRepository::prepare_member_removal(connection, TeamId(team), user, owner, departure)
                .await
                .map_err(|error| match error {
                    Error::Busy => RemoveUserFromTeamError::VaultBusy,
                    Error::OwnedItems => RemoveUserFromTeamError::VaultItemsOwned,
                    _ => RemoveUserFromTeamError::VaultUnavailable,
                })
        })
    }
}

/// Invoke namespace erasure through the service that owns the vault provider.
pub struct PasswordVaultCleanup(
    pub std::sync::Arc<document_storage_service_client::DocumentStorageServiceClient>,
);
impl std::fmt::Debug for PasswordVaultCleanup {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PasswordVaultCleanup")
    }
}
impl teams::domain::vault::VaultCleanup for PasswordVaultCleanup {
    fn purge(&self, team: Uuid) -> teams::domain::vault::VaultCleanupFuture<'_> {
        Box::pin(async move {
            self.0
                .purge_team_vault(team)
                .await
                .map_err(|error| match error {
                    document_storage_service_client::delete::VaultLifecycleRequestError::Busy => {
                        teams::domain::vault::VaultLifecycleError::Busy
                    }
                    _ => teams::domain::vault::VaultLifecycleError::Unavailable,
                })
        })
    }
}

#[cfg(test)]
mod test;
