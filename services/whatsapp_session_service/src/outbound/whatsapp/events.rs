//! Maps whatsmeow events onto the linked-devices domain's session events.
//! Only group traffic becomes [`InboundEvent`]s; the account runner then drops
//! everything outside adopted groups.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use external_chat::domain::rich::SystemLine;
use external_chat::domain::{
    models::{ExternalChatKind, MediaPresentation},
    rich::RichContent,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use whatsapp_linked::domain::events::{
    ChatUpdate, HistoryPage, InboundEvent, InboundKind, LookupAnswer, Media, Message,
    MessageAnchor, MessageKind, Receipt, ReceiptState, Target,
};
use whatsapp_linked::domain::jid::PhoneNumber;
use whatsapp_linked::domain::models::Identity;
use whatsmeow::Event;
use whatsmeow::download::{DownloadableMessage, MediaType};
use whatsmeow::proto::wa_common::MessageKey;
use whatsmeow::proto::wa_e2e;
use whatsmeow::proto::wa_e2e::protocol_message;
use whatsmeow::proto::wa_history_sync::conversation::EndOfHistoryTransferType;
use whatsmeow::proto::wa_history_sync::{Conversation, HistorySync, Pushname};
use whatsmeow::proto::wa_web::WebMessageInfo;
use whatsmeow::store::{ContactStore, LidStore, StoreError};
use whatsmeow::types::events::GroupInfo;
use whatsmeow::types::{
    ContactInfo, DEFAULT_USER_SERVER, GROUP_SERVER, HIDDEN_USER_SERVER, IsOnWhatsAppResponse, Jid,
    MessageSource,
};

use crate::domain::ports::SessionEvent;

mod rich;
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

/// What a whatsmeow event means for the account, if anything. `seal` turns
/// a [`MediaLocator`] into the opaque bytes stored with the attachment;
/// `None` drops the attachment to a placeholder. Poll votes are mapped by
/// [`map_poll_vote`] once decrypted.
pub fn map_event(
    account: Uuid,
    event: &Event,
    now: DateTime<Utc>,
    seal: &dyn Fn(&MediaLocator) -> Option<Vec<u8>>,
) -> Vec<Mapped> {
    let inbound = |event: InboundEvent| Mapped::Inbound(Box::new(event));
    match event {
        // A message the phone sent again on request is an earlier message.
        Event::Message(message) => map_message(
            account,
            message,
            now,
            seal,
            !message.unavailable_request_id.is_empty(),
        )
        .map(inbound)
        .into_iter()
        .collect(),
        Event::Receipt(receipt) => map_receipt(account, receipt, now)
            .map(inbound)
            .into_iter()
            .collect(),
        Event::JoinedGroup(joined) => vec![Mapped::Session(SessionEvent::GroupChanged {
            group_jid: joined.group_info.jid.to_non_ad().to_string(),
            info: Some(Box::new(super::group_info(joined.group_info.clone(), now))),
        })],
        Event::GroupInfo(change) if change.jid.server == GROUP_SERVER => {
            let mut mapped = vec![Mapped::Session(SessionEvent::GroupChanged {
                group_jid: change.jid.to_non_ad().to_string(),
                info: None,
            })];
            mapped.extend(
                map_group_info(account, change, now)
                    .into_iter()
                    .map(inbound),
            );
            mapped
        }
        Event::Picture(picture) => map_group_picture(account, picture, now)
            .map(inbound)
            .into_iter()
            .collect(),
        event => map_session(event)
            .map(Mapped::Session)
            .into_iter()
            .collect(),
    }
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

/// A direct chat as the account's phone keys it: by LID when the store knows
/// the person's LID (phones keep direct chats by LID), else as given.
pub async fn phone_chat(lids: &dyn LidStore, chat: Jid) -> Jid {
    if chat.server != DEFAULT_USER_SERVER {
        return chat;
    }
    match lids.get_lid_for_pn(&chat).await {
        Ok(Some(lid)) => lid.to_non_ad(),
        Ok(None) => chat,
        Err(error) => {
            tracing::debug!(error = %error, "Reading a chat's LID mapping failed");
            chat
        }
    }
}

/// A direct chat as Macro keys it: by phone number when the store knows it.
pub async fn macro_chat(lids: &dyn LidStore, chat: &str) -> String {
    let Ok(jid) = chat.parse::<Jid>() else {
        return chat.to_owned();
    };
    if jid.server != HIDDEN_USER_SERVER {
        return chat.to_owned();
    }
    match lids.get_pn_for_lid(&jid).await {
        Ok(Some(phone)) => phone.to_non_ad().to_string(),
        Ok(None) => chat.to_owned(),
        Err(error) => {
            tracing::debug!(error = %error, "Reading a chat's LID mapping failed");
            chat.to_owned()
        }
    }
}

/// Fills in addresses the message didn't carry from the account's LID store:
/// the sender's other address (see [`complete_sender`]) and a direct chat's
/// other address, so either addressing reaches the added chat. A store
/// failure is returned: without the other address the gate could drop a
/// message of an added chat, so the caller leaves it unacknowledged and
/// WhatsApp redelivers it.
pub async fn complete_addresses(
    lids: &dyn LidStore,
    event: &mut InboundEvent,
) -> Result<(), StoreError> {
    complete_sender(lids, event).await?;
    if event.chat_alternate_jid.is_some() {
        return Ok(());
    }
    let Ok(chat) = event.group_jid.parse::<Jid>() else {
        return Ok(());
    };
    let alternate = match chat.server.as_str() {
        HIDDEN_USER_SERVER => lids.get_pn_for_lid(&chat).await?,
        DEFAULT_USER_SERVER => lids.get_lid_for_pn(&chat).await?,
        _ => return Ok(()),
    };
    match alternate {
        Some(alternate) if alternate.server == DEFAULT_USER_SERVER => {
            // Direct chats go by phone number when it is known.
            event.chat_alternate_jid = Some(event.group_jid.clone());
            event.group_jid = alternate.to_non_ad().to_string();
        }
        alternate => event.chat_alternate_jid = alternate.as_ref().and_then(person),
    }
    Ok(())
}

/// Fills the other half of a message sender's phone-number/LID pair from the
/// account's LID store, which whatsmeow fills at pairing (the account's own
/// pair), from group participant lists and from message addressing. Without
/// it a LID-only sender cannot be matched to the person already seen by phone
/// number and is quarantined.
pub async fn complete_sender(
    lids: &dyn LidStore,
    event: &mut InboundEvent,
) -> Result<(), StoreError> {
    let InboundKind::Message(message) = &mut event.kind else {
        return Ok(());
    };
    let sender = &mut message.sender;
    if sender.alternate_jid.is_some() {
        return Ok(());
    }
    let Ok(jid) = sender.jid.parse::<Jid>() else {
        return Ok(());
    };
    let alternate = match jid.server.as_str() {
        HIDDEN_USER_SERVER => lids.get_pn_for_lid(&jid).await?,
        DEFAULT_USER_SERVER => lids.get_lid_for_pn(&jid).await?,
        _ => return Ok(()),
    };
    sender.alternate_jid = alternate.as_ref().and_then(person);
    Ok(())
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

fn text_of(message: &wa_e2e::Message) -> Option<String> {
    if let Some(text) = &message.conversation {
        return Some(text.clone());
    }
    let extended = message.extended_text_message.as_ref()?;
    Some(extended.text.clone().unwrap_or_default())
}

/// The context of a message's content part: what it quotes, whom it
/// mentions, whether it was forwarded. Every content type carries its own.
fn context_of(message: &wa_e2e::Message) -> Option<&wa_e2e::ContextInfo> {
    [
        message
            .extended_text_message
            .as_ref()
            .and_then(|part| part.context_info.as_deref()),
        message
            .image_message
            .as_ref()
            .and_then(|part| part.context_info.as_deref()),
        message
            .video_message
            .as_ref()
            .and_then(|part| part.context_info.as_deref()),
        message
            .audio_message
            .as_ref()
            .and_then(|part| part.context_info.as_deref()),
        message
            .document_message
            .as_ref()
            .and_then(|part| part.context_info.as_deref()),
        message
            .sticker_message
            .as_ref()
            .and_then(|part| part.context_info.as_deref()),
    ]
    .into_iter()
    .flatten()
    .next()
}

/// The message a reply quotes.
fn quote_of(context: Option<&wa_e2e::ContextInfo>) -> Option<Target> {
    let context = context?;
    Some(Target {
        source_id: context.stanza_id.clone()?,
        sender_jid: person_text(context.participant.as_deref()?)?,
    })
}

/// One attachment part of a message, with its caption.
struct Attachment<'part> {
    part: &'part (dyn DownloadableMessage + Sync),
    media_type: LocatorMediaType,
    mime: Option<&'part str>,
    filename: Option<&'part str>,
    size: Option<u64>,
    caption: Option<&'part str>,
    width: Option<u32>,
    height: Option<u32>,
    seconds: Option<u32>,
    presentation: Option<MediaPresentation>,
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
            width: image.width,
            height: image.height,
            seconds: None,
            presentation: None,
        });
    }
    if let Some(sticker) = &message.sticker_message {
        return Some(Attachment {
            part: sticker.as_ref(),
            media_type: LocatorMediaType::Image,
            mime: sticker.mimetype.as_deref().or(Some("image/webp")),
            filename: None,
            size: sticker.file_length,
            caption: None,
            width: sticker.width,
            height: sticker.height,
            seconds: None,
            presentation: Some(MediaPresentation::Sticker),
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
            width: video.width,
            height: video.height,
            seconds: video.seconds,
            presentation: video
                .gif_playback
                .unwrap_or(false)
                .then_some(MediaPresentation::Gif),
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
            width: None,
            height: None,
            seconds: audio.seconds,
            presentation: audio
                .ptt
                .unwrap_or(false)
                .then_some(MediaPresentation::VoiceNote),
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
        width: None,
        height: None,
        seconds: None,
        presentation: None,
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
                LocatorMediaType::Image if attachment.presentation.is_some() => "sticker",
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
        width: attachment.width.filter(|width| *width > 0),
        height: attachment.height.filter(|height| *height > 0),
        duration_seconds: attachment.seconds,
        presentation: attachment.presentation,
    })
}

/// An earlier message the phone sent in a history page, as an inbound event
/// marked history: imported without notifications or unread counts.
pub fn map_history_message(
    account: Uuid,
    event: &whatsmeow::types::events::Message,
    now: DateTime<Utc>,
    seal: &dyn Fn(&MediaLocator) -> Option<Vec<u8>>,
) -> Option<InboundEvent> {
    map_message(account, event, now, seal, true)
}

fn map_message(
    account: Uuid,
    event: &whatsmeow::types::events::Message,
    now: DateTime<Utc>,
    seal: &dyn Fn(&MediaLocator) -> Option<Vec<u8>>,
    history: bool,
) -> Option<InboundEvent> {
    let info = &event.info;
    chat_of(info)?;
    let author = person(&info.sender)?;
    let source_at = info.timestamp.unwrap_or(now);
    let content = match event.message.as_ref() {
        Some(message) => {
            if carries_only_keys(message) || message.poll_update_message.is_some() {
                return None;
            }
            message_content(message, &author, source_at, seal)?
        }
        // A history page keeps what happened in the group as stub messages.
        None => {
            let line = event.source_web_msg.as_ref().and_then(rich::stub_line)?;
            let target = event
                .source_web_msg
                .as_ref()
                .and_then(|web| web.pin_in_chat.as_ref()?.key.as_ref())
                .and_then(|key| target(key, &author));
            Content {
                kind: MessageKind::System,
                text: String::new(),
                target,
                revision: 0,
                media: vec![],
                rich: Some(RichContent::System(line)),
                context: None,
            }
        }
    };
    Some(inbound_message(
        account, event, &author, now, history, content,
    ))
}

/// What one message says, before it is addressed to its group.
struct Content<'message> {
    kind: MessageKind,
    text: String,
    target: Option<Target>,
    revision: i64,
    media: Vec<Media>,
    rich: Option<RichContent>,
    context: Option<&'message wa_e2e::ContextInfo>,
}

impl Content<'_> {
    fn new(kind: MessageKind, text: String, target: Option<Target>, revision: i64) -> Self {
        Self {
            kind,
            text,
            target,
            revision,
            media: vec![],
            rich: None,
            context: None,
        }
    }

    fn unsupported(text: &str) -> Self {
        Self::new(MessageKind::Unsupported, text.to_owned(), None, 0)
    }
}

/// Media WhatsApp shows once on the phone (the port unwraps the view-once
/// wrappers; the flag can also sit on the media itself). Macro keeps it.
fn message_view_once(message: Option<&wa_e2e::Message>) -> bool {
    message.is_some_and(|message| {
        message
            .image_message
            .as_ref()
            .and_then(|part| part.view_once)
            .or_else(|| {
                message
                    .video_message
                    .as_ref()
                    .and_then(|part| part.view_once)
            })
            .or_else(|| {
                message
                    .audio_message
                    .as_ref()
                    .and_then(|part| part.view_once)
            })
            .unwrap_or(false)
    })
}

fn message_content<'message>(
    message: &'message wa_e2e::Message,
    author: &str,
    source_at: DateTime<Utc>,
    seal: &dyn Fn(&MediaLocator) -> Option<Vec<u8>>,
) -> Option<Content<'message>> {
    if let Some(protocol) = &message.protocol_message {
        let key = protocol.key.as_ref()?;
        let edit_target = Target {
            source_id: key.id.clone()?,
            sender_jid: author.to_owned(),
        };
        return match protocol
            .r#type
            .and_then(|value| protocol_message::Type::try_from(value).ok())
        {
            Some(protocol_message::Type::Revoke) => Some(Content::new(
                MessageKind::Delete,
                String::new(),
                Some(edit_target),
                0,
            )),
            Some(protocol_message::Type::MessageEdit) => {
                let text = protocol.edited_message.as_deref().and_then(text_of)?;
                let revision = protocol
                    .timestamp_ms
                    .unwrap_or_else(|| source_at.timestamp_millis());
                Some(Content::new(
                    MessageKind::Edit,
                    text,
                    Some(edit_target),
                    revision,
                ))
            }
            // Key shares, history notifications and the like are not group content.
            _ => None,
        };
    }
    if let Some(reaction) = &message.reaction_message {
        let target = target(reaction.key.as_ref()?, author)?;
        return Some(Content::new(
            MessageKind::Reaction,
            reaction.text.clone().unwrap_or_default(),
            Some(target),
            reaction.sender_timestamp_ms.unwrap_or(0),
        ));
    }
    if let Some(pin) = message.pin_in_chat_message.as_ref() {
        let line = rich::pin_line(pin)?;
        return Some(Content {
            rich: Some(RichContent::System(line)),
            ..Content::new(
                MessageKind::System,
                String::new(),
                target(pin.key.as_ref()?, author),
                0,
            )
        });
    }
    if let Some(call) = message.call_log_messsage.as_ref() {
        return Some(Content {
            rich: Some(RichContent::System(rich::call_line(call))),
            ..Content::new(MessageKind::System, String::new(), None, 0)
        });
    }
    if let Some(attachment) = attachment_of(message) {
        let context = context_of(message);
        return Some(match media_of(&attachment, seal) {
            Some(part) => Content {
                media: vec![part],
                context,
                ..Content::new(
                    MessageKind::Text,
                    attachment.caption.unwrap_or_default().to_owned(),
                    quote_of(context),
                    0,
                )
            },
            None => Content::unsupported(UNSUPPORTED_TEXT),
        });
    }
    if let Some(rich_content) = rich::rich_of(message) {
        let context = rich::rich_context(message);
        return Some(Content {
            rich: Some(rich_content),
            context,
            ..Content::new(MessageKind::Rich, String::new(), quote_of(context), 0)
        });
    }
    if let Some(text) = text_of(message) {
        let context = context_of(message);
        return Some(Content {
            context,
            ..Content::new(MessageKind::Text, text, quote_of(context), 0)
        });
    }
    Some(Content::unsupported(UNSUPPORTED_TEXT))
}

fn inbound_message(
    account: Uuid,
    event: &whatsmeow::types::events::Message,
    author: &str,
    now: DateTime<Utc>,
    history: bool,
    content: Content<'_>,
) -> InboundEvent {
    let info = &event.info;
    let sender = Identity {
        jid: author.to_owned(),
        alternate_jid: person(&info.sender_alt),
        display_name: (!info.push_name.is_empty()).then(|| info.push_name.clone()),
    };
    let revision_text = content.revision.to_string();
    let mentions = content
        .context
        .map(|context| {
            context
                .mentioned_jid
                .iter()
                .filter_map(|jid| person_text(jid))
                .collect()
        })
        .unwrap_or_default();
    let (group_jid, chat_alternate_jid) =
        chat_of(info).unwrap_or_else(|| (info.chat.to_non_ad().to_string(), None));
    InboundEvent {
        event_id: event_id(
            account,
            &[
                "message",
                &info.chat.to_string(),
                author,
                info.id.as_str(),
                content.kind.as_str(),
                &revision_text,
            ],
        ),
        group_jid,
        chat_alternate_jid,
        source_at: info.timestamp.unwrap_or(now),
        observed_at: now,
        kind: InboundKind::Message(Message {
            source_id: info.id.to_string(),
            sender,
            kind: content.kind,
            text: content.text,
            from_me: info.is_from_me,
            history,
            revision: content.revision,
            target: content.target,
            media: content.media,
            mentions,
            forwarded: content
                .context
                .is_some_and(|context| context.is_forwarded.unwrap_or(false)),
            view_once: event.is_view_once || message_view_once(event.message.as_ref()),
            rich: content.rich,
        }),
    }
}

/// A decrypted vote on a poll in a group: the options the voter chose now.
pub fn map_poll_vote(
    account: Uuid,
    event: &whatsmeow::types::events::Message,
    selected: &[Vec<u8>],
    now: DateTime<Utc>,
) -> Option<InboundEvent> {
    let info = &event.info;
    chat_of(info)?;
    let author = person(&info.sender)?;
    let update = event.message.as_ref()?.poll_update_message.as_ref()?;
    let poll = target(update.poll_creation_message_key.as_ref()?, &author)?;
    let content = Content {
        rich: Some(rich::poll_vote(selected)),
        ..Content::new(
            MessageKind::PollVote,
            String::new(),
            Some(poll),
            update.sender_timestamp_ms.unwrap_or(0),
        )
    };
    Some(inbound_message(
        account,
        event,
        &author,
        now,
        !event.unavailable_request_id.is_empty(),
        content,
    ))
}

/// The votes a history page carries on a poll message (already decrypted by
/// the phone), one event per voter.
pub fn history_poll_votes(
    account: Uuid,
    event: &whatsmeow::types::events::Message,
    now: DateTime<Utc>,
) -> Vec<InboundEvent> {
    let Some(web) = event.source_web_msg.as_ref() else {
        return vec![];
    };
    let Some(poll_author) = person(&event.info.sender) else {
        return vec![];
    };
    let Some((group_jid, chat_alternate_jid)) = chat_of(&event.info) else {
        return vec![];
    };
    let direct = event.info.chat.server != GROUP_SERVER;
    let poll = Target {
        source_id: event.info.id.clone(),
        sender_jid: poll_author,
    };
    web.poll_updates
        .iter()
        .filter_map(|update| {
            let key = update.poll_update_message_key.as_ref()?;
            let voter = if key.from_me.unwrap_or(false) {
                person(&event.info.sender).filter(|_| event.info.is_from_me)?
            } else if direct {
                // A direct chat's only other voter is the other person.
                person_text(key.participant.as_deref().unwrap_or(&group_jid))?
            } else {
                person_text(key.participant.as_deref()?)?
            };
            let vote = update.vote.as_ref()?;
            let source_id = key.id.clone()?;
            let revision = update.sender_timestamp_ms.unwrap_or(0);
            let source_at = DateTime::from_timestamp_millis(revision).unwrap_or(now);
            Some(InboundEvent {
                event_id: event_id(
                    account,
                    &[
                        "message",
                        &event.info.chat.to_string(),
                        &voter,
                        &source_id,
                        MessageKind::PollVote.as_str(),
                        &revision.to_string(),
                    ],
                ),
                group_jid: group_jid.clone(),
                chat_alternate_jid: chat_alternate_jid.clone(),
                source_at,
                observed_at: now,
                kind: InboundKind::Message(Message {
                    source_id,
                    sender: Identity {
                        jid: voter,
                        alternate_jid: None,
                        display_name: None,
                    },
                    from_me: key.from_me.unwrap_or(false),
                    kind: MessageKind::PollVote,
                    text: String::new(),
                    history: true,
                    revision,
                    target: Some(poll.clone()),
                    media: vec![],
                    mentions: vec![],
                    forwarded: false,
                    view_once: false,
                    rich: Some(rich::poll_vote(&vote.selected_options)),
                }),
            })
        })
        .collect()
}

/// A system line from a group notification, which has no message id: the
/// line gets a stable one from what it says.
fn system_event(
    account: Uuid,
    group: &Jid,
    actor: Option<&Jid>,
    actor_pn: Option<&Jid>,
    at: Option<DateTime<Utc>>,
    mut line: SystemLine,
    now: DateTime<Utc>,
) -> InboundEvent {
    let group = group.to_non_ad().to_string();
    let actor = actor.and_then(person);
    line.by_whatsapp = actor.is_none();
    let source_at = at.unwrap_or(now);
    // The same change seen by several accounts is one line: its id comes
    // from what it says, never from who saw it.
    let said = [
        "system",
        &group,
        &source_at.timestamp().to_string(),
        &serde_json::to_string(&line).unwrap_or_default(),
    ]
    .join("\n");
    let source = Uuid::new_v5(&EVENT_NAMESPACE, said.as_bytes());
    InboundEvent {
        event_id: event_id(account, &[&said]),
        source_at,
        observed_at: now,
        kind: InboundKind::Message(Message {
            source_id: format!("SYSTEM-{}", source.simple()).to_uppercase(),
            sender: Identity {
                jid: actor.unwrap_or_else(|| group.clone()),
                alternate_jid: actor_pn.and_then(person),
                display_name: None,
            },
            from_me: false,
            kind: MessageKind::System,
            text: String::new(),
            history: false,
            revision: 0,
            target: None,
            media: vec![],
            mentions: vec![],
            forwarded: false,
            view_once: false,
            rich: Some(RichContent::System(line)),
        }),
        group_jid: group,
        chat_alternate_jid: None,
    }
}

/// The system lines of a live group notification, each its own event.
pub fn map_group_info(account: Uuid, change: &GroupInfo, now: DateTime<Utc>) -> Vec<InboundEvent> {
    let actor = change.sender.as_ref().and_then(person);
    rich::group_info_lines(change, actor.as_deref())
        .into_iter()
        .map(|line| {
            system_event(
                account,
                &change.jid,
                change.sender.as_ref(),
                change.sender_pn.as_ref(),
                change.timestamp,
                line,
                now,
            )
        })
        .collect()
}

/// A new (or removed) group icon, as a system line.
pub fn map_group_picture(
    account: Uuid,
    picture: &whatsmeow::types::events::Picture,
    now: DateTime<Utc>,
) -> Option<InboundEvent> {
    (picture.jid.server == GROUP_SERVER).then(|| {
        system_event(
            account,
            &picture.jid,
            (!picture.author.is_empty()).then_some(&picture.author),
            None,
            picture.timestamp,
            rich::icon_line(),
            now,
        )
    })
}

fn map_receipt(
    account: Uuid,
    receipt: &whatsmeow::types::events::Receipt,
    now: DateTime<Utc>,
) -> Option<InboundEvent> {
    let source = &receipt.source;
    if receipt.message_ids.is_empty() {
        return None;
    }
    let (group_jid, chat_alternate_jid) = chat_of(source)?;
    let participant = person(&source.sender)?;
    let state = match receipt.r#type.as_str() {
        "" => ReceiptState::Delivered,
        "read" => ReceiptState::Read,
        "played" => ReceiptState::Played,
        _ => return None,
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
                state.as_ref(),
                &joined,
            ],
        ),
        group_jid,
        chat_alternate_jid,
        source_at: receipt.timestamp.unwrap_or(now),
        observed_at: now,
        kind: InboundKind::Receipt(Receipt {
            source_ids,
            participant_jid: participant,
            state,
        }),
    })
}

/// The chat a message or receipt belongs to: the group, or a direct chat's
/// other person, by phone number when the addressing carries it, with their
/// other address. `None` for what isn't a chat (status, broadcasts, channels).
fn chat_of(source: &MessageSource) -> Option<(String, Option<String>)> {
    let chat = source.chat.to_non_ad();
    match chat_kind(&chat)? {
        ExternalChatKind::Group => Some((chat.to_string(), None)),
        ExternalChatKind::Direct => {
            let alternate = if source.is_from_me {
                &source.recipient_alt
            } else {
                &source.sender_alt
            };
            let other = (!alternate.is_empty() && alternate.server != chat.server)
                .then(|| alternate.to_non_ad())
                .filter(|other| chat_kind(other) == Some(ExternalChatKind::Direct));
            Some(match other {
                Some(phone) if phone.server == DEFAULT_USER_SERVER => {
                    (phone.to_string(), Some(chat.to_string()))
                }
                other => (chat.to_string(), other.map(|other| other.to_string())),
            })
        }
    }
}

/// A chat in the account's list: groups, and direct chats with people.
/// Status updates, broadcasts and channels are not chats.
fn chat_kind(jid: &Jid) -> Option<ExternalChatKind> {
    match jid.server.as_str() {
        GROUP_SERVER => Some(ExternalChatKind::Group),
        DEFAULT_USER_SERVER | HIDDEN_USER_SERVER if !jid.user.is_empty() => {
            Some(ExternalChatKind::Direct)
        }
        _ => None,
    }
}

fn timestamp(seconds: Option<u64>) -> Option<DateTime<Utc>> {
    DateTime::from_timestamp(
        i64::try_from(seconds.filter(|seconds| *seconds > 0)?).ok()?,
        0,
    )
}

/// Whether a message is something a chat list counts as activity: content,
/// not reactions, protocol messages or key distributions.
fn is_activity(message: &wa_e2e::Message) -> bool {
    !carries_only_keys(message)
        && message.protocol_message.is_none()
        && message.reaction_message.is_none()
}

/// A live message moves its chat to the top of the account's list, adding
/// the chat if it is new. Only names and ids; never content.
pub fn message_chat(event: &whatsmeow::types::events::Message) -> Option<ChatUpdate> {
    let info = &event.info;
    if !event.unavailable_request_id.is_empty() || !is_activity(event.message.as_ref()?) {
        return None;
    }
    // A direct chat WhatsApp addresses by LID is listed by phone number when
    // the message carries it.
    let alternate = if info.is_from_me {
        &info.recipient_alt
    } else {
        &info.sender_alt
    };
    let chat = if info.chat.server == HIDDEN_USER_SERVER && alternate.server == DEFAULT_USER_SERVER
    {
        alternate.to_non_ad()
    } else {
        info.chat.to_non_ad()
    };
    let kind = chat_kind(&chat)?;
    let at = info.timestamp?;
    Some(ChatUpdate {
        jid: chat.to_string(),
        kind,
        // A direct chat is named after the other person, never after us.
        name: (kind == ExternalChatKind::Direct && !info.is_from_me && !info.push_name.is_empty())
            .then(|| info.push_name.clone()),
        last_activity_at: Some(at),
        archived: None,
        pinned: None,
        anchor: Some(MessageAnchor {
            id: info.id.clone(),
            at,
            from_me: info.is_from_me,
            sender_jid: person(&info.sender),
        }),
        create: true,
    })
}

/// The key of a history message, as an anchor.
pub fn web_message_anchor(message: &WebMessageInfo) -> Option<MessageAnchor> {
    let key = &message.key;
    Some(MessageAnchor {
        id: key.id.clone().filter(|id| !id.is_empty())?,
        at: timestamp(message.message_timestamp)?,
        from_me: key.from_me.unwrap_or(false),
        sender_jid: message
            .participant
            .as_deref()
            .or(key.participant.as_deref())
            .and_then(person_text),
    })
}

/// The chat of a history-sync conversation, by phone number when WhatsApp
/// gave one for a LID chat.
fn conversation_chat(conversation: &Conversation) -> Option<(Jid, ExternalChatKind)> {
    let id: Jid = conversation.id.parse().ok()?;
    let id = match (id.server.as_str(), conversation.pn_jid.as_deref()) {
        (HIDDEN_USER_SERVER, Some(pn)) => pn.parse().unwrap_or(id),
        _ => id,
    }
    .to_non_ad();
    let kind = chat_kind(&id)?;
    Some((id, kind))
}

/// The chats of a history-sync bundle (the initial chat list, recent and
/// full syncs): names, activity, archive and pin, and each chat's newest
/// message as its anchor. Push-name bundles only rename known direct chats.
pub fn history_chats(history: &HistorySync) -> Vec<ChatUpdate> {
    let mut chats: Vec<ChatUpdate> = history
        .conversations
        .iter()
        .filter_map(|conversation| {
            let (jid, kind) = conversation_chat(conversation)?;
            let anchor = conversation
                .messages
                .iter()
                .filter_map(|message| web_message_anchor(message.message.as_ref()?))
                .max_by_key(|anchor| anchor.at);
            let activity = [
                timestamp(conversation.conversation_timestamp),
                timestamp(conversation.last_msg_timestamp),
                anchor.as_ref().map(|anchor| anchor.at),
            ]
            .into_iter()
            .flatten()
            .max();
            let name = [
                conversation.name.as_deref(),
                conversation.display_name.as_deref(),
            ]
            .into_iter()
            .flatten()
            .map(str::trim)
            .find(|name| !name.is_empty())
            .map(str::to_owned);
            Some(ChatUpdate {
                jid: jid.to_string(),
                kind,
                name,
                last_activity_at: activity,
                archived: conversation.archived,
                pinned: conversation.pinned.map(|pinned| pinned > 0),
                anchor,
                create: true,
            })
        })
        .collect();
    chats.extend(history.pushnames.iter().filter_map(push_name_chat));
    chats
}

fn push_name_chat(push_name: &Pushname) -> Option<ChatUpdate> {
    let jid: Jid = push_name.id.as_deref()?.parse().ok()?;
    let name = push_name.pushname.as_deref()?.trim();
    (chat_kind(&jid) == Some(ExternalChatKind::Direct) && !name.is_empty()).then(|| ChatUpdate {
        jid: jid.to_non_ad().to_string(),
        kind: ExternalChatKind::Direct,
        name: Some(name.to_owned()),
        last_activity_at: None,
        archived: None,
        pinned: None,
        anchor: None,
        create: false,
    })
}

/// A setting change (archive, pin) or a new name for a chat already listed.
fn setting_chat(jid: &Jid, update: impl FnOnce(&mut ChatUpdate)) -> Option<ChatUpdate> {
    let jid = jid.to_non_ad();
    let mut chat = ChatUpdate {
        jid: jid.to_string(),
        kind: chat_kind(&jid)?,
        name: None,
        last_activity_at: None,
        archived: None,
        pinned: None,
        anchor: None,
        create: false,
    };
    update(&mut chat);
    Some(chat)
}

/// What an app-state or contact event changes in the chat list.
pub fn chat_setting(event: &Event) -> Option<ChatUpdate> {
    match event {
        Event::Archive(archive) => setting_chat(&archive.jid, |chat| {
            chat.archived = archive.action.as_ref().and_then(|action| action.archived);
        }),
        Event::Pin(pin) => setting_chat(&pin.jid, |chat| {
            chat.pinned = pin.action.as_ref().and_then(|action| action.pinned);
        }),
        Event::PushName(push_name) if !push_name.new_push_name.is_empty() => {
            setting_chat(&push_name.jid, |chat| {
                chat.name = Some(push_name.new_push_name.clone());
            })
            .filter(|chat| chat.kind == ExternalChatKind::Direct)
        }
        // A saved contact is someone to start a chat with, so it is listed
        // even before anyone wrote.
        Event::Contact(contact) => {
            let action = contact.action.as_ref()?;
            let name = action
                .full_name
                .as_deref()
                .or(action.first_name.as_deref())
                .filter(|name| !name.trim().is_empty())?;
            setting_chat(&contact.jid, |chat| {
                chat.name = Some(name.to_owned());
                chat.create = true;
            })
            .filter(|chat| chat.kind == ExternalChatKind::Direct)
        }
        _ => None,
    }
}

/// The address book's saved contacts as direct chats with no activity, so
/// the chat list offers people never written to. People only seen with a
/// WhatsApp or business name (in groups, say) are not saved contacts.
pub fn contact_chats(contacts: &HashMap<Jid, ContactInfo>) -> Vec<ChatUpdate> {
    contacts
        .iter()
        .filter_map(|(jid, contact)| {
            let name = [&contact.full_name, &contact.first_name]
                .into_iter()
                .find(|name| !name.trim().is_empty())?;
            setting_chat(jid, |chat| {
                chat.name = Some(name.clone());
                chat.create = true;
            })
            .filter(|chat| chat.kind == ExternalChatKind::Direct)
        })
        .collect()
}

/// WhatsApp's answer to `IsOnWhatsApp` for one number: registered numbers
/// are found as their phone-number chat, named like any chat (address book,
/// else the verified business or WhatsApp name).
pub async fn lookup_answer(
    lids: &dyn LidStore,
    contacts: &dyn ContactStore,
    phone: &PhoneNumber,
    answers: &[IsOnWhatsAppResponse],
) -> LookupAnswer {
    let Some(answer) = answers.iter().find(|answer| answer.is_in) else {
        return LookupAnswer::NotOnWhatsApp;
    };
    let business = answer
        .verified_name
        .as_ref()
        .and_then(|verified| verified.details.as_ref())
        .and_then(|details| details.verified_name.clone())
        .filter(|name| !name.trim().is_empty());
    let mut chats = [ChatUpdate {
        jid: phone.jid(),
        kind: ExternalChatKind::Direct,
        name: business,
        last_activity_at: None,
        archived: None,
        pinned: None,
        anchor: None,
        create: true,
    }];
    complete_chats(lids, contacts, &mut chats).await;
    let [chat] = chats;
    LookupAnswer::Found {
        jid: chat.jid,
        name: chat.name,
    }
}

/// Direct chats by phone number when the LID store knows it, and named after
/// the address book (else the WhatsApp name) when nothing better was given.
pub async fn complete_chats(
    lids: &dyn LidStore,
    contacts: &dyn ContactStore,
    chats: &mut [ChatUpdate],
) {
    for chat in chats
        .iter_mut()
        .filter(|chat| chat.kind == ExternalChatKind::Direct)
    {
        let Ok(mut jid) = chat.jid.parse::<Jid>() else {
            continue;
        };
        if jid.server == HIDDEN_USER_SERVER
            && let Ok(Some(pn)) = lids.get_pn_for_lid(&jid).await
        {
            jid = pn.to_non_ad();
            chat.jid = jid.to_string();
        }
        if let Ok(Some(contact)) = contacts.get_contact(&jid).await {
            let address_book = [contact.full_name, contact.first_name]
                .into_iter()
                .find(|name| !name.trim().is_empty());
            if let Some(name) = address_book {
                chat.name = Some(name);
            } else if chat.name.is_none() {
                chat.name = [contact.push_name, contact.business_name]
                    .into_iter()
                    .find(|name| !name.trim().is_empty());
            }
        }
    }
}

/// The page an on-demand history answer is for: its chat, how many messages
/// came, the oldest of them, and whether the phone has nothing older.
pub fn history_page(conversation: &Conversation) -> Option<HistoryPage> {
    let (jid, _) = conversation_chat(conversation)?;
    let anchors: Vec<MessageAnchor> = conversation
        .messages
        .iter()
        .filter_map(|message| web_message_anchor(message.message.as_ref()?))
        .collect();
    let complete = matches!(
        conversation
            .end_of_history_transfer_type
            .and_then(|value| EndOfHistoryTransferType::try_from(value).ok()),
        Some(
            EndOfHistoryTransferType::CompleteAndNoMoreMessageRemainOnPrimary
                | EndOfHistoryTransferType::CompleteOnDemandSyncWithMoreMsgOnPrimaryButNoAccess
        )
    );
    Some(HistoryPage {
        chat_jid: jid.to_string(),
        messages: u32::try_from(anchors.len()).unwrap_or(u32::MAX),
        oldest: anchors.into_iter().min_by_key(|anchor| anchor.at),
        complete,
    })
}
