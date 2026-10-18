//! Verify the raw envelope before decoding. Durability is provided by the
//! receipt service; a successful signature alone does not acknowledge delivery.

use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::Sha256;

use crate::domain::{
    events::*,
    models::{DeliveryState, MessagingError, Provenance, Provider, ProviderId},
};

mod content;
mod groups;
#[cfg(test)]
mod test;
mod whatsapp;

/// Largest accepted raw notification body.
pub const MAX_WEBHOOK_BYTES: usize = 4 * 1024 * 1024;
const MAX_SHARE_TITLE_CHARS: usize = 2000;

/// Authenticate exact raw bytes using Meta's SHA-256 signature. Malformed,
/// missing and incorrect signatures all fail closed, using constant-time MAC verification.
pub fn verify_signature(secret: &[u8], signature: &str, body: &[u8]) -> Result<(), MessagingError> {
    if body.len() > MAX_WEBHOOK_BYTES || secret.is_empty() {
        return Err(MessagingError::Invalid(
            "invalid webhook size or configuration",
        ));
    }
    let hex = signature
        .strip_prefix("sha256=")
        .filter(|s| s.len() == 64)
        .ok_or(MessagingError::Forbidden)?;
    let mut expected = [0_u8; 32];
    for (i, chunk) in hex.as_bytes().chunks_exact(2).enumerate() {
        let digit = |c: u8| {
            (c as char)
                .to_digit(16)
                .map(|d| d as u8)
                .ok_or(MessagingError::Forbidden)
        };
        expected[i] = digit(chunk[0])? * 16 + digit(chunk[1])?;
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).map_err(|_| MessagingError::Forbidden)?;
    mac.update(body);
    mac.verify_slice(&expected)
        .map_err(|_| MessagingError::Forbidden)
}

/// Translate only the selected official product's envelope. Retrying a malformed
/// receipt cannot turn it into fabricated content or an external send.
pub fn decode(provider: Provider, payload: &Value) -> Result<ReceiptBatch, MessagingError> {
    let expected = match provider {
        Provider::Whatsapp => "whatsapp_business_account",
        Provider::Instagram => "instagram",
    };
    if payload.get("object").and_then(Value::as_str) != Some(expected) {
        return Err(MessagingError::Invalid(
            "webhook product does not match this endpoint",
        ));
    }
    let entries = array(payload, "entry")?;
    let mut events = Decoder::default();
    for entry in entries {
        events.capture(|events| match provider {
            Provider::Whatsapp => whatsapp::decode(entry, events),
            Provider::Instagram => instagram(entry, events),
        });
    }
    Ok(events.batch)
}

#[derive(Default)]
struct Decoder {
    batch: ReceiptBatch,
}
impl Decoder {
    fn push(&mut self, event: IncomingEvent) {
        // The authenticated raw envelope is bounded to 4 MiB, and persistence
        // commits one item at a time. A count limit must not discard valid facts.
        self.batch.events.push(event);
    }
    fn capture(&mut self, decode: impl FnOnce(&mut Self) -> Result<(), MessagingError>) {
        if decode(self).is_err() {
            self.batch.invalid_items = self.batch.invalid_items.saturating_add(1);
        }
    }
}

// Missing optional collections are valid; malformed collections do not hide siblings.
fn items<'a>(value: &'a Value, key: &str, decoder: &mut Decoder) -> &'a [Value] {
    match value.get(key) {
        None => &[],
        Some(Value::Array(items)) => items,
        Some(_) => {
            decoder.batch.invalid_items = decoder.batch.invalid_items.saturating_add(1);
            &[]
        }
    }
}

fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str, MessagingError> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or(MessagingError::Invalid(
            "provider payload is missing a required field",
        ))
}
fn id(v: &Value, key: &str) -> Result<ProviderId, MessagingError> {
    string(v, key)?.to_owned().try_into()
}
fn array<'a>(v: &'a Value, key: &str) -> Result<&'a [Value], MessagingError> {
    v.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or(MessagingError::Invalid(
            "provider payload is missing an event collection",
        ))
}
fn optional_array<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key)
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}
fn timestamp(v: &Value, milliseconds: bool) -> Result<DateTime<Utc>, MessagingError> {
    let seconds = v
        .as_i64()
        .or_else(|| v.as_str()?.parse().ok())
        .ok_or(MessagingError::Invalid("provider timestamp is invalid"))?;
    let timestamp = if milliseconds {
        DateTime::from_timestamp_millis(seconds)
    } else {
        DateTime::from_timestamp(seconds, 0)
    };
    timestamp
        .filter(|t| t.timestamp() >= 0)
        .ok_or(MessagingError::Invalid("provider timestamp is invalid"))
}
fn optional_string(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn instagram(entry: &Value, events: &mut Decoder) -> Result<(), MessagingError> {
    let account = id(entry, "id")?;
    for event in items(entry, "messaging", events) {
        events.capture(|events| {
            if let Some(edit) = event.get("message_edit") {
                let number = edit["num_edit"]
                    .as_u64()
                    .or_else(|| edit["num_edit"].as_str()?.parse().ok())
                    .and_then(|n| u32::try_from(n).ok())
                    .filter(|n| *n > 0);
                let text = edit["text"].as_str().filter(|s| s.len() <= 64 * 1024);
                if let (Some(number), Some(text)) = (number, text) {
                    push_instagram_revision(
                        events,
                        instagram_revision(
                            &account,
                            event,
                            edit,
                            MessageRevision::Edited {
                                text: text.to_owned(),
                                number,
                            },
                        ),
                    );
                } else {
                    return Err(MessagingError::Invalid("invalid Instagram message edit"));
                }
                return Ok(());
            }
            let Some(message) = event.get("message") else {
                if event.get("reaction").is_some() {
                    events.push(IncomingEvent::Unsupported {
                        account_id: Some(account.clone()),
                        field: "reaction".into(),
                    });
                } else if let Some(read) = event.get("read") {
                    events.push(IncomingEvent::Status {
                        group_id: None,
                        provenance: Provenance::Customer,
                        account_id: account.clone(),
                        message_id: id(read, "mid")?,
                        state: DeliveryState::Read,
                        timestamp: timestamp(&event["timestamp"], true)?,
                        error_code: None,
                    });
                } else {
                    events.push(IncomingEvent::Unsupported {
                        account_id: Some(account.clone()),
                        field: "instagram_messaging_event".to_owned(),
                    });
                }
                return Ok(());
            };
            if message["is_deleted"] == true {
                push_instagram_revision(
                    events,
                    instagram_revision(&account, event, message, MessageRevision::Deleted),
                );
                return Ok(());
            }
            let echo = message["is_echo"].as_bool().unwrap_or(false);
            let sender = id(&event["sender"], "id")?;
            let recipient = id(&event["recipient"], "id")?;
            if (!echo && recipient != account) || (echo && sender != account) {
                return Err(MessagingError::Invalid(
                    "Instagram message account does not match envelope",
                ));
            }
            let customer = if echo { recipient } else { sender };
            let mut media = Vec::new();
            let mut content = optional_string(message, "text").unwrap_or_default();
            let mut share_type = None;
            if let Some(story) = message.get("reply_to").and_then(|r| r.get("story")) {
                let url = optional_string(story, "url");
                append_content(
                    &mut content,
                    if url.is_some() {
                        "Reply to Instagram story · Preview"
                    } else {
                        "Reply to Instagram story · Content unavailable"
                    },
                );
                if let Some(url) = url {
                    media.push(IncomingMedia {
                        kind: MediaKind::Image,
                        id: id(story, "id").ok(),
                        url: Some(url),
                        mime_type: None,
                        filename: Some("Instagram story preview".into()),
                        sha256: None,
                    });
                }
            }
            for attachment in optional_array(message, "attachments") {
                let kind = attachment["type"].as_str().unwrap_or_default();
                let payload = &attachment["payload"];
                if matches!(kind, "ig_post" | "ig_reel") {
                    share_type = Some(kind);
                    // The provider CDN URL is a media preview, not a post permalink.
                    // Native storage verifies the MIME and bytes, including video.
                    let url = optional_string(payload, "url");
                    let permalink = url.as_deref().and_then(instagram_permalink);
                    let label = if kind == "ig_reel" {
                        "Shared Instagram reel"
                    } else {
                        "Shared Instagram post"
                    };
                    append_content(
                        &mut content,
                        &if url.is_some() && permalink.is_none() {
                            format!("{label} · Preview")
                        } else {
                            label.to_owned()
                        },
                    );
                    if let Some(title) = optional_string(payload, "title") {
                        content.push('\n');
                        content.extend(title.chars().take(MAX_SHARE_TITLE_CHARS));
                    }
                    if let Some(permalink) = permalink {
                        append_content(&mut content, permalink);
                    } else if let Some(url) = url.filter(|_| media.len() < 10) {
                        media.push(IncomingMedia {
                            kind: MediaKind::Image,
                            id: id(
                                payload,
                                if kind == "ig_reel" {
                                    "reel_video_id"
                                } else {
                                    "ig_post_media_id"
                                },
                            )
                            .ok(),
                            url: Some(url),
                            mime_type: None,
                            filename: Some(
                                if kind == "ig_reel" {
                                    "Instagram reel preview"
                                } else {
                                    "Instagram post preview"
                                }
                                .into(),
                            ),
                            sha256: None,
                        });
                    }
                    continue;
                }
                let media_kind = match kind {
                    "image" => MediaKind::Image,
                    "audio" => MediaKind::Audio,
                    "video" => MediaKind::Video,
                    "file" => MediaKind::Document,
                    _ => {
                        append_content(&mut content, "Content unavailable");
                        continue;
                    }
                };
                let Some(url) = optional_string(payload, "url").filter(|_| media.len() < 10) else {
                    append_content(&mut content, "Attachment unavailable");
                    continue;
                };
                media.push(IncomingMedia {
                    kind: media_kind,
                    id: None,
                    url: Some(url),
                    mime_type: None,
                    filename: None,
                    sha256: None,
                });
            }
            if content.is_empty() && media.is_empty() {
                content = "Content unavailable".to_owned();
            }
            events.push(IncomingEvent::Message(IncomingMessage {
                group_id: None,
                provider: Provider::Instagram,
                account_id: account.clone(),
                customer_id: customer,
                customer_phone: None,
                message_id: id(message, "mid")?,
                author_handle: None,
                author_name: None,
                content,
                timestamp: timestamp(&event["timestamp"], true)?,
                direction: if echo {
                    Direction::Outbound
                } else {
                    Direction::Inbound
                },
                provenance: if echo {
                    Provenance::PhoneEcho
                } else {
                    Provenance::Customer
                },
                message_type: share_type.unwrap_or("message").to_owned(),
                reply_to: message.get("reply_to").and_then(|r| id(r, "mid").ok()),
                media,
            }));

            Ok(())
        });
    }
    for change in items(entry, "changes", events) {
        events.capture(|events| {
            events.push(IncomingEvent::Unsupported {
                account_id: Some(account.clone()),
                field: string(change, "field")?.to_owned(),
            });

            Ok(())
        });
    }
    Ok(())
}

fn instagram_revision(
    account: &ProviderId,
    event: &Value,
    payload: &Value,
    change: MessageRevision,
) -> Result<IncomingRevision, MessagingError> {
    let sender = id(&event["sender"], "id")?;
    let recipient = id(&event["recipient"], "id")?;
    let (customer_id, direction) = if &recipient == account && &sender != account {
        (sender, Direction::Inbound)
    } else if &sender == account && &recipient != account {
        (recipient, Direction::Outbound)
    } else {
        return Err(MessagingError::Invalid(
            "Instagram revision account does not match envelope",
        ));
    };
    Ok(IncomingRevision {
        provenance: Provenance::Customer,
        account_id: account.clone(),
        customer_id,
        message_id: id(payload, "mid")?,
        direction,
        timestamp: timestamp(&event["timestamp"], true)?,
        change,
    })
}

fn push_instagram_revision(
    events: &mut Decoder,
    revision: Result<IncomingRevision, MessagingError>,
) {
    events.capture(|events| {
        events.push(IncomingEvent::Revision(revision?));
        Ok(())
    });
}

fn append_content(content: &mut String, part: &str) {
    if !content.is_empty() {
        content.push_str("\n\n");
    }
    content.push_str(part);
}
