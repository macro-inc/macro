//! Capabilities required by the vault; all authorization decisions remain in the service.
use super::models::*;
use async_trait::async_trait;

#[async_trait]
/// Metadata storage and cross-replica serialization. Object-safe for composition.
pub trait Repository: Send + Sync {
    /// Bounded account-owned erasures that have not yet been acknowledged.
    async fn retired_user_items(
        &self,
        team: TeamId,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Vec<ItemId>, Error>;

    /// Permanently close a deleting account's admissions before enumerating erasures.
    async fn close_user(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<(), Error>;
    /// Team vaults containing the user's records or durable pending write intents.
    async fn user_vault_teams(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Vec<TeamId>, Error>;
    /// Current team owner used by the domain's shared-item transfer policy.
    async fn team_owner(
        &self,
        team: TeamId,
    ) -> Result<macro_user_id::user_id::MacroUserIdStr<'static>, Error>;
    /// Apply administrative metadata fencing while the caller holds the team lease.
    async fn depart_user(
        &self,
        team: TeamId,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
        owner: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<(), Error>;
    /// Strip user metadata from acknowledged private erasures, retaining only lifecycle fences.
    async fn scrub_user_metadata(
        &self,
        team: TeamId,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<(), Error>;

    /// Durably close a team vault before provider deletion; future human admissions fail.
    async fn close_team(&self, team: TeamId) -> Result<(), Error>;
    /// Remove team vault metadata only after acknowledged namespace erasure.
    async fn purge_team_metadata(&self, team: TeamId) -> Result<(), Error>;
    /// Discover bounded durable item erasures, with first erasures ahead of repeats.
    async fn item_cleanup_due(&self) -> Result<Vec<(TeamId, ItemId)>, Error>;

    /// Persist a unique pending enrollment before any provider mutation.
    async fn stage_totp(&self, team: TeamId, item: ItemId, key: TotpKeyId) -> Result<(), Error>;
    /// Select a successful enrollment only while its authorized metadata revision remains current.
    async fn activate_totp(
        &self,
        team: TeamId,
        item: ItemId,
        key: TotpKeyId,
        expected_revision: i64,
    ) -> Result<(), Error>;
    /// Retire enrollments at the authorized revision; omission is restricted to deleting tombstones.
    async fn retire_totp(
        &self,
        team: TeamId,
        item: ItemId,
        expected_revision: Option<i64>,
    ) -> Result<(), Error>;
    /// List every known enrollment so deletion can immediately attempt erasure.
    async fn totp_keys(&self, team: TeamId, item: ItemId) -> Result<Vec<TotpKeyId>, Error>;
    /// Return a bounded batch of enrollment cleanup facts whose grace period elapsed.
    async fn totp_cleanup_due(&self) -> Result<Vec<TotpCleanup>, Error>;
    /// Begin quarantine under the vault lease; return true only after its grace period elapsed.
    async fn totp_cleanup_ready(&self, cleanup: TotpCleanup) -> Result<bool, Error>;
    /// Retain the retired generation and schedule periodic erasure after acknowledged cleanup.
    async fn finish_totp_cleanup(&self, cleanup: TotpCleanup) -> Result<(), Error>;

    /// Hold the team's vault lock until the returned guard is dropped; contention returns typed Busy.
    async fn lock(&self, team: TeamId, item: ItemId) -> Result<Box<dyn ItemLock>, Error>;
    /// Persist metadata-only intent before an external value write.
    async fn stage(&self, operation: uuid::Uuid, record: &Record) -> Result<(), Error>;
    /// Load the metadata intent belonging to this team, item, and operation.
    async fn staged(
        &self,
        team: TeamId,
        item: ItemId,
        operation: uuid::Uuid,
    ) -> Result<Record, Error>;
    /// Retire a reconciled metadata intent.
    async fn finish(&self, operation: uuid::Uuid) -> Result<(), Error>;
    /// Return current memberships from the authoritative team store.
    async fn teams(&self, actor: &Actor) -> Result<Vec<TeamId>, Error>;
    /// Search metadata visible to the actor within the team.
    async fn list(&self, actor: &Actor, team: TeamId, search: &str) -> Result<Vec<Record>, Error>;
    /// Load an item and its authorization facts without resolving secret values.
    async fn get(&self, team: TeamId, item: ItemId) -> Result<Record, Error>;
    /// Commit metadata with its observed version guard.
    async fn save(&self, record: &Record, expected_version: Option<i32>) -> Result<(), Error>;
    /// Retain a deletion fence while retiring the visible metadata record.
    async fn delete(&self, team: TeamId, item: ItemId) -> Result<(), Error>;
    /// Record a fixed activity event without credential material.
    async fn audit(
        &self,
        team: TeamId,
        item: ItemId,
        actor: &Actor,
        action: Action,
        event_id: uuid::Uuid,
    ) -> Result<(), Error>;
    /// Read a bounded page of recorded item activity.
    async fn activity(&self, team: TeamId, item: ItemId) -> Result<Vec<Activity>, Error>;
    /// List the team folders.
    async fn folders(&self, team: TeamId) -> Result<Vec<Folder>, Error>;
    /// Create or rename a folder belonging to the team.
    async fn save_folder(&self, folder: &Folder) -> Result<(), Error>;
    /// Remove the folder and its metadata-only item assignments.
    async fn delete_folder(&self, team: TeamId, id: uuid::Uuid) -> Result<(), Error>;
}

#[async_trait]
/// Namespace-isolated private value storage. Object-safe for replaceable providers.
pub trait SecretProvider: Send + Sync {
    /// Delete the namespace through a separate, team-bound parent identity.
    async fn purge_namespace(&self, team: TeamId) -> Result<(), Error>;
    /// Read only provider version metadata, without loading a private payload.
    async fn current_version(&self, team: TeamId, item: ItemId) -> Result<Option<i32>, Error>;
    /// Read the accepted operation marker during an explicitly authorized recovery.
    async fn status(&self, team: TeamId, item: ItemId) -> Result<Option<(i32, uuid::Uuid)>, Error>;
    /// Write one protected version using the provider CAS guard.
    async fn write(
        &self,
        team: TeamId,
        item: ItemId,
        expected_version: i32,
        operation: uuid::Uuid,
        values: &SecretValues,
    ) -> Result<i32, Error>;
    /// Resolve one explicit private value version.
    async fn read(&self, team: TeamId, item: ItemId, version: i32) -> Result<SecretValues, Error>;
    /// Resolve only the account identifier, without exposing other fields to the caller.
    async fn username(
        &self,
        team: TeamId,
        item: ItemId,
        version: i32,
    ) -> Result<SecretString, Error>;
    /// Retain a deletion fence while retiring the visible metadata record.
    async fn delete(&self, team: TeamId, item: ItemId) -> Result<(), Error>;
    /// List version timestamps without private values.
    async fn history(&self, team: TeamId, item: ItemId) -> Result<Vec<Version>, Error>;
    /// Enroll or replace a private verification-code seed.
    async fn set_totp(
        &self,
        team: TeamId,
        key_id: TotpKeyId,
        key: &SecretString,
    ) -> Result<(), Error>;
    /// Remove a verification-code seed idempotently.
    async fn delete_totp(&self, team: TeamId, key_id: TotpKeyId) -> Result<(), Error>;
    /// Resolve the current confidential verification code.
    async fn totp(&self, team: TeamId, key_id: TotpKeyId) -> Result<TotpCode, Error>;
}

#[async_trait]
/// Verifies recent signed human authentication. Object-safe for composition.
pub trait Reauthentication: Send + Sync {
    /// Require the original signed human authentication within the allowed window.
    async fn verify(&self, actor: &Actor) -> Result<(), Error>;
}

/// A scope-bound team-vault lock; releasing the guard releases its lease.
pub trait ItemLock: Send + Sync {}

/// Per-user rollout is checked in the domain at every entry point.
#[async_trait]
pub trait Availability: Send + Sync {
    /// Fail closed unless rollout and backing-provider configuration permit access.
    async fn require_enabled(&self, actor: &Actor) -> Result<(), Error>;
}
