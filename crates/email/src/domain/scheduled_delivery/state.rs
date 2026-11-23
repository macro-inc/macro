//! Durable claim decisions over storage facts; SQL retains relational guards.
use models_email::service::message::ScheduledMessage;
use uuid::Uuid;

/// A unique ownership receipt; replacing it fences every older invocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeliveryClaimToken(pub Uuid);

/// Facts acquired atomically before any provider I/O.
pub struct DeliveryClaim {
    /// Scheduled message identity and attribution.
    pub schedule: ScheduledMessage,
    /// Ownership required by every subsequent transition.
    pub token: DeliveryClaimToken,
    /// Stable RFC 5322 Message-ID; absent for uncertain pre-upgrade submissions.
    pub message_id_header: Option<String>,
    /// Whether a provider submission may already have happened.
    pub requires_reconciliation: bool,
    /// Immutable approved content, when admitted through GraphQL.
    /// Attachment identities retained for every scheduled send.
    pub approved_attachments: serde_json::Value,
    pub approved_snapshot: Option<serde_json::Value>,
    /// Prepared envelope/body frozen by GraphQL admission; absent for older writes.
    pub prepared_content: Option<serde_json::Value>,
}

/// Schedule facts selected and locked by storage.
pub struct ScheduleFacts {
    /// Scheduled send time.
    pub send_time: chrono::DateTime<chrono::Utc>,
    /// Whether an invocation already owns processing.
    pub processing: bool,
    /// Persisted actor attribution.
    pub actor_id: Option<String>,
    /// Persisted agent attribution.
    pub agent_correlation_id: Option<Uuid>,
    /// Existing ownership token, if this is a managed claim.
    pub delivery_claim_id: Option<Uuid>,
    /// Whether provider submission began.
    pub delivery_started_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Stable provider Message-ID.
    pub delivery_message_id: Option<String>,
    /// Stored recovery state.
    pub delivery_status: String,
    /// Approved attachment identities.
    pub approved_attachments: serde_json::Value,
    /// Atomic storage availability result.
    pub available: bool,
}
/// Admission content retained by the active attempt.
pub struct AttemptFacts {
    /// Approved request snapshot.
    pub request: Option<serde_json::Value>,
    /// Frozen prepared content.
    pub prepared_content: Option<serde_json::Value>,
}
/// A transaction holding message then schedule locks.
pub trait ClaimTransaction: Send + Sized {
    /// Lock the message and read its sent state.
    fn message_sent(
        &mut self,
        link: Uuid,
        message: Uuid,
    ) -> impl Future<Output = anyhow::Result<Option<bool>>> + Send;
    /// Lock and read the schedule including storage's availability result.
    fn schedule(
        &mut self,
        link: Uuid,
        message: Uuid,
        lease: i32,
    ) -> impl Future<Output = anyhow::Result<Option<ScheduleFacts>>> + Send;
    /// Store the selected ownership and identity.
    fn acquire(
        &mut self,
        link: Uuid,
        message: Uuid,
        token: Uuid,
        lease: i32,
        header: Option<&str>,
        legacy: bool,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Read active admission content.
    fn attempt(
        &mut self,
        link: Uuid,
        message: Uuid,
    ) -> impl Future<Output = anyhow::Result<Option<AttemptFacts>>> + Send;
    /// Commit ownership before any provider I/O.
    fn commit(self) -> impl Future<Output = anyhow::Result<()>> + Send;
}
/// Transaction acquisition, without choosing claim policy.
pub trait ClaimStore: Sync {
    /// Owned lock scope, dropped on every early return.
    type Transaction: ClaimTransaction;
    /// Begin the original transaction.
    fn begin(&self) -> impl Future<Output = anyhow::Result<Self::Transaction>> + Send;
}
/// Statement outcomes for an already acquired ownership receipt.
pub trait DeliveryTransitions: Sync {
    /// Record submission only if the atomic guard still matches.
    fn begin_submission(
        &self,
        claim: &DeliveryClaim,
        lease: i32,
    ) -> impl Future<Output = anyhow::Result<u64>> + Send;
    /// Release preparation without changing the storage predicates.
    fn release_preparation(
        &self,
        claim: &DeliveryClaim,
        retry: i32,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Persist the selected paused state.
    fn pause_delivery(
        &self,
        claim: &DeliveryClaim,
        unconfirmed: bool,
        retry: i32,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}
/// Completion statements on the caller's existing transaction.
pub trait CompletionQueries: Send {
    /// Lock and read the message.
    fn message_sent(
        &mut self,
        link: Uuid,
        message: Uuid,
    ) -> impl Future<Output = anyhow::Result<Option<bool>>> + Send;
    /// Apply the atomic ownership guard and return its affected count.
    fn complete(
        &mut self,
        claim: &DeliveryClaim,
    ) -> impl Future<Output = anyhow::Result<u64>> + Send;
}

/// Acquire a fresh or expired claim under the common message -> schedule lock order.
#[tracing::instrument(
    target = "email_db_client::messages::scheduled::delivery",
    skip(pool),
    err
)]
pub async fn claim_delivery(
    pool: &impl ClaimStore,
    link_id: Uuid,
    message_id: Uuid,
    lease_seconds: i32,
) -> anyhow::Result<Option<DeliveryClaim>> {
    let mut tx = pool.begin().await?;
    let message = tx.message_sent(link_id, message_id).await?;
    if message.is_none_or(|is_sent| is_sent) {
        return Ok(None);
    }
    let schedule = tx.schedule(link_id, message_id, lease_seconds).await?;
    let Some(schedule) = schedule.filter(|row| row.available) else {
        return Ok(None);
    };
    // Old claims have no submission boundary. Never infer they are safe to resend.
    let legacy_claim = schedule.processing && schedule.delivery_claim_id.is_none();
    let reconcile = legacy_claim
        || schedule.delivery_started_at.is_some()
        || schedule.delivery_status == "unconfirmed";
    let header = schedule.delivery_message_id.or_else(|| {
        (!reconcile).then(|| {
            format!(
                "{}.{}@send.macro.com",
                message_id,
                macro_uuid::generate_uuid_v7()
            )
        })
    });
    let token = DeliveryClaimToken(macro_uuid::generate_uuid_v7());
    tx.acquire(
        link_id,
        message_id,
        token.0,
        lease_seconds,
        header.as_deref(),
        legacy_claim,
    )
    .await?;
    let attempt = tx.attempt(link_id, message_id).await?;
    tx.commit().await?;
    Ok(Some(DeliveryClaim {
        schedule: ScheduledMessage {
            link_id,
            message_id,
            send_time: schedule.send_time,
            sent: false,
            processing: true,
            actor_id: schedule.actor_id,
            agent_correlation_id: schedule.agent_correlation_id,
        },
        token,
        message_id_header: header,
        requires_reconciliation: reconcile,
        approved_attachments: schedule.approved_attachments,
        approved_snapshot: attempt.as_ref().and_then(|attempt| attempt.request.clone()),
        prepared_content: attempt.and_then(|attempt| attempt.prepared_content),
    }))
}

/// Persist the provider submission boundary.
#[tracing::instrument(
    target = "email_db_client::messages::scheduled::delivery",
    skip(pool, claim),
    err
)]
pub async fn begin_submission(
    pool: &impl DeliveryTransitions,
    claim: &DeliveryClaim,
    lease_seconds: i32,
) -> anyhow::Result<bool> {
    Ok(pool.begin_submission(claim, lease_seconds).await? == 1)
}

/// Back off preparation before submission.
#[tracing::instrument(
    target = "email_db_client::messages::scheduled::delivery",
    skip(pool, claim),
    err
)]
pub async fn release_preparation(
    pool: &impl DeliveryTransitions,
    claim: &DeliveryClaim,
    retry_seconds: i32,
) -> anyhow::Result<()> {
    pool.release_preparation(claim, retry_seconds).await
}

/// Persist a paused delivery state.
#[tracing::instrument(
    target = "email_db_client::messages::scheduled::delivery",
    skip(pool, claim),
    err
)]
pub async fn pause_delivery(
    pool: &impl DeliveryTransitions,
    claim: &DeliveryClaim,
    unconfirmed: bool,
    retry_seconds: i32,
) -> anyhow::Result<()> {
    pool.pause_delivery(claim, unconfirmed, retry_seconds).await
}

/// Fence completion before changing the message, preserving its caller's lock scope.
#[tracing::instrument(
    target = "email_db_client::messages::scheduled::delivery",
    skip(tx, claim),
    err
)]
pub async fn complete_delivery(
    tx: &mut impl CompletionQueries,
    claim: &DeliveryClaim,
) -> anyhow::Result<bool> {
    let row = tx
        .message_sent(claim.schedule.link_id, claim.schedule.message_id)
        .await?;
    if row.is_none_or(|is_sent| is_sent) {
        return Ok(false);
    }
    Ok(tx.complete(claim).await? == 1)
}

#[cfg(test)]
mod test;
