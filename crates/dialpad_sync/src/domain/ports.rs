use super::models::*;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Result of a port call.
pub type Result<T> = std::result::Result<T, rootcause::Report>;

/// Storage owns enrollment, setup leases, durable delivery deduplication and
/// delivery leases.
#[async_trait]
pub trait SyncRepository: Send + Sync {
    /// The user's sync, if they ever connected.
    async fn by_user(&self, user: &MacroUserIdStr<'static>) -> Result<Option<Connection>>;
    /// A sync by id.
    async fn by_id(&self, id: Uuid) -> Result<Option<Connection>>;
    /// Start or resume a user's enrollment. A running sync keeps running and
    /// only clears its issue; anything else restarts as pending with
    /// `backfill_since`.
    async fn enroll(
        &self,
        user: &MacroUserIdStr<'static>,
        backfill_since: Option<DateTime<Utc>>,
    ) -> Result<()>;
    /// Syncs waiting for setup: pending, or failed setup due for a retry, and
    /// not leased by another instance.
    async fn awaiting_setup(&self, limit: i64) -> Result<Vec<Connection>>;
    /// Lease setup and store the new signing secret. None when another
    /// instance holds the lease or the observed enrollment is no longer waiting.
    async fn begin_setup(
        &self,
        connection: &Connection,
        secret: &SigningSecret,
    ) -> Result<Option<SetupLease>>;
    /// Record the registration and start delivering. False when the sync was
    /// removed or restarted meanwhile, or `lease` expired and another
    /// instance replaced the secret; the caller must retire `registration`.
    async fn activate(
        &self,
        id: Uuid,
        lease: SetupLease,
        dialpad_user: DialpadId,
        registration: Registration,
    ) -> Result<bool>;
    /// Fail only the setup that still holds `lease`; drop its pending
    /// deliveries. The `max_attempts`th failure in a row stops retrying as
    /// [`SyncIssue::SetupAbandoned`].
    async fn failed_setup(&self, id: Uuid, lease: SetupLease, max_attempts: i32) -> Result<()>;
    /// Stop the observed connection state and drop pending deliveries only if
    /// its enrollment, setup and enabled state still match.
    async fn stop(&self, connection: &Connection, issue: SyncIssue) -> Result<()>;
    /// Record an issue only on the observed running enrollment.
    async fn flag(&self, connection: &Connection, issue: SyncIssue) -> Result<()>;
    /// Stop as [`SyncIssue::Disconnected`], keeping the row and its import
    /// namespace. `unregistered` forgets the Dialpad resources once they
    /// were removed; otherwise the next setup removes them.
    async fn disconnect(&self, connection: &Connection, unregistered: bool) -> Result<()>;
    /// Running syncs with past calls left to import and due for a page,
    /// least recently tried first.
    async fn backfilling(&self, limit: i64) -> Result<Vec<Connection>>;
    /// Queue a page and advance only if enrollment and backfill progress still
    /// match `connection`; `None` finishes it. Clears any failures.
    async fn advance_backfill(
        &self,
        connection: &Connection,
        calls: Vec<CallEvent>,
        cursor: Option<String>,
    ) -> Result<()>;
    /// Count a failed page and back off, only if enrollment and backfill
    /// progress still match `connection`.
    async fn backfill_failed(&self, connection: &Connection) -> Result<()>;
    /// Move a backfill behind the others without counting a failure.
    async fn defer_backfill(&self, connection: &Connection) -> Result<()>;
    /// Persist a verified delivery once; repeats are ignored.
    async fn enqueue(&self, id: Uuid, event: CallEvent, traceparent: Option<String>) -> Result<()>;
    /// Lease the pending deliveries of the next due call, if any. Deliveries
    /// leased elsewhere are left to that claim.
    async fn claim(&self) -> Result<Option<Job>>;
    /// Whether the sync is on and `job` still holds its deliveries; stopping
    /// or disconnecting drops them.
    async fn holds(&self, job: &Job) -> Result<bool>;
    /// Every stored event for one call, oldest first.
    async fn events(&self, id: Uuid, call: DialpadId) -> Result<Vec<CallEvent>>;
    /// Complete the job's leased deliveries, schedule their retry with
    /// backoff, or park them until a new event for the call arrives.
    async fn finish(&self, job: &Job, outcome: JobOutcome) -> Result<()>;
}

/// The user's Dialpad grant, held by Macro Connect.
#[async_trait]
pub trait Grants: Send + Sync {
    /// The user's current Dialpad grant.
    async fn grant(&self, user: &MacroUserIdStr<'static>) -> Result<Grant>;
    /// A Macro Connect URL where the user approves Dialpad, returning to
    /// `redirect_url`.
    async fn connect_url(
        &self,
        user: &MacroUserIdStr<'static>,
        redirect_url: &str,
    ) -> Result<String>;
    /// Remove the Dialpad connection from Macro Connect. Does not revoke the
    /// grant at Dialpad.
    async fn disconnect(&self, user: &MacroUserIdStr<'static>) -> Result<()>;
}

/// Dialpad's REST API, called with the user's token.
#[async_trait]
pub trait Dialpad: Send + Sync {
    /// The connected Dialpad user's id, from `GET /users/me`.
    async fn me(&self, token: &AccessToken) -> Result<DialpadId>;
    /// Register a webhook signed with `secret`; returns its id.
    async fn create_webhook(
        &self,
        token: &AccessToken,
        url: &str,
        secret: &SigningSecret,
    ) -> Result<DialpadId>;
    /// Subscribe `webhook` to `user`'s call states; returns the subscription id.
    async fn subscribe(
        &self,
        token: &AccessToken,
        webhook: DialpadId,
        user: DialpadId,
    ) -> Result<DialpadId>;
    /// Delete the subscription, then the webhook. Already gone, or no longer
    /// the token's to delete, is success.
    async fn unregister(&self, token: &AccessToken, registration: Registration) -> Result<()>;
    /// Delete a webhook. Already gone, or no longer the token's, is success.
    async fn delete_webhook(&self, token: &AccessToken, webhook: DialpadId) -> Result<()>;
    /// `None` when the call has no transcript or transcripts are off for the
    /// company. Anything else fails, so the call retries rather than
    /// replacing its stored transcript with none.
    async fn transcript(
        &self,
        token: &AccessToken,
        call: DialpadId,
    ) -> Result<Option<Vec<TranscriptLine>>>;
    /// `None` when the call has no recap.
    async fn recap(&self, token: &AccessToken, call: DialpadId) -> Result<Option<Recap>>;
    /// The user's concluded calls started at or after `since`, newest first.
    async fn calls(
        &self,
        token: &AccessToken,
        user: DialpadId,
        since: DateTime<Utc>,
        cursor: Option<&str>,
    ) -> Result<CallPage>;
}

/// Checks a delivery's signature before anything reads it.
pub trait DeliveryVerifier: Send + Sync {
    /// The claims a delivery carries, when `secret` signed it. The claims
    /// are not yet read as an event.
    fn verify(&self, secret: &SigningSecret, body: &[u8]) -> Option<serde_json::Value>;
}
