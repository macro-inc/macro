//! Reads for calls that exist only as `call_entities` rows (Granola and other
//! imports). They never had an RTC room, so they have no `calls` or
//! `call_records` row; native calls are mirrored into `call_entities` too and
//! are excluded here by `created_via`.

use std::collections::HashMap;

use chrono::Duration;
use entity_access::domain::models::AccessLevel;
use sqlx::PgConnection;
use uuid::Uuid;

use crate::domain::meetings::GuestId;
use crate::domain::models::{
    CallGuest, CallPeople, CallRecord, CallRecordGuest, CallRecordParticipant, CallRecordSource,
    CallRecordTranscriptSegment,
};
use crate::domain::records::CallProvider;
use macro_user_id::user_id::MacroUserIdStr;
use phone_number::PhoneNumber;

/// The attendees of an imported call. Those the importer matched to a Macro
/// account are participants; the rest are guests, known only by the
/// provider's name, email or phone.
#[derive(Default)]
pub(super) struct ImportedPeople {
    pub(super) participants: Vec<CallRecordParticipant>,
    pub(super) guests: Vec<CallRecordGuest>,
    /// Each participant's attendee id and provider name, so transcript
    /// segments can point at their account.
    accounts: Vec<(Uuid, Option<String>, String)>,
}

pub(super) async fn imported_people(
    conn: &mut PgConnection,
    call_ids: &[Uuid],
) -> Result<HashMap<Uuid, ImportedPeople>, sqlx::Error> {
    let mut people: HashMap<Uuid, ImportedPeople> = HashMap::new();
    if call_ids.is_empty() {
        return Ok(people);
    }
    for row in sqlx::query!(
        r#"
        SELECT p.call_id, p.id, p.user_id, p.display_name, p.email, p.phone,
               COALESCE(ce.started_at, ce.created_at) AS "joined_at!",
               ce.ended_at
        FROM call_entity_participants p
        JOIN call_entities ce ON ce.id = p.call_id
        WHERE p.call_id = ANY($1)
        ORDER BY p.call_id, p.id
        "#,
        call_ids,
    )
    .fetch_all(conn)
    .await?
    {
        let call = people.entry(row.call_id).or_default();
        if let Some(user_id) = row.user_id {
            call.accounts
                .push((row.id, row.display_name, user_id.clone()));
            call.participants.push(CallRecordParticipant {
                user_id,
                joined_at: row.joined_at,
                left_at: row.ended_at,
            });
            continue;
        }
        let phone = row
            .phone
            .map(|phone| PhoneNumber::parse(&phone).map_or(phone, |number| number.readable()));
        call.guests.push(CallRecordGuest {
            id: GuestId::from_uuid(row.id),
            display_name: row
                .display_name
                .or(row.email)
                .or(phone)
                .unwrap_or_else(|| "Participant".into()),
            joined_at: row.joined_at,
            left_at: row.ended_at,
        });
    }
    Ok(people)
}

/// Where each imported call came from: its most recently synced source.
pub(super) async fn imported_sources(
    conn: &mut PgConnection,
    call_ids: &[Uuid],
) -> Result<HashMap<Uuid, CallRecordSource>, sqlx::Error> {
    let mut sources = HashMap::new();
    if call_ids.is_empty() {
        return Ok(sources);
    }
    for row in sqlx::query!(
        r#"
        SELECT DISTINCT ON (call_id) call_id, provider, external_url
        FROM call_entity_sources
        WHERE call_id = ANY($1)
        ORDER BY call_id, synced_at DESC NULLS LAST
        "#,
        call_ids,
    )
    .fetch_all(conn)
    .await?
    {
        // A provider a newer build imports from shows no badge here, rather
        // than failing the whole list.
        let Ok(provider) = row.provider.parse::<CallProvider>() else {
            tracing::warn!(call_id = %row.call_id, provider = %row.provider, "unknown call provider");
            continue;
        };
        sources.insert(
            row.call_id,
            CallRecordSource {
                provider,
                external_url: row.external_url,
            },
        );
    }
    Ok(sources)
}

/// The people on an imported call, for matching them to CRM records: its
/// owner, and its guests' emails and phones. `None` when `call_id` is not an
/// import.
pub(super) async fn imported_call_people(
    conn: &mut PgConnection,
    call_id: &Uuid,
) -> Result<Option<CallPeople>, sqlx::Error> {
    let Some(owner) = sqlx::query_scalar!(
        "SELECT user_id FROM call_entities WHERE id = $1 AND created_via = 'import'",
        call_id,
    )
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(None);
    };
    let guests = sqlx::query!(
        r#"
        SELECT LOWER(email) AS email, phone
        FROM call_entity_participants
        WHERE call_id = $1 AND user_id IS NULL AND (email IS NOT NULL OR phone IS NOT NULL)
        ORDER BY id
        "#,
        call_id,
    )
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .map(|row| CallGuest {
        email: row.email,
        phone: row.phone,
    })
    .collect();
    // An unparsable owner names nobody to match; the guests still link.
    let user_ids = MacroUserIdStr::try_from(owner)
        .inspect_err(
            |error| tracing::warn!(%call_id, error = ?error, "skipping unparsable import owner"),
        )
        .ok()
        .into_iter()
        .collect();
    Ok(Some(CallPeople { user_ids, guests }))
}

/// Full record for an imported call, or `None` when `call_id` is not one.
pub(super) async fn read_imported_call_record(
    conn: &mut PgConnection,
    call_id: &Uuid,
) -> Result<Option<CallRecord>, sqlx::Error> {
    let Some(call) = sqlx::query!(
        r#"
        SELECT ce.id, ce.user_id, ce.title, ce.started_at, ce.ended_at, ce.duration_ms, ce.created_at,
               sp.team_share_access_level AS "team_share_access_level?: AccessLevel",
               src.provider AS "provider?", src.external_url, src.metadata ->> 'summary' AS summary
        FROM call_entities ce
        JOIN "SharePermission" sp ON sp.id = ce.share_permission_id
        LEFT JOIN LATERAL (
            SELECT provider, external_url, metadata
            FROM call_entity_sources
            WHERE call_id = ce.id
            ORDER BY synced_at DESC NULLS LAST
            LIMIT 1
        ) src ON true
        WHERE ce.id = $1 AND ce.created_via <> 'native'
        "#,
        call_id,
    )
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(None);
    };

    let provider = call
        .provider
        .as_deref()
        .map(str::parse::<CallProvider>)
        .transpose()
        .map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
    let started_at = call.started_at.unwrap_or(call.created_at);
    let people = imported_people(&mut *conn, &[call.id])
        .await?
        .remove(&call.id)
        .unwrap_or_default();

    let segments = sqlx::query!(
        r#"
        SELECT s.transcript_id, s.sequence_num, s.participant_id, s.speaker_label, s.content,
               s.start_ms, s.end_ms, t.started_at AS transcript_started_at
        FROM call_entity_transcript_segments s
        JOIN call_entity_transcripts t ON t.call_id = s.call_id AND t.id = s.transcript_id
        WHERE s.call_id = $1
        ORDER BY t.started_at NULLS LAST, t.id, s.sequence_num
        "#,
        call_id,
    )
    .fetch_all(&mut *conn)
    .await?;

    let transcript = segments
        .into_iter()
        .enumerate()
        .map(|(index, s)| {
            let origin = s.transcript_started_at.unwrap_or(started_at);
            let at = |ms: i64| origin + Duration::milliseconds(ms);
            CallRecordTranscriptSegment {
                // Segments have a composite key; derive a stable per-segment id
                // so transcript deep links can target one.
                transcript_id: Uuid::new_v5(&s.transcript_id, &s.sequence_num.to_be_bytes()),
                segment_id: None,
                speaker_id: imported_speaker_id(&people, s.participant_id, s.speaker_label),
                diarized_speaker_id: None,
                content: s.content,
                started_at: s.start_ms.map(at).unwrap_or(origin),
                ended_at: s.end_ms.map(at),
                // Renumber across transcripts; the UI keys rows by this.
                sequence_num: index as i32,
            }
        })
        .collect();

    Ok(Some(CallRecord {
        call_id: call.id,
        user_access_level: None,
        channel_id: None,
        discussion: crate::domain::models::CallDiscussion::CallChat { call_id: call.id },
        room_name: None,
        created_by: call.user_id,
        started_at,
        ended_at: call.ended_at,
        duration_ms: call.duration_ms,
        egress_id: None,
        recording_started_at: None,
        recording_key: None,
        preview_key: None,
        recording_url: None,
        recording_preview_url: None,
        channel_name: None,
        custom_name: call.title,
        summary: call.summary,
        share_with_team: call.team_share_access_level.is_some(),
        team_share_access_level: call.team_share_access_level,
        is_active: false,
        status: None,
        // Imports never ring, so there is nothing to decline.
        viewer_has_declined: false,
        participants: people.participants,
        guests: people.guests,
        transcript,
        source: provider.map(|provider| CallRecordSource {
            provider,
            external_url: call.external_url,
        }),
    }))
}

/// Attribute a segment to an attendee when the provider linked one or the
/// label names one: a participant by their account, a guest by their guest
/// id. Otherwise keep the provider's label so the UI shows it.
fn imported_speaker_id(
    people: &ImportedPeople,
    participant_id: Option<Uuid>,
    speaker_label: Option<String>,
) -> String {
    if let Some(id) = participant_id {
        return people
            .accounts
            .iter()
            .find(|(attendee, ..)| *attendee == id)
            .map_or_else(
                || GuestId::from_uuid(id).to_string(),
                |(.., user)| user.clone(),
            );
    }
    let label = speaker_label.unwrap_or_else(|| "Unknown speaker".into());
    let names = |name: &str| name.eq_ignore_ascii_case(&label);
    people
        .accounts
        .iter()
        .find(|(_, name, _)| name.as_deref().is_some_and(names))
        .map(|(.., user)| user.clone())
        .or_else(|| {
            people
                .guests
                .iter()
                .find(|g| names(&g.display_name))
                .map(|g| g.id.to_string())
        })
        .unwrap_or(label)
}

#[cfg(test)]
mod test;
