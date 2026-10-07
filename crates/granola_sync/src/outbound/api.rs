//! The REST adapter translates Granola meeting-note objects into call resources.
use crate::domain::{
    models::*,
    ports::{Granola, Result},
};
use async_trait::async_trait;
use call::domain::{imports::ImportedCall, records::*};
use chrono::{DateTime, Utc};
use pipedream_mcp::domain::{
    models::PipedreamConnection,
    ports::{ApiProxy, ProxyMethod},
};
use rootcause::prelude::IntoRootcause;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::HashSet, sync::Arc};

pub struct GranolaApi<P>(pub Arc<P>);

impl<P: ApiProxy> GranolaApi<P> {
    async fn request(
        &self,
        connection: &Connection,
        method: ProxyMethod,
        path: &str,
        body: Option<Value>,
    ) -> Result<Option<Value>> {
        let account = PipedreamConnection {
            user_id: connection.user_id.clone(),
            app_slug: "granola".into(),
            server_name: "Granola".into(),
            account_id: connection.account_id.clone(),
            enabled: true,
        };
        let response = self
            .0
            .proxy(
                &account,
                method,
                &format!("https://public-api.granola.ai/v1{path}"),
                body,
            )
            .await
            .into_rootcause()?;
        match response.status {
            200..=299 => Ok(Some(response.body)),
            404 => Ok(None),
            status => Err(rootcause::report!("Granola API returned HTTP {status}")),
        }
    }
}

#[async_trait]
impl<P: ApiProxy> Granola for GranolaApi<P> {
    async fn register(&self, connection: &Connection, url: &str) -> Result<Webhook> {
        let body = self
            .request(
                connection,
                ProxyMethod::Post,
                "/webhook-endpoints",
                Some(json!({
                    "url": url, "scopes": connection.scope.scopes(),
                    "events": ["note.generated", "note.edited", "note.access_granted"]
                })),
            )
            .await?
            .ok_or_else(|| {
                rootcause::report!("Granola webhooks are unavailable for this account")
            })?;
        #[derive(Deserialize)]
        struct Registration {
            id: String,
            signing_secret: String,
        }
        let result: Registration = serde_json::from_value(body)?;
        Ok(Webhook {
            id: result.id,
            secret: SigningSecret(result.signing_secret),
        })
    }
    async fn unregister(&self, connection: &Connection) -> Result<()> {
        if let Some(id) = &connection.endpoint_id {
            // Treat provider IDs as path segments rather than concatenating input.
            let id = url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>();
            self.request(
                connection,
                ProxyMethod::Delete,
                &format!("/webhook-endpoints/{id}"),
                None,
            )
            .await?;
        }
        Ok(())
    }
    async fn meeting(&self, connection: &Connection, id: &NoteId) -> Result<Option<ImportedCall>> {
        let Some(body) = self
            .request(
                connection,
                ProxyMethod::Get,
                &format!("/notes/{}", id.as_ref()),
                None,
            )
            .await?
        else {
            return Ok(None);
        };
        let note: Note = serde_json::from_value(body)?;
        if note.id.as_ref() != id.as_ref() {
            return Err(rootcause::report!("Granola returned a different meeting"));
        }
        if note.deleted_at.is_some() {
            return Ok(None);
        }
        let mut transcript = Vec::new();
        let mut cursor: Option<String> = None;
        let mut seen = HashSet::new();
        loop {
            let mut path = format!("/notes/{}/transcript", id.as_ref());
            if let Some(cursor) = &cursor {
                let query = url::form_urlencoded::Serializer::new(String::new())
                    .append_pair("cursor", cursor)
                    .finish();
                path.push('?');
                path.push_str(&query);
            }
            let Some(page) = self
                .request(connection, ProxyMethod::Get, &path, None)
                .await?
            else {
                if cursor.is_some() {
                    return Err(rootcause::report!(
                        "Granola transcript disappeared during pagination"
                    ));
                }
                // Missing/expired transcript does not make the meeting disappear.
                break;
            };
            let page: TranscriptPage = serde_json::from_value(page)?;
            transcript.extend(page.transcript);
            if !page.has_more {
                break;
            }
            let next = page
                .cursor
                .filter(|c| !c.is_empty())
                .ok_or_else(|| rootcause::report!("Granola transcript pagination has no cursor"))?;
            if !seen.insert(next.clone()) || transcript.len() > 100_000 {
                return Err(rootcause::report!(
                    "Granola transcript pagination exceeded safe bounds"
                ));
            }
            cursor = Some(next);
            // Stay below Granola's five requests/second sustained allowance.
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        Ok(Some(map_meeting(connection, note, transcript)?))
    }
}

#[derive(Deserialize)]
struct Person {
    name: Option<String>,
    email: String,
}
#[derive(Deserialize)]
struct Note {
    id: NoteId,
    title: Option<String>,
    owner: Person,
    updated_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
    web_url: String,
    calendar_event: Option<Value>,
    #[serde(default)]
    attendees: Vec<Person>,
    summary_markdown: Option<String>,
    summary_text: Option<String>,
}
#[derive(Deserialize)]
struct TranscriptPage {
    transcript: Vec<Segment>,
    #[serde(rename = "hasMore")]
    has_more: bool,
    cursor: Option<String>,
}
#[derive(Deserialize)]
struct Segment {
    text: String,
    start_time: Option<DateTime<Utc>>,
    end_time: Option<DateTime<Utc>>,
    speaker: Option<Speaker>,
}
#[derive(Deserialize)]
struct Speaker {
    name: Option<String>,
    attribution: Option<String>,
    diarization_label: Option<String>,
    source: Option<String>,
}

fn map_meeting(
    connection: &Connection,
    note: Note,
    segments: Vec<Segment>,
) -> Result<ImportedCall> {
    let start = segments.iter().filter_map(|s| s.start_time).min();
    let end = segments.iter().filter_map(|s| s.end_time).max();
    let mut emails = HashSet::new();
    let participants = note
        .attendees
        .into_iter()
        .filter(|p| emails.insert(p.email.to_lowercase()))
        .map(|p| CallParticipant {
            id: macro_uuid::generate_uuid_v7(),
            user_id: None,
            display_name: p.name,
            email: Some(p.email),
            phone: None,
            external_id: None,
            attendance: vec![],
        })
        .collect();
    let segments = segments
        .into_iter()
        .enumerate()
        .map(|(index, segment)| {
            let speaker_label = segment.speaker.and_then(|s| {
                s.name
                    .or(s.diarization_label)
                    .or_else(|| match s.attribution.as_deref() {
                        Some("me") => Some(
                            note.owner
                                .name
                                .clone()
                                .unwrap_or_else(|| note.owner.email.clone()),
                        ),
                        Some("them") => Some("Other participants".into()),
                        _ => s.source,
                    })
            });
            let start_ms = segment
                .start_time
                .zip(start)
                .map(|(t, origin)| (t - origin).num_milliseconds());
            let end_ms = segment
                .end_time
                .zip(start)
                .map(|(t, origin)| (t - origin).num_milliseconds());
            // Retain text if the provider supplies malformed timing.
            let valid = start_ms.is_none_or(|v| v >= 0)
                && end_ms.is_none_or(|v| v >= 0)
                && !matches!((start_ms, end_ms), (Some(a), Some(b)) if b < a);
            CallTranscriptSegment {
                sequence_num: index as i32,
                participant_id: None,
                speaker_label,
                content: segment.text,
                start_ms: if valid { start_ms } else { None },
                end_ms: if valid { end_ms } else { None },
            }
        })
        .collect::<Vec<_>>();
    let transcript = (!segments.is_empty()).then(|| CallTranscript {
        id: macro_uuid::generate_uuid_v7(),
        recording_id: None,
        language: None,
        provider: Some(CallProvider::Granola),
        started_at: start,
        segments,
    });
    let mut metadata = serde_json::Map::new();
    metadata.insert(
        "summary".into(),
        json!(note.summary_markdown.or(note.summary_text)),
    );
    metadata.insert("calendarEvent".into(), json!(note.calendar_event));
    metadata.insert("sourceTitle".into(), json!(note.title));
    // Private scratch notes are intentionally not part of a meeting import.
    Ok(ImportedCall {
        title: note.title,
        started_at: start,
        ended_at: end.filter(|end| start.is_none_or(|start| *end >= start)),
        participants,
        transcript,
        source: CallSource {
            user_id: connection.user_id.clone(),
            namespace: connection.namespace.to_string(),
            provider: CallProvider::Granola,
            object_type: "note".into(),
            external_id: String::from(note.id)
                .try_into()
                .map_err(|e| rootcause::report!("{e}"))?,
            external_url: Some(note.web_url),
            external_updated_at: Some(note.updated_at),
            synced_at: Some(Utc::now()),
            metadata,
        },
    })
}

#[cfg(test)]
mod test;
