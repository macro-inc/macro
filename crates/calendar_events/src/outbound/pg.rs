//! PostgreSQL implementation of the calendar repository port.

use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use futures::try_join;
use rootcause::Report;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::domain::{
    models::{
        ActorInboxes, AppliedGoogleGrant, AttendeeResponseStatus, CalendarAttendee,
        CalendarBackfillClaim, CalendarBackfillFailureDisposition, CalendarBackfillFailureOutcome,
        CalendarBackfillJob, CalendarBackfillJobKey, CalendarBackfillKind, CalendarCreationTarget,
        CalendarEvent, CalendarEventMutationTarget, CalendarEventOverride, CalendarEventSource,
        CalendarEventUpsert, CalendarGrantIntent, CalendarLinkTokenIdentity, CalendarMentionEvent,
        CalendarMentionPreview, CalendarMentionRequestItem, CalendarOccurrence,
        CalendarOccurrenceCursor, CalendarReminderFiring, CalendarSyncStatus, CalendarWatchRelease,
        ConferenceProvider, DisconnectedGoogleCalendar, DueCalendarReminder, EventReminderOverride,
        EventReminders, EventStart, EventStatus, EventTime, EventTransparency, EventType,
        EventVisibility, GOOGLE_CALENDAR_SCOPES, GoogleCalendarSyncSnapshot, GoogleScopeSet,
        GoogleWatchChannel, OccurrenceRange, ProviderCalendar, StoredGoogleCalendar,
        VisibleCalendar,
    },
    ports::{
        CalendarBackfillRepository, CalendarEventChange, CalendarEventWrite,
        CalendarEventWriteOutcome, CalendarReminderDispatchRepo, CalendarRepository,
        GoogleCalendarSyncRepository, RetiredCalendarEvent,
    },
};

/// PostgreSQL calendar repository.
#[derive(Clone)]
pub struct PgCalendarRepository {
    pool: PgPool,
}

impl PgCalendarRepository {
    /// Construct a repository from the shared MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    async fn persist_google_backfill_failure(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Option<Uuid>,
        disposition: CalendarBackfillFailureDisposition,
        message: &str,
    ) -> Result<CalendarBackfillFailureOutcome, Report> {
        let (job_status, account_status, completed_at, link_needs_reauth) = match disposition {
            CalendarBackfillFailureDisposition::Retry => ("pending", "pending", None, false),
            CalendarBackfillFailureDisposition::Permanent => {
                ("failed", "error", Some(Utc::now()), false)
            }
            CalendarBackfillFailureDisposition::ReauthRequired => {
                ("failed", "reauth_required", Some(Utc::now()), true)
            }
            CalendarBackfillFailureDisposition::CalendarPermissionRequired => {
                ("failed", "reauth_required", Some(Utc::now()), false)
            }
        };
        let required_scopes = GOOGLE_CALENDAR_SCOPES.map(str::to_owned);
        let mut tx = self.pool.begin().await.map_err(report)?;

        // Incremental grant application locks the inbox before its jobs. Keep
        // the same order for reauth failure so concurrent consent and worker
        // deliveries cannot deadlock.
        let previous_link_reauth = if link_needs_reauth {
            Some(
                sqlx::query_scalar!(
                    r#"
                    SELECT needs_reauth
                    FROM email_links
                    WHERE id = $1
                    FOR UPDATE
                    "#,
                    key.email_link_id,
                )
                .fetch_one(&mut *tx)
                .await
                .map_err(report)?,
            )
        } else {
            None
        };

        let updated = if let Some(lease_token) = lease_token {
            sqlx::query!(
                r#"
                UPDATE calendar_backfill_jobs
                SET status = $4,
                    lease_expires_at = NULL,
                    lease_token = NULL,
                    last_error = $2,
                    completed_at = $5,
                    updated_at = now()
                WHERE id = $1
                  AND email_link_id = $3
                  AND kind = 'google_calendar'
                  AND status = 'running'
                  AND lease_token = $6
                  AND lease_expires_at > now()
                  AND EXISTS (
                        SELECT 1
                        FROM email_link_google_scopes scopes
                        WHERE scopes.link_id = calendar_backfill_jobs.email_link_id
                          AND scopes.grant_version = calendar_backfill_jobs.grant_version
                          AND scopes.granted_scopes @> $7::text[]
                  )
                "#,
                key.job_id,
                message,
                key.email_link_id,
                job_status,
                completed_at,
                lease_token,
                &required_scopes,
            )
            .execute(&mut *tx)
            .await
            .map_err(report)?
        } else {
            sqlx::query!(
                r#"
                UPDATE calendar_backfill_jobs
                SET status = $4,
                    lease_expires_at = NULL,
                    lease_token = NULL,
                    last_error = $2,
                    completed_at = $5,
                    updated_at = now()
                WHERE id = $1
                  AND email_link_id = $3
                  AND kind = 'google_calendar'
                  AND status NOT IN ('complete', 'failed')
                  AND lease_token IS NULL
                  AND EXISTS (
                        SELECT 1
                        FROM email_link_google_scopes scopes
                        WHERE scopes.link_id = calendar_backfill_jobs.email_link_id
                          AND scopes.grant_version = calendar_backfill_jobs.grant_version
                          AND scopes.granted_scopes @> $6::text[]
                  )
                "#,
                key.job_id,
                message,
                key.email_link_id,
                job_status,
                completed_at,
                &required_scopes,
            )
            .execute(&mut *tx)
            .await
            .map_err(report)?
        };
        if updated.rows_affected() != 1 {
            if lease_token.is_some() {
                return Err(rootcause::report!(
                    "Google Calendar backfill lease was lost"
                ));
            }
            tx.commit().await.map_err(report)?;
            return Ok(CalendarBackfillFailureOutcome {
                job_transitioned: false,
                link_reauth_transitioned: false,
            });
        }

        sqlx::query!(
            r#"
            UPDATE calendar_accounts
            SET sync_status = $2,
                last_sync_error = $3,
                updated_at = now()
            WHERE email_link_id = $1
            "#,
            key.email_link_id,
            account_status,
            message,
        )
        .execute(&mut *tx)
        .await
        .map_err(report)?;
        if link_needs_reauth {
            sqlx::query!(
                r#"
                UPDATE email_links
                SET needs_reauth = true,
                    last_sync_error_at = now(),
                    updated_at = now()
                WHERE id = $1
                "#,
                key.email_link_id,
            )
            .execute(&mut *tx)
            .await
            .map_err(report)?;
        }

        tx.commit().await.map_err(report)?;
        Ok(CalendarBackfillFailureOutcome {
            job_transitioned: true,
            link_reauth_transitioned: previous_link_reauth == Some(false),
        })
    }

    #[cfg(test)]
    async fn upsert_event_fixture(&self, upsert: CalendarEventUpsert) -> Result<Uuid, Report> {
        self.upsert_event(CalendarEventWrite::Fixture(upsert))
            .await
            .map(|outcome| outcome.event_id)
    }

    #[cfg(test)]
    async fn upsert_calendar_fixture(
        &self,
        account_id: Uuid,
        calendar: ProviderCalendar,
    ) -> Result<Uuid, Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        let id = upsert_calendar_tx(&mut tx, account_id, calendar).await?.id;
        tx.commit().await.map_err(report)?;
        Ok(id)
    }

    #[cfg(test)]
    async fn upsert_google_account(&self, email_link_id: Uuid) -> Result<Uuid, Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        let row = sqlx::query_as!(
            GrantRow,
            r#"
            SELECT
                l.macro_id,
                l.email_address::text AS "email_address!",
                COALESCE(g.granted_scopes, '{}') AS "granted_scopes!",
                COALESCE(g.grant_version, 0) AS "grant_version!",
                g.calendar_disabled_at
            FROM email_links l
            LEFT JOIN email_link_google_scopes g ON g.link_id = l.id
            WHERE l.id = $1
            "#,
            email_link_id,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(report)?;
        let id =
            upsert_google_account_tx(&mut tx, email_link_id, &row.macro_id, &row.email_address)
                .await?;
        tx.commit().await.map_err(report)?;
        Ok(id)
    }
}

struct GrantRow {
    macro_id: String,
    email_address: String,
    granted_scopes: Vec<String>,
    grant_version: i64,
    calendar_disabled_at: Option<DateTime<Utc>>,
}

struct StoredCalendarRow {
    id: Uuid,
    sync_token: Option<String>,
    materialized_starts_at: Option<DateTime<Utc>>,
    materialized_ends_at: Option<DateTime<Utc>>,
    materialized_start_date: Option<NaiveDate>,
    materialized_end_date: Option<NaiveDate>,
    synced_at: Option<DateTime<Utc>>,
    watch_expires_at: Option<DateTime<Utc>>,
}

struct OccurrenceJoinRow {
    event_id: Uuid,
    canonical_calendar_id: Option<Uuid>,
    occurrence_key: String,
    recurrence_id: Option<String>,
    occurrence_starts_at: Option<DateTime<Utc>>,
    occurrence_ends_at: Option<DateTime<Utc>>,
    occurrence_start_date: Option<NaiveDate>,
    occurrence_end_date: Option<NaiveDate>,
    is_cancelled: bool,
    owner_id: String,
    ical_uid: String,
    title: String,
    description: Option<String>,
    location: Option<String>,
    status: String,
    visibility: String,
    transparency: String,
    event_type: String,
    starts_at: Option<DateTime<Utc>>,
    ends_at: Option<DateTime<Utc>>,
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
    time_zone: Option<String>,
    recurrence_lines: Vec<String>,
    organizer_email: Option<String>,
    organizer_name: Option<String>,
    creator_email: Option<String>,
    creator_name: Option<String>,
    conference_url: Option<String>,
    conference_provider: Option<String>,
    sequence: i32,
    is_read_only: bool,
    reminders_use_default: bool,
    reminder_overrides: serde_json::Value,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

struct MentionPreviewRow {
    mention_exists: bool,
    viewer_event_id: Option<Uuid>,
    title: Option<String>,
    location: Option<String>,
    organizer_email: Option<String>,
    organizer_name: Option<String>,
    recurrence_lines: Option<Vec<String>>,
    event_starts_at: Option<DateTime<Utc>>,
    event_ends_at: Option<DateTime<Utc>>,
    event_start_date: Option<NaiveDate>,
    event_end_date: Option<NaiveDate>,
    time_zone: Option<String>,
    updated_at: Option<DateTime<Utc>>,
    occurrence_key: Option<String>,
    occurrence_starts_at: Option<DateTime<Utc>>,
    occurrence_ends_at: Option<DateTime<Utc>>,
    occurrence_start_date: Option<NaiveDate>,
    occurrence_end_date: Option<NaiveDate>,
    attendee_count: Option<i64>,
}

struct OverrideAttendeeRow {
    event_id: Uuid,
    recurrence_id: String,
    email: Option<String>,
    display_name: Option<String>,
    response_status: Option<String>,
    is_organizer: Option<bool>,
    is_optional: Option<bool>,
    is_self: Option<bool>,
    comment: Option<String>,
}

struct AttendeeRow {
    event_id: Uuid,
    email: String,
    display_name: Option<String>,
    response_status: String,
    is_organizer: bool,
    is_optional: bool,
    is_self: bool,
    comment: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSourceProjection {
    event: CalendarEvent,
    overrides: Vec<CalendarEventOverride>,
    occurrences: Vec<CalendarOccurrence>,
}

impl From<&CalendarEventUpsert> for StoredSourceProjection {
    fn from(upsert: &CalendarEventUpsert) -> Self {
        Self {
            event: upsert.event.clone(),
            overrides: upsert.overrides.clone(),
            occurrences: upsert.occurrences.clone(),
        }
    }
}

impl CalendarRepository for PgCalendarRepository {
    #[tracing::instrument(skip(self, scopes), err)]
    async fn apply_google_grant(
        &self,
        email_link_id: Uuid,
        scopes: GoogleScopeSet,
        intent: CalendarGrantIntent,
    ) -> Result<AppliedGoogleGrant, Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        // The email_links row remains the grant serialization point. Every
        // production side-table write below occurs while holding this lock.
        let row = sqlx::query_as!(
            GrantRow,
            r#"
            SELECT
                l.macro_id,
                l.email_address::text AS "email_address!",
                COALESCE(g.granted_scopes, '{}') AS "granted_scopes!",
                COALESCE(g.grant_version, 0) AS "grant_version!",
                g.calendar_disabled_at
            FROM email_links l
            LEFT JOIN email_link_google_scopes g ON g.link_id = l.id
            WHERE l.id = $1
            FOR UPDATE OF l
            "#,
            email_link_id,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(report)?;

        // The user's own opt-out outranks whatever Google reports. Consent
        // requests carry `include_granted_scopes=true`, so a plain Gmail
        // reconnect hands back the calendar scopes of an earlier grant; only a
        // flow that explicitly asked for calendar counts as re-enabling it.
        let clear_opt_out = matches!(intent, CalendarGrantIntent::CalendarRequested);
        let calendar_opted_out = row.calendar_disabled_at.is_some() && !clear_opt_out;
        let scopes = if calendar_opted_out {
            scopes.without_calendar()
        } else {
            scopes
        };

        let old_scopes = GoogleScopeSet::from_scopes(row.granted_scopes);
        let had_calendar_capability = old_scopes.has_calendar_capability();
        let changed = old_scopes != scopes;
        if !changed {
            if clear_opt_out {
                clear_calendar_opt_out_tx(&mut tx, email_link_id).await?;
            }
            let jobs = if scopes.has_calendar_capability() {
                retry_failed_backfills_tx(&mut tx, email_link_id, row.grant_version).await?
            } else {
                Vec::new()
            };
            tx.commit().await.map_err(report)?;
            return Ok(AppliedGoogleGrant {
                grant_version: row.grant_version,
                changed: false,
                jobs,
            });
        }

        let grant_version = row.grant_version + 1;
        let granted_scopes = scopes.clone().into_vec();
        sqlx::query!(
            r#"
            INSERT INTO email_link_google_scopes (link_id, granted_scopes, grant_version)
            VALUES ($1, $2, $3)
            ON CONFLICT (link_id) DO UPDATE
            SET granted_scopes = EXCLUDED.granted_scopes,
                grant_version = EXCLUDED.grant_version,
                calendar_disabled_at = CASE
                    WHEN $4 THEN NULL
                    ELSE email_link_google_scopes.calendar_disabled_at
                END,
                updated_at = now()
            "#,
            email_link_id,
            &granted_scopes,
            grant_version,
            clear_opt_out,
        )
        .execute(&mut *tx)
        .await
        .map_err(report)?;
        invalidate_stale_google_jobs_tx(&mut tx, email_link_id, grant_version).await?;

        let mut jobs = Vec::new();
        let has_calendar_capability = scopes.has_calendar_capability();
        if had_calendar_capability && !has_calendar_capability {
            disable_google_calendar_capability_tx(&mut tx, email_link_id).await?;
        }
        if has_calendar_capability {
            let account_id =
                upsert_google_account_tx(&mut tx, email_link_id, &row.macro_id, &row.email_address)
                    .await?;
            for kind in [CalendarBackfillKind::GoogleCalendar] {
                let job_id = Uuid::now_v7();
                let inserted = sqlx::query_scalar!(
                    r#"
                    INSERT INTO calendar_backfill_jobs (
                        id, email_link_id, account_id, kind, grant_version
                    )
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (email_link_id, kind, grant_version) DO NOTHING
                    RETURNING id
                    "#,
                    job_id,
                    email_link_id,
                    account_id,
                    kind.as_str(),
                    grant_version,
                )
                .fetch_optional(&mut *tx)
                .await
                .map_err(report)?;

                if let Some(job_id) = inserted {
                    sqlx::query!(
                        r#"
                        INSERT INTO calendar_sync_outbox (
                            id, backfill_job_id
                        )
                        VALUES ($1, $2)
                        "#,
                        Uuid::now_v7(),
                        job_id,
                    )
                    .execute(&mut *tx)
                    .await
                    .map_err(report)?;

                    jobs.push(CalendarBackfillJob {
                        id: job_id,
                        email_link_id,
                        account_id: Some(account_id),
                        kind,
                        grant_version,
                    });
                }
            }
        }

        tx.commit().await.map_err(report)?;
        Ok(AppliedGoogleGrant {
            grant_version,
            changed,
            jobs,
        })
    }

    #[tracing::instrument(skip(self, requester_id), err)]
    async fn disconnect_google_calendar(
        &self,
        requester_id: &str,
        email_link_id: Uuid,
    ) -> Result<Option<DisconnectedGoogleCalendar>, Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        // Same serialization point and lock order as grant application, so a
        // consent landing concurrently either precedes or follows this removal.
        // Only the inbox's owner may disconnect it: a delegate reads the
        // owner's calendar and must not be able to delete the owner's data.
        let row = sqlx::query!(
            r#"
            SELECT
                l.fusionauth_user_id,
                l.email_address::text AS "email_address!",
                l.provider::text AS "provider!",
                COALESCE(g.granted_scopes, '{}') AS "granted_scopes!"
            FROM email_links l
            LEFT JOIN email_link_google_scopes g ON g.link_id = l.id
            WHERE l.id = $1 AND l.macro_id = $2
            FOR UPDATE OF l
            "#,
            email_link_id,
            requester_id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(report)?;
        let Some(row) = row else {
            return Ok(None);
        };

        // Read the open channels before the calendars go away; the caller
        // closes them at Google once the local removal has committed.
        let watch_channels = sqlx::query!(
            r#"
            SELECT
                c.watch_channel_id AS "channel_id!",
                c.watch_resource_id AS "resource_id!"
            FROM calendars c
            JOIN calendar_accounts a ON a.id = c.account_id
            WHERE a.email_link_id = $1
              AND c.watch_channel_id IS NOT NULL
              AND c.watch_resource_id IS NOT NULL
            "#,
            email_link_id,
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(report)?
        .into_iter()
        .map(|row| CalendarWatchRelease {
            channel_id: row.channel_id,
            resource_id: row.resource_id,
        })
        .collect();

        let granted_scopes = GoogleScopeSet::from_scopes(row.granted_scopes)
            .without_calendar()
            .into_vec();
        let grant_version = sqlx::query_scalar!(
            r#"
            INSERT INTO email_link_google_scopes (
                link_id, granted_scopes, grant_version, calendar_disabled_at
            )
            VALUES ($1, $2, 1, now())
            ON CONFLICT (link_id) DO UPDATE
            SET granted_scopes = EXCLUDED.granted_scopes,
                grant_version = email_link_google_scopes.grant_version + 1,
                calendar_disabled_at = now(),
                updated_at = now()
            RETURNING grant_version AS "grant_version!"
            "#,
            email_link_id,
            &granted_scopes,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(report)?;

        // Fence anything mid-flight against the superseded grant, then tear
        // the local projection down and drop the account itself, which
        // cascades its calendars and backfill jobs.
        invalidate_stale_google_jobs_tx(&mut tx, email_link_id, grant_version).await?;
        disable_google_calendar_capability_tx(&mut tx, email_link_id).await?;
        sqlx::query!(
            "DELETE FROM calendar_accounts WHERE email_link_id = $1",
            email_link_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(report)?;

        tx.commit().await.map_err(report)?;
        Ok(Some(DisconnectedGoogleCalendar {
            token_identity: CalendarLinkTokenIdentity {
                fusionauth_user_id: row.fusionauth_user_id,
                email_address: row.email_address,
                provider: row.provider,
            },
            watch_channels,
        }))
    }

    #[tracing::instrument(skip(self, write), err)]
    async fn upsert_event(
        &self,
        write: CalendarEventWrite,
    ) -> Result<CalendarEventWriteOutcome, Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        let upsert = match write {
            CalendarEventWrite::GoogleBackfill {
                key,
                lease_token,
                upsert,
            } => {
                let CalendarEventSource::Google(source) = &upsert.source;
                if source.email_link_id != key.email_link_id {
                    return Err(rootcause::report!(
                        "Google calendar event fence does not match its connected inbox"
                    ));
                }
                fence_google_mutation_tx(&mut tx, key, lease_token, Some(source.account_id))
                    .await?;
                upsert
            }
            CalendarEventWrite::UserMutation(upsert) => upsert,
            #[cfg(test)]
            CalendarEventWrite::Fixture(upsert) => upsert,
        };
        let CalendarEventSource::Google(source) = &upsert.source;
        let source_kind = "google";
        let source_link_id = source.email_link_id;
        let reconciliation_lock = event_reconciliation_lock(source_link_id, &upsert.event.ical_uid);
        sqlx::query_scalar!(
            r#"SELECT 1 AS "locked!" FROM pg_advisory_xact_lock($1)"#,
            reconciliation_lock,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(report)?;
        // Full snapshots re-upsert every event they observed, and a provider
        // sync-token reset makes that happen wholesale. When the incoming
        // Google projection is identical to the stored one, skip the write
        // path entirely so rebuilds cost reads, not occurrence churn.
        let existing = sqlx::query!(
            r#"
            SELECT event_id, normalized_payload
            FROM calendar_event_sources
            WHERE source_kind = 'google'
              AND account_id = $1
              AND calendar_id = $2
              AND provider_event_id = $3
            "#,
            source.account_id,
            source.calendar_id,
            &source.provider_event_id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(report)?;
        if let Some(row) = existing {
            let incoming =
                serde_json::to_value(StoredSourceProjection::from(&upsert)).map_err(report)?;
            if canonical_projection(&row.normalized_payload) == canonical_projection(&incoming) {
                tx.commit().await.map_err(report)?;
                return Ok(CalendarEventWriteOutcome {
                    event_id: row.event_id,
                    owner_id: upsert.event.owner_id.clone(),
                    change: CalendarEventChange::Unchanged,
                });
            }
        }

        let (starts_at, ends_at, start_date, end_date, time_zone) = split_time(&upsert.event.time);
        let proposed_id = upsert.event.id;

        // Google is the authoritative source when the same RFC UID was first
        // discovered in email. Email can still create/update entities that do
        // not yet have a Google source.
        let applied = sqlx::query!(
            r#"
            INSERT INTO calendar_events (
                id, owner_id, source_link_id, ical_uid, title, description, location,
                status, visibility, transparency, event_type,
                starts_at, ends_at, start_date, end_date, time_zone,
                recurrence_lines, organizer_email, organizer_name,
                creator_email, creator_name,
                conference_url, conference_provider, sequence, is_read_only,
                canonical_source_kind,
                canonical_source_updated_at,
                reminders_use_default, reminder_overrides,
                created_at, updated_at
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $30,
                $11, $12, $13, $14, $15,
                $16, $17, $18,
                $28, $29,
                $19, $27, $20, $21, $22, $24,
                $25, $26,
                $23, $24
            )
            ON CONFLICT (owner_id, source_link_id, ical_uid) DO UPDATE SET
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                location = EXCLUDED.location,
                status = EXCLUDED.status,
                visibility = EXCLUDED.visibility,
                transparency = EXCLUDED.transparency,
                event_type = EXCLUDED.event_type,
                starts_at = EXCLUDED.starts_at,
                ends_at = EXCLUDED.ends_at,
                start_date = EXCLUDED.start_date,
                end_date = EXCLUDED.end_date,
                time_zone = EXCLUDED.time_zone,
                recurrence_lines = EXCLUDED.recurrence_lines,
                organizer_email = EXCLUDED.organizer_email,
                organizer_name = EXCLUDED.organizer_name,
                creator_email = EXCLUDED.creator_email,
                creator_name = EXCLUDED.creator_name,
                conference_url = EXCLUDED.conference_url,
                conference_provider = EXCLUDED.conference_provider,
                sequence = EXCLUDED.sequence,
                is_read_only = EXCLUDED.is_read_only,
                canonical_source_kind = EXCLUDED.canonical_source_kind,
                canonical_source_updated_at = EXCLUDED.canonical_source_updated_at,
                reminders_use_default = EXCLUDED.reminders_use_default,
                reminder_overrides = EXCLUDED.reminder_overrides,
                updated_at = GREATEST(calendar_events.updated_at, EXCLUDED.updated_at)
            WHERE
                EXCLUDED.sequence > calendar_events.sequence
                OR (
                    EXCLUDED.sequence = calendar_events.sequence
                    AND EXCLUDED.canonical_source_updated_at
                        >= calendar_events.canonical_source_updated_at
                )
            -- `xmax = 0` distinguishes the INSERT from the DO UPDATE: a
            -- freshly inserted row carries no updating transaction id.
            RETURNING id, (xmax = 0) AS "inserted!"
            "#,
            proposed_id,
            &upsert.event.owner_id,
            source_link_id,
            &upsert.event.ical_uid,
            &upsert.event.title,
            upsert.event.description.as_deref(),
            upsert.event.location.as_deref(),
            upsert.event.status.as_str(),
            upsert.event.visibility.as_str(),
            upsert.event.transparency.as_str(),
            starts_at,
            ends_at,
            start_date,
            end_date,
            time_zone,
            &upsert.event.recurrence_lines,
            upsert.event.organizer_email.as_deref(),
            upsert.event.organizer_name.as_deref(),
            upsert.event.conference_url.as_deref(),
            db_sequence(upsert.event.sequence)?,
            upsert.event.is_read_only,
            source_kind,
            upsert.event.created_at,
            upsert.event.updated_at,
            upsert.event.reminders.use_default,
            serde_json::to_value(&upsert.event.reminders.overrides).map_err(report)?,
            upsert
                .event
                .conference_provider
                .map(ConferenceProvider::as_str),
            upsert.event.creator_email.as_deref(),
            upsert.event.creator_name.as_deref(),
            upsert.event.event_type.as_str(),
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(report)?;

        // No returned row means the sequence guard rejected the write as
        // stale: the source is still recorded below, but the canonical row and
        // its projections are untouched.
        let (event_id, change) = match &applied {
            Some(row) => (
                row.id,
                if row.inserted {
                    CalendarEventChange::Created
                } else {
                    CalendarEventChange::Updated
                },
            ),
            None => (
                sqlx::query_scalar!(
                    "SELECT id FROM calendar_events WHERE owner_id = $1 AND source_link_id = $2 AND ical_uid = $3",
                    &upsert.event.owner_id,
                    source_link_id,
                    &upsert.event.ical_uid,
                )
                .fetch_one(&mut *tx)
                .await
                .map_err(report)?,
                CalendarEventChange::Unchanged,
            ),
        };

        persist_source(&mut tx, event_id, &upsert).await?;

        // Only the source selected as canonical replaces projections and
        // attendees. Lower-sequence/stale sources are still recorded above.
        if applied.is_some() {
            replace_attendees(&mut tx, event_id, &upsert.event.attendees).await?;
            replace_overrides(&mut tx, event_id, &upsert.overrides).await?;
            replace_occurrences(
                &mut tx,
                event_id,
                &upsert.event.owner_id,
                &upsert.occurrences,
            )
            .await?;
            let calendar =
                fetch_calendar_reminder_context(&mut tx, Some(source.calendar_id)).await?;
            rebuild_event_reminder_firings(
                &mut tx,
                event_id,
                upsert.event.status,
                upsert.event.event_type,
                &upsert.event.reminders,
                calendar.as_ref(),
            )
            .await?;
        }

        tx.commit().await.map_err(report)?;
        Ok(CalendarEventWriteOutcome {
            event_id,
            owner_id: upsert.event.owner_id.clone(),
            change,
        })
    }

    #[tracing::instrument(skip(self, requester_id, range), err)]
    async fn list_occurrences(
        &self,
        requester_id: &str,
        range: OccurrenceRange,
        cursor: Option<CalendarOccurrenceCursor>,
        limit: u16,
    ) -> Result<Vec<(CalendarEvent, CalendarOccurrence)>, Report> {
        let cursor_starts_at = cursor.as_ref().map(|cursor| cursor.starts_at);
        let cursor_event_id = cursor.as_ref().map(|cursor| cursor.event_id);
        let cursor_occurrence_key = cursor.as_ref().map(|cursor| cursor.occurrence_key.as_str());
        let rows = sqlx::query_as!(
            OccurrenceJoinRow,
            r#"
            SELECT
                occurrence.event_id,
                canonical_source.calendar_id AS "canonical_calendar_id?",
                occurrence.occurrence_key,
                occurrence.recurrence_id,
                occurrence.starts_at AS occurrence_starts_at,
                occurrence.ends_at AS occurrence_ends_at,
                occurrence.start_date AS occurrence_start_date,
                occurrence.end_date AS occurrence_end_date,
                occurrence.is_cancelled,
                event.owner_id,
                event.ical_uid,
                event.title,
                event.description,
                event.location,
                event.status,
                event.visibility,
                event.transparency,
                event.event_type,
                event.starts_at,
                event.ends_at,
                event.start_date,
                event.end_date,
                event.time_zone,
                event.recurrence_lines,
                event.organizer_email,
                event.organizer_name,
                event.creator_email,
                event.creator_name,
                event.conference_url,
                event.conference_provider,
                event.sequence,
                event.is_read_only,
                event.reminders_use_default,
                event.reminder_overrides,
                event.created_at,
                event.updated_at
            FROM calendar_event_occurrences occurrence
            JOIN calendar_events event ON event.id = occurrence.event_id
            LEFT JOIN LATERAL (
                SELECT source.calendar_id
                FROM calendar_event_sources source
                JOIN calendars calendar ON calendar.id = source.calendar_id
                JOIN calendar_accounts account ON account.id = source.account_id
                WHERE source.event_id = event.id
                  AND NOT calendar.is_deleted
                  AND account.sync_status <> 'disabled'
                ORDER BY
                    source.source_sequence DESC,
                    source.source_updated_at DESC,
                    source.last_seen_at DESC,
                    source.id DESC
                LIMIT 1
            ) canonical_source ON true
            WHERE occurrence.owner_id IN (
                    SELECT $1::text
                    UNION
                    SELECT link.child_macro_id
                    FROM macro_user_links link
                    WHERE link.primary_macro_id = $1
              )
              AND event.status <> 'cancelled'
              AND NOT occurrence.is_cancelled
              AND (
                    event.owner_id = $1
                    OR EXISTS (
                        SELECT 1
                        FROM macro_user_links link
                        WHERE link.link_id = event.source_link_id
                          AND link.primary_macro_id = $1
                    )
              )
              AND (
                    occurrence.timed_span && tstzrange($2, $3, '[)')
                    OR occurrence.day_span && daterange($4, $5, '[)')
              )
              AND (
                    $6::timestamptz IS NULL
                    OR (
                        COALESCE(
                            occurrence.starts_at,
                            occurrence.start_date::timestamp AT TIME ZONE 'UTC'
                        ),
                        occurrence.event_id,
                        occurrence.occurrence_key
                    ) > ($6, $7, $8)
              )
            ORDER BY
                COALESCE(occurrence.starts_at, occurrence.start_date::timestamp AT TIME ZONE 'UTC'),
                occurrence.event_id,
                occurrence.occurrence_key
            LIMIT $9
            "#,
            requester_id,
            range.starts_at,
            range.ends_at,
            range.start_date,
            range.end_date,
            cursor_starts_at,
            cursor_event_id,
            cursor_occurrence_key,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(report)?;
        let event_ids: Vec<_> = rows.iter().map(|row| row.event_id).collect();
        let (attendees, override_attendees) = try_join!(
            fetch_attendees(&self.pool, &event_ids),
            fetch_override_attendees(&self.pool, &event_ids),
        )?;
        rows.into_iter()
            .map(|row| {
                let event_id = row.event_id;
                let occurrence = occurrence_from_join(&row)?;
                // An exception's attendee list replaces the series list for
                // that occurrence alone: Google records an instance-scoped
                // RSVP there and never on the master.
                let effective = occurrence
                    .recurrence_id
                    .as_ref()
                    .and_then(|recurrence_id| {
                        override_attendees.get(&(event_id, recurrence_id.clone()))
                    })
                    .or_else(|| attendees.get(&event_id))
                    .cloned()
                    .unwrap_or_default();
                let event = event_from_join(row, effective)?;
                Ok((event, occurrence))
            })
            .collect()
    }

    #[tracing::instrument(skip(self, requester_id, items), err)]
    async fn mention_previews(
        &self,
        requester_id: &str,
        items: Vec<CalendarMentionRequestItem>,
        now: DateTime<Utc>,
    ) -> Result<Vec<CalendarMentionPreview>, Report> {
        let event_ids: Vec<Uuid> = items.iter().map(|item| item.event_id).collect();
        let occurrence_keys: Vec<Option<String>> = items
            .iter()
            .map(|item| item.occurrence_key.clone())
            .collect();
        // The viewer lateral resolves the mentioned meeting to the
        // requester's own projection through the shared iCalendar UID,
        // preferring an owned copy over a delegated one and the mentioned
        // row itself among ties, so the preview only ever reads rows the
        // requester could already see on their calendar.
        let rows = sqlx::query_as!(
            MentionPreviewRow,
            r#"
            SELECT
                (mentioned.id IS NOT NULL) AS "mention_exists!",
                viewer_event.id AS "viewer_event_id?",
                viewer_event.title AS "title?",
                viewer_event.location AS "location?",
                viewer_event.organizer_email AS "organizer_email?",
                viewer_event.organizer_name AS "organizer_name?",
                viewer_event.recurrence_lines AS "recurrence_lines?",
                viewer_event.starts_at AS "event_starts_at?",
                viewer_event.ends_at AS "event_ends_at?",
                viewer_event.start_date AS "event_start_date?",
                viewer_event.end_date AS "event_end_date?",
                viewer_event.time_zone AS "time_zone?",
                viewer_event.updated_at AS "updated_at?",
                occurrence.occurrence_key AS "occurrence_key?",
                occurrence.starts_at AS "occurrence_starts_at?",
                occurrence.ends_at AS "occurrence_ends_at?",
                occurrence.start_date AS "occurrence_start_date?",
                occurrence.end_date AS "occurrence_end_date?",
                attendees.attendee_count AS "attendee_count?"
            FROM unnest($2::uuid[], $3::text[])
                WITH ORDINALITY AS requested(event_id, occurrence_key, ord)
            LEFT JOIN calendar_events mentioned
                ON mentioned.id = requested.event_id
               AND mentioned.status <> 'cancelled'
            LEFT JOIN LATERAL (
                SELECT
                    candidate.id,
                    candidate.title,
                    candidate.location,
                    candidate.organizer_email,
                    candidate.organizer_name,
                    candidate.recurrence_lines,
                    candidate.starts_at,
                    candidate.ends_at,
                    candidate.start_date,
                    candidate.end_date,
                    candidate.time_zone,
                    candidate.updated_at
                FROM calendar_events candidate
                WHERE candidate.ical_uid = mentioned.ical_uid
                  AND candidate.status <> 'cancelled'
                  AND (
                        candidate.owner_id = $1
                        OR EXISTS (
                            SELECT 1
                            FROM macro_user_links link
                            WHERE link.link_id = candidate.source_link_id
                              AND link.primary_macro_id = $1
                        )
                  )
                ORDER BY
                    (candidate.owner_id = $1) DESC,
                    (candidate.id = mentioned.id) DESC,
                    candidate.updated_at DESC,
                    candidate.id
                LIMIT 1
            ) viewer_event ON true
            LEFT JOIN LATERAL (
                SELECT
                    instance.occurrence_key,
                    instance.starts_at,
                    instance.ends_at,
                    instance.start_date,
                    instance.end_date
                FROM calendar_event_occurrences instance
                CROSS JOIN LATERAL (
                    SELECT COALESCE(
                        instance.starts_at,
                        instance.start_date::timestamp AT TIME ZONE 'UTC'
                    ) AS at
                ) instance_start
                WHERE instance.event_id = viewer_event.id
                  AND NOT instance.is_cancelled
                ORDER BY
                    (instance.occurrence_key
                        IS NOT DISTINCT FROM requested.occurrence_key) DESC,
                    (instance_start.at >= $4) DESC,
                    CASE WHEN instance_start.at >= $4 THEN instance_start.at END ASC,
                    instance_start.at DESC,
                    instance.occurrence_key
                LIMIT 1
            ) occurrence ON true
            LEFT JOIN LATERAL (
                SELECT count(*) AS attendee_count
                FROM calendar_event_attendees attendee
                WHERE attendee.event_id = viewer_event.id
            ) attendees ON true
            ORDER BY requested.ord
            "#,
            requester_id,
            &event_ids,
            &occurrence_keys as &[Option<String>],
            now,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(report)?;

        rows.into_iter().map(mention_preview_from_row).collect()
    }

    #[tracing::instrument(skip(self, requester_id), err)]
    async fn sync_status(&self, requester_id: &str) -> Result<CalendarSyncStatus, Report> {
        let is_syncing = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM calendar_accounts account
                WHERE account.sync_status IN ('pending', 'syncing')
                  AND (
                        account.owner_id = $1
                        OR EXISTS (
                            SELECT 1
                            FROM macro_user_links link
                            WHERE link.link_id = account.email_link_id
                              AND link.primary_macro_id = $1
                        )
                  )
            ) AS "is_syncing!"
            "#,
            requester_id,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(report)?;
        Ok(if is_syncing {
            CalendarSyncStatus::Syncing
        } else {
            CalendarSyncStatus::Ready
        })
    }

    #[tracing::instrument(skip(self, calendar), fields(job_id = %key.job_id), err)]
    async fn upsert_google_calendar(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
        account_id: Uuid,
        calendar: ProviderCalendar,
    ) -> Result<StoredGoogleCalendar, Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        fence_google_mutation_tx(&mut tx, key, lease_token, Some(account_id)).await?;
        let calendar = upsert_calendar_tx(&mut tx, account_id, calendar).await?;
        tx.commit().await.map_err(report)?;
        stored_google_calendar(calendar)
    }

    #[tracing::instrument(skip(self, sync), fields(job_id = %key.job_id), err)]
    async fn commit_google_calendar_sync(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
        account_id: Uuid,
        sync: GoogleCalendarSyncSnapshot,
        events_upserted: usize,
    ) -> Result<Vec<RetiredCalendarEvent>, Report> {
        let mut retired = Vec::new();
        let mut tx = self.pool.begin().await.map_err(report)?;
        fence_google_mutation_tx(&mut tx, key, lease_token, Some(account_id)).await?;

        if events_upserted > 0 {
            sqlx::query!(
                r#"
                UPDATE calendar_backfill_jobs
                SET extracted_count = extracted_count + $3,
                    updated_at = now()
                WHERE id = $1
                  AND email_link_id = $2
                "#,
                key.job_id,
                key.email_link_id,
                i64::try_from(events_upserted).map_err(|_| {
                    rootcause::report!(
                        "calendar backfill extracted count overflows the database representation"
                    )
                })?,
            )
            .execute(&mut *tx)
            .await
            .map_err(report)?;
        }

        if !sync.cancelled_provider_event_ids.is_empty() {
            // A cancelled recurring master retires its expanded instances via
            // provider_recurring_event_id, matching Google's tombstone shape.
            let affected_event_ids = sqlx::query_scalar!(
                r#"
                WITH deleted_sources AS (
                    DELETE FROM calendar_event_sources source
                    WHERE source.source_kind = 'google'
                      AND source.account_id = $1
                      AND source.calendar_id = $2
                      AND (
                            source.provider_event_id = ANY($3::text[])
                            OR source.provider_recurring_event_id = ANY($3::text[])
                      )
                    RETURNING source.event_id
                )
                SELECT DISTINCT event_id AS "event_id!"
                FROM deleted_sources
                "#,
                account_id,
                sync.calendar_id,
                &sync.cancelled_provider_event_ids,
            )
            .fetch_all(&mut *tx)
            .await
            .map_err(report)?;
            for event_id in affected_event_ids {
                if let Some(outcome) = restore_best_source_or_delete(&mut tx, event_id).await? {
                    retired.push(outcome);
                }
            }
        }

        if let Some(observed_provider_event_ids) = &sync.observed_provider_event_ids {
            let affected_event_ids = sqlx::query_scalar!(
                r#"
                WITH deleted_sources AS (
                    DELETE FROM calendar_event_sources source
                    WHERE source.source_kind = 'google'
                      AND source.account_id = $1
                      AND source.calendar_id = $2
                      AND NOT (source.provider_event_id = ANY($3::text[]))
                    RETURNING source.event_id
                )
                SELECT DISTINCT event_id AS "event_id!"
                FROM deleted_sources
                "#,
                account_id,
                sync.calendar_id,
                observed_provider_event_ids,
            )
            .fetch_all(&mut *tx)
            .await
            .map_err(report)?;
            for event_id in affected_event_ids {
                if let Some(outcome) = restore_best_source_or_delete(&mut tx, event_id).await? {
                    retired.push(outcome);
                }
            }
        }

        let has_materialized_range = sync.materialized_range.is_some();
        let materialized_starts_at = sync
            .materialized_range
            .as_ref()
            .map(|range| range.starts_at);
        let materialized_ends_at = sync.materialized_range.as_ref().map(|range| range.ends_at);
        let materialized_start_date = sync
            .materialized_range
            .as_ref()
            .map(|range| range.start_date);
        let materialized_end_date = sync.materialized_range.as_ref().map(|range| range.end_date);
        let updated = sqlx::query!(
            r#"
            UPDATE calendars
            SET sync_token = $3,
                synced_at = now(),
                materialized_starts_at = CASE
                    WHEN $4 THEN $5
                    ELSE materialized_starts_at
                END,
                materialized_ends_at = CASE
                    WHEN $4 THEN $6
                    ELSE materialized_ends_at
                END,
                materialized_start_date = CASE
                    WHEN $4 THEN $7
                    ELSE materialized_start_date
                END,
                materialized_end_date = CASE
                    WHEN $4 THEN $8
                    ELSE materialized_end_date
                END,
                updated_at = now()
            WHERE id = $1
              AND account_id = $2
              AND NOT is_deleted
            "#,
            sync.calendar_id,
            account_id,
            sync.next_sync_token,
            has_materialized_range,
            materialized_starts_at,
            materialized_ends_at,
            materialized_start_date,
            materialized_end_date,
        )
        .execute(&mut *tx)
        .await
        .map_err(report)?;
        if updated.rows_affected() != 1 {
            return Err(rootcause::report!(
                "provider calendar disappeared before sync state was committed"
            ));
        }

        tx.commit().await.map_err(report)?;
        Ok(retired)
    }

    #[tracing::instrument(skip(self, channel), fields(job_id = %key.job_id), err)]
    async fn record_watch_channel(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
        account_id: Uuid,
        calendar_id: Uuid,
        channel: GoogleWatchChannel,
    ) -> Result<(), Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        fence_google_mutation_tx(&mut tx, key, lease_token, Some(account_id)).await?;
        sqlx::query!(
            r#"
            UPDATE calendars
            SET watch_channel_id = $3,
                watch_resource_id = $4,
                watch_expires_at = $5,
                updated_at = now()
            WHERE id = $1
              AND account_id = $2
              AND NOT is_deleted
            "#,
            calendar_id,
            account_id,
            channel.channel_id.to_string(),
            channel.resource_id,
            channel.expires_at,
        )
        .execute(&mut *tx)
        .await
        .map_err(report)?;
        tx.commit().await.map_err(report)
    }

    #[tracing::instrument(skip(self, channel_id, resource_id), err)]
    async fn find_watch_target(
        &self,
        channel_id: &str,
        resource_id: &str,
    ) -> Result<Option<Uuid>, Report> {
        sqlx::query_scalar!(
            r#"
            SELECT account.email_link_id
            FROM calendars calendar
            JOIN calendar_accounts account ON account.id = calendar.account_id
            WHERE calendar.watch_channel_id = $1
              AND calendar.watch_resource_id = $2
              AND NOT calendar.is_deleted
              AND account.sync_status <> 'disabled'
            "#,
            channel_id,
            resource_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(report)
    }

    #[tracing::instrument(skip(self), err)]
    async fn schedule_google_sync_for_link(&self, email_link_id: Uuid) -> Result<bool, Report> {
        let required_scopes = GOOGLE_CALENDAR_SCOPES.map(str::to_owned);
        let scheduled = sqlx::query_scalar!(
            r#"
            WITH due AS (
                UPDATE calendar_backfill_jobs job
                SET status = 'pending',
                    cursor = '{}',
                    last_error = NULL,
                    started_at = NULL,
                    completed_at = NULL,
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = now()
                FROM calendar_accounts account, email_link_google_scopes scopes
                WHERE job.email_link_id = $1
                  AND job.email_link_id = account.email_link_id
                  AND job.account_id = account.id
                  AND scopes.link_id = job.email_link_id
                  AND job.kind = 'google_calendar'
                  AND job.status = 'complete'
                  AND job.grant_version = scopes.grant_version
                  AND scopes.granted_scopes @> $2::text[]
                  AND account.sync_status = 'ready'
                RETURNING job.id
            ),
            republished AS (
                UPDATE calendar_sync_outbox outbox
                SET published_at = NULL
                FROM due
                WHERE outbox.backfill_job_id = due.id
            )
            SELECT count(*) > 0 AS "scheduled!" FROM due
            "#,
            email_link_id,
            &required_scopes,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(report)?;
        Ok(scheduled)
    }

    #[tracing::instrument(skip(self, calendar_ids), fields(job_id = %key.job_id), err)]
    async fn reconcile_google_calendar_list(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
        account_id: Uuid,
        calendar_ids: Vec<Uuid>,
    ) -> Result<Vec<RetiredCalendarEvent>, Report> {
        let mut retired = Vec::new();
        let mut tx = self.pool.begin().await.map_err(report)?;
        fence_google_mutation_tx(&mut tx, key, lease_token, Some(account_id)).await?;

        let affected_event_ids = sqlx::query_scalar!(
            r#"
            WITH deleted_sources AS (
                DELETE FROM calendar_event_sources source
                WHERE source.source_kind = 'google'
                  AND source.account_id = $1
                  AND (
                        source.calendar_id IS NULL
                        OR NOT (source.calendar_id = ANY($2::uuid[]))
                  )
                RETURNING source.event_id
            )
            SELECT DISTINCT event_id AS "event_id!"
            FROM deleted_sources
            "#,
            account_id,
            &calendar_ids,
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(report)?;
        for event_id in affected_event_ids {
            if let Some(outcome) = restore_best_source_or_delete(&mut tx, event_id).await? {
                retired.push(outcome);
            }
        }

        sqlx::query!(
            r#"
            UPDATE calendars
            SET is_deleted = NOT (id = ANY($2::uuid[])),
                sync_token = CASE
                    WHEN id = ANY($2::uuid[]) THEN sync_token
                    ELSE NULL
                END,
                materialized_starts_at = CASE
                    WHEN id = ANY($2::uuid[]) THEN materialized_starts_at
                    ELSE NULL
                END,
                materialized_ends_at = CASE
                    WHEN id = ANY($2::uuid[]) THEN materialized_ends_at
                    ELSE NULL
                END,
                materialized_start_date = CASE
                    WHEN id = ANY($2::uuid[]) THEN materialized_start_date
                    ELSE NULL
                END,
                materialized_end_date = CASE
                    WHEN id = ANY($2::uuid[]) THEN materialized_end_date
                    ELSE NULL
                END,
                updated_at = now()
            WHERE account_id = $1
              AND is_deleted IS DISTINCT FROM NOT (id = ANY($2::uuid[]))
            "#,
            account_id,
            &calendar_ids,
        )
        .execute(&mut *tx)
        .await
        .map_err(report)?;

        tx.commit().await.map_err(report)?;
        Ok(retired)
    }

    #[tracing::instrument(skip(self, requester_id), err)]
    async fn get_event_mutation_target(
        &self,
        requester_id: &str,
        event_id: Uuid,
    ) -> Result<Option<CalendarEventMutationTarget>, Report> {
        // Rank Google sources exactly like source restoration so mutations
        // address the same provider copy reads are projected from.
        let row = sqlx::query!(
            r#"
            SELECT
                event.id AS event_id,
                event.owner_id,
                event.is_read_only,
                source.provider_event_id AS "provider_event_id!",
                source.provider_recurring_event_id,
                source.account_id AS "account_id!",
                source.calendar_id AS "calendar_id!",
                calendar.provider_calendar_id,
                account.email_link_id,
                link.fusionauth_user_id,
                link.email_address,
                link.provider::text AS "provider!"
            FROM calendar_events event
            JOIN calendar_event_sources source
                ON source.event_id = event.id
               AND source.source_kind = 'google'
            JOIN calendars calendar ON calendar.id = source.calendar_id
            JOIN calendar_accounts account ON account.id = source.account_id
            JOIN email_links link ON link.id = account.email_link_id
            WHERE event.id = $1
              AND NOT calendar.is_deleted
              AND account.sync_status <> 'disabled'
              AND (
                    event.owner_id = $2
                    OR EXISTS (
                        SELECT 1
                        FROM macro_user_links delegation
                        WHERE delegation.link_id = event.source_link_id
                          AND delegation.primary_macro_id = $2
                    )
              )
            ORDER BY
                source.source_sequence DESC,
                source.source_updated_at DESC,
                source.last_seen_at DESC,
                source.id DESC
            LIMIT 1
            "#,
            event_id,
            requester_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(report)?;
        let Some(row) = row else {
            return Ok(None);
        };
        let actor = ActorInboxes::from_owned(self.owned_inbox_emails(requester_id).await?);
        let token_identity = CalendarLinkTokenIdentity {
            fusionauth_user_id: row.fusionauth_user_id,
            email_address: row.email_address,
            provider: row.provider,
        };
        Ok(Some(CalendarEventMutationTarget {
            event_id: row.event_id,
            is_read_only: row.is_read_only,
            provider_event_id: row.provider_event_id,
            provider_recurring_event_id: row.provider_recurring_event_id,
            owner_id: row.owner_id,
            email_link_id: row.email_link_id,
            account_id: row.account_id,
            calendar_id: row.calendar_id,
            provider_calendar_id: row.provider_calendar_id,
            token_identity,
            actor,
        }))
    }

    #[tracing::instrument(skip(self, requester_id), err)]
    async fn get_creation_target(
        &self,
        requester_id: &str,
        email_link_id: Option<Uuid>,
        calendar_id: Option<Uuid>,
    ) -> Result<Option<CalendarCreationTarget>, Report> {
        let row = sqlx::query!(
            r#"
            SELECT
                link.macro_id AS owner_id,
                link.id AS email_link_id,
                account.id AS account_id,
                calendar.id AS calendar_id,
                calendar.provider_calendar_id,
                calendar.access_role,
                link.fusionauth_user_id,
                link.email_address,
                link.provider::text AS "provider!"
            FROM email_links link
            JOIN calendar_accounts account ON account.email_link_id = link.id
            JOIN calendars calendar ON calendar.account_id = account.id
            WHERE NOT calendar.is_deleted
              AND account.sync_status <> 'disabled'
              AND (
                    ($3::uuid IS NOT NULL AND calendar.id = $3)
                    OR ($3::uuid IS NULL AND calendar.is_primary)
              )
              AND ($2::uuid IS NULL OR link.id = $2)
              AND (
                    link.macro_id = $1
                    OR EXISTS (
                        SELECT 1
                        FROM macro_user_links delegation
                        WHERE delegation.link_id = link.id
                          AND delegation.primary_macro_id = $1
                    )
              )
            ORDER BY
                (link.macro_id = $1) DESC,
                link.is_primary DESC,
                link.created_at ASC
            LIMIT 1
            "#,
            requester_id,
            email_link_id,
            calendar_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(report)?;
        let Some(row) = row else {
            return Ok(None);
        };
        let actor = ActorInboxes::from_owned(self.owned_inbox_emails(requester_id).await?);
        let token_identity = CalendarLinkTokenIdentity {
            fusionauth_user_id: row.fusionauth_user_id,
            email_address: row.email_address,
            provider: row.provider,
        };
        Ok(Some(CalendarCreationTarget {
            owner_id: row.owner_id,
            email_link_id: row.email_link_id,
            account_id: row.account_id,
            calendar_id: row.calendar_id,
            provider_calendar_id: row.provider_calendar_id,
            is_read_only: !matches!(row.access_role.as_deref(), Some("owner" | "writer")),
            token_identity,
            actor,
        }))
    }

    #[tracing::instrument(skip(self, requester_id), err)]
    async fn list_visible_calendars(
        &self,
        requester_id: &str,
    ) -> Result<Vec<VisibleCalendar>, Report> {
        let rows = sqlx::query!(
            r#"
            SELECT
                calendar.id,
                link.id AS email_link_id,
                link.email_address,
                calendar.name,
                calendar.color,
                calendar.is_primary,
                calendar.access_role,
                calendar.default_reminders
            FROM email_links link
            JOIN calendar_accounts account ON account.email_link_id = link.id
            JOIN calendars calendar ON calendar.account_id = account.id
            WHERE NOT calendar.is_deleted
              AND account.sync_status <> 'disabled'
              AND (
                    link.macro_id = $1
                    OR EXISTS (
                        SELECT 1
                        FROM macro_user_links delegation
                        WHERE delegation.link_id = link.id
                          AND delegation.primary_macro_id = $1
                    )
              )
            ORDER BY
                (link.macro_id = $1) DESC,
                link.is_primary DESC,
                link.created_at ASC,
                calendar.is_primary DESC,
                (calendar.access_role IN ('owner', 'writer')) DESC,
                calendar.name ASC
            "#,
            requester_id,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(report)?;
        Ok(rows
            .into_iter()
            .map(|row| VisibleCalendar {
                id: row.id,
                email_link_id: row.email_link_id,
                email_address: row.email_address,
                name: row.name,
                color: row.color,
                is_primary: row.is_primary,
                is_writable: matches!(row.access_role.as_deref(), Some("owner" | "writer")),
                default_reminders: serde_json::from_value(row.default_reminders)
                    .inspect_err(|e| {
                        tracing::error!(error = ?e, calendar_id = %row.id, "malformed calendar default_reminders json");
                    })
                    .unwrap_or_default(),
            })
            .collect())
    }

    #[tracing::instrument(skip(self, requester_id), err)]
    async fn owned_inbox_emails(&self, requester_id: &str) -> Result<Vec<String>, Report> {
        sqlx::query_scalar!(
            r#"
            SELECT email_address::text AS "email_address!"
            FROM email_links
            WHERE macro_id = $1
            "#,
            requester_id,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(report)
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_google_source(
        &self,
        account_id: Uuid,
        calendar_id: Uuid,
        provider_event_id: &str,
    ) -> Result<Vec<RetiredCalendarEvent>, Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        let cancelled = [provider_event_id.to_string()];
        // A deleted recurring master retires its expanded instances via
        // provider_recurring_event_id, matching Google's tombstone shape.
        let affected_event_ids = sqlx::query_scalar!(
            r#"
            WITH deleted_sources AS (
                DELETE FROM calendar_event_sources source
                WHERE source.source_kind = 'google'
                  AND source.account_id = $1
                  AND source.calendar_id = $2
                  AND (
                        source.provider_event_id = ANY($3::text[])
                        OR source.provider_recurring_event_id = ANY($3::text[])
                  )
                RETURNING source.event_id
            )
            SELECT DISTINCT event_id AS "event_id!"
            FROM deleted_sources
            "#,
            account_id,
            calendar_id,
            &cancelled,
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(report)?;
        let mut retired = Vec::new();
        for event_id in affected_event_ids {
            if let Some(outcome) = restore_best_source_or_delete(&mut tx, event_id).await? {
                retired.push(outcome);
            }
        }
        tx.commit().await.map_err(report)?;
        Ok(retired)
    }
}

impl GoogleCalendarSyncRepository for PgCalendarRepository {
    #[tracing::instrument(skip(self), err)]
    async fn schedule_due_google_syncs(&self, due_before: DateTime<Utc>) -> Result<usize, Report> {
        let required_scopes = GOOGLE_CALENDAR_SCOPES.map(str::to_owned);
        let due_count = sqlx::query_scalar!(
            r#"
            WITH due AS (
                UPDATE calendar_backfill_jobs job
                SET status = 'pending',
                    cursor = '{}',
                    scanned_count = 0,
                    extracted_count = 0,
                    last_error = NULL,
                    started_at = NULL,
                    completed_at = NULL,
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = now()
                FROM calendar_accounts account, email_link_google_scopes scopes
                WHERE job.email_link_id = account.email_link_id
                  AND job.account_id = account.id
                  AND scopes.link_id = job.email_link_id
                  AND job.kind = 'google_calendar'
                  AND job.status = 'complete'
                  AND job.grant_version = scopes.grant_version
                  AND scopes.granted_scopes @> $2::text[]
                  AND account.sync_status = 'ready'
                  AND account.last_synced_at <= $1
                RETURNING job.id
            ),
            republished AS (
                UPDATE calendar_sync_outbox outbox
                SET published_at = NULL
                FROM due
                WHERE outbox.backfill_job_id = due.id
            )
            SELECT count(*) AS "due_count!" FROM due
            "#,
            due_before,
            &required_scopes,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(report)?;
        Ok(due_count as usize)
    }
}

async fn fence_google_mutation_tx(
    tx: &mut Transaction<'_, Postgres>,
    key: CalendarBackfillJobKey,
    lease_token: Uuid,
    account_id: Option<Uuid>,
) -> Result<(), Report> {
    let required_scopes = GOOGLE_CALENDAR_SCOPES.map(str::to_owned);
    let fenced_job = sqlx::query_scalar!(
        r#"
        SELECT job.id
        FROM calendar_backfill_jobs job
        WHERE job.id = $1
          AND job.email_link_id = $2
          AND job.kind = 'google_calendar'
          AND job.status = 'running'
          AND job.lease_token = $3
          AND job.lease_expires_at > now()
          AND EXISTS (
                SELECT 1
                FROM email_link_google_scopes scopes
                WHERE scopes.link_id = job.email_link_id
                  AND scopes.grant_version = job.grant_version
                  AND scopes.granted_scopes @> $5::text[]
          )
          AND EXISTS (
                SELECT 1
                FROM calendar_accounts account
                WHERE account.id = job.account_id
                  AND account.email_link_id = job.email_link_id
                  AND account.sync_status <> 'disabled'
                  AND ($4::uuid IS NULL OR account.id = $4)
          )
        FOR UPDATE OF job
        "#,
        key.job_id,
        key.email_link_id,
        lease_token,
        account_id,
        &required_scopes,
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(report)?;
    if fenced_job.is_none() {
        return Err(rootcause::report!(
            "Google Calendar backfill lease was lost before provider mutation"
        ));
    }
    Ok(())
}

async fn upsert_calendar_tx(
    tx: &mut Transaction<'_, Postgres>,
    account_id: Uuid,
    calendar: ProviderCalendar,
) -> Result<StoredCalendarRow, Report> {
    // Snapshot the reminder-relevant state before the upsert: a change to the
    // default reminders or the zone that anchors all-day starts invalidates
    // the firing schedule of every event that follows this calendar.
    let previous = sqlx::query!(
        r#"
        SELECT time_zone, default_reminders
        FROM calendars
        WHERE account_id = $1 AND provider_calendar_id = $2
        "#,
        account_id,
        &calendar.provider_calendar_id,
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(report)?;
    let default_reminders = serde_json::to_value(&calendar.default_reminders).map_err(report)?;
    let reminders_invalidated = previous.is_some_and(|previous| {
        previous.default_reminders != default_reminders || previous.time_zone != calendar.time_zone
    });
    let anchor_zone = calendar.time_zone.clone();
    let row = sqlx::query_as!(
        StoredCalendarRow,
        r#"
        INSERT INTO calendars (
            id, account_id, provider_calendar_id, name, description,
            time_zone, color, access_role, is_primary, is_selected,
            default_reminders
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (account_id, provider_calendar_id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            time_zone = EXCLUDED.time_zone,
            color = EXCLUDED.color,
            access_role = EXCLUDED.access_role,
            is_primary = EXCLUDED.is_primary,
            is_selected = EXCLUDED.is_selected,
            is_deleted = false,
            default_reminders = EXCLUDED.default_reminders,
            updated_at = now()
        RETURNING
            id,
            sync_token,
            materialized_starts_at,
            materialized_ends_at,
            materialized_start_date,
            materialized_end_date,
            synced_at,
            watch_expires_at
        "#,
        Uuid::now_v7(),
        account_id,
        calendar.provider_calendar_id,
        calendar.name,
        calendar.description,
        calendar.time_zone,
        calendar.color,
        calendar.access_role,
        calendar.is_primary,
        calendar.is_selected,
        &default_reminders,
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(report)?;
    if reminders_invalidated {
        rebuild_calendar_reminder_firings(tx, row.id, anchor_zone.as_deref(), &default_reminders)
            .await?;
    }
    Ok(row)
}

fn stored_google_calendar(row: StoredCalendarRow) -> Result<StoredGoogleCalendar, Report> {
    let materialized_range = match (
        row.materialized_starts_at,
        row.materialized_ends_at,
        row.materialized_start_date,
        row.materialized_end_date,
    ) {
        (Some(starts_at), Some(ends_at), Some(start_date), Some(end_date)) => {
            Some(OccurrenceRange {
                starts_at,
                ends_at,
                start_date,
                end_date,
            })
        }
        (None, None, None, None) => None,
        _ => {
            return Err(rootcause::report!(
                "provider calendar has a partially persisted materialized range"
            ));
        }
    };
    Ok(StoredGoogleCalendar {
        id: row.id,
        sync_token: row.sync_token,
        materialized_range,
        synced_at: row.synced_at,
        watch_expires_at: row.watch_expires_at,
    })
}

impl CalendarBackfillRepository for PgCalendarRepository {
    #[tracing::instrument(skip(self, message), err)]
    async fn fail_unclaimed_google_backfill(
        &self,
        key: CalendarBackfillJobKey,
        disposition: CalendarBackfillFailureDisposition,
        message: &str,
    ) -> Result<CalendarBackfillFailureOutcome, Report> {
        self.persist_google_backfill_failure(key, None, disposition, message)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn claim_google_backfill(
        &self,
        key: CalendarBackfillJobKey,
    ) -> Result<CalendarBackfillClaim, Report> {
        let lease_token = Uuid::now_v7();
        let required_scopes = GOOGLE_CALENDAR_SCOPES.map(str::to_owned);
        let mut tx = self.pool.begin().await.map_err(report)?;
        let claimed_account_id = sqlx::query_scalar!(
            r#"
            UPDATE calendar_backfill_jobs
            SET status = 'running',
                started_at = COALESCE(started_at, now()),
                lease_token = $3,
                lease_expires_at = now() + interval '2 minutes',
                last_error = NULL,
                updated_at = now()
            WHERE id = $1
              AND email_link_id = $2
              AND kind = 'google_calendar'
              AND EXISTS (
                    SELECT 1
                    FROM email_link_google_scopes scopes
                    WHERE scopes.link_id = calendar_backfill_jobs.email_link_id
                      AND scopes.grant_version = calendar_backfill_jobs.grant_version
                      AND scopes.granted_scopes @> $4::text[]
              )
              AND EXISTS (
                    SELECT 1
                    FROM calendar_accounts account
                    WHERE account.id = calendar_backfill_jobs.account_id
                      AND account.email_link_id = calendar_backfill_jobs.email_link_id
                      AND account.sync_status <> 'disabled'
              )
              AND (
                  status = 'pending'
                  OR (
                      status = 'running'
                      AND lease_expires_at < now()
                  )
              )
            RETURNING account_id
            "#,
            key.job_id,
            key.email_link_id,
            lease_token,
            &required_scopes,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(report)?;
        if let Some(account_id) = claimed_account_id {
            let Some(account_id) = account_id else {
                tx.rollback().await.map_err(report)?;
                return Err(rootcause::report!(
                    "Google Calendar backfill job has no calendar account"
                ));
            };
            tx.commit().await.map_err(report)?;
            return Ok(CalendarBackfillClaim::Claimed {
                lease_token,
                account_id,
            });
        }

        let state = sqlx::query!(
            r#"
            SELECT status, account_id
            FROM calendar_backfill_jobs
            WHERE id = $1
              AND email_link_id = $2
              AND kind = 'google_calendar'
            "#,
            key.job_id,
            key.email_link_id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(report)?;
        if state
            .as_ref()
            .is_some_and(|state| state.account_id.is_none())
        {
            tx.rollback().await.map_err(report)?;
            return Err(rootcause::report!(
                "Google Calendar backfill job has no calendar account"
            ));
        }
        let claim = match state.as_ref().map(|state| state.status.as_str()) {
            Some("complete") => CalendarBackfillClaim::Complete,
            Some("running" | "pending") => CalendarBackfillClaim::Busy,
            Some("failed") => CalendarBackfillClaim::Failed,
            _ => CalendarBackfillClaim::NotFound,
        };
        tx.commit().await.map_err(report)?;
        Ok(claim)
    }

    #[tracing::instrument(skip(self), err)]
    async fn mark_google_account_syncing(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
    ) -> Result<(), Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        fence_google_mutation_tx(&mut tx, key, lease_token, None).await?;
        sqlx::query!(
            r#"
            UPDATE calendar_accounts
            SET sync_status = 'syncing',
                last_sync_error = NULL,
                updated_at = now()
            WHERE email_link_id = $1
            "#,
            key.email_link_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(report)?;
        tx.commit().await.map_err(report)
    }

    #[tracing::instrument(skip(self), err)]
    async fn maintain_google_backfill_lease(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
    ) -> Result<(), Report> {
        let required_scopes = GOOGLE_CALENDAR_SCOPES.map(str::to_owned);
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            let updated = sqlx::query!(
                r#"
                UPDATE calendar_backfill_jobs
                SET lease_expires_at = now() + interval '2 minutes',
                    updated_at = now()
                WHERE id = $1
                  AND email_link_id = $2
                  AND status = 'running'
                  AND lease_token = $3
                  AND lease_expires_at > now()
                  AND EXISTS (
                        SELECT 1
                        FROM email_link_google_scopes scopes
                        WHERE scopes.link_id = calendar_backfill_jobs.email_link_id
                          AND scopes.grant_version = calendar_backfill_jobs.grant_version
                          AND scopes.granted_scopes @> $4::text[]
                  )
                "#,
                key.job_id,
                key.email_link_id,
                lease_token,
                &required_scopes,
            )
            .execute(&self.pool)
            .await
            .map_err(report)?;
            if updated.rows_affected() != 1 {
                return Err(rootcause::report!(
                    "Google Calendar backfill lease was lost"
                ));
            }
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn complete_google_backfill(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
    ) -> Result<(), Report> {
        let required_scopes = GOOGLE_CALENDAR_SCOPES.map(str::to_owned);
        let mut tx = self.pool.begin().await.map_err(report)?;
        let completed = sqlx::query!(
            r#"
            UPDATE calendar_backfill_jobs
            SET status = 'complete',
                completed_at = now(),
                lease_token = NULL,
                lease_expires_at = NULL,
                updated_at = now()
            WHERE id = $1
              AND email_link_id = $2
              AND kind = 'google_calendar'
              AND status = 'running'
              AND lease_token = $3
              AND lease_expires_at > now()
              AND EXISTS (
                    SELECT 1
                    FROM email_link_google_scopes scopes
                    WHERE scopes.link_id = calendar_backfill_jobs.email_link_id
                      AND scopes.grant_version = calendar_backfill_jobs.grant_version
                      AND scopes.granted_scopes @> $4::text[]
              )
            "#,
            key.job_id,
            key.email_link_id,
            lease_token,
            &required_scopes,
        )
        .execute(&mut *tx)
        .await
        .map_err(report)?;
        if completed.rows_affected() != 1 {
            return Err(rootcause::report!(
                "Google Calendar backfill lease was lost"
            ));
        }
        sqlx::query!(
            r#"
            UPDATE calendar_accounts
            SET sync_status = 'ready',
                last_synced_at = now(),
                last_sync_error = NULL,
                updated_at = now()
            WHERE email_link_id = $1
            "#,
            key.email_link_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(report)?;
        tx.commit().await.map_err(report)?;
        Ok(())
    }

    #[tracing::instrument(skip(self, message), err)]
    async fn fail_google_backfill(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
        disposition: CalendarBackfillFailureDisposition,
        message: &str,
    ) -> Result<CalendarBackfillFailureOutcome, Report> {
        self.persist_google_backfill_failure(key, Some(lease_token), disposition, message)
            .await
    }
}

async fn invalidate_stale_google_jobs_tx(
    tx: &mut Transaction<'_, Postgres>,
    email_link_id: Uuid,
    current_grant_version: i64,
) -> Result<(), Report> {
    sqlx::query!(
        r#"
        WITH invalidated AS (
            UPDATE calendar_backfill_jobs
            SET status = 'failed',
                completed_at = now(),
                lease_token = NULL,
                lease_expires_at = NULL,
                last_error = 'superseded by a newer Google grant',
                updated_at = now()
            WHERE email_link_id = $1
              AND kind = 'google_calendar'
              AND grant_version <> $2
              AND status IN ('pending', 'running')
            RETURNING id
        )
        UPDATE calendar_sync_outbox outbox
        SET published_at = COALESCE(outbox.published_at, now())
        FROM invalidated
        WHERE outbox.backfill_job_id = invalidated.id
        "#,
        email_link_id,
        current_grant_version,
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    Ok(())
}

async fn clear_calendar_opt_out_tx(
    tx: &mut Transaction<'_, Postgres>,
    email_link_id: Uuid,
) -> Result<(), Report> {
    sqlx::query!(
        r#"
        UPDATE email_link_google_scopes
        SET calendar_disabled_at = NULL,
            updated_at = now()
        WHERE link_id = $1 AND calendar_disabled_at IS NOT NULL
        "#,
        email_link_id,
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    Ok(())
}

/// Retirements here are deliberately **not** returned for publication.
///
/// Both callers — a grant that lost its calendar scopes, and an explicit
/// disconnect — purge every event on the inbox at once, so per-event `Deleted`
/// topic messages would fan out to one message per event in the account.
/// Search documents for those events are consequently left stale; they are
/// invisible rather than leaked, because enrichment re-reads visibility from
/// Postgres and drops a hit whose row is gone. Removing them wants a
/// purge-by-owner operation, not this path.
async fn disable_google_calendar_capability_tx(
    tx: &mut Transaction<'_, Postgres>,
    email_link_id: Uuid,
) -> Result<(), Report> {
    let account_id = sqlx::query_scalar!(
        r#"
        UPDATE calendar_accounts
        SET sync_status = 'disabled',
            last_sync_error = 'Google Calendar permission is no longer granted',
            updated_at = now()
        WHERE email_link_id = $1
        RETURNING id
        "#,
        email_link_id,
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(report)?;
    let Some(account_id) = account_id else {
        return Ok(());
    };

    sqlx::query!(
        r#"
        UPDATE calendars
        SET is_deleted = true,
            sync_token = NULL,
            materialized_starts_at = NULL,
            materialized_ends_at = NULL,
            materialized_start_date = NULL,
            materialized_end_date = NULL,
            updated_at = now()
        WHERE account_id = $1
        "#,
        account_id,
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;

    let affected_event_ids = sqlx::query_scalar!(
        r#"
        WITH deleted_sources AS (
            DELETE FROM calendar_event_sources
            WHERE source_kind = 'google'
              AND account_id = $1
            RETURNING event_id
        )
        SELECT DISTINCT event_id AS "event_id!"
        FROM deleted_sources
        "#,
        account_id,
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(report)?;
    for event_id in &affected_event_ids {
        restore_best_source_or_delete(tx, *event_id).await?;
    }

    // Reminder delivery claims are deliberately not foreign-keyed to
    // occurrences, so an event that lost its last source takes its claims with
    // it here rather than leaving them behind forever.
    sqlx::query!(
        r#"
        DELETE FROM calendar_event_reminder_deliveries d
        WHERE d.event_id = ANY($1)
          AND NOT EXISTS (
                SELECT 1 FROM calendar_events e WHERE e.id = d.event_id
          )
        "#,
        &affected_event_ids,
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    Ok(())
}

async fn upsert_google_account_tx(
    tx: &mut Transaction<'_, Postgres>,
    email_link_id: Uuid,
    owner_id: &str,
    email_address: &str,
) -> Result<Uuid, Report> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO calendar_accounts (
            id, owner_id, email_link_id, provider, provider_account_id
        )
        VALUES ($1, $2, $3, 'google', $4)
        ON CONFLICT (email_link_id) DO UPDATE SET
            owner_id = EXCLUDED.owner_id,
            provider_account_id = EXCLUDED.provider_account_id,
            sync_status = CASE
                WHEN calendar_accounts.sync_status = 'disabled' THEN 'pending'
                ELSE calendar_accounts.sync_status
            END,
            last_sync_error = CASE
                WHEN calendar_accounts.sync_status = 'disabled' THEN NULL
                ELSE calendar_accounts.last_sync_error
            END,
            updated_at = now()
        RETURNING id
        "#,
        Uuid::now_v7(),
        owner_id,
        email_link_id,
        email_address,
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(report)
}

async fn retry_failed_backfills_tx(
    tx: &mut Transaction<'_, Postgres>,
    email_link_id: Uuid,
    grant_version: i64,
) -> Result<Vec<CalendarBackfillJob>, Report> {
    struct FailedJobRow {
        id: Uuid,
        account_id: Option<Uuid>,
        kind: String,
    }

    let failed = sqlx::query_as!(
        FailedJobRow,
        r#"
        UPDATE calendar_backfill_jobs
        SET status = 'pending',
            cursor = '{}',
            scanned_count = 0,
            extracted_count = 0,
            last_error = NULL,
            started_at = NULL,
            completed_at = NULL,
            lease_expires_at = NULL,
            updated_at = now()
        WHERE email_link_id = $1
          AND grant_version = $2
          AND status = 'failed'
          AND kind = 'google_calendar'
        RETURNING id, account_id, kind
        "#,
        email_link_id,
        grant_version,
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(report)?;

    let mut jobs = Vec::with_capacity(failed.len());
    for row in failed {
        sqlx::query!(
            r#"
            UPDATE calendar_sync_outbox
            SET published_at = NULL
            WHERE backfill_job_id = $1
            "#,
            row.id,
        )
        .execute(&mut **tx)
        .await
        .map_err(report)?;

        let kind = match row.kind.as_str() {
            "google_calendar" => CalendarBackfillKind::GoogleCalendar,
            _ => return Err(rootcause::report!("invalid calendar backfill kind")),
        };
        jobs.push(CalendarBackfillJob {
            id: row.id,
            email_link_id,
            account_id: row.account_id,
            kind,
            grant_version,
        });
    }
    Ok(jobs)
}

async fn persist_source(
    tx: &mut Transaction<'_, Postgres>,
    event_id: Uuid,
    upsert: &CalendarEventUpsert,
) -> Result<(), Report> {
    let normalized_payload =
        serde_json::to_value(StoredSourceProjection::from(upsert)).map_err(report)?;
    let CalendarEventSource::Google(source) = &upsert.source;
    sqlx::query!(
        r#"
                INSERT INTO calendar_event_sources (
                    id, event_id, source_link_id, source_kind, account_id, calendar_id,
                    provider_event_id, provider_recurring_event_id,
                    provider_etag, raw_payload, source_sequence,
                    source_updated_at, normalized_payload
                )
                VALUES (
                    $1, $2, $3, 'google', $4, $5, $6, $7, $8, $9,
                    $10, $11, $12
                )
                ON CONFLICT (account_id, calendar_id, provider_event_id)
                    WHERE source_kind = 'google'
                DO UPDATE SET
                    event_id = EXCLUDED.event_id,
                    provider_recurring_event_id = EXCLUDED.provider_recurring_event_id,
                    provider_etag = EXCLUDED.provider_etag,
                    raw_payload = EXCLUDED.raw_payload,
                    source_sequence = EXCLUDED.source_sequence,
                    source_updated_at = EXCLUDED.source_updated_at,
                    normalized_payload = EXCLUDED.normalized_payload,
                    last_seen_at = now()
                WHERE
                    EXCLUDED.source_sequence > calendar_event_sources.source_sequence
                    OR (
                        EXCLUDED.source_sequence = calendar_event_sources.source_sequence
                        AND EXCLUDED.source_updated_at >= calendar_event_sources.source_updated_at
                    )
                "#,
        Uuid::now_v7(),
        event_id,
        source.email_link_id,
        source.account_id,
        source.calendar_id,
        &source.provider_event_id,
        source.provider_recurring_event_id.as_deref(),
        source.provider_etag.as_deref(),
        &source.raw_payload,
        db_sequence(upsert.event.sequence)?,
        upsert.event.updated_at,
        &normalized_payload,
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    Ok(())
}

/// Rewrite an event from its next-best remaining source, or delete it when no
/// source is left, reporting which happened.
///
/// `None` means the row was already gone before this call.
async fn restore_best_source_or_delete(
    tx: &mut Transaction<'_, Postgres>,
    event_id: Uuid,
) -> Result<Option<RetiredCalendarEvent>, Report> {
    let identity = sqlx::query!(
        r#"
        SELECT source_link_id, ical_uid, owner_id
        FROM calendar_events
        WHERE id = $1
        "#,
        event_id,
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(report)?;
    let Some(identity) = identity else {
        return Ok(None);
    };
    let reconciliation_lock =
        event_reconciliation_lock(identity.source_link_id, &identity.ical_uid);
    sqlx::query_scalar!(
        r#"SELECT 1 AS "locked!" FROM pg_advisory_xact_lock($1)"#,
        reconciliation_lock,
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(report)?;

    let source = sqlx::query!(
        r#"
        SELECT source_kind, source_updated_at, normalized_payload, calendar_id
        FROM calendar_event_sources
        WHERE event_id = $1
        ORDER BY
            source_sequence DESC,
            source_updated_at DESC,
            last_seen_at DESC,
            id DESC
        LIMIT 1
        "#,
        event_id,
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(report)?;
    let Some(source) = source else {
        sqlx::query!("DELETE FROM calendar_events WHERE id = $1", event_id)
            .execute(&mut **tx)
            .await
            .map_err(report)?;
        return Ok(Some(RetiredCalendarEvent {
            event_id,
            owner_id: identity.owner_id,
            deleted: true,
        }));
    };

    let projection: StoredSourceProjection =
        serde_json::from_value(source.normalized_payload).map_err(report)?;
    let (starts_at, ends_at, start_date, end_date, time_zone) = split_time(&projection.event.time);
    sqlx::query!(
        r#"
        UPDATE calendar_events
        SET title = $2,
            description = $3,
            location = $4,
            status = $5,
            visibility = $6,
            transparency = $7,
            event_type = $28,
            starts_at = $8,
            ends_at = $9,
            start_date = $10,
            end_date = $11,
            time_zone = $12,
            recurrence_lines = $13,
            organizer_email = $14,
            organizer_name = $15,
            creator_email = $26,
            creator_name = $27,
            conference_url = $16,
            conference_provider = $25,
            sequence = $17,
            is_read_only = $18,
            canonical_source_kind = $19,
            canonical_source_updated_at = $20,
            reminders_use_default = $23,
            reminder_overrides = $24,
            created_at = $21,
            updated_at = GREATEST(calendar_events.updated_at, $22)
        WHERE id = $1
        "#,
        event_id,
        &projection.event.title,
        projection.event.description.as_deref(),
        projection.event.location.as_deref(),
        projection.event.status.as_str(),
        projection.event.visibility.as_str(),
        projection.event.transparency.as_str(),
        starts_at,
        ends_at,
        start_date,
        end_date,
        time_zone,
        &projection.event.recurrence_lines,
        projection.event.organizer_email.as_deref(),
        projection.event.organizer_name.as_deref(),
        projection.event.conference_url.as_deref(),
        db_sequence(projection.event.sequence)?,
        projection.event.is_read_only,
        &source.source_kind,
        source.source_updated_at,
        projection.event.created_at,
        projection.event.updated_at,
        projection.event.reminders.use_default,
        serde_json::to_value(&projection.event.reminders.overrides).map_err(report)?,
        projection
            .event
            .conference_provider
            .map(ConferenceProvider::as_str),
        projection.event.creator_email.as_deref(),
        projection.event.creator_name.as_deref(),
        projection.event.event_type.as_str(),
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    replace_attendees(tx, event_id, &projection.event.attendees).await?;
    replace_overrides(tx, event_id, &projection.overrides).await?;
    replace_occurrences(
        tx,
        event_id,
        &projection.event.owner_id,
        &projection.occurrences,
    )
    .await?;
    let calendar = fetch_calendar_reminder_context(tx, source.calendar_id).await?;
    rebuild_event_reminder_firings(
        tx,
        event_id,
        projection.event.status,
        projection.event.event_type,
        &projection.event.reminders,
        calendar.as_ref(),
    )
    .await?;
    Ok(Some(RetiredCalendarEvent {
        event_id,
        owner_id: identity.owner_id,
        deleted: false,
    }))
}

async fn replace_attendees(
    tx: &mut Transaction<'_, Postgres>,
    event_id: Uuid,
    attendees: &[CalendarAttendee],
) -> Result<(), Report> {
    sqlx::query!(
        "DELETE FROM calendar_event_attendees WHERE event_id = $1",
        event_id
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    for attendee in attendees {
        sqlx::query!(
            r#"
            INSERT INTO calendar_event_attendees (
                event_id, email, display_name, response_status,
                is_organizer, is_optional, is_self, comment
            )
            VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8)
            ON CONFLICT (event_id, email) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                response_status = EXCLUDED.response_status,
                is_organizer = EXCLUDED.is_organizer,
                is_optional = EXCLUDED.is_optional,
                is_self = EXCLUDED.is_self,
                comment = EXCLUDED.comment
            "#,
            event_id,
            &attendee.email,
            attendee.display_name.as_deref(),
            attendee.response_status.as_str(),
            attendee.is_organizer,
            attendee.is_optional,
            attendee.is_self,
            attendee.comment.as_deref(),
        )
        .execute(&mut **tx)
        .await
        .map_err(report)?;
    }
    Ok(())
}

async fn replace_overrides(
    tx: &mut Transaction<'_, Postgres>,
    event_id: Uuid,
    overrides: &[CalendarEventOverride],
) -> Result<(), Report> {
    sqlx::query!(
        "DELETE FROM calendar_event_overrides WHERE event_id = $1",
        event_id
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    for event_override in overrides {
        let (starts_at, ends_at, start_date, end_date, _time_zone) =
            split_time(&event_override.time);
        let (original_starts_at, original_start_date) = match event_override.original_time {
            EventStart::Timed(value) => (Some(value), None),
            EventStart::AllDay(value) => (None, Some(value)),
        };
        sqlx::query!(
            r#"
            INSERT INTO calendar_event_overrides (
                event_id, recurrence_id, original_starts_at, original_start_date,
                starts_at, ends_at, start_date, end_date,
                title, description, location, status, attendees_overridden
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            "#,
            event_id,
            &event_override.recurrence_id,
            original_starts_at,
            original_start_date,
            starts_at,
            ends_at,
            start_date,
            end_date,
            event_override.title.as_deref(),
            event_override.description.as_deref(),
            event_override.location.as_deref(),
            event_override.status.map(EventStatus::as_str),
            event_override.attendees.is_some(),
        )
        .execute(&mut **tx)
        .await
        .map_err(report)?;
        for attendee in event_override.attendees.iter().flatten() {
            sqlx::query!(
                r#"
                INSERT INTO calendar_event_override_attendees (
                    event_id, recurrence_id, email, display_name, response_status,
                    is_organizer, is_optional, is_self, comment
                )
                VALUES ($1, $2, lower($3), $4, $5, $6, $7, $8, $9)
                ON CONFLICT (event_id, recurrence_id, email) DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    response_status = EXCLUDED.response_status,
                    is_organizer = EXCLUDED.is_organizer,
                    is_optional = EXCLUDED.is_optional,
                    is_self = EXCLUDED.is_self,
                    comment = EXCLUDED.comment
                "#,
                event_id,
                &event_override.recurrence_id,
                &attendee.email,
                attendee.display_name.as_deref(),
                attendee.response_status.as_str(),
                attendee.is_organizer,
                attendee.is_optional,
                attendee.is_self,
                attendee.comment.as_deref(),
            )
            .execute(&mut **tx)
            .await
            .map_err(report)?;
        }
    }
    Ok(())
}

async fn replace_occurrences(
    tx: &mut Transaction<'_, Postgres>,
    event_id: Uuid,
    owner_id: &str,
    occurrences: &[CalendarOccurrence],
) -> Result<(), Report> {
    sqlx::query!(
        "DELETE FROM calendar_event_occurrences WHERE event_id = $1",
        event_id
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    for occurrence in occurrences {
        let (starts_at, ends_at, start_date, end_date, _time_zone) = split_time(&occurrence.time);
        sqlx::query!(
            r#"
            INSERT INTO calendar_event_occurrences (
                event_id, owner_id, occurrence_key, recurrence_id,
                starts_at, ends_at, start_date, end_date, is_cancelled
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
            event_id,
            owner_id,
            &occurrence.occurrence_key,
            occurrence.recurrence_id.as_deref(),
            starts_at,
            ends_at,
            start_date,
            end_date,
            occurrence.is_cancelled,
        )
        .execute(&mut **tx)
        .await
        .map_err(report)?;
    }
    Ok(())
}

/// Calendar state a reminder firing schedule depends on: the zone that
/// anchors all-day starts and the defaults `useDefault` events resolve to.
struct CalendarReminderContext {
    time_zone: Option<String>,
    default_reminders: Vec<EventReminderOverride>,
}

async fn fetch_calendar_reminder_context(
    tx: &mut Transaction<'_, Postgres>,
    calendar_id: Option<Uuid>,
) -> Result<Option<CalendarReminderContext>, Report> {
    let Some(calendar_id) = calendar_id else {
        return Ok(None);
    };
    let row = sqlx::query!(
        r#"SELECT time_zone, default_reminders FROM calendars WHERE id = $1"#,
        calendar_id,
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(report)?;
    Ok(row.map(|row| CalendarReminderContext {
        time_zone: row.time_zone,
        // This feeds the firing schedule: a malformed value silently drops
        // every default reminder on the calendar, so it must leave a trace.
        default_reminders: serde_json::from_value(row.default_reminders)
            .inspect_err(|e| {
                tracing::error!(error = ?e, %calendar_id, "malformed calendar default_reminders json");
            })
            .unwrap_or_default(),
    }))
}

/// The zone that anchors an all-day occurrence's midnight, validated against
/// the server's own tzdata. Google resolves all-day reminders against the
/// calendar's zone; a zone the server does not know falls back to UTC rather
/// than failing the write. chrono-tz and Postgres carry independent IANA
/// copies, so client-side parsing alone cannot guarantee `AT TIME ZONE`
/// accepts the name.
async fn anchor_time_zone(
    tx: &mut Transaction<'_, Postgres>,
    zone: Option<&str>,
) -> Result<String, Report> {
    let Some(zone) = zone.filter(|zone| *zone != "UTC") else {
        return Ok("UTC".to_owned());
    };
    let known = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $1) AS "known!""#,
        zone,
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(report)?;
    if known {
        Ok(zone.to_owned())
    } else {
        tracing::warn!(
            zone,
            "calendar time zone unknown to postgres, anchoring all-day reminders at UTC"
        );
        Ok("UTC".to_owned())
    }
}

/// Rebuild one event's reminder firing schedule from its just-replaced
/// occurrences and resolved popup offsets. Runs inside the canonical
/// replacement transaction so the schedule can never disagree with the
/// projections it derives from. Recently past firings are kept so the sweep's
/// grace window still sees them; delivery claims live in the deliveries table
/// and survive this rebuild.
async fn rebuild_event_reminder_firings(
    tx: &mut Transaction<'_, Postgres>,
    event_id: Uuid,
    status: EventStatus,
    event_type: EventType,
    reminders: &EventReminders,
    calendar: Option<&CalendarReminderContext>,
) -> Result<(), Report> {
    sqlx::query!(
        "DELETE FROM calendar_event_reminder_firings WHERE event_id = $1",
        event_id,
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    if status == EventStatus::Cancelled {
        return Ok(());
    }
    let defaults = if event_type.uses_calendar_default_reminders() {
        calendar.map_or(&[] as &[_], |calendar| &calendar.default_reminders)
    } else {
        &[]
    };
    let minutes: Vec<i32> = reminders
        .popup_minutes(defaults)
        .into_iter()
        .filter_map(|minutes| i32::try_from(minutes).ok())
        .collect();
    if minutes.is_empty() {
        return Ok(());
    }
    let time_zone = anchor_time_zone(
        tx,
        calendar.and_then(|calendar| calendar.time_zone.as_deref()),
    )
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO calendar_event_reminder_firings (
            event_id, occurrence_key, minutes_before, fire_at
        )
        SELECT
            occurrence.event_id,
            occurrence.occurrence_key,
            offsets.minutes,
            COALESCE(
                occurrence.starts_at,
                occurrence.start_date::timestamp AT TIME ZONE $3
            ) - make_interval(mins => offsets.minutes)
        FROM calendar_event_occurrences occurrence
        CROSS JOIN UNNEST($2::int[]) AS offsets(minutes)
        WHERE occurrence.event_id = $1
          AND NOT occurrence.is_cancelled
          AND COALESCE(
                occurrence.starts_at,
                occurrence.start_date::timestamp AT TIME ZONE $3
              ) - make_interval(mins => offsets.minutes) > now() - interval '1 day'
        "#,
        event_id,
        &minutes,
        time_zone,
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    Ok(())
}

/// Rebuild the firing schedule for every event whose canonical source lives
/// on one calendar, after its default reminders or time zone changed.
/// Set-based because a defaults change fans out to every `useDefault` event
/// on the calendar. Both statements rank sources exactly like
/// `restore_best_source_or_delete` and the read path: an event that also
/// holds a secondary source on this calendar keeps the schedule its
/// canonical calendar derived.
async fn rebuild_calendar_reminder_firings(
    tx: &mut Transaction<'_, Postgres>,
    calendar_id: Uuid,
    time_zone: Option<&str>,
    default_reminders: &serde_json::Value,
) -> Result<(), Report> {
    sqlx::query!(
        r#"
        DELETE FROM calendar_event_reminder_firings firing
        USING calendar_event_sources source
        WHERE source.event_id = firing.event_id
          AND source.calendar_id = $1
          AND (
              SELECT canonical.calendar_id
              FROM calendar_event_sources canonical
              WHERE canonical.event_id = firing.event_id
              ORDER BY
                  canonical.source_sequence DESC,
                  canonical.source_updated_at DESC,
                  canonical.last_seen_at DESC,
                  canonical.id DESC
              LIMIT 1
          ) = $1
        "#,
        calendar_id,
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    let anchor_zone = anchor_time_zone(tx, time_zone).await?;
    sqlx::query!(
        r#"
        INSERT INTO calendar_event_reminder_firings (
            event_id, occurrence_key, minutes_before, fire_at
        )
        SELECT DISTINCT
            occurrence.event_id,
            occurrence.occurrence_key,
            offsets.minutes,
            COALESCE(
                occurrence.starts_at,
                occurrence.start_date::timestamp AT TIME ZONE $2
            ) - make_interval(mins => offsets.minutes)
        FROM calendar_event_sources source
        JOIN calendar_events event ON event.id = source.event_id
        JOIN calendar_event_occurrences occurrence ON occurrence.event_id = event.id
        CROSS JOIN LATERAL (
            SELECT (reminder.value ->> 'minutes')::int AS minutes
            FROM jsonb_array_elements(
                CASE
                    -- Status-style events never resolve the calendar
                    -- defaults, mirroring EventType::uses_calendar_default_reminders.
                    WHEN event.reminders_use_default
                        AND event.event_type IN ('default', 'from_gmail')
                        THEN $3::jsonb
                    WHEN event.reminders_use_default THEN '[]'::jsonb
                    ELSE event.reminder_overrides
                END
            ) AS reminder(value)
            WHERE reminder.value ->> 'method' = 'popup'
              AND (reminder.value ->> 'minutes')::int >= 0
        ) offsets
        WHERE source.calendar_id = $1
          AND (
              SELECT canonical.calendar_id
              FROM calendar_event_sources canonical
              WHERE canonical.event_id = event.id
              ORDER BY
                  canonical.source_sequence DESC,
                  canonical.source_updated_at DESC,
                  canonical.last_seen_at DESC,
                  canonical.id DESC
              LIMIT 1
          ) = $1
          AND event.status <> 'cancelled'
          AND NOT occurrence.is_cancelled
          AND COALESCE(
                occurrence.starts_at,
                occurrence.start_date::timestamp AT TIME ZONE $2
              ) - make_interval(mins => offsets.minutes) > now() - interval '1 day'
        ON CONFLICT (event_id, occurrence_key, minutes_before) DO NOTHING
        "#,
        calendar_id,
        anchor_zone,
        default_reminders,
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    Ok(())
}

async fn fetch_attendees(
    pool: &PgPool,
    event_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<CalendarAttendee>>, Report> {
    if event_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = sqlx::query_as!(
        AttendeeRow,
        r#"
        SELECT
            event_id, email, display_name, response_status,
            is_organizer, is_optional, is_self, comment
        FROM calendar_event_attendees
        WHERE event_id = ANY($1)
        ORDER BY event_id, email
        "#,
        event_ids,
    )
    .fetch_all(pool)
    .await
    .map_err(report)?;
    let mut by_event = HashMap::new();
    for row in rows {
        by_event
            .entry(row.event_id)
            .or_insert_with(Vec::new)
            .push(CalendarAttendee {
                email: row.email,
                display_name: row.display_name,
                response_status: attendee_status(&row.response_status),
                is_organizer: row.is_organizer,
                is_optional: row.is_optional,
                is_self: row.is_self,
                comment: row.comment,
            });
    }
    Ok(by_event)
}

/// Per-occurrence attendee overrides for the supplied events, keyed by
/// `(event_id, recurrence_id)`.
async fn fetch_override_attendees(
    pool: &PgPool,
    event_ids: &[Uuid],
) -> Result<HashMap<(Uuid, String), Vec<CalendarAttendee>>, Report> {
    if event_ids.is_empty() {
        return Ok(HashMap::new());
    }
    // Driven from the overrides table so an explicitly-empty replacement
    // list still produces a map entry: absence of an entry means "inherit
    // the series attendees", never "the exception has no attendees".
    let rows = sqlx::query_as!(
        OverrideAttendeeRow,
        r#"
        SELECT
            override.event_id,
            override.recurrence_id,
            attendee.email AS "email?",
            attendee.display_name,
            attendee.response_status AS "response_status?",
            attendee.is_organizer AS "is_organizer?",
            attendee.is_optional AS "is_optional?",
            attendee.is_self AS "is_self?",
            attendee.comment
        FROM calendar_event_overrides override
        LEFT JOIN calendar_event_override_attendees attendee
            ON attendee.event_id = override.event_id
           AND attendee.recurrence_id = override.recurrence_id
        WHERE override.event_id = ANY($1)
          AND override.attendees_overridden
        ORDER BY override.event_id, override.recurrence_id, attendee.email
        "#,
        event_ids,
    )
    .fetch_all(pool)
    .await
    .map_err(report)?;
    let mut by_occurrence: HashMap<(Uuid, String), Vec<CalendarAttendee>> = HashMap::new();
    for row in rows {
        let attendees = by_occurrence
            .entry((row.event_id, row.recurrence_id))
            .or_default();
        if let (Some(email), Some(response_status)) = (row.email, row.response_status) {
            attendees.push(CalendarAttendee {
                email,
                display_name: row.display_name,
                response_status: attendee_status(&response_status),
                is_organizer: row.is_organizer.unwrap_or_default(),
                is_optional: row.is_optional.unwrap_or_default(),
                is_self: row.is_self.unwrap_or_default(),
                comment: row.comment,
            });
        }
    }
    Ok(by_occurrence)
}

type SplitTime = (
    Option<DateTime<Utc>>,
    Option<DateTime<Utc>>,
    Option<NaiveDate>,
    Option<NaiveDate>,
    Option<String>,
);

fn split_time(time: &EventTime) -> SplitTime {
    match time {
        EventTime::Timed {
            starts_at,
            ends_at,
            time_zone,
        } => (
            Some(*starts_at),
            Some(*ends_at),
            None,
            None,
            time_zone.clone(),
        ),
        EventTime::AllDay {
            start_date,
            end_date,
        } => (None, None, Some(*start_date), Some(*end_date), None),
    }
}

fn row_time(
    starts_at: Option<DateTime<Utc>>,
    ends_at: Option<DateTime<Utc>>,
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
    time_zone: Option<String>,
) -> Result<EventTime, Report> {
    match (starts_at, ends_at, start_date, end_date) {
        (Some(starts_at), Some(ends_at), None, None) => Ok(EventTime::Timed {
            starts_at,
            ends_at,
            time_zone,
        }),
        (None, None, Some(start_date), Some(end_date)) => Ok(EventTime::AllDay {
            start_date,
            end_date,
        }),
        _ => Err(rootcause::report!(
            "invalid calendar time shape in database"
        )),
    }
}

fn mention_preview_from_row(row: MentionPreviewRow) -> Result<CalendarMentionPreview, Report> {
    if !row.mention_exists {
        return Ok(CalendarMentionPreview::DoesNotExist);
    }
    let Some(viewer_event_id) = row.viewer_event_id else {
        return Ok(CalendarMentionPreview::NoAccess);
    };
    let time = if row.occurrence_key.is_some() {
        row_time(
            row.occurrence_starts_at,
            row.occurrence_ends_at,
            row.occurrence_start_date,
            row.occurrence_end_date,
            row.time_zone,
        )?
    } else {
        // No materialized instance (the event sits outside the maintained
        // window) — the series' own span still gives the preview a time.
        row_time(
            row.event_starts_at,
            row.event_ends_at,
            row.event_start_date,
            row.event_end_date,
            row.time_zone,
        )?
    };
    Ok(CalendarMentionPreview::Accessible(Box::new(
        CalendarMentionEvent {
            viewer_event_id,
            title: row.title.unwrap_or_default(),
            time,
            occurrence_key: row.occurrence_key,
            is_recurring: !row.recurrence_lines.unwrap_or_default().is_empty(),
            location: row.location,
            organizer_email: row.organizer_email,
            organizer_name: row.organizer_name,
            attendee_count: usize::try_from(row.attendee_count.unwrap_or_default())
                .unwrap_or_default(),
            updated_at: row.updated_at.unwrap_or(DateTime::<Utc>::MIN_UTC),
        },
    )))
}

fn event_from_join(
    row: OccurrenceJoinRow,
    attendees: Vec<CalendarAttendee>,
) -> Result<CalendarEvent, Report> {
    Ok(CalendarEvent {
        id: row.event_id,
        owner_id: row.owner_id,
        ical_uid: row.ical_uid,
        calendar_id: row.canonical_calendar_id,
        title: row.title,
        description: row.description,
        location: row.location,
        status: event_status(&row.status),
        visibility: event_visibility(&row.visibility),
        transparency: event_transparency(&row.transparency),
        event_type: event_type(&row.event_type),
        time: row_time(
            row.starts_at,
            row.ends_at,
            row.start_date,
            row.end_date,
            row.time_zone,
        )?,
        recurrence_lines: row.recurrence_lines,
        organizer_email: row.organizer_email,
        organizer_name: row.organizer_name,
        creator_email: row.creator_email,
        creator_name: row.creator_name,
        conference_url: row.conference_url,
        conference_provider: row.conference_provider.as_deref().map(conference_provider),
        sequence: u32::try_from(row.sequence).unwrap_or_default(),
        is_read_only: row.is_read_only,
        reminders: EventReminders {
            use_default: row.reminders_use_default,
            overrides: serde_json::from_value(row.reminder_overrides)
                .inspect_err(|e| {
                    tracing::error!(error = ?e, event_id = %row.event_id, "malformed event reminder_overrides json");
                })
                .unwrap_or_default(),
        },
        attendees,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn occurrence_from_join(row: &OccurrenceJoinRow) -> Result<CalendarOccurrence, Report> {
    Ok(CalendarOccurrence {
        event_id: row.event_id,
        occurrence_key: row.occurrence_key.clone(),
        recurrence_id: row.recurrence_id.clone(),
        time: row_time(
            row.occurrence_starts_at,
            row.occurrence_ends_at,
            row.occurrence_start_date,
            row.occurrence_end_date,
            None,
        )?,
        is_cancelled: row.is_cancelled,
    })
}

fn event_status(value: &str) -> EventStatus {
    match value {
        "tentative" => EventStatus::Tentative,
        "cancelled" => EventStatus::Cancelled,
        _ => EventStatus::Confirmed,
    }
}

fn event_visibility(value: &str) -> EventVisibility {
    match value {
        "public" => EventVisibility::Public,
        "private" => EventVisibility::Private,
        "confidential" => EventVisibility::Confidential,
        _ => EventVisibility::Default,
    }
}

/// Parse the stored provider, treating an unknown value as a third-party
/// conference so a row written by a newer deployment stays joinable and is
/// never mistaken for one Macro may detach.
fn conference_provider(value: &str) -> ConferenceProvider {
    if value == "google_meet" {
        ConferenceProvider::GoogleMeet
    } else {
        ConferenceProvider::Other
    }
}

fn event_transparency(value: &str) -> EventTransparency {
    if value == "transparent" {
        EventTransparency::Transparent
    } else {
        EventTransparency::Opaque
    }
}

fn event_type(value: &str) -> EventType {
    match value {
        "out_of_office" => EventType::OutOfOffice,
        "focus_time" => EventType::FocusTime,
        "working_location" => EventType::WorkingLocation,
        "birthday" => EventType::Birthday,
        "from_gmail" => EventType::FromGmail,
        _ => EventType::Default,
    }
}

fn attendee_status(value: &str) -> AttendeeResponseStatus {
    match value {
        "accepted" => AttendeeResponseStatus::Accepted,
        "declined" => AttendeeResponseStatus::Declined,
        "tentative" => AttendeeResponseStatus::Tentative,
        _ => AttendeeResponseStatus::NeedsAction,
    }
}

/// Strip the volatile identifiers a fresh normalization mints (the proposed
/// entity id and its occurrence back-references) so two projections of the
/// same provider state compare equal.
fn canonical_projection(value: &serde_json::Value) -> serde_json::Value {
    let mut value = value.clone();
    if let Some(event) = value.get_mut("event").and_then(|event| event.get_mut("id")) {
        *event = serde_json::Value::Null;
    }
    if let Some(occurrences) = value.get_mut("occurrences").and_then(|v| v.as_array_mut()) {
        for occurrence in occurrences {
            if let Some(id) = occurrence.get_mut("eventId") {
                *id = serde_json::Value::Null;
            }
        }
    }
    value
}

fn report(error: impl std::error::Error + Send + Sync + 'static) -> Report {
    rootcause::report!(error).into()
}

fn db_sequence(sequence: u32) -> Result<i32, Report> {
    i32::try_from(sequence).map_err(|_| {
        rootcause::report!(
            "calendar event sequence {sequence} overflows the database representation"
        )
    })
}

/// How stale a firing may be and still alert. A late reminder for a meeting
/// already underway is noise; anything the dispatcher missed by more than
/// this window is silently dropped rather than delivered hours late.
const REMINDER_SWEEP_GRACE: chrono::Duration = chrono::Duration::minutes(30);

impl CalendarReminderDispatchRepo for PgCalendarRepository {
    #[tracing::instrument(err, skip(self))]
    async fn due_reminder_firings(
        &self,
        now: DateTime<Utc>,
        after: Option<&CalendarReminderFiring>,
        limit: i64,
    ) -> Result<Vec<CalendarReminderFiring>, Report> {
        // Driven by `calendar_event_reminder_firings_due_idx`. A completed
        // delivery claim is what makes a delivered firing stop being due; a
        // held-but-unfinished claim still sweeps, and loses the claim race at
        // delivery instead. The keyset resumes past `after` because nothing
        // marks a swept firing — re-running the window from the top would
        // return the same rows forever.
        let rows = sqlx::query!(
            r#"
            SELECT firing.event_id, firing.occurrence_key, firing.minutes_before, firing.fire_at
            FROM calendar_event_reminder_firings firing
            WHERE firing.fire_at <= $1
              AND firing.fire_at > $2
              AND (
                  $4::timestamptz IS NULL
                  OR (firing.fire_at, firing.event_id, firing.minutes_before, firing.occurrence_key)
                     > ($4, $5, $6, $7)
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM calendar_event_reminder_deliveries delivery
                  WHERE delivery.event_id = firing.event_id
                    AND delivery.occurrence_key = firing.occurrence_key
                    AND delivery.minutes_before = firing.minutes_before
                    AND delivery.fire_at = firing.fire_at
                    AND delivery.sent_at IS NOT NULL
              )
            ORDER BY firing.fire_at, firing.event_id, firing.minutes_before, firing.occurrence_key
            LIMIT $3
            "#,
            now,
            now - REMINDER_SWEEP_GRACE,
            limit,
            after.map(|firing| firing.fire_at),
            after.map(|firing| firing.event_id),
            after.map(|firing| firing.minutes_before),
            after.map(|firing| firing.occurrence_key.as_str()),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(report)?;

        Ok(rows
            .into_iter()
            .map(|row| CalendarReminderFiring {
                event_id: row.event_id,
                occurrence_key: row.occurrence_key,
                minutes_before: row.minutes_before,
                fire_at: row.fire_at,
            })
            .collect())
    }

    #[tracing::instrument(err, skip(self))]
    async fn find_due_reminder(
        &self,
        firing: &CalendarReminderFiring,
    ) -> Result<Option<DueCalendarReminder>, Report> {
        // Matching the firing row exactly — including `fire_at` — is what
        // makes a stale message safe: a moved event replaced its schedule
        // rows, and this then finds nothing rather than alerting at a time
        // that no longer exists. The canonical-source lateral mirrors the
        // read path so a deleted calendar or disabled account stops alerts.
        // The grace bound is re-applied here because firing rows outlive the
        // sweep window: a Deliver message that sat in the queue past the
        // grace must drop, not alert hours late.
        let stale_before = Utc::now() - REMINDER_SWEEP_GRACE;
        let row = sqlx::query!(
            r#"
            SELECT
                event.owner_id,
                event.title,
                event.time_zone AS "event_time_zone?",
                occurrence.starts_at,
                occurrence.ends_at,
                occurrence.start_date,
                occurrence.end_date,
                canonical_source.calendar_time_zone AS "calendar_time_zone?",
                CASE WHEN EXISTS (
                        SELECT 1
                        FROM calendar_event_overrides override
                        WHERE override.event_id = event.id
                          AND override.recurrence_id = occurrence.recurrence_id
                          AND override.attendees_overridden
                     )
                     THEN EXISTS (
                        SELECT 1
                        FROM calendar_event_override_attendees attendee
                        JOIN email_links owner_inbox
                          ON owner_inbox.macro_id = event.owner_id
                         AND lower(owner_inbox.email_address::text) = attendee.email
                        WHERE attendee.event_id = event.id
                          AND attendee.recurrence_id = occurrence.recurrence_id
                          AND attendee.response_status = 'declined'
                     )
                     ELSE EXISTS (
                        SELECT 1
                        FROM calendar_event_attendees attendee
                        JOIN email_links owner_inbox
                          ON owner_inbox.macro_id = event.owner_id
                         AND lower(owner_inbox.email_address::text) = attendee.email
                        WHERE attendee.event_id = event.id
                          AND attendee.response_status = 'declined'
                     )
                END AS "declined!"
            FROM calendar_event_reminder_firings firing
            JOIN calendar_events event ON event.id = firing.event_id
            JOIN calendar_event_occurrences occurrence
                ON occurrence.event_id = firing.event_id
               AND occurrence.occurrence_key = firing.occurrence_key
            JOIN LATERAL (
                SELECT calendar.time_zone AS calendar_time_zone
                FROM calendar_event_sources source
                JOIN calendars calendar ON calendar.id = source.calendar_id
                JOIN calendar_accounts account ON account.id = source.account_id
                WHERE source.event_id = event.id
                  AND NOT calendar.is_deleted
                  AND account.sync_status <> 'disabled'
                ORDER BY
                    source.source_sequence DESC,
                    source.source_updated_at DESC,
                    source.last_seen_at DESC,
                    source.id DESC
                LIMIT 1
            ) canonical_source ON true
            WHERE firing.event_id = $1
              AND firing.occurrence_key = $2
              AND firing.minutes_before = $3
              AND firing.fire_at = $4
              AND firing.fire_at > $5
              AND event.status <> 'cancelled'
              AND NOT occurrence.is_cancelled
            "#,
            firing.event_id,
            &firing.occurrence_key,
            firing.minutes_before,
            firing.fire_at,
            stale_before,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(report)?;

        let Some(row) = row else {
            return Ok(None);
        };
        let time = row_time(
            row.starts_at,
            row.ends_at,
            row.start_date,
            row.end_date,
            row.event_time_zone.clone(),
        )?;
        Ok(Some(DueCalendarReminder {
            firing: firing.clone(),
            owner_id: row.owner_id,
            title: row.title,
            time,
            display_time_zone: row.event_time_zone.or(row.calendar_time_zone),
            declined: row.declined,
        }))
    }

    #[tracing::instrument(err, skip(self))]
    async fn claim_reminder_delivery(
        &self,
        firing: &CalendarReminderFiring,
        retry_before: DateTime<Utc>,
    ) -> Result<bool, Report> {
        // One statement covers both a first claim and a retry. The unique
        // index on the firing identity makes the insert the claim; the
        // conflict branch takes over a claim made before `retry_before` and
        // never completed, so a dispatcher that died mid-flight does not
        // strand the firing. Already sent or still fresh matches neither.
        let claimed = sqlx::query_scalar!(
            r#"
            INSERT INTO calendar_event_reminder_deliveries (
                id, event_id, occurrence_key, minutes_before, fire_at
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (event_id, occurrence_key, minutes_before, fire_at) DO UPDATE
               SET created_at = now()
             WHERE calendar_event_reminder_deliveries.sent_at IS NULL
               AND calendar_event_reminder_deliveries.created_at < $6
            RETURNING id
            "#,
            Uuid::now_v7(),
            firing.event_id,
            &firing.occurrence_key,
            firing.minutes_before,
            firing.fire_at,
            retry_before,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(report)?;

        Ok(claimed.is_some())
    }

    #[tracing::instrument(err, skip(self))]
    async fn release_reminder_delivery(
        &self,
        firing: &CalendarReminderFiring,
    ) -> Result<(), Report> {
        // `sent_at IS NULL` guards against releasing a firing that did go
        // out: completion and release can only race if the same firing is
        // handled twice, and the delivered one must win.
        sqlx::query!(
            r#"
            DELETE FROM calendar_event_reminder_deliveries
            WHERE event_id = $1
              AND occurrence_key = $2
              AND minutes_before = $3
              AND fire_at = $4
              AND sent_at IS NULL
            "#,
            firing.event_id,
            &firing.occurrence_key,
            firing.minutes_before,
            firing.fire_at,
        )
        .execute(&self.pool)
        .await
        .map_err(report)?;

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn complete_reminder_delivery(
        &self,
        firing: &CalendarReminderFiring,
    ) -> Result<(), Report> {
        sqlx::query!(
            r#"
            UPDATE calendar_event_reminder_deliveries
            SET sent_at = now()
            WHERE event_id = $1
              AND occurrence_key = $2
              AND minutes_before = $3
              AND fire_at = $4
            "#,
            firing.event_id,
            &firing.occurrence_key,
            firing.minutes_before,
            firing.fire_at,
        )
        .execute(&self.pool)
        .await
        .map_err(report)?;

        Ok(())
    }
}

fn event_reconciliation_lock(source_link_id: Uuid, ical_uid: &str) -> i64 {
    // Stable FNV-1a produces the same advisory-lock key in every service
    // process. A collision only adds harmless serialization.
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in source_link_id
        .as_bytes()
        .iter()
        .copied()
        .chain(ical_uid.bytes())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    i64::from_ne_bytes(hash.to_ne_bytes())
}

#[cfg(test)]
mod test;
