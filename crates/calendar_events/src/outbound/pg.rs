//! PostgreSQL implementation of the calendar repository port.

use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use rootcause::Report;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::domain::{
    models::{
        AppliedGoogleGrant, AttendeeResponseStatus, CalendarAttendee, CalendarBackfillClaim,
        CalendarBackfillFailureDisposition, CalendarBackfillFailureOutcome, CalendarBackfillJob,
        CalendarBackfillJobKey, CalendarBackfillKind, CalendarCreationTarget, CalendarEvent,
        CalendarEventMutationTarget, CalendarEventOverride, CalendarEventSource,
        CalendarEventUpsert, CalendarLinkTokenIdentity, CalendarOccurrence,
        CalendarOccurrenceCursor, CalendarSyncStatus, EventStart, EventStatus, EventTime,
        EventTransparency, EventVisibility, GOOGLE_CALENDAR_SCOPES, GoogleCalendarSyncSnapshot,
        GoogleScopeSet, GoogleWatchChannel, OccurrenceRange, ProviderCalendar,
        StoredGoogleCalendar, VisibleCalendar,
    },
    ports::{
        CalendarBackfillRepository, CalendarEventWrite, CalendarRepository,
        GoogleCalendarSyncRepository,
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
        self.upsert_event(CalendarEventWrite::Fixture(upsert)).await
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
                COALESCE(g.grant_version, 0) AS "grant_version!"
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
    starts_at: Option<DateTime<Utc>>,
    ends_at: Option<DateTime<Utc>>,
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
    time_zone: Option<String>,
    recurrence_lines: Vec<String>,
    organizer_email: Option<String>,
    organizer_name: Option<String>,
    conference_url: Option<String>,
    sequence: i32,
    is_read_only: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
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
                COALESCE(g.grant_version, 0) AS "grant_version!"
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

        let old_scopes = GoogleScopeSet::from_scopes(row.granted_scopes);
        let had_calendar_capability = old_scopes.has_calendar_capability();
        let changed = old_scopes != scopes;
        if !changed {
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
                updated_at = now()
            "#,
            email_link_id,
            &granted_scopes,
            grant_version,
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

    #[tracing::instrument(skip(self, write), err)]
    async fn upsert_event(&self, write: CalendarEventWrite) -> Result<Uuid, Report> {
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
                return Ok(row.event_id);
            }
        }

        let (starts_at, ends_at, start_date, end_date, time_zone) = split_time(&upsert.event.time);
        let proposed_id = upsert.event.id;

        // Google is the authoritative source when the same RFC UID was first
        // discovered in email. Email can still create/update entities that do
        // not yet have a Google source.
        let applied_id = sqlx::query_scalar!(
            r#"
            INSERT INTO calendar_events (
                id, owner_id, source_link_id, ical_uid, title, description, location,
                status, visibility, transparency,
                starts_at, ends_at, start_date, end_date, time_zone,
                recurrence_lines, organizer_email, organizer_name,
                conference_url, sequence, is_read_only, canonical_source_kind,
                canonical_source_updated_at,
                created_at, updated_at
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10,
                $11, $12, $13, $14, $15,
                $16, $17, $18,
                $19, $20, $21, $22, $24,
                $23, $24
            )
            ON CONFLICT (owner_id, source_link_id, ical_uid) DO UPDATE SET
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                location = EXCLUDED.location,
                status = EXCLUDED.status,
                visibility = EXCLUDED.visibility,
                transparency = EXCLUDED.transparency,
                starts_at = EXCLUDED.starts_at,
                ends_at = EXCLUDED.ends_at,
                start_date = EXCLUDED.start_date,
                end_date = EXCLUDED.end_date,
                time_zone = EXCLUDED.time_zone,
                recurrence_lines = EXCLUDED.recurrence_lines,
                organizer_email = EXCLUDED.organizer_email,
                organizer_name = EXCLUDED.organizer_name,
                conference_url = EXCLUDED.conference_url,
                sequence = EXCLUDED.sequence,
                is_read_only = EXCLUDED.is_read_only,
                canonical_source_kind = EXCLUDED.canonical_source_kind,
                canonical_source_updated_at = EXCLUDED.canonical_source_updated_at,
                updated_at = GREATEST(calendar_events.updated_at, EXCLUDED.updated_at)
            WHERE
                EXCLUDED.sequence > calendar_events.sequence
                OR (
                    EXCLUDED.sequence = calendar_events.sequence
                    AND EXCLUDED.canonical_source_updated_at
                        >= calendar_events.canonical_source_updated_at
                )
            RETURNING id
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
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(report)?;

        let event_id = match applied_id {
            Some(id) => id,
            None => sqlx::query_scalar!(
                "SELECT id FROM calendar_events WHERE owner_id = $1 AND source_link_id = $2 AND ical_uid = $3",
                &upsert.event.owner_id,
                source_link_id,
                &upsert.event.ical_uid,
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(report)?,
        };

        persist_source(&mut tx, event_id, &upsert).await?;

        // Only the source selected as canonical replaces projections and
        // attendees. Lower-sequence/stale sources are still recorded above.
        if applied_id.is_some() {
            replace_attendees(&mut tx, event_id, &upsert.event.attendees).await?;
            replace_overrides(&mut tx, event_id, &upsert.overrides).await?;
            replace_occurrences(
                &mut tx,
                event_id,
                &upsert.event.owner_id,
                &upsert.occurrences,
            )
            .await?;
        }

        tx.commit().await.map_err(report)?;
        Ok(event_id)
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
                event.starts_at,
                event.ends_at,
                event.start_date,
                event.end_date,
                event.time_zone,
                event.recurrence_lines,
                event.organizer_email,
                event.organizer_name,
                event.conference_url,
                event.sequence,
                event.is_read_only,
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
        let attendees = fetch_attendees(&self.pool, &event_ids).await?;
        rows.into_iter()
            .map(|row| {
                let event_id = row.event_id;
                let occurrence = occurrence_from_join(&row)?;
                let event =
                    event_from_join(row, attendees.get(&event_id).cloned().unwrap_or_default())?;
                Ok((event, occurrence))
            })
            .collect()
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
    ) -> Result<(), Report> {
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
                restore_best_source_or_delete(&mut tx, event_id).await?;
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
                restore_best_source_or_delete(&mut tx, event_id).await?;
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

        tx.commit().await.map_err(report)
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
    ) -> Result<(), Report> {
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
            restore_best_source_or_delete(&mut tx, event_id).await?;
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

        tx.commit().await.map_err(report)
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
        Ok(row.map(|row| CalendarEventMutationTarget {
            event_id: row.event_id,
            is_read_only: row.is_read_only,
            provider_event_id: row.provider_event_id,
            provider_recurring_event_id: row.provider_recurring_event_id,
            owner_id: row.owner_id,
            email_link_id: row.email_link_id,
            account_id: row.account_id,
            calendar_id: row.calendar_id,
            provider_calendar_id: row.provider_calendar_id,
            token_identity: CalendarLinkTokenIdentity {
                fusionauth_user_id: row.fusionauth_user_id,
                email_address: row.email_address,
                provider: row.provider,
            },
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
        Ok(row.map(|row| CalendarCreationTarget {
            owner_id: row.owner_id,
            email_link_id: row.email_link_id,
            account_id: row.account_id,
            calendar_id: row.calendar_id,
            provider_calendar_id: row.provider_calendar_id,
            is_read_only: !matches!(row.access_role.as_deref(), Some("owner" | "writer")),
            token_identity: CalendarLinkTokenIdentity {
                fusionauth_user_id: row.fusionauth_user_id,
                email_address: row.email_address,
                provider: row.provider,
            },
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
                calendar.access_role
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
            })
            .collect())
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_google_source(
        &self,
        account_id: Uuid,
        calendar_id: Uuid,
        provider_event_id: &str,
    ) -> Result<(), Report> {
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
        for event_id in affected_event_ids {
            restore_best_source_or_delete(&mut tx, event_id).await?;
        }
        tx.commit().await.map_err(report)
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
    sqlx::query_as!(
        StoredCalendarRow,
        r#"
        INSERT INTO calendars (
            id, account_id, provider_calendar_id, name, description,
            time_zone, color, access_role, is_primary, is_selected
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (account_id, provider_calendar_id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            time_zone = EXCLUDED.time_zone,
            color = EXCLUDED.color,
            access_role = EXCLUDED.access_role,
            is_primary = EXCLUDED.is_primary,
            is_selected = EXCLUDED.is_selected,
            is_deleted = false,
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
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(report)
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
    for event_id in affected_event_ids {
        restore_best_source_or_delete(tx, event_id).await?;
    }
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

async fn restore_best_source_or_delete(
    tx: &mut Transaction<'_, Postgres>,
    event_id: Uuid,
) -> Result<(), Report> {
    let identity = sqlx::query!(
        r#"
        SELECT source_link_id, ical_uid
        FROM calendar_events
        WHERE id = $1
        "#,
        event_id,
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(report)?;
    let Some(identity) = identity else {
        return Ok(());
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
        SELECT source_kind, source_updated_at, normalized_payload
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
        return Ok(());
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
            starts_at = $8,
            ends_at = $9,
            start_date = $10,
            end_date = $11,
            time_zone = $12,
            recurrence_lines = $13,
            organizer_email = $14,
            organizer_name = $15,
            conference_url = $16,
            sequence = $17,
            is_read_only = $18,
            canonical_source_kind = $19,
            canonical_source_updated_at = $20,
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
    .await
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
                title, description, location, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        )
        .execute(&mut **tx)
        .await
        .map_err(report)?;
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
        conference_url: row.conference_url,
        sequence: u32::try_from(row.sequence).unwrap_or_default(),
        is_read_only: row.is_read_only,
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

fn event_transparency(value: &str) -> EventTransparency {
    if value == "transparent" {
        EventTransparency::Transparent
    } else {
        EventTransparency::Opaque
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
