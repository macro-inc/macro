use super::models::*;
use async_trait::async_trait;
use call::domain::imports::ImportedCall;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, rootcause::Report>;

/// Storage owns atomic registration, durable delivery deduplication, and leases.
#[async_trait]
pub trait SyncRepository: Send + Sync {
    async fn by_user(&self, user: &MacroUserIdStr<'static>) -> Result<Option<Connection>>;
    async fn by_id(&self, id: Uuid) -> Result<Option<Connection>>;
    /// Every user's sync state, without signing secrets.
    async fn states(&self) -> Result<Vec<SyncState>>;
    async fn reserve(&self, connection: &Connection) -> Result<bool>;
    async fn activate(&self, id: Uuid, webhook: Webhook, scope: Scope) -> Result<bool>;
    async fn stop(&self, id: Uuid) -> Result<()>;
    async fn failed_setup(&self, id: Uuid) -> Result<()>;
    async fn enqueue(&self, id: Uuid, event: Event) -> Result<()>;
    async fn claim(&self) -> Result<Option<Job>>;
    async fn finish(&self, job: &Job, success: bool) -> Result<()>;
    /// Lease the next page of an enabled connection's unfinished backfill.
    async fn claim_backfill(&self) -> Result<Option<BackfillJob>>;
    /// Record that a note of the job's page is imported, so a retry of the
    /// page skips it. A stale lease changes nothing.
    async fn mark_backfilled(&self, job: &BackfillJob, note: &NoteId) -> Result<()>;
    /// Save where the backfill continues. A stale lease changes nothing.
    async fn finish_backfill(&self, job: &BackfillJob, step: BackfillStep) -> Result<()>;
}

/// Provider I/O goes through the user's Granola connection.
#[async_trait]
pub trait Granola: Send + Sync {
    async fn register(
        &self,
        connection: &Connection,
        url: &str,
        scope: Scope,
    ) -> Result<Registration>;
    async fn unregister(&self, connection: &Connection) -> Result<()>;
    async fn meeting(&self, connection: &Connection, note: &NoteId)
    -> Result<Option<ImportedCall>>;
    /// One page of the notes the connection's key can see, newest first.
    async fn notes(&self, connection: &Connection, cursor: Option<&str>) -> Result<NotesPage>;
}

/// Whose Granola sync may run: a user whose Granola connection gives API
/// access. Rechecked before ingesting, including after fetch.
#[async_trait]
pub trait Accounts: Send + Sync {
    /// Whether the user's Granola connection gives API access.
    async fn connected(&self, user: &MacroUserIdStr<'static>) -> Result<bool>;
    /// Every user whose Granola connection gives API access.
    async fn holders(&self) -> Result<Vec<MacroUserIdStr<'static>>>;
}

/// Whether history backfill may run for a user. Off unless the user is
/// opted in, so deploying backfill changes nothing by itself.
#[async_trait]
pub trait BackfillRollout: Send + Sync {
    async fn enabled(&self, user: &MacroUserIdStr<'static>) -> Result<bool>;
}

pub trait DeliveryVerifier: Send + Sync {
    fn verify(&self, secret: &SigningSecret, delivery: &Delivery<'_>) -> bool;
}
