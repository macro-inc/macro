//! Writing mail: drafts, replies and forwards, sending, and attachments.

use std::collections::BTreeMap;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use super::messages::{apply_fields, folder_not_found};
use super::{Ctx, Handled, Reply};
use crate::error::GraphError;
use crate::mailbox::{
    Address, Attachment, BodyType, IN_REPLY_TO_PROPERTY, Mailbox, Message, REFERENCES_PROPERTY,
};
use crate::odata::Query;
use crate::render;

/// Graph takes attachments of 3 MB and more only through an upload session.
const DIRECT_ATTACHMENT_LIMIT: usize = 3 * 1024 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Reply,
    ReplyAll,
    Forward,
}

pub(crate) fn kind(action: &str) -> Kind {
    match action {
        "createReplyAll" | "replyAll" => Kind::ReplyAll,
        _ => Kind::Reply,
    }
}

/// An empty draft in a folder.
fn blank(mailbox: &mut Mailbox, folder_id: String, now: DateTime<Utc>) -> Message {
    let id = mailbox.new_id("message");
    Message {
        internet_message_id: format!("<{}@emulator.example>", id.to_lowercase()),
        conversation_id: String::new(),
        id,
        folder_id,
        version: 1,
        changed_seq: 0,
        subject: String::new(),
        body_type: BodyType::Text,
        body: String::new(),
        from: Some(Address {
            address: mailbox.email.clone(),
            name: Some(mailbox.name.clone()),
        }),
        to: Vec::new(),
        cc: Vec::new(),
        bcc: Vec::new(),
        reply_to: Vec::new(),
        is_read: true,
        is_draft: true,
        flagged: false,
        categories: Vec::new(),
        focused: true,
        received: now,
        sent: Some(now),
        created: now,
        modified: now,
        headers: Vec::new(),
        properties: BTreeMap::new(),
        attachments: Vec::new(),
        from_me: false,
        calendar: None,
    }
}

/// The messages a draft's reply headers name.
fn replies_to(message: &Message) -> Vec<String> {
    [IN_REPLY_TO_PROPERTY, REFERENCES_PROPERTY]
        .iter()
        .filter_map(|property| message.property(property))
        .flat_map(|value| {
            value
                .split_whitespace()
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .collect()
}

fn created(mailbox: &Mailbox, id: &str) -> Handled {
    let message = mailbox
        .messages
        .get(id)
        .ok_or_else(GraphError::item_not_found)?;
    Ok(Reply::Json(
        201,
        render::message(message, &Query::default())?,
    ))
}

/// Stores a new draft built from a JSON message.
fn store_draft(
    ctx: &mut Ctx<'_>,
    folder: Option<&str>,
    fields: &Value,
) -> Result<String, GraphError> {
    let now = ctx.now;
    let mailbox = ctx.mailbox()?;
    let folder_id = mailbox
        .folder(folder.unwrap_or("drafts"))
        .map(|folder| folder.id.clone())
        .ok_or_else(folder_not_found)?;
    let mut draft = blank(mailbox, folder_id, now);
    apply_fields(&mut draft, fields)?;
    draft.conversation_id = mailbox.conversation_of(&replies_to(&draft));
    Ok(mailbox.insert(draft))
}

pub(crate) fn create(ctx: &mut Ctx<'_>, folder: Option<&str>) -> Handled {
    let fields = ctx.json_body()?;
    let id = store_draft(ctx, folder, &fields)?;
    created(ctx.mailbox()?, &id)
}

pub(crate) fn send(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let email = ctx.email.clone();
    ctx.state.send(&email, id)?;
    Ok(Reply::Empty(202))
}

pub(crate) fn send_mail(ctx: &mut Ctx<'_>) -> Handled {
    let body = ctx.json_body()?;
    let Some(message) = body.get("message") else {
        return Err(GraphError::bad_request("sendMail requires a message."));
    };
    let id = store_draft(ctx, None, message)?;
    let email = ctx.email.clone();
    ctx.state.send(&email, &id)?;
    if body["saveToSentItems"] == false {
        ctx.mailbox()?.remove_message(&id)?;
    }
    Ok(Reply::Empty(202))
}

fn prefixed(prefix: &str, subject: &str) -> String {
    match subject.to_ascii_uppercase().starts_with(prefix) {
        true => subject.to_string(),
        false => format!("{prefix} {subject}"),
    }
}

/// A draft answering a message: `createReply`, `createReplyAll` and
/// `createForward`, or their send-at-once forms `reply`, `replyAll` and
/// `forward`. The body's `message` overrides what Graph fills in, and
/// `comment` becomes the draft's body.
pub(crate) fn create_response(ctx: &mut Ctx<'_>, id: &str, kind: Kind, send_now: bool) -> Handled {
    let body: Value = match ctx.call.body.is_empty() {
        true => json!({}),
        false => ctx.json_body()?,
    };
    let now = ctx.now;
    let mailbox = ctx.mailbox()?;
    let parent = mailbox
        .messages
        .get(id)
        .cloned()
        .ok_or_else(GraphError::item_not_found)?;
    let drafts = mailbox
        .well_known("drafts")
        .map(|folder| folder.id.clone())
        .ok_or_else(folder_not_found)?;

    let mut draft = blank(mailbox, drafts, now);
    draft.conversation_id = parent.conversation_id.clone();
    draft.subject = match kind {
        Kind::Forward => prefixed("FW:", &parent.subject),
        Kind::Reply | Kind::ReplyAll => prefixed("RE:", &parent.subject),
    };
    let own = mailbox.email.clone();
    let not_own = |address: &&Address| !address.address.eq_ignore_ascii_case(&own);
    match kind {
        Kind::Forward => {
            draft.attachments = parent
                .attachments
                .iter()
                .map(|attachment| Attachment {
                    id: mailbox.new_id("attachment"),
                    ..attachment.clone()
                })
                .collect();
        }
        Kind::Reply => draft.to = parent.from.iter().cloned().collect(),
        Kind::ReplyAll => {
            draft.to = parent.from.iter().cloned().collect();
            draft.to.extend(parent.to.iter().filter(not_own).cloned());
            draft.cc = parent.cc.iter().filter(not_own).cloned().collect();
        }
    }
    if kind != Kind::Forward {
        let mut references = parent.property(REFERENCES_PROPERTY).unwrap_or_default();
        references.push(' ');
        references.push_str(&parent.internet_message_id);
        draft.properties.insert(
            IN_REPLY_TO_PROPERTY.to_string(),
            parent.internet_message_id.clone(),
        );
        draft.properties.insert(
            REFERENCES_PROPERTY.to_string(),
            references.trim().to_string(),
        );
    }
    if let Some(comment) = body["comment"].as_str() {
        draft.body = comment.to_string();
    }
    if let Some(recipients) = body.get("toRecipients") {
        apply_fields(&mut draft, &json!({"toRecipients": recipients}))?;
    }
    if let Some(overrides) = body.get("message") {
        apply_fields(&mut draft, overrides)?;
    }

    let draft_id = mailbox.insert(draft);
    if !send_now {
        return created(mailbox, &draft_id);
    }
    let email = ctx.email.clone();
    ctx.state.send(&email, &draft_id)?;
    Ok(Reply::Empty(202))
}

pub(crate) fn add_attachment(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let body = ctx.json_body()?;
    let now = ctx.now;
    let invalid = |what: &str| GraphError::bad_request(&format!("The attachment needs {what}."));
    let name = body["name"].as_str().ok_or_else(|| invalid("a name"))?;
    let encoded = body["contentBytes"]
        .as_str()
        .ok_or_else(|| invalid("contentBytes"))?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| invalid("base64 contentBytes"))?;
    if bytes.len() >= DIRECT_ATTACHMENT_LIMIT {
        return Err(GraphError::too_large(
            "The attachment is too large; use an upload session for attachments of 3 MB or more.",
        ));
    }

    let mailbox = ctx.mailbox()?;
    let attachment = Attachment {
        id: mailbox.new_id("attachment"),
        name: name.to_string(),
        content_type: body["contentType"]
            .as_str()
            .unwrap_or("application/octet-stream")
            .to_string(),
        bytes,
        content_id: body["contentId"].as_str().map(str::to_string),
        inline: body["isInline"] == true,
        modified: now,
    };
    let rendered = render::attachment(&attachment, &Query::default())?;
    let message = mailbox
        .messages
        .get_mut(id)
        .ok_or_else(GraphError::item_not_found)?;
    message.attachments.push(attachment);
    mailbox.touch(id, now);
    Ok(Reply::Json(201, rendered))
}

pub(crate) fn delete_attachment(ctx: &mut Ctx<'_>, id: &str, attachment: &str) -> Handled {
    let now = ctx.now;
    let mailbox = ctx.mailbox()?;
    let message = mailbox
        .messages
        .get_mut(id)
        .ok_or_else(GraphError::item_not_found)?;
    let before = message.attachments.len();
    message
        .attachments
        .retain(|candidate| candidate.id != attachment);
    if message.attachments.len() == before {
        return Err(GraphError::item_not_found());
    }
    mailbox.touch(id, now);
    Ok(Reply::Empty(204))
}
