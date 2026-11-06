//! Keep every Macro-held copy of a Google meeting on the guest policy of the
//! organizer's own copy, when Macro holds that copy.
//!
//! Google takes 4 to 12 seconds to carry an organizer's policy change to its
//! guests' copies. A guest who invites someone in that window gets a 200
//! while Google drops the guest without telling anyone, so Macro applies the
//! organizer's change to every copy it holds as soon as it stores the
//! organizer's copy, and a copy written back meanwhile keeps the organizer's
//! switches instead of the stale ones Google echoes.
use super::*;

/// Align the copies of `event_id`'s meeting after it was stored.
///
/// The organizer's copy is the Google source on the calendar Google names as
/// the organizer, the user's address for a primary calendar or a secondary
/// calendar's id, which the syncing inbox can write; it is the copy
/// [`CalendarEventMutationTarget::organizer_copy_calendar_id`] routes the
/// organizer's writes through. Its policy goes to every entity of the meeting
/// with that organizer, the organizer's own included when its canonical copy
/// is an invitation, and to every other Google source's projection. Outlook
/// copies have no guest policy and snapshots grant nothing, so neither takes
/// part. Returns the entities whose stored policy changed.
#[tracing::instrument(
    name = "calendar.align_guest_policy",
    skip(tx),
    fields(aligned = tracing::field::Empty),
    err
)]
pub(super) async fn align_with_organizer(
    tx: &mut Transaction<'_, Postgres>,
    event_id: Uuid,
) -> Result<Vec<AlignedGuestCopy>, Report> {
    let organizer = sqlx::query!(
        r#"
        WITH written AS (
            SELECT calendar_meeting_uid(ical_uid) AS meeting, lower(organizer_email) AS organizer
            FROM calendar_events
            WHERE id = $1 AND organizer_email IS NOT NULL
        )
        SELECT source.id AS source_id,
               written.meeting AS "meeting!",
               written.organizer AS "organizer!",
               source.normalized_payload -> 'event' -> 'guestPolicy' AS policy
        FROM written
        JOIN calendar_events event
          ON calendar_meeting_uid(event.ical_uid) = written.meeting
         AND lower(event.organizer_email) = written.organizer
        JOIN calendar_event_sources source
          ON source.event_id = event.id AND source.source_kind = 'google'
        JOIN calendars calendar
          ON calendar.id = source.calendar_id AND calendar.account_id = source.account_id
        WHERE event.status <> 'cancelled'
          AND NOT event.is_snapshot
          AND NOT calendar.is_deleted
          AND calendar.access_role IN ('owner', 'writer')
          AND lower(calendar.provider_calendar_id) = written.organizer
        ORDER BY source.source_updated_at DESC NULLS LAST, source.id
        LIMIT 1
        "#,
        event_id,
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(report)?;
    let Some(organizer) = organizer else {
        tracing::Span::current().record("aligned", 0);
        return Ok(Vec::new());
    };
    // The projection omits Google's default, as a freshly synced one does.
    let policy = match organizer.policy {
        Some(policy) => serde_json::from_value::<GuestPolicy>(policy).map_err(report)?,
        None => GuestPolicy::default(),
    };
    let projected = (!policy.is_default())
        .then(|| serde_json::to_value(policy))
        .transpose()
        .map_err(report)?;
    let rows = sqlx::query!(
        r#"
        UPDATE calendar_events event
        SET guests_can_modify = $3,
            guests_can_invite_others = $4,
            guests_can_see_other_guests = $5
        WHERE calendar_meeting_uid(event.ical_uid) = $1
          AND lower(event.organizer_email) = $2
          AND event.status <> 'cancelled'
          AND NOT event.is_snapshot
          AND EXISTS (SELECT 1 FROM calendar_event_sources source
                      WHERE source.event_id = event.id AND source.source_kind = 'google')
          AND (event.guests_can_modify, event.guests_can_invite_others,
               event.guests_can_see_other_guests) IS DISTINCT FROM ($3, $4, $5)
        RETURNING event.id, event.owner_id, event.source_link_id
        "#,
        organizer.meeting,
        organizer.organizer,
        policy.can_modify,
        policy.can_invite_others,
        policy.can_see_other_guests,
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(report)?;
    // Each copy's stored projection carries the policy too, so a restore from
    // another copy cannot bring the stale switches back.
    sqlx::query!(
        r#"
        UPDATE calendar_event_sources source
        SET normalized_payload = CASE WHEN $4::jsonb IS NULL
            THEN source.normalized_payload #- '{event,guestPolicy}'
            ELSE jsonb_set(source.normalized_payload, '{event,guestPolicy}', $4)
        END
        FROM calendar_events event
        WHERE source.event_id = event.id
          AND source.source_kind = 'google'
          AND source.id <> $3
          AND source.normalized_payload ? 'event'
          AND (source.normalized_payload -> 'event' -> 'guestPolicy') IS DISTINCT FROM $4::jsonb
          AND calendar_meeting_uid(event.ical_uid) = $1
          AND lower(event.organizer_email) = $2
          AND event.status <> 'cancelled'
          AND NOT event.is_snapshot
        "#,
        organizer.meeting,
        organizer.organizer,
        organizer.source_id,
        projected,
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    tracing::Span::current().record("aligned", rows.len());
    Ok(rows
        .into_iter()
        .map(|row| AlignedGuestCopy {
            event_id: row.id,
            owner_id: row.owner_id,
            email_link_id: row.source_link_id,
        })
        .collect())
}
