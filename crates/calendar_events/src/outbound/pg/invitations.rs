//! Identity lookup stays inside the calendar-owned PostgreSQL adapter.
use super::*;
use crate::domain::invitations::{
    CalendarInvitationRepository, InvitationAvailability, InvitationCandidate, InvitationIdentity,
};

impl CalendarInvitationRepository for PgCalendarRepository {
    async fn invitation_availability(
        &self,
        viewer: &str,
    ) -> Result<InvitationAvailability, Report> {
        let row = sqlx::query!(r#"SELECT count(*) > 0 AS "connected!",
            COALESCE(bool_or(a.sync_status IN ('pending', 'syncing')), false) AS "syncing!"
            FROM calendar_accounts a JOIN email_links l ON l.id = a.email_link_id
            WHERE a.owner_id = $1 AND l.macro_id = $1 AND a.sync_status NOT IN ('disabled', 'reauth_required')"#, viewer).fetch_one(&self.pool).await.map_err(report)?;
        Ok(InvitationAvailability {
            connected: row.connected,
            syncing: row.syncing,
        })
    }
    async fn invitation_candidates(
        &self,
        viewer: &str,
        items: &[InvitationIdentity],
    ) -> Result<Vec<Vec<InvitationCandidate>>, Report> {
        let uids = items.iter().map(|i| i.uid.clone()).collect::<Vec<_>>();
        let requested_keys = items
            .iter()
            .map(|item| item.occurrence_key.clone())
            .collect::<Vec<_>>();
        let matches = sqlx::query!(r#"
            SELECT requested.ord AS "ord!", candidate.id, candidate.source_link_id, candidate.email_address, candidate.sequence, candidate.status, candidate.updated_at,
                (SELECT o.occurrence_key FROM calendar_event_occurrences o
                 WHERE o.event_id = candidate.id AND (requested.occurrence_key IS NULL OR o.occurrence_key = requested.occurrence_key OR o.recurrence_id = requested.occurrence_key)
                 ORDER BY o.occurrence_key LIMIT 1) AS occurrence_key
            FROM unnest($2::text[], $3::text[]) WITH ORDINALITY requested(uid, occurrence_key, ord)
            CROSS JOIN LATERAL (
                SELECT e.id, e.source_link_id, l.email_address, e.sequence, e.status, e.updated_at
                FROM calendar_events e JOIN email_links l ON l.id = e.source_link_id
                WHERE e.ical_uid = requested.uid AND e.owner_id = $1 AND l.macro_id = $1
                  AND EXISTS (SELECT 1 FROM calendar_event_sources s JOIN calendar_accounts a ON a.id = s.account_id JOIN calendars c ON c.id = s.calendar_id WHERE s.event_id = e.id AND s.source_kind = 'google' AND NOT c.is_deleted AND a.sync_status NOT IN ('disabled', 'reauth_required'))
                ORDER BY e.id LIMIT 16
            ) candidate
        "#, viewer, &uids, &requested_keys as &[Option<String>]).fetch_all(&self.pool).await.map_err(report)?;
        let ids = matches.iter().map(|r| r.id).collect::<Vec<_>>();
        let keys = matches
            .iter()
            .map(|r| r.occurrence_key.clone())
            .collect::<Vec<_>>();
        let rows = sqlx::query_as!(
            OccurrenceJoinRow,
            r#"            SELECT
                occurrence.event_id,
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
                COALESCE(override.sequence, event.sequence) AS "sequence!",
                event.is_read_only,
                event.reminders_use_default,
                event.reminder_overrides,
                event.created_at,
                COALESCE(override.source_updated_at, event.updated_at) AS "updated_at!"
            FROM unnest($2::uuid[], $3::text[]) requested(event_id, occurrence_key)
            JOIN calendar_events event ON event.id = requested.event_id
            JOIN LATERAL (
                SELECT o.* FROM calendar_event_occurrences o
                WHERE o.event_id = event.id
                  AND o.occurrence_key = requested.occurrence_key
                ORDER BY o.occurrence_key LIMIT 1
            ) occurrence ON true
            LEFT JOIN calendar_event_overrides override
                ON override.event_id = occurrence.event_id
               AND override.recurrence_id = occurrence.recurrence_id
            WHERE event.owner_id = $1
"#,
            viewer,
            &ids,
            &keys as &[Option<String>]
        )
        .fetch_all(&self.pool)
        .await
        .map_err(report)?;
        let (attendees, overrides, sources) = try_join!(
            fetch_attendees(&self.pool, &ids),
            fetch_override_attendees(&self.pool, &ids),
            fetch_source_contents(&self.pool, &ids)
        )?;
        let mut projections = std::collections::HashMap::new();
        for row in rows {
            let id = row.event_id;
            let occurrence = occurrence_from_join(&row)?;
            let effective = occurrence
                .recurrence_id
                .as_ref()
                .and_then(|key| overrides.get(&(id, key.clone())))
                .or_else(|| attendees.get(&id))
                .cloned()
                .unwrap_or_default();
            let event = event_from_join(
                row,
                effective,
                sources.get(&id).cloned().unwrap_or_default(),
            )?;
            projections.insert((id, occurrence.occurrence_key.clone()), (event, occurrence));
        }
        let mut results = (0..items.len()).map(|_| Vec::new()).collect::<Vec<_>>();
        for candidate in matches {
            let index = (candidate.ord - 1) as usize;
            let projection = candidate
                .occurrence_key
                .as_ref()
                .and_then(|key| projections.get(&(candidate.id, key.clone())));
            if let Some((event, occurrence)) = projection {
                results[index].push(InvitationCandidate {
                    link_id: candidate.source_link_id,
                    email: candidate.email_address,
                    series_sequence: u32::try_from(candidate.sequence).unwrap_or_default(),
                    series_cancelled: candidate.status == "cancelled",
                    series_updated_at: candidate.updated_at,
                    event: event.clone(),
                    occurrence: occurrence.clone(),
                });
            }
        }
        Ok(results)
    }
}
