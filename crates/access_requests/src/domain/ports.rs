//! Persistence and delivery boundaries. Transactions carry no SQL types inward.
use super::models::*;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::{share_permission::access_level::AccessLevel, sharing::SharingFacts};
use uuid::Uuid;

/// One serialized entity workflow. Dropping it without commit rolls back.
pub trait RequestTransaction: Send {
    /// Locked ownership/lifecycle facts.
    fn facts(&self) -> &SharingFacts;
    /// The requester's latest attempt.
    fn mine(
        &mut self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<AccessRequest>, RequestError>> + Send;
    /// An entity-scoped request identity.
    fn request(
        &mut self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<AccessRequest>, RequestError>> + Send;
    /// Pending page and total. The service bounds the page size.
    fn pending(
        &mut self,
        offset: u32,
        limit: u32,
    ) -> impl Future<Output = Result<(Vec<AccessRequest>, i64), RequestError>> + Send;
    /// Persist a transition under the transaction's entity lock.
    fn save(
        &mut self,
        request: &AccessRequest,
    ) -> impl Future<Output = Result<(), RequestError>> + Send;
    /// Direct non-owner user grants.
    fn direct_access(
        &mut self,
    ) -> impl Future<Output = Result<Vec<DirectAccess>, RequestError>> + Send;
    /// Apply a direct grant through the owning access domain's transaction helpers.
    fn grant(
        &mut self,
        user: &MacroUserIdStr<'_>,
        level: Option<AccessLevel>,
        upgrade_only: bool,
    ) -> impl Future<Output = Result<(), RequestError>> + Send;
    /// Queue notifications/cache invalidations and attach prior notifications to complete.
    fn enqueue(
        &mut self,
        event: RequestEvent,
    ) -> impl Future<Output = Result<(), RequestError>> + Send;
    /// Commit both the change and its delivery work.
    fn commit(self) -> impl Future<Output = Result<(), RequestError>> + Send;
}
/// Request persistence and durable delivery claims.
pub trait RequestRepository: Send + Sync + 'static {
    /// An owned, rollback-on-drop transaction.
    type Transaction: RequestTransaction;
    /// Serialize request writes for the entity and lock its current ownership.
    fn begin(
        &self,
        entity: ShareEntity,
    ) -> impl Future<Output = Result<Self::Transaction, RequestError>> + Send;
    /// Claim due work with a lease, safe for multiple service replicas.
    fn claim_events(&self) -> impl Future<Output = Result<Vec<RequestEvent>, RequestError>> + Send;
    /// Complete a successfully delivered event.
    fn delivered(&self, event_id: Uuid) -> impl Future<Output = Result<(), RequestError>> + Send;
}
/// Notifications and realtime invalidation, implemented at the composition boundary.
pub trait RequestEventSink: Send + Sync + 'static {
    /// Idempotently deliver an event. Failures remain durable for retry.
    fn deliver(
        &self,
        event: &RequestEvent,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}
/// Time source for cooldowns and deterministic workflow tests.
pub trait Clock: Send + Sync + 'static {
    /// Current UTC time.
    fn now(&self) -> chrono::DateTime<chrono::Utc>;
}
/// Wall clock used by production wiring.
pub struct SystemClock;
impl Clock for SystemClock {
    fn now(&self) -> chrono::DateTime<chrono::Utc> {
        chrono::Utc::now()
    }
}
