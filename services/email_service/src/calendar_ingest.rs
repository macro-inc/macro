//! Shared live-ingest and historical-backfill extraction of calendar MIME parts.

use base64::{
    Engine as _,
    engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD},
};
use calendar_events::{
    domain::{
        models::{EmailIcsSource, OccurrenceRange},
        service::CalendarService,
    },
    inbound::ics::{ics_content_hash, parse_email_ics},
    outbound::pg::PgCalendarRepository,
};
use chrono::Utc;
use models_email::gmail::MessagePart;
use uuid::Uuid;

const MAX_ICS_BYTES: usize = 10 * 1024 * 1024;

struct CalendarPart<'a> {
    part: &'a MessagePart,
    attachment_id: Option<&'a str>,
}

/// Identifiers and provider data needed to extract invitations from one email.
pub struct CalendarIngestInput<'a> {
    /// OAuth access token used to fetch non-inline Gmail attachments.
    pub access_token: &'a str,
    /// Whether the caller is a backfill worker, for quota accounting.
    pub is_backfill: bool,
    /// Macro owner of the linked inbox.
    pub owner_id: &'a str,
    /// Persisted email link containing the message.
    pub email_link_id: Uuid,
    /// Persisted email thread containing the message.
    pub email_thread_id: Uuid,
    /// Persisted email message being inspected.
    pub email_message_id: Uuid,
    /// Gmail message identifier used by the attachment API.
    pub provider_message_id: &'a str,
    /// Gmail MIME tree to inspect recursively.
    pub payload: &'a MessagePart,
}

/// Extract and reconcile every `text/calendar`, `application/ics`, or
/// filename-identified `.ics` part from one Gmail message.
///
/// Invalid individual invitations are logged and skipped so malformed mail
/// cannot block email ingestion. Gmail fetch and database failures are
/// returned, allowing the surrounding queue operation to retry.
#[tracing::instrument(
    skip(db, gmail_client, redis_client, input),
    fields(
        email_link_id = %input.email_link_id,
        email_message_id = %input.email_message_id
    ),
    err
)]
pub async fn ingest_calendar_parts(
    db: &sqlx::PgPool,
    gmail_client: &gmail_client::GmailClient,
    redis_client: &crate::util::redis::RedisClient,
    input: CalendarIngestInput<'_>,
) -> anyhow::Result<usize> {
    let parts = calendar_parts(input.payload);
    if parts.is_empty() {
        return Ok(0);
    }

    let horizon = OccurrenceRange::maintenance_horizon(Utc::now());
    let service = CalendarService::new(PgCalendarRepository::new(db.clone()));
    let mut extracted = 0;

    for calendar_part in parts {
        let bytes = if let Some(encoded) = calendar_part
            .part
            .body
            .as_ref()
            .and_then(|body| body.data_base64.as_deref())
        {
            match decode_base64url(encoded) {
                Ok(bytes) => bytes,
                Err(error) => {
                    tracing::warn!(
                        error = ?error,
                        part_id = %calendar_part.part.part_id,
                        "skipping calendar MIME part with invalid inline base64"
                    );
                    continue;
                }
            }
        } else if let Some(attachment_id) = calendar_part.attachment_id {
            // Callers already passed a message-level gate; attachment fetches
            // are additional Gmail requests and must respect the same quota.
            if redis_client
                .is_rate_limited(crate::util::redis::rate_limit::RateLimitArgs {
                    user_id: input.email_link_id,
                    operation:
                        models_email::gmail::operations::GmailApiOperation::MessagesAttachmentsGet,
                    is_backfill: input.is_backfill,
                })
                .await
            {
                anyhow::bail!("Gmail rate limit reached while fetching calendar attachments");
            }
            gmail_client
                .get_attachment_data(input.access_token, input.provider_message_id, attachment_id)
                .await?
        } else {
            tracing::warn!(
                part_id = %calendar_part.part.part_id,
                "calendar MIME part has neither inline data nor an attachment id"
            );
            continue;
        };

        if bytes.len() > MAX_ICS_BYTES {
            tracing::warn!(
                part_id = %calendar_part.part.part_id,
                bytes = bytes.len(),
                "calendar MIME part exceeds extraction size limit"
            );
            continue;
        }

        let source = EmailIcsSource {
            email_link_id: input.email_link_id,
            email_thread_id: Some(input.email_thread_id),
            email_message_id: input.email_message_id,
            email_attachment_id: calendar_part
                .attachment_id
                .map(ToOwned::to_owned)
                .or_else(|| Some(calendar_part.part.part_id.clone()).filter(|id| !id.is_empty())),
            content_hash: ics_content_hash(&bytes),
            raw_payload: serde_json::json!({
                "providerMessageId": input.provider_message_id,
                "partId": calendar_part.part.part_id,
                "filename": calendar_part.part.filename,
                "mimeType": calendar_part.part.mime_type,
            }),
        };
        let upserts = match parse_email_ics(input.owner_id, source, &bytes, &horizon) {
            Ok(upserts) => upserts,
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    part_id=%calendar_part.part.part_id,
                    "skipping malformed calendar invitation"
                );
                continue;
            }
        };
        for upsert in upserts {
            service
                .upsert_email_event(upsert)
                .await
                .map_err(|error| anyhow::anyhow!("{error:?}"))?;
            extracted += 1;
        }
    }

    Ok(extracted)
}

fn calendar_parts(root: &MessagePart) -> Vec<CalendarPart<'_>> {
    let mut result = Vec::new();
    let mut stack = vec![root];
    while let Some(part) = stack.pop() {
        let mime_type = part.mime_type.split(';').next().unwrap_or_default().trim();
        let is_calendar = mime_type.eq_ignore_ascii_case("text/calendar")
            || mime_type.eq_ignore_ascii_case("application/ics")
            || part.filename.to_ascii_lowercase().ends_with(".ics");
        if is_calendar {
            result.push(CalendarPart {
                attachment_id: part
                    .body
                    .as_ref()
                    .and_then(|body| body.attachment_id.as_deref()),
                part,
            });
        }
        if let Some(children) = &part.parts {
            stack.extend(children);
        }
    }
    result
}

fn decode_base64url(value: &str) -> anyhow::Result<Vec<u8>> {
    URL_SAFE_NO_PAD
        .decode(value)
        .or_else(|_| URL_SAFE.decode(value))
        .map_err(Into::into)
}

#[cfg(test)]
mod test;
