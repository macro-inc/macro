//! Provider entitlement checks attached to a successfully observed source.

use rootcause::Report;
use sqlx::{Postgres, Transaction};

use crate::domain::models::GoogleEventSource;

use super::report;

/// An unchanged response verifies its content only when the role observed
/// before its provider request still matches this account's calendar role.
/// A delayed response must never upgrade itself to a newer stored role.
pub(super) async fn verify_source_access(
    tx: &mut Transaction<'_, Postgres>,
    source: &GoogleEventSource,
) -> Result<(), Report> {
    sqlx::query!(
        r#"
        UPDATE calendar_event_sources source
        SET provider_access_role = $4
        FROM calendars calendar
        WHERE source.calendar_id = calendar.id
          AND calendar.account_id = $1
          AND source.account_id = $1
          AND source.calendar_id = $2
          AND source.provider_event_id = $3
          AND $4::text IS NOT NULL
          AND calendar.access_role = $4
          AND source.provider_access_role IS DISTINCT FROM $4
        "#,
        source.account_id,
        source.calendar_id,
        &source.provider_event_id,
        source.observed_access_role.as_deref(),
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    Ok(())
}

/// Lock the calendar's certification before committing new snapshot state.
pub(super) async fn snapshot_is_verified(
    tx: &mut Transaction<'_, Postgres>,
    account_id: uuid::Uuid,
    calendar_id: uuid::Uuid,
) -> Result<bool, Report> {
    sqlx::query_scalar!(
        r#"SELECT snapshot_normalization_version >= 1 AS "verified!" FROM calendars WHERE id=$1 AND account_id=$2 AND NOT is_deleted FOR UPDATE"#,
        calendar_id,
        account_id,
    )
    .fetch_optional(&mut **tx)
    .await
    .map(|verified| verified.unwrap_or(false))
    .map_err(report)
}

/// Certify a strict worker's snapshot after the state-change trigger ran.
pub(super) async fn verify_calendar_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    account_id: uuid::Uuid,
    calendar_id: uuid::Uuid,
) -> Result<(), Report> {
    sqlx::query!(
        "UPDATE calendars SET snapshot_normalization_version=1 WHERE id=$1 AND account_id=$2 AND NOT is_deleted",
        calendar_id,
        account_id,
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    Ok(())
}
