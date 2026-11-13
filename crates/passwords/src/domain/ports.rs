//! Capabilities required by the vault; all authorization decisions remain in the service.
use super::models::*;
use async_trait::async_trait;

#[async_trait]
/// Metadata storage and cross-replica serialization. Object-safe for composition.
pub trait Repository: Send + Sync {
    /// Current authoritative account classification; missing accounts are not humans.
    async fn is_human(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<bool, Error>;
    /// Current owner/admin role in this team; this fact never implies human admission.
    async fn is_team_admin(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
        team: TeamId,
    ) -> Result<bool, Error>;
    /// Any retained item, intent, enrollment or namespace closure identity, including tombstones.
    async fn has_team_data(&self, team: TeamId) -> Result<bool, Error>;

    /// Durably close a team vault before provider deletion; future human admissions fail.
    async fn close_team(&self, team: TeamId) -> Result<(), Error>;
    /// Remove team vault metadata only after acknowledged namespace erasure.
    async fn purge_team_metadata(&self, team: TeamId) -> Result<(), Error>;
    /// Discover bounded retained explicit item-deletion retries, ahead of repeats.
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
    /// Publish an admitted actor's metadata intent before a value write, serialized with membership revocation.
    async fn stage(
        &self,
        operation: uuid::Uuid,
        record: &Record,
        publisher: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<(), Error>;
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
    /// Metadata visible to the actor whose name equals one of `names`, ignoring
    /// case and surrounding spaces; at most 500 records.
    async fn matching(
        &self,
        actor: &Actor,
        team: TeamId,
        names: &[String],
    ) -> Result<Vec<Record>, Error>;
    /// Load an item and its authorization facts without resolving secret values.
    async fn get(&self, team: TeamId, item: ItemId) -> Result<Record, Error>;
    /// Commit metadata with its observed version guard. A live record's folder is
    /// share-locked in the same transaction; a deleted one fails with `FolderMissing`.
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
    /// Create a new folder (insert only, never an upsert) under its parent.
    /// Rejects a missing parent, the team folder cap, and trees deeper than the limit.
    async fn save_folder(&self, folder: &Folder) -> Result<(), Error>;
    /// Insert a folder if absent; an existing team folder is never moved or renamed.
    async fn ensure_folder(
        &self,
        team: TeamId,
        id: uuid::Uuid,
        name: &str,
        parent_id: Option<uuid::Uuid>,
    ) -> Result<Folder, Error>;
    /// Record only source format and counts for one batch attempt, even when no item succeeded.
    async fn audit_import(
        &self,
        team: TeamId,
        import_id: uuid::Uuid,
        actor: &Actor,
        format: ImportFormat,
        counts: ImportCounts,
    ) -> Result<(), Error>;
    /// Rename an existing folder (update only); `NotFound` when it no longer exists.
    async fn rename_folder(
        &self,
        team: TeamId,
        id: uuid::Uuid,
        name: &str,
    ) -> Result<Folder, Error>;
    /// Move a folder under another folder of the team, or to the top level.
    /// Rejects cycles and trees deeper than the limit, checked in the same transaction.
    async fn move_folder(
        &self,
        team: TeamId,
        id: uuid::Uuid,
        parent: Option<uuid::Uuid>,
    ) -> Result<Folder, Error>;
    /// Remove the folder and its subfolders, unfiling their items without touching values.
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

/// A scope-bound team-vault lock; releasing the guard releases its lease.
#[async_trait]
pub trait ItemLock: Send + Sync {
    /// Await release before the next batch step, instead of relying on asynchronous Drop cleanup.
    async fn release(self: Box<Self>) -> Result<(), Error>;
}

/// Human rollout and provider readiness are independent of maintenance.
#[async_trait]
pub trait Availability: Send + Sync {
    /// Fail closed unless this actor's rollout and provider configuration permit access.
    async fn require_enabled(&self, actor: &Actor) -> Result<(), Error>;
    /// Require provider configuration before lifecycle side effects, without evaluating flags.
    fn require_provider(&self) -> Result<(), Error>;
}
