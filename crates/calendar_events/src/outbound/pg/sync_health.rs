//! How current each of a requester's calendars is, read from the sync state
//! Google and Outlook store on accounts and calendars.
use super::*;
use crate::domain::models::{CalendarFreshness, CalendarSyncHealth, SYSTEM_CALENDAR_SYNC_INTERVAL};
use crate::domain::ports::CalendarSyncHealthReader;

/// The stored spelling of a failure kind (`calendars.last_sync_error_kind`).
pub(super) fn stored_sync_failure(kind: CalendarSyncFailure) -> &'static str {
    match kind {
        CalendarSyncFailure::Transient => "transient",
        CalendarSyncFailure::Permanent => "permanent",
        CalendarSyncFailure::ReauthRequired => "reauth_required",
    }
}

/// A calendar's own failure. A builder older than the kind column stores none,
/// so an unknown kind is read as the failure a retry will not fix.
fn calendar_failure(kind: Option<&str>) -> CalendarSyncFailure {
    match kind {
        Some("transient") => CalendarSyncFailure::Transient,
        Some("reauth_required") => CalendarSyncFailure::ReauthRequired,
        _ => CalendarSyncFailure::Permanent,
    }
}

/// The failure an account's sync status puts on every calendar it holds.
/// Google marks a whole account `error` only when its sync failed for good,
/// and `pending` while a failed run waits to retry. Outlook marks the account
/// `error` after a failure on any one of its calendars, which records its own
/// failure, so there the account status says nothing about the others. Either
/// provider marks an account `syncing` or `pending` while it catches up: a
/// first import, a retry, or a return from reauthorization.
fn account_failure(provider: &str, status: &str) -> Option<CalendarSyncFailure> {
    match (provider, status) {
        (_, "reauth_required") => Some(CalendarSyncFailure::ReauthRequired),
        ("google", "error") => Some(CalendarSyncFailure::Permanent),
        (_, "pending" | "syncing") => Some(CalendarSyncFailure::Transient),
        _ => None,
    }
}

impl CalendarSyncHealthReader for PgCalendarRepository {
    #[tracing::instrument(
        skip(self, requester_id),
        fields(calendar_count = tracing::field::Empty),
        err
    )]
    async fn calendar_sync_health(&self, requester_id: &str) -> Result<CalendarSyncHealth, Report> {
        // The same accounts and calendars `list_visible_calendars` reads,
        // keeping accounts that list no calendar yet. Each side of the union
        // reads its own index: an `OR` across the two would scan every inbox.
        let rows = sqlx::query!(
            r#"
            WITH links AS MATERIALIZED (
                SELECT link.id
                FROM email_links link
                WHERE link.macro_id = $1
                UNION
                SELECT delegation.link_id
                FROM macro_user_links delegation
                WHERE delegation.primary_macro_id = $1
            )
            SELECT
                links.id AS "email_link_id!",
                account.provider AS "provider!",
                account.sync_status AS "account_status!",
                account.last_synced_at IS NOT NULL AS "account_synced!",
                calendar.id AS "calendar_id?",
                calendar.provider_calendar_id AS "provider_calendar_id?",
                calendar.synced_at AS "synced_at?",
                calendar.last_sync_error IS NOT NULL AS "calendar_failed?",
                calendar.last_sync_error_kind AS "calendar_failure_kind?"
            FROM links
            JOIN calendar_accounts account ON account.email_link_id = links.id
            LEFT JOIN calendars calendar
                ON calendar.account_id = account.id
               AND NOT calendar.is_deleted
            WHERE account.sync_status <> 'disabled'
            "#,
            requester_id,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(report)?;

        let mut health = CalendarSyncHealth::default();
        for row in rows {
            let Some(calendar_id) = row.calendar_id else {
                if !row.account_synced {
                    health.unlisted_inboxes.push(row.email_link_id);
                }
                continue;
            };
            let system = row
                .provider_calendar_id
                .as_deref()
                .is_some_and(is_system_calendar);
            let refresh_due_at = row.synced_at.map(|synced_at| {
                if system {
                    synced_at + SYSTEM_CALENDAR_SYNC_INTERVAL
                } else {
                    synced_at
                }
            });
            let own_failure = row
                .calendar_failed
                .unwrap_or(false)
                .then(|| calendar_failure(row.calendar_failure_kind.as_deref()));
            health.calendars.push(CalendarFreshness {
                calendar_id,
                refresh_due_at,
                failure: own_failure.max(account_failure(&row.provider, &row.account_status)),
            });
        }
        tracing::Span::current().record("calendar_count", health.calendars.len());
        Ok(health)
    }
}
