//! The typed event a routine's agent is told about, from the same content the
//! condition classifier reads.

use std::collections::HashMap;

use call::domain::models::CallRecord;
use channel_sender::ChannelSender;
use channels::domain::models::{ChannelMetadata, ChannelType as ChannelKind};
use email::domain::models::{ContactInfo, ParsedMessage};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use messages::domain::models::{Message, MessageThread};
use model::document::DocumentBasic;
use models_properties::service::{
    property_option::PropertyOptionValue, property_value::PropertyValue,
};
use properties::EntityPropertyInfo;
use rootcause::Report;
use system_properties::SystemPropertyKey;
use trigger_context::{
    CallSnapshot, CallStartedSnapshot, ChannelType, ContextMessage, ContextPerson, ContextThread,
    DiscussionContext, DiscussionSurface, DocumentSnapshot, EmailSnapshot, ReplyTarget,
    RoutineEvent, TaskSnapshot, TranscriptLine,
};

use super::{
    ChannelMessage, EventContent, MAX_TRANSCRIPT_CHARS, email_body, truncate, truncate_to,
};
use crate::domain::event_trigger::{EventName, EventReference};

#[cfg(test)]
mod test;

/// Messages of a discussion passed on, the triggering message included.
const MAX_THREAD_MESSAGES: usize = 20;

/// `Err` when the event's message or email is gone, or the content read does
/// not belong to the event.
pub(super) fn routine_event(
    event: &EventReference,
    content: EventContent,
) -> Result<RoutineEvent, Report> {
    let name = event.event_name();
    match content {
        EventContent::Document {
            document,
            properties,
            markdown,
        } => document_event(name, document, &properties, markdown.as_deref()),
        EventContent::Email(message) => match (name, message) {
            (EventName::EmailMessageReceived, Some(message)) => Ok(RoutineEvent::EmailReceived {
                email: email_snapshot(event.entity_id(), &message),
            }),
            (EventName::EmailMessageReceived, None) => {
                Err(rootcause::report!("the email is no longer available"))
            }
            (name, _) => Err(mismatch(name)),
        },
        EventContent::Channel { channel, message } => {
            channel_event(name, event.entity_id(), channel, message)
        }
        EventContent::Call(record) => match (name, record) {
            (EventName::CallStarted, Some(record)) => Ok(RoutineEvent::CallStarted {
                call: call_started_snapshot(event.entity_id(), record)?,
            }),
            (EventName::CallEnded, Some(record)) => Ok(RoutineEvent::CallEnded {
                call: call_snapshot(event.entity_id(), record)?,
            }),
            (EventName::CallStarted | EventName::CallEnded, None) => {
                Err(rootcause::report!("the call record is no longer available"))
            }
            (name, _) => Err(mismatch(name)),
        },
    }
}

fn mismatch(name: EventName) -> Report {
    rootcause::report!(
        "the content read does not belong to a {} event",
        name.as_str()
    )
}

fn document_event(
    name: EventName,
    document: DocumentBasic,
    properties: &[EntityPropertyInfo],
    markdown: Option<&str>,
) -> Result<RoutineEvent, Report> {
    Ok(match name {
        EventName::DocumentCreated => RoutineEvent::DocumentCreated {
            document: document_snapshot(document, markdown),
        },
        EventName::DocumentUpdated => RoutineEvent::DocumentUpdated {
            document: document_snapshot(document, markdown),
        },
        EventName::DocumentDeleted => RoutineEvent::DocumentDeleted {
            id: document.document_id,
            name: document.document_name,
        },
        EventName::TaskCreated => RoutineEvent::TaskCreated {
            task: task_snapshot(document, properties, markdown),
        },
        EventName::TaskStatusChanged => RoutineEvent::TaskStatusChanged {
            task: task_snapshot(document, properties, markdown),
        },
        EventName::TaskPriorityChanged => RoutineEvent::TaskPriorityChanged {
            task: task_snapshot(document, properties, markdown),
        },
        EventName::TaskPropertyChanged => RoutineEvent::TaskPropertyChanged {
            task: task_snapshot(document, properties, markdown),
        },
        name => return Err(mismatch(name)),
    })
}

fn channel_event(
    name: EventName,
    channel_id: Uuid,
    channel: ChannelMetadata,
    message: Option<ChannelMessage>,
) -> Result<RoutineEvent, Report> {
    if name == EventName::ChannelCreated {
        return Ok(RoutineEvent::ChannelCreated {
            id: channel_id,
            name: Some(channel.channel_name),
        });
    }
    let message =
        message.ok_or_else(|| rootcause::report!("the message is no longer available"))?;
    let attachment = newest_attachment(&message.message);
    let discussion = discussion(channel_id, channel, message);
    Ok(match name {
        EventName::ChannelMessagePosted => RoutineEvent::ChannelMessagePosted { discussion },
        EventName::ChannelMentioned => RoutineEvent::ChannelMentioned { discussion },
        EventName::ChannelMessagePatched => RoutineEvent::ChannelMessagePatched { discussion },
        EventName::ChannelMessageAttachmentCreated => {
            let (entity_type, entity_id) = attachment
                .ok_or_else(|| rootcause::report!("the attachment is no longer available"))?;
            RoutineEvent::ChannelMessageAttachmentCreated {
                discussion,
                entity_type,
                entity_id,
            }
        }
        name => return Err(mismatch(name)),
    })
}

fn document_snapshot(document: DocumentBasic, markdown: Option<&str>) -> DocumentSnapshot {
    DocumentSnapshot {
        id: document.document_id,
        name: document.document_name,
        file_type: document.file_type.unwrap_or_default(),
        text: markdown.map(truncate),
    }
}

fn task_snapshot(
    document: DocumentBasic,
    properties: &[EntityPropertyInfo],
    markdown: Option<&str>,
) -> TaskSnapshot {
    let mut task = TaskSnapshot {
        id: document.document_id,
        title: document.document_name,
        markdown: markdown.map(truncate).unwrap_or_default(),
        status: None,
        priority: None,
        due: None,
        assignees: Vec::new(),
        // Projects are read under their own access, which the run does not carry.
        project: None,
    };
    for property in properties {
        match (
            SystemPropertyKey::from_uuid(property.property_definition_id),
            &property.value,
        ) {
            (Some(SystemPropertyKey::Status), Some(PropertyValue::SelectOption(ids))) => {
                task.status = option_label(property, ids);
            }
            (Some(SystemPropertyKey::Priority), Some(PropertyValue::SelectOption(ids))) => {
                task.priority = option_label(property, ids);
            }
            (Some(SystemPropertyKey::DueDate), Some(PropertyValue::Date(due))) => {
                task.due = Some(*due);
            }
            (Some(SystemPropertyKey::Assignees), Some(PropertyValue::EntityRef(references))) => {
                task.assignees = references
                    .iter()
                    .map(|reference| principal(&reference.entity_id))
                    .collect();
            }
            _ => {}
        }
    }
    task
}

/// The label of the first selected option.
fn option_label(property: &EntityPropertyInfo, ids: &[Uuid]) -> Option<String> {
    let id = ids.first()?;
    let option = property.options.iter().find(|option| option.id == *id)?;
    Some(match &option.value {
        PropertyOptionValue::String(text) => text.clone(),
        PropertyOptionValue::Number(number) => number.to_string(),
    })
}

fn email_snapshot(thread_id: Uuid, message: &ParsedMessage) -> EmailSnapshot {
    EmailSnapshot {
        thread_id,
        subject: message.subject.clone().unwrap_or_default(),
        from: message.from.as_ref().map(address).unwrap_or_default(),
        to: message.to.iter().map(address).collect(),
        received_at: message
            .internal_date_ts
            .or(message.sent_at)
            .unwrap_or(message.created_at),
        body: email_body(message).unwrap_or_default(),
    }
}

fn call_started_snapshot(call_id: Uuid, record: CallRecord) -> Result<CallStartedSnapshot, Report> {
    if record.call_id != call_id {
        return Err(mismatch(EventName::CallStarted));
    }
    let started_by = principal(&record.created_by);
    let participants = call_participants(&record);
    Ok(CallStartedSnapshot {
        id: record.call_id,
        title: record.custom_name,
        channel_id: record.channel_id,
        channel_name: record.channel_name,
        started_at: record.started_at,
        started_by,
        participants,
    })
}

fn call_snapshot(call_id: Uuid, record: CallRecord) -> Result<CallSnapshot, Report> {
    if record.call_id != call_id {
        return Err(mismatch(EventName::CallEnded));
    }
    let ended_at = record
        .ended_at
        .ok_or_else(|| rootcause::report!("the call has not ended"))?;
    let participants = call_participants(&record);
    let (transcript, transcript_omitted) = call_transcript(&record);
    Ok(CallSnapshot {
        id: record.call_id,
        title: record.custom_name,
        channel_id: record.channel_id,
        channel_name: record.channel_name,
        started_at: record.started_at,
        ended_at,
        participants,
        summary: record.summary.as_deref().map(truncate),
        transcript,
        transcript_omitted,
    })
}

/// Everyone who joined: Macro accounts first, then guests by their own names.
pub(super) fn call_participants(record: &CallRecord) -> Vec<ContextPerson> {
    record
        .participants
        .iter()
        .map(|participant| principal(&participant.user_id))
        .chain(record.guests.iter().map(|guest| ContextPerson {
            id: guest.id.to_string(),
            name: guest.display_name.clone(),
            email: None,
        }))
        .collect()
}

/// What was said, oldest first, up to [`MAX_TRANSCRIPT_CHARS`] of speech; true
/// when the rest was left out.
pub(super) fn call_transcript(record: &CallRecord) -> (Vec<TranscriptLine>, bool) {
    let guests: HashMap<String, &str> = record
        .guests
        .iter()
        .map(|guest| (guest.id.to_string(), guest.display_name.as_str()))
        .collect();
    let line = |speaker_id: &str, text: String, at| TranscriptLine {
        speaker: guests
            .get(speaker_id)
            .map_or_else(|| principal(speaker_id).name, |name| (*name).to_owned()),
        text,
        at,
    };
    let mut room = MAX_TRANSCRIPT_CHARS;
    let mut lines = Vec::new();
    for segment in &record.transcript {
        let length = segment.content.chars().count();
        if length > room {
            if room > 0 {
                let text = truncate_to(&segment.content, room);
                lines.push(line(&segment.speaker_id, text, segment.started_at));
            }
            return (lines, true);
        }
        room -= length;
        lines.push(line(
            &segment.speaker_id,
            segment.content.clone(),
            segment.started_at,
        ));
    }
    (lines, false)
}

fn address(contact: &ContactInfo) -> String {
    match &contact.name {
        Some(name) => format!("{name} <{}>", contact.email),
        None => contact.email.clone(),
    }
}

/// The triggering message with its discussion up to it. A top-level message
/// is its own discussion, so it travels as the channel context.
fn discussion(
    channel_id: Uuid,
    channel: ChannelMetadata,
    ChannelMessage { message, thread }: ChannelMessage,
) -> DiscussionContext {
    let surface = DiscussionSurface::Channel {
        id: channel_id,
        name: Some(channel.channel_name),
        channel_type: channel_type(channel.channel_type),
    };
    let sender = author(&message);
    let prompt_message_id = message.id;
    match message.thread_id.filter(|root| *root != message.id) {
        Some(root_id) => DiscussionContext {
            surface,
            prompt_message_id,
            sender,
            reply_target: ReplyTarget::Thread { root_id },
            thread: Some(context_thread(root_id, thread, &message)),
            channel: Vec::new(),
        },
        None => DiscussionContext {
            surface,
            prompt_message_id,
            sender,
            reply_target: ReplyTarget::None,
            thread: None,
            channel: vec![ContextThread {
                root_id: message.id,
                messages: vec![context_message(&message)],
                messages_omitted: false,
            }],
        },
    }
}

/// Live messages from the root through `message`, keeping the root and the
/// latest replies when there are too many.
fn context_thread(
    root_id: Uuid,
    thread: Option<MessageThread>,
    message: &Message,
) -> ContextThread {
    let unread = thread.is_none();
    let mut earlier: Vec<ContextMessage> = thread
        .iter()
        .flat_map(|thread| std::iter::once(&thread.root).chain(&thread.replies))
        .filter(|other| {
            other.deleted_at.is_none()
                && other.id != message.id
                && other.created_at <= message.created_at
        })
        .map(context_message)
        .collect();
    let room = MAX_THREAD_MESSAGES - 1;
    let bounded = earlier.len() > room;
    if bounded {
        let root = (earlier[0].id == root_id).then(|| earlier.remove(0));
        let replies = earlier.split_off(earlier.len() - (room - usize::from(root.is_some())));
        earlier = root.into_iter().chain(replies).collect();
    }
    earlier.push(context_message(message));
    ContextThread {
        root_id,
        messages: earlier,
        messages_omitted: unread || bounded,
    }
}

fn context_message(message: &Message) -> ContextMessage {
    ContextMessage {
        id: message.id,
        author: author(message),
        content: truncate(&message.content),
        posted_at: message.created_at,
    }
}

fn author(message: &Message) -> ContextPerson {
    let id = message.sender_id.as_ref().to_owned();
    if let Some(imported) = &message.imported_author {
        return ContextPerson {
            id,
            name: imported.name.clone(),
            email: None,
        };
    }
    if let Some(user) = message.sender_id.as_user() {
        return user_person(user);
    }
    ContextPerson {
        name: message
            .bot_profile
            .as_ref()
            .map_or_else(|| id.clone(), |bot| bot.name.clone()),
        id,
        email: None,
    }
}

/// A user or bot named only by its id.
fn principal(id: &str) -> ContextPerson {
    match ChannelSender::parse_from_str(id)
        .ok()
        .and_then(|sender| sender.into_user())
    {
        Some(user) => user_person(&user),
        None => ContextPerson {
            id: id.to_owned(),
            name: id.to_owned(),
            email: None,
        },
    }
}

fn user_person(user: &MacroUserIdStr<'_>) -> ContextPerson {
    ContextPerson {
        id: user.as_ref().to_owned(),
        name: user.email_str().to_owned(),
        email: Some(user.email_str().to_owned()),
    }
}

/// What the newest attachment attaches, as its type and id.
fn newest_attachment(message: &Message) -> Option<(String, String)> {
    message
        .attachments
        .iter()
        .max_by_key(|attachment| attachment.created_at)
        .map(|attachment| (attachment.entity_type.clone(), attachment.entity_id.clone()))
}

fn channel_type(channel_type: ChannelKind) -> ChannelType {
    match channel_type {
        ChannelKind::Public => ChannelType::Public,
        ChannelKind::Private => ChannelType::Private,
        ChannelKind::DirectMessage => ChannelType::DirectMessage,
        ChannelKind::Team => ChannelType::Team,
    }
}
