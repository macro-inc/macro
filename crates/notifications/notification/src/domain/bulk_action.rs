//! Bulk actions on one user's notifications: marking many done as one
//! durable, resumable, undoable unit.
//!
//! An action is a stored record that a worker applies in chunks. Each chunk
//! commits its state changes, a ledger row per changed notification (the
//! state to restore) and the action's cursor in one transaction, so a crash
//! or deploy resumes from the cursor and nothing is applied twice. A lease
//! names the one worker allowed to commit; a worker that stops renewing it
//! is replaced. Undo takes the lease from a running action and walks the
//! ledger back, reopening only notifications the action was the last to
//! change.
//!
//! The caller decides which notifications each chunk covers and owns the
//! action's `scope` and `cursor`, which this module stores without reading.

use std::future::Future;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use uuid::Uuid;

/// Where a bulk action is in its life.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::EnumString, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum BulkActionStatus {
    /// Chunks are still being applied.
    Applying,
    /// Every chunk is applied.
    Done,
    /// An undo is walking the ledger back.
    Undoing,
    /// The undo finished.
    Undone,
    /// The action stalled too many times in a row and was given up; what it
    /// applied stays in the ledger and can still be undone.
    Failed,
}

impl BulkActionStatus {
    /// Whether a worker still has chunks to run.
    pub fn is_running(self) -> bool {
        matches!(self, Self::Applying | Self::Undoing)
    }
}

/// A stored bulk action.
#[derive(Debug, Clone, PartialEq)]
pub struct BulkAction {
    /// The caller-generated id.
    pub id: Uuid,
    /// Whose notifications it changes.
    pub user_id: MacroUserIdStr<'static>,
    /// What it covers, frozen at creation; the caller's own encoding.
    pub scope: serde_json::Value,
    /// Only notifications created at or before this time are changed.
    pub as_of: DateTime<Utc>,
    /// Where it is in its life.
    pub status: BulkActionStatus,
    /// Where the next chunk starts; the caller's own encoding.
    pub cursor: Option<serde_json::Value>,
    /// Caller-counted units applied so far.
    pub units: u32,
    /// Notifications marked done so far.
    pub applied: u32,
    /// Notifications an undo has reopened so far.
    pub restored: u32,
    /// Bumps on every change, so readers can drop stale updates.
    pub revision: i64,
    /// When it was created.
    pub created_at: DateTime<Utc>,
}

/// The right to commit chunks of one action. A chunk under a token the
/// action no longer holds commits nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BulkActionLease {
    /// The action.
    pub action_id: Uuid,
    /// Whose notifications it changes.
    pub user_id: MacroUserIdStr<'static>,
    /// The token the action must still hold.
    pub token: Uuid,
}

/// A request to create an action.
#[derive(Debug, Clone)]
pub struct NewBulkAction {
    /// The caller-generated id; creating the same id again changes nothing.
    pub id: Uuid,
    /// Whose notifications it changes.
    pub user_id: MacroUserIdStr<'static>,
    /// What it covers.
    pub scope: serde_json::Value,
}

/// What creating an action found.
#[derive(Debug, Clone)]
pub enum CreatedBulkAction {
    /// The action is new and the caller holds its lease.
    Created(BulkAction, BulkActionLease),
    /// The id was created before with the same scope; nothing changed.
    Existing(BulkAction),
    /// The id belongs to another user's action or another scope.
    Conflict,
}

/// One notification a chunk marks done.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BulkActionItem {
    /// The notification.
    pub notification_id: Uuid,
    /// The caller's grouping of it, returned when an undo reopens it.
    pub group_key: String,
}

/// One chunk to apply.
#[derive(Debug, Clone)]
pub struct ApplyChunk {
    /// The notifications to mark done. Those already done, deleted, not the
    /// user's or newer than the action's `as_of` are skipped.
    pub items: Vec<BulkActionItem>,
    /// Caller-counted units this chunk adds.
    pub units: u32,
    /// Where the next chunk starts.
    pub cursor: Option<serde_json::Value>,
    /// This is the action's last chunk.
    pub finished: bool,
}

/// What a committed apply chunk changed.
#[derive(Debug, Clone)]
pub struct AppliedChunk {
    /// The action after the chunk.
    pub action: BulkAction,
    /// The notifications whose state changed.
    pub changed: Vec<Uuid>,
}

/// What a committed undo chunk changed.
#[derive(Debug, Clone)]
pub struct RevertedChunk {
    /// The action after the chunk; `Undone` once the ledger is exhausted.
    pub action: BulkAction,
    /// The group keys of the notifications reopened, deduplicated.
    pub groups: Vec<String>,
}

/// The result of one chunk.
#[derive(Debug, Clone)]
pub enum ChunkOutcome<T> {
    /// The chunk committed.
    Committed(T),
    /// Nothing was committed: the lease was taken (by an undo, or by another
    /// worker after this one stalled) or the action is no longer in the
    /// state this chunk needs. The worker stops.
    Stopped,
}

/// What an undo request found.
#[derive(Debug, Clone)]
pub enum UndoRequested {
    /// The action is now undoing and the caller holds its lease. A worker
    /// that was applying it can commit nothing more.
    Started(BulkAction, BulkActionLease),
    /// An undo is already running or finished; nothing changed.
    Already(BulkAction),
}

/// Storage for bulk actions, their ledgers and the notification state they
/// change. Every method that changes notification state does so in one
/// transaction with the ledger and the action row.
pub trait BulkActionStore: Send + Sync + 'static {
    /// Create an action stamped with the database's current time, leased to
    /// the caller.
    fn create(
        &self,
        new: NewBulkAction,
    ) -> impl Future<Output = Result<CreatedBulkAction, Report>> + Send;

    /// Mark a chunk's notifications done, record each one's earlier state,
    /// advance the cursor and renew the lease, all or nothing.
    fn apply_chunk(
        &self,
        lease: &BulkActionLease,
        chunk: ApplyChunk,
    ) -> impl Future<Output = Result<ChunkOutcome<AppliedChunk>, Report>> + Send;

    /// Start undoing the user's action, taking its lease. `None` when the
    /// user has no such action.
    fn request_undo(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<UndoRequested>, Report>> + Send;

    /// Reopen up to `limit` ledger rows to their earlier state, skipping
    /// notifications the action was not the last to change, and renew the
    /// lease, all or nothing. The chunk that finds the ledger exhausted
    /// marks the action undone.
    fn revert_chunk(
        &self,
        lease: &BulkActionLease,
        limit: u16,
    ) -> impl Future<Output = Result<ChunkOutcome<RevertedChunk>, Report>> + Send;

    /// Take over up to `limit` running actions whose lease expired. One
    /// claimed too many times in a row without committing a chunk is marked
    /// failed instead and not returned.
    fn claim_stalled(
        &self,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<(BulkAction, BulkActionLease)>, Report>> + Send;

    /// Give up a lease early, so another worker can claim the action at
    /// once. Best effort: an expired lease is claimed anyway.
    fn release(&self, lease: &BulkActionLease) -> impl Future<Output = Result<(), Report>> + Send;

    /// The user's action `id`.
    fn get(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<BulkAction>, Report>> + Send;

    /// The user's actions still running, oldest first.
    fn running(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<BulkAction>, Report>> + Send;

    /// Delete up to `limit` actions that finished before `before`, with
    /// their ledgers. Returns how many were deleted.
    fn purge_finished(
        &self,
        before: DateTime<Utc>,
        limit: u16,
    ) -> impl Future<Output = Result<u64, Report>> + Send;
}
