//! Typed test call sites for the moved domain APIs.
use crate::domain::scheduled_delivery::state;
pub use crate::domain::scheduled_delivery::state::DeliveryClaim;
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;
pub async fn claim_delivery(
    pool: &PgPool,
    link: Uuid,
    message: Uuid,
    lease: i32,
) -> anyhow::Result<Option<DeliveryClaim>> {
    state::claim_delivery(pool, link, message, lease).await
}
pub async fn begin_submission(
    pool: &PgPool,
    claim: &DeliveryClaim,
    lease: i32,
) -> anyhow::Result<bool> {
    state::begin_submission(pool, claim, lease).await
}
pub async fn release_preparation(
    pool: &PgPool,
    claim: &DeliveryClaim,
    retry: i32,
) -> anyhow::Result<()> {
    state::release_preparation(pool, claim, retry).await
}
pub async fn record_absent_lookup(
    pool: &PgPool,
    claim: &DeliveryClaim,
    retry: i32,
) -> anyhow::Result<()> {
    state::record_absent_lookup(pool, claim, retry).await
}
pub async fn release_for_resend(pool: &PgPool, claim: &DeliveryClaim) -> anyhow::Result<bool> {
    state::release_for_resend(pool, claim).await
}
pub async fn pause_delivery(
    pool: &PgPool,
    claim: &DeliveryClaim,
    unconfirmed: bool,
    retry: i32,
) -> anyhow::Result<()> {
    state::pause_delivery(pool, claim, unconfirmed, retry).await
}
pub async fn complete_delivery(
    tx: &mut PgConnection,
    claim: &DeliveryClaim,
) -> anyhow::Result<bool> {
    state::complete_delivery(tx, claim).await
}
