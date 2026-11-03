//! Builds one complete call snapshot from every event Dialpad sent for it.
//!
//! Imports replace the stored call wholesale, and Dialpad sends a call's
//! details, transcript notice and recap as separate, possibly out-of-order
//! events. So each import starts from all of the call's events, never from
//! the one that triggered it.

use super::models::*;
use call::domain::{imports::ImportedCall, records::*};
use chrono::{DateTime, NaiveDateTime, Utc};
use phone_number::PhoneNumber;
use serde_json::json;

#[cfg(test)]
mod test;

/// What a call's events need fetched before it can be imported.
#[derive(Debug, PartialEq, Eq)]
pub struct Needs {
    pub transcript: bool,
    pub recap: bool,
}

/// `None` when the call never connected (missed, voicemail): nothing to import.
pub fn needs(events: &[CallEvent]) -> Option<Needs> {
    let latest = latest_details(events)?;
    latest.date_connected?;
    let has = |state| events.iter().any(|event| event.state == state);
    let backfill = has(CallState::Backfill);
    let recap_in_events = has(CallState::RecapSummary) || has(CallState::RecapActionItems);
    Some(Needs {
        transcript: backfill || has(CallState::CallTranscription),
        recap: backfill && !recap_in_events,
    })
}

/// The newest event that carries the call's details.
fn latest_details(events: &[CallEvent]) -> Option<&CallEvent> {
    events
        .iter()
        .filter(|event| event.date_started.is_some() || event.date_connected.is_some())
        .max_by_key(|event| event.occurred_at())
}

fn latest_with<'a, T>(
    events: &'a [CallEvent],
    state: CallState,
    field: impl Fn(&'a CallEvent) -> Option<T>,
) -> Option<T> {
    events
        .iter()
        .filter(|event| event.state == state)
        .max_by_key(|event| event.occurred_at())
        .and_then(field)
}

fn non_empty(text: Option<&str>) -> Option<String> {
    text.map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

/// Build the snapshot, or `None` when the call is not importable.
pub fn imported_call(
    connection: &Connection,
    events: &[CallEvent],
    transcript: Option<Vec<TranscriptLine>>,
    fetched_recap: Option<Recap>,
) -> Option<ImportedCall> {
    let details = latest_details(events)?;
    let started_at = details
        .date_connected
        .and_then(DateTime::from_timestamp_millis)?;
    let ended_at = details
        .date_ended
        .and_then(DateTime::from_timestamp_millis)
        .filter(|end| *end >= started_at);
    let revision = events.iter().filter_map(CallEvent::occurred_at).max();

    let target = details.target.clone().unwrap_or_default();
    let contact = details.contact.clone().unwrap_or_default();
    let user_participant = CallParticipant {
        id: macro_uuid::generate_uuid_v7(),
        user_id: None,
        display_name: non_empty(target.name.as_deref()),
        email: non_empty(target.email.as_deref()),
        phone: target
            .phone
            .as_deref()
            .or(details.internal_number.as_deref())
            .and_then(PhoneNumber::parse)
            .map(String::from),
        external_id: target.id.map(|id| ExternalCallId(format!("user:{id}"))),
        attendance: vec![],
    };
    let caller_phone = contact
        .phone
        .as_deref()
        .or(details.external_number.as_deref())
        .and_then(PhoneNumber::parse);
    // Dialpad names unknown callers by their number; that is not a name.
    let caller_name = non_empty(contact.name.as_deref()).filter(|name| {
        PhoneNumber::parse(name).is_none_or(|number| Some(&number) != caller_phone.as_ref())
    });
    let caller = CallParticipant {
        id: macro_uuid::generate_uuid_v7(),
        user_id: None,
        display_name: caller_name.clone(),
        email: non_empty(contact.email.as_deref()),
        phone: caller_phone.clone().map(String::from),
        external_id: non_empty(contact.id.as_deref())
            .map(|id| ExternalCallId(format!("contact:{id}"))),
        attendance: vec![],
    };
    let has_caller =
        caller.display_name.is_some() || caller.email.is_some() || caller.phone.is_some();

    let title = match (&caller_name, &caller_phone) {
        (Some(name), _) => format!("Call with {name}"),
        (None, Some(phone)) => format!("Call with {phone}"),
        (None, None) => "Dialpad call".to_owned(),
    };
    let transcript = transcript.and_then(map_transcript);

    let summary_text = latest_with(events, CallState::RecapSummary, |event| {
        non_empty(event.recap_summary.as_deref())
    })
    .or_else(|| {
        fetched_recap
            .as_ref()
            .and_then(|recap| recap.summary.clone())
    });
    let action_items = latest_with(events, CallState::RecapActionItems, |event| {
        event.recap_action_items.clone()
    })
    .or_else(|| fetched_recap.map(|recap| recap.action_items))
    .unwrap_or_default();
    let summary = recap_markdown(summary_text, &action_items);

    let mut participants = vec![user_participant];
    if has_caller {
        participants.push(caller);
    }
    let mut metadata = serde_json::Map::new();
    metadata.insert("summary".into(), json!(summary));
    metadata.insert("sourceTitle".into(), json!(title));
    metadata.insert(
        "direction".into(),
        json!(
            details
                .direction
                .map(|direction| direction.as_ref().to_owned())
        ),
    );
    metadata.insert(
        "masterCallId".into(),
        json!(details.master_call_id.map(|id| id.to_string())),
    );
    Some(ImportedCall {
        title: Some(title),
        started_at: Some(started_at),
        ended_at,
        participants,
        transcript,
        source: CallSource {
            user_id: connection.user_id.clone(),
            namespace: connection.namespace.to_string(),
            provider: CallProvider::Dialpad,
            object_type: "call".into(),
            external_id: ExternalCallId(details.call_id.to_string()),
            external_url: events
                .iter()
                .rev()
                .find_map(|event| non_empty(event.company_call_review_share_link.as_deref())),
            external_updated_at: revision,
            synced_at: Some(Utc::now()),
            metadata,
        },
    })
}

fn recap_markdown(summary: Option<String>, action_items: &[String]) -> Option<String> {
    let items: Vec<String> = action_items
        .iter()
        .filter_map(|item| non_empty(Some(item)))
        .map(|item| format!("- {item}"))
        .collect();
    let mut sections = Vec::new();
    if let Some(summary) = summary {
        sections.push(summary);
    }
    if !items.is_empty() {
        sections.push(format!("**Action items**\n\n{}", items.join("\n")));
    }
    (!sections.is_empty()).then(|| sections.join("\n\n"))
}

/// Dialpad sends naive UTC times; accept an offset too.
fn line_time(time: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(time)
        .map(|time| time.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            NaiveDateTime::parse_from_str(time, "%Y-%m-%dT%H:%M:%S%.f")
                .ok()
                .map(|time| time.and_utc())
        })
}

/// Speakers are kept as Dialpad's labels; the call view matches them to
/// participants by name.
fn map_transcript(lines: Vec<TranscriptLine>) -> Option<CallTranscript> {
    let lines: Vec<(TranscriptLine, Option<DateTime<Utc>>)> = lines
        .into_iter()
        .filter(|line| line.kind.as_deref() == Some("transcript"))
        .filter(|line| {
            line.content
                .as_deref()
                .is_some_and(|text| !text.trim().is_empty())
        })
        .map(|line| {
            let at = line.time.as_deref().and_then(line_time);
            (line, at)
        })
        .collect();
    let origin = lines.iter().filter_map(|(_, at)| *at).min();
    let segments: Vec<CallTranscriptSegment> = lines
        .into_iter()
        .enumerate()
        .map(|(index, (line, at))| CallTranscriptSegment {
            sequence_num: index as i32,
            participant_id: None,
            speaker_label: non_empty(line.name.as_deref()),
            content: line.content.unwrap_or_default(),
            start_ms: at
                .zip(origin)
                .map(|(at, origin)| (at - origin).num_milliseconds()),
            end_ms: None,
        })
        .collect();
    (!segments.is_empty()).then(|| CallTranscript {
        id: macro_uuid::generate_uuid_v7(),
        recording_id: None,
        language: None,
        provider: Some(CallProvider::Dialpad),
        started_at: origin,
        segments,
    })
}
