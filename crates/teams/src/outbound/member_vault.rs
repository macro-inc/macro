//! Transaction bridge to the vault's owning database adapter.
use crate::domain::{model::RemoveUserFromTeamError, vault::MemberRemovalMode};
use sqlx::PgConnection;
use std::{future::Future, pin::Pin};
use uuid::Uuid;

/// Metadata fencing in the same transaction as membership revocation.
pub type MemberVaultFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), RemoveUserFromTeamError>> + Send + 'a>>;

/// The composition root supplies the vault adapter; teams never writes vault tables.
pub trait MemberVault: Send + Sync {
    /// Publish private erasure after all required saga steps succeed.
    fn finish<'a>(
        &'a self,
        connection: &'a mut PgConnection,
        team: Uuid,
        user: &'a str,
    ) -> MemberVaultFuture<'a>;
    /// Unfence in the same transaction that restores membership.
    fn rollback<'a>(
        &'a self,
        connection: &'a mut PgConnection,
        team: Uuid,
        user: &'a str,
    ) -> MemberVaultFuture<'a>;
    /// Validate a voluntary departure or fence an administrative removal.
    fn prepare<'a>(
        &'a self,
        connection: &'a mut PgConnection,
        team: Uuid,
        user: &'a str,
        owner: &'a str,
        mode: MemberRemovalMode,
    ) -> MemberVaultFuture<'a>;
}

/// An unwired mutation must not silently orphan vault values.
pub struct UnwiredMemberVault;
impl MemberVault for UnwiredMemberVault {
    fn finish<'a>(&'a self, _: &'a mut PgConnection, _: Uuid, _: &'a str) -> MemberVaultFuture<'a> {
        Box::pin(async { Err(RemoveUserFromTeamError::VaultUnavailable) })
    }
    fn rollback<'a>(
        &'a self,
        _: &'a mut PgConnection,
        _: Uuid,
        _: &'a str,
    ) -> MemberVaultFuture<'a> {
        Box::pin(async { Err(RemoveUserFromTeamError::VaultUnavailable) })
    }
    fn prepare<'a>(
        &'a self,
        _: &'a mut PgConnection,
        _: Uuid,
        _: &'a str,
        _: &'a str,
        _: MemberRemovalMode,
    ) -> MemberVaultFuture<'a> {
        Box::pin(async { Err(RemoveUserFromTeamError::VaultUnavailable) })
    }
}
