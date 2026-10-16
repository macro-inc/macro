//! Reading the per-link change log and hydrating its targets.

use std::collections::HashMap;

use futures::try_join;
use rootcause::Report;
use uuid::Uuid;

use super::{
    OccurrenceJoinRow, PgCalendarRepository, VisibleCalendarRow, change_log::op_from_row,
    fetch_attendees, fetch_override_attendees, fetch_source_contents, occurrence_from_join, report,
    series_event_from_join, take_exception, visible_calendar,
};
use crate::domain::{
    changes::{
        CalendarChange, CalendarChangeRepository, CalendarEventChange, CalendarLinkLog,
        CalendarLinkWatermark, CalendarWatermark, EventChangeLoad, EventOccurrence,
    },
    models::VisibleCalendar,
    ports::CalendarRepository,
};

impl CalendarChangeRepository for PgCalendarRepository {
    #[tracing::instrument(skip(self, viewer), err)]
    async fn current_watermark(&self, viewer: &str) -> Result<CalendarWatermark, Report> {
        let rows = sqlx::query!(
            r#"
            WITH visible AS (
                SELECT id AS link_id FROM email_links WHERE macro_id = $1
                UNION
                SELECT link_id FROM macro_user_links WHERE primary_macro_id = $1
            )
            SELECT visible.link_id AS "link_id!", COALESCE(counter.seq, 0) AS "seq!"
            FROM visible
            LEFT JOIN calendar_change_counters counter ON counter.link_id = visible.link_id
            "#,
            viewer,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(report)?;
        Ok(CalendarWatermark::from_links(rows.into_iter().map(|row| {
            CalendarLinkWatermark {
                link_id: row.link_id,
                seq: row.seq,
            }
        })))
    }

    #[tracing::instrument(skip(self, viewer, since), err)]
    async fn link_logs(
        &self,
        viewer: &str,
        since: &CalendarWatermark,
        limit: usize,
    ) -> Result<Vec<CalendarLinkLog>, Report> {
        let (since_links, since_seqs): (Vec<Uuid>, Vec<i64>) =
            since.links().map(|link| (link.link_id, link.seq)).unzip();
        let limit = i64::try_from(limit)
            .map_err(|_| rootcause::report!("calendar change page limit is too large"))?;
        // One statement, so each link's counter and rows come from the same
        // snapshot and the counter never trails the rows read.
        let rows = sqlx::query!(
            r#"
            WITH visible AS (
                SELECT id AS link_id FROM email_links WHERE macro_id = $1
                UNION
                SELECT link_id FROM macro_user_links WHERE primary_macro_id = $1
            ),
            since AS (
                SELECT position.link_id, position.seq
                FROM unnest($2::uuid[], $3::bigint[]) AS position(link_id, seq)
            )
            SELECT
                visible.link_id AS "link_id!",
                COALESCE(counter.seq, 0) AS "counter!",
                COALESCE(
                    (
                        SELECT min(retained.seq) - 1
                        FROM calendar_change_log retained
                        WHERE retained.link_id = visible.link_id
                    ),
                    counter.seq,
                    0
                ) AS "floor!",
                change.seq AS "seq?",
                change.kind AS "kind?",
                change.event_id AS "event_id?",
                change.calendar_id AS "calendar_id?"
            FROM visible
            LEFT JOIN calendar_change_counters counter ON counter.link_id = visible.link_id
            LEFT JOIN since ON since.link_id = visible.link_id
            LEFT JOIN LATERAL (
                SELECT log.seq, log.kind, log.event_id, log.calendar_id
                FROM calendar_change_log log
                WHERE log.link_id = visible.link_id
                  AND since.seq IS NOT NULL
                  AND log.seq > since.seq
                ORDER BY log.seq
                LIMIT $4
            ) change ON true
            ORDER BY visible.link_id, change.seq
            "#,
            viewer,
            &since_links,
            &since_seqs,
            limit,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(report)?;

        let mut logs: Vec<CalendarLinkLog> = Vec::new();
        for row in rows {
            if logs.last().is_none_or(|log| log.link_id != row.link_id) {
                logs.push(CalendarLinkLog {
                    link_id: row.link_id,
                    counter: row.counter,
                    floor: row.floor,
                    changes: Vec::new(),
                });
            }
            if let (Some(seq), Some(kind)) = (row.seq, row.kind) {
                let op = op_from_row(kind, row.event_id, row.calendar_id)?;
                if let Some(log) = logs.last_mut() {
                    log.changes.push(CalendarChange { seq, op });
                }
            }
        }
        Ok(logs)
    }

    #[tracing::instrument(skip(self, viewer, event_ids), err)]
    async fn load_event_changes(
        &self,
        viewer: &str,
        event_ids: &[Uuid],
        max_occurrences: usize,
    ) -> Result<EventChangeLoad, Report> {
        if event_ids.is_empty() {
            return Ok(EventChangeLoad::default());
        }
        let max_occurrences = i64::try_from(max_occurrences)
            .map_err(|_| rootcause::report!("calendar occurrence cap is too large"))?;
        // The running total over the requested order only grows, so the
        // admitted ids are always a prefix of the request.
        let admitted = sqlx::query_scalar!(
            r#"
            SELECT totals.event_id AS "event_id!"
            FROM (
                SELECT
                    requested.event_id,
                    requested.ord,
                    (sum(count(occurrence.event_id)) OVER (ORDER BY requested.ord))::bigint AS running
                FROM unnest($1::uuid[]) WITH ORDINALITY AS requested(event_id, ord)
                LEFT JOIN calendar_event_occurrences occurrence
                    ON occurrence.event_id = requested.event_id
                   AND NOT occurrence.is_cancelled
                GROUP BY requested.event_id, requested.ord
            ) totals
            WHERE totals.ord = 1 OR totals.running <= $2::bigint
            ORDER BY totals.ord
            "#,
            event_ids,
            max_occurrences,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(report)?;

        let rows = sqlx::query_as!(
            OccurrenceJoinRow,
            r#"
            SELECT
                occurrence.event_id,
                event.source_link_id,
                occurrence.occurrence_key,
                occurrence.recurrence_id,
                occurrence.starts_at AS occurrence_starts_at,
                occurrence.ends_at AS occurrence_ends_at,
                occurrence.start_date AS occurrence_start_date,
                occurrence.end_date AS occurrence_end_date,
                occurrence.is_cancelled,
                override.title AS override_title,
                override.description AS override_description,
                override.location AS override_location,
                override.status AS override_status,
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
            LEFT JOIN calendar_event_overrides override
                ON override.event_id = occurrence.event_id
               AND override.recurrence_id = occurrence.recurrence_id
            WHERE occurrence.event_id = ANY($2::uuid[])
              AND occurrence.owner_id IN (
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
            ORDER BY
                occurrence.event_id,
                COALESCE(occurrence.starts_at, occurrence.start_date::timestamp AT TIME ZONE 'UTC'),
                occurrence.occurrence_key
            "#,
            viewer,
            &admitted,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(report)?;
        let (attendees, override_attendees, source_contents) = try_join!(
            fetch_attendees(&self.pool, &admitted),
            fetch_override_attendees(&self.pool, &admitted),
            fetch_source_contents(&self.pool, &admitted),
        )?;

        let mut changes: HashMap<Uuid, CalendarEventChange> = HashMap::new();
        for mut row in rows {
            let event_id = row.event_id;
            let occurrence = occurrence_from_join(&row)?;
            let mut exception = take_exception(&mut row);
            exception.attendees = occurrence.recurrence_id.as_ref().and_then(|recurrence_id| {
                override_attendees
                    .get(&(event_id, recurrence_id.clone()))
                    .cloned()
            });
            let instance = EventOccurrence {
                occurrence,
                exception,
            };
            match changes.get_mut(&event_id) {
                Some(change) => change.occurrences.push(instance),
                None => {
                    let link_id = row.source_link_id;
                    let event = series_event_from_join(
                        row,
                        attendees.get(&event_id).cloned().unwrap_or_default(),
                        source_contents.get(&event_id).cloned().unwrap_or_default(),
                    )?;
                    changes.insert(
                        event_id,
                        CalendarEventChange {
                            event,
                            link_id,
                            occurrences: vec![instance],
                        },
                    );
                }
            }
        }
        Ok(EventChangeLoad {
            events: admitted
                .iter()
                .filter_map(|event_id| changes.remove(event_id))
                .collect(),
            considered: admitted.len(),
        })
    }

    #[tracing::instrument(skip(self, viewer, calendar_ids), err)]
    async fn list_calendars_by_ids(
        &self,
        viewer: &str,
        calendar_ids: &[Uuid],
    ) -> Result<Vec<VisibleCalendar>, Report> {
        let rows = sqlx::query_as!(
            VisibleCalendarRow,
            r#"
            SELECT
                calendar.id,
                link.id AS email_link_id,
                link.email_address,
                calendar.name,
                calendar.color,
                calendar.is_primary,
                calendar.access_role,
                calendar.provider_calendar_id,
                calendar.default_reminders,
                calendar.last_sync_error,
                calendar.consecutive_sync_failures
            FROM email_links link
            JOIN calendar_accounts account ON account.email_link_id = link.id
            JOIN calendars calendar ON calendar.account_id = account.id
            WHERE calendar.id = ANY($2::uuid[])
              AND NOT calendar.is_deleted
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
            "#,
            viewer,
            calendar_ids,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(report)?;
        Ok(rows.into_iter().map(visible_calendar).collect())
    }

    async fn owned_inbox_emails(&self, viewer: &str) -> Result<Vec<String>, Report> {
        CalendarRepository::owned_inbox_emails(self, viewer).await
    }
}
