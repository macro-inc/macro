//! Maps whatsmeow events onto the linked-devices domain's session events.
//! Only group traffic becomes [`InboundEvent`]s; the account runner then drops
//! everything outside adopted groups.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use whatsapp_linked::domain::events::{
    InboundEvent, InboundKind, Media, Message, MessageKind, Receipt, Target,
};
use whatsapp_linked::domain::models::Identity;
use whatsmeow::Event;
use whatsmeow::download::{DownloadableMessage, MediaType};
use whatsmeow::proto::wa_common::MessageKey;
use whatsmeow::proto::wa_e2e;
use whatsmeow::proto::wa_e2e::protocol_message;
use whatsmeow::types::{GROUP_SERVER, Jid};

use crate::domain::ports::SessionEvent;

#[cfg(test)]
mod test;

/// Namespace for event ids, so a redelivered protocol event keeps its id.
const EVENT_NAMESPACE: Uuid = Uuid::from_u128(0x6c1e_4f0a_93d2_4b7e_8a55_0f3c_2d19_7e41);

/// Readable stand-in for message shapes Macro does not import.
const UNSUPPORTED_TEXT: &str = "Sent something Macro can't show yet";

/// What a whatsmeow event means for the account.
#[derive(Debug)]
pub enum Mapped {
    /// Connection or pairing progress for the runner.
    Session(SessionEvent),
    /// Group traffic to store before acknowledging.
    Inbound(Box<InboundEvent>),
}

/// Where and how to fetch an observed attachment. Sealed with the account's
/// data key before it leaves the process: the media key decrypts the file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaLocator {
    /// Path on the media host.
    pub direct_path: String,
    /// Key the file is encrypted with.
    pub media_key: Vec<u8>,
    /// SHA-256 of the encrypted file.
    pub file_enc_sha256: Vec<u8>,
    /// SHA-256 of the plaintext.
    pub file_sha256: Vec<u8>,
    /// Which media keys to derive.
    pub media_type: LocatorMediaType,
}

/// The media key expansion of a locator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocatorMediaType {
    /// Image keys.
    Image,
    /// Video keys.
    Video,
    /// Audio keys.
    Audio,
    /// Document keys.
    Document,
}

impl LocatorMediaType {
    /// whatsmeow's media type.
    pub fn media_type(self) -> MediaType {
        match self {
            LocatorMediaType::Image => MediaType::Image,
            LocatorMediaType::Video => MediaType::Video,
            LocatorMediaType::Audio => MediaType::Audio,
            LocatorMediaType::Document => MediaType::Document,
        }
    }
}

/// The meaning of a whatsmeow event, if the account cares about it. `seal`
/// turns a [`MediaLocator`] into the opaque bytes stored with the attachment;
/// `None` drops the attachment to a placeholder.
pub fn map_event(
    account: Uuid,
    event: &Event,
    now: DateTime<Utc>,
    seal: &dyn Fn(&MediaLocator) -> Option<Vec<u8>>,
) -> Option<Mapped> {
    Some(match event {
        Event::Message(message) => {
            Mapped::Inbound(Box::new(map_message(account, message, now, seal)?))
        }
        Event::Receipt(receipt) => Mapped::Inbound(Box::new(map_receipt(account, receipt, now)?)),
        Event::JoinedGroup(joined) => Mapped::Session(SessionEvent::GroupChanged {
            group_jid: joined.group_info.jid.to_non_ad().to_string(),
            info: Some(Box::new(super::group_info(joined.group_info.clone(), now))),
        }),
        Event::GroupInfo(change) if change.jid.server == GROUP_SERVER => {
            Mapped::Session(SessionEvent::GroupChanged {
                group_jid: change.jid.to_non_ad().to_string(),
                info: None,
            })
        }
        event => Mapped::Session(map_session(event)?),
    })
}

fn map_session(event: &Event) -> Option<SessionEvent> {
    match event {
        Event::PairPasskeyRequest(request) => Some(SessionEvent::PasskeyRequested {
            challenge: serde_json::to_value(&request.public_key).ok()?,
        }),
        // With `skip_handoff_ux` the QR channel confirms on its own.
        Event::PairPasskeyConfirmation(confirmation) if !confirmation.skip_handoff_ux => {
            Some(SessionEvent::PasskeyConfirmation {
                code: confirmation.code.clone(),
            })
        }
        Event::PairSuccess(success) => Some(SessionEvent::PairSuccess {
            identity_jid: success.id.to_non_ad().to_string(),
        }),
        Event::PairError(_) => Some(SessionEvent::PairFailed),
        Event::Connected(_) => Some(SessionEvent::Connected),
        Event::Disconnected(_) | Event::KeepAliveTimeout(_) => Some(SessionEvent::Disconnected),
        Event::LoggedOut(_) => Some(SessionEvent::LoggedOut),
        Event::StreamReplaced(_) => Some(SessionEvent::Replaced),
        _ => None,
    }
}

fn person(jid: &Jid) -> Option<String> {
    (!jid.is_empty()).then(|| jid.to_non_ad().to_string())
}

fn person_text(jid: &str) -> Option<String> {
    jid.parse::<Jid>().ok().and_then(|jid| person(&jid))
}

fn event_id(account: Uuid, parts: &[&str]) -> Uuid {
    let mut name = account.to_string();
    for part in parts {
        name.push('\n');
        name.push_str(part);
    }
    Uuid::new_v5(&EVENT_NAMESPACE, name.as_bytes())
}

/// The author of the message a key points at: the reacting or quoting
/// person themselves when `from_me`, otherwise the key's participant.
fn target(key: &MessageKey, author: &str) -> Option<Target> {
    let sender_jid = if key.from_me.unwrap_or(false) {
        author.to_owned()
    } else {
        person_text(key.participant.as_deref()?)?
    };
    Some(Target {
        source_id: key.id.clone()?,
        sender_jid,
    })
}

/// whatsmeow delivers a sender key distribution (sent with a sender's first
/// group message and on every key rotation) as its own event with the same
/// message id as the content. It is not content; importing it would claim
/// that id and drop the real message.
fn carries_only_keys(message: &wa_e2e::Message) -> bool {
    let content = wa_e2e::Message {
        sender_key_distribution_message: None,
        message_context_info: None,
        ..message.clone()
    };
    content == wa_e2e::Message::default()
}

fn text_of(message: &wa_e2e::Message) -> Option<(String, Option<&wa_e2e::ContextInfo>)> {
    if let Some(text) = &message.conversation {
        return Some((text.clone(), None));
    }
    let extended = message.extended_text_message.as_ref()?;
    Some((
        extended.text.clone().unwrap_or_default(),
        extended.context_info.as_deref(),
    ))
}

/// One attachment part of a message, with its caption.
struct Attachment<'part> {
    part: &'part (dyn DownloadableMessage + Sync),
    media_type: LocatorMediaType,
    mime: Option<&'part str>,
    filename: Option<&'part str>,
    size: Option<u64>,
    caption: Option<&'part str>,
}

fn attachment_of(message: &wa_e2e::Message) -> Option<Attachment<'_>> {
    if let Some(image) = &message.image_message {
        return Some(Attachment {
            part: image.as_ref(),
            media_type: LocatorMediaType::Image,
            mime: image.mimetype.as_deref(),
            filename: None,
            size: image.file_length,
            caption: image.caption.as_deref(),
        });
    }
    if let Some(video) = &message.video_message {
        return Some(Attachment {
            part: video.as_ref(),
            media_type: LocatorMediaType::Video,
            mime: video.mimetype.as_deref(),
            filename: None,
            size: video.file_length,
            caption: video.caption.as_deref(),
        });
    }
    if let Some(audio) = &message.audio_message {
        return Some(Attachment {
            part: audio.as_ref(),
            media_type: LocatorMediaType::Audio,
            mime: audio.mimetype.as_deref(),
            filename: None,
            size: audio.file_length,
            caption: None,
        });
    }
    let document = message.document_message.as_ref()?;
    Some(Attachment {
        part: document.as_ref(),
        media_type: LocatorMediaType::Document,
        mime: document.mimetype.as_deref(),
        filename: document.file_name.as_deref(),
        size: document.file_length,
        caption: document.caption.as_deref(),
    })
}

/// The domain's attachment for a media part, or `None` when it lacks what a
/// download needs.
fn media_of(
    attachment: &Attachment<'_>,
    seal: &dyn Fn(&MediaLocator) -> Option<Vec<u8>>,
) -> Option<Media> {
    let part = attachment.part;
    let sha256: [u8; 32] = part.get_file_sha256()?.try_into().ok()?;
    let mime = attachment
        .mime
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_owned();
    let filename = match attachment.filename {
        Some(name) if !name.is_empty() => name.to_owned(),
        _ => {
            let extension = mime.rsplit('/').next().unwrap_or("bin");
            let stem = match attachment.media_type {
                LocatorMediaType::Image => "image",
                LocatorMediaType::Video => "video",
                LocatorMediaType::Audio => "audio",
                LocatorMediaType::Document => "document",
            };
            format!("{stem}.{extension}")
        }
    };
    let locator = seal(&MediaLocator {
        direct_path: part.get_direct_path().to_owned(),
        media_key: part.get_media_key()?.to_vec(),
        file_enc_sha256: part.get_file_enc_sha256()?.to_vec(),
        file_sha256: sha256.to_vec(),
        media_type: attachment.media_type,
    })?;
    Some(Media {
        mime,
        filename,
        size: attachment.size?,
        sha256,
        locator,
    })
}

fn map_message(
    account: Uuid,
    event: &whatsmeow::types::events::Message,
    now: DateTime<Utc>,
    seal: &dyn Fn(&MediaLocator) -> Option<Vec<u8>>,
) -> Option<InboundEvent> {
    let info = &event.info;
    if info.chat.server != GROUP_SERVER {
        return None;
    }
    let author = person(&info.sender)?;
    let sender = Identity {
        jid: author.clone(),
        alternate_jid: person(&info.sender_alt),
        display_name: (!info.push_name.is_empty()).then(|| info.push_name.clone()),
    };
    let source_at = info.timestamp.unwrap_or(now);
    let message = event.message.as_ref()?;
    if carries_only_keys(message) {
        return None;
    }
    let mut media = Vec::new();
    let (kind, text, target, revision) = if let Some(protocol) = &message.protocol_message {
        let key = protocol.key.as_ref()?;
        let edit_target = Target {
            source_id: key.id.clone()?,
            sender_jid: author.clone(),
        };
        match protocol
            .r#type
            .and_then(|value| protocol_message::Type::try_from(value).ok())
        {
            Some(protocol_message::Type::Revoke) => {
                (MessageKind::Delete, String::new(), Some(edit_target), 0)
            }
            Some(protocol_message::Type::MessageEdit) => {
                let (text, _) = protocol.edited_message.as_deref().and_then(text_of)?;
                let revision = protocol
                    .timestamp_ms
                    .unwrap_or_else(|| source_at.timestamp_millis());
                (MessageKind::Edit, text, Some(edit_target), revision)
            }
            // Key shares, history notifications and the like are not group content.
            _ => return None,
        }
    } else if let Some(reaction) = &message.reaction_message {
        let target = target(reaction.key.as_ref()?, &author)?;
        let revision = reaction.sender_timestamp_ms.unwrap_or(0);
        (
            MessageKind::Reaction,
            reaction.text.clone().unwrap_or_default(),
            Some(target),
            revision,
        )
    } else if let Some(attachment) = attachment_of(message) {
        match media_of(&attachment, seal) {
            Some(part) => {
                media.push(part);
                (
                    MessageKind::Text,
                    attachment.caption.unwrap_or_default().to_owned(),
                    None,
                    0,
                )
            }
            None => (
                MessageKind::Unsupported,
                UNSUPPORTED_TEXT.to_owned(),
                None,
                0,
            ),
        }
    } else if let Some((text, context)) = text_of(message) {
        let quote = context.and_then(|context| {
            Some(Target {
                source_id: context.stanza_id.clone()?,
                sender_jid: person_text(context.participant.as_deref()?)?,
            })
        });
        (MessageKind::Text, text, quote, 0)
    } else {
        (
            MessageKind::Unsupported,
            UNSUPPORTED_TEXT.to_owned(),
            None,
            0,
        )
    };
    let kind_name = match kind {
        MessageKind::Text => "text",
        MessageKind::Reaction => "reaction",
        MessageKind::Edit => "edit",
        MessageKind::Delete => "delete",
        MessageKind::Unsupported => "unsupported",
    };
    let revision_text = revision.to_string();
    Some(InboundEvent {
        event_id: event_id(
            account,
            &[
                "message",
                &info.chat.to_string(),
                &author,
                info.id.as_str(),
                kind_name,
                &revision_text,
            ],
        ),
        group_jid: info.chat.to_non_ad().to_string(),
        source_at,
        observed_at: now,
        kind: InboundKind::Message(Message {
            source_id: info.id.to_string(),
            sender,
            kind,
            text,
            history: false,
            revision,
            target,
            media,
        }),
    })
}

fn map_receipt(
    account: Uuid,
    receipt: &whatsmeow::types::events::Receipt,
    now: DateTime<Utc>,
) -> Option<InboundEvent> {
    let source = &receipt.source;
    if source.chat.server != GROUP_SERVER || receipt.message_ids.is_empty() {
        return None;
    }
    let participant = person(&source.sender)?;
    let state = match receipt.r#type.as_str() {
        "" => "delivered",
        other => other,
    };
    let source_ids: Vec<String> = receipt
        .message_ids
        .iter()
        .map(ToString::to_string)
        .collect();
    let joined = source_ids.join(",");
    Some(InboundEvent {
        event_id: event_id(
            account,
            &[
                "receipt",
                &source.chat.to_string(),
                &participant,
                state,
                &joined,
            ],
        ),
        group_jid: source.chat.to_non_ad().to_string(),
        source_at: receipt.timestamp.unwrap_or(now),
        observed_at: now,
        kind: InboundKind::Receipt(Receipt {
            source_ids,
            participant_jid: participant,
            state: state.to_owned(),
        }),
    })
}
