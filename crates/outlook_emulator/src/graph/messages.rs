//! Reading and organizing messages: list, get, delta, update, move, delete,
//! MIME source and attachments.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Value, json};

use super::{Ctx, Handled, Reply};
use crate::error::GraphError;
use crate::mailbox::{
    Address, BodyType, DeltaCursor, DeltaEntry, Mailbox, Message, normalize_html,
};
use crate::odata::{Filter, Literal, Query};
use crate::{mime, render};

const MESSAGE_ENTITY: &str = "users('me')/messages";
const DEFAULT_DELTA_PAGE_SIZE: usize = 10;
/// How much of a subject Exchange stores.
const MAX_SUBJECT_CHARS: usize = 255;

fn matches(message: &Message, filter: &Filter) -> Result<bool, GraphError> {
    let unsupported = |name: &str| {
        GraphError::bad_request(&format!(
            "Invalid filter clause: the emulator cannot filter messages by '{name}'."
        ))
    };
    match filter {
        Filter::Category(name) => Ok(message.categories.contains(name)),
        Filter::Property { id, value } => Ok(message.property(id).as_ref() == Some(value)),
        Filter::Field { name, value } => match (name.as_str(), value) {
            ("isRead", Literal::Bool(wanted)) => Ok(message.is_read == *wanted),
            ("isDraft", Literal::Bool(wanted)) => Ok(message.is_draft == *wanted),
            ("parentFolderId", Literal::Text(wanted)) => Ok(&message.folder_id == wanted),
            ("conversationId", Literal::Text(wanted)) => Ok(&message.conversation_id == wanted),
            ("internetMessageId", Literal::Text(wanted)) => {
                Ok(&message.internet_message_id == wanted)
            }
            _ => Err(unsupported(name)),
        },
    }
}

fn folder_id(mailbox: &Mailbox, key: &str) -> Result<String, GraphError> {
    mailbox
        .folder(key)
        .map(|folder| folder.id.clone())
        .ok_or_else(folder_not_found)
}

pub(crate) fn folder_not_found() -> GraphError {
    GraphError::server(
        404,
        "ErrorFolderNotFound",
        "The specified folder could not be found in the store.",
    )
}

pub(crate) fn list(ctx: &mut Ctx<'_>, folder: Option<&str>) -> Handled {
    let query = ctx.query.clone();
    let mailbox = ctx.mailbox()?;
    let folder = folder.map(|key| folder_id(mailbox, key)).transpose()?;

    let mut found = Vec::new();
    for message in mailbox.messages.values() {
        let in_folder = folder.as_ref().is_none_or(|id| &message.folder_id == id);
        let wanted = match &query.filter {
            Some(filter) => matches(message, filter)?,
            None => true,
        };
        if in_folder && wanted {
            found.push(message);
        }
    }

    let (property, descending) = query
        .order_by
        .clone()
        .unwrap_or_else(|| ("receivedDateTime".to_string(), true));
    match property.as_str() {
        "receivedDateTime" => found.sort_by_key(|message| message.received),
        "sentDateTime" => found.sort_by_key(|message| message.sent),
        "createdDateTime" => found.sort_by_key(|message| message.created),
        "lastModifiedDateTime" => found.sort_by_key(|message| message.modified),
        "subject" => found.sort_by(|a, b| a.subject.cmp(&b.subject)),
        other => {
            return Err(GraphError::bad_request(&format!(
                "The emulator cannot order messages by '{other}'."
            )));
        }
    }
    if descending {
        found.reverse();
    }

    let rendered: Vec<Value> = found
        .into_iter()
        .map(|message| render::message(message, &query))
        .collect::<Result<_, _>>()?;
    let (page, next) = ctx.page(rendered);
    Ok(ctx.collection(MESSAGE_ENTITY, page, next))
}

pub(crate) fn get(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let query = ctx.query.clone();
    let context = ctx.context(&format!("{MESSAGE_ENTITY}/$entity"));
    let mailbox = ctx.mailbox()?;
    let message = mailbox
        .messages
        .get(id)
        .ok_or_else(GraphError::item_not_found)?;
    let mut body = render::message(message, &query)?;
    body["@odata.context"] = json!(context);
    Ok(Reply::Json(200, body))
}

fn encode_cursor(cursor: &DeltaCursor) -> String {
    URL_SAFE_NO_PAD.encode(serde_json::to_vec(cursor).unwrap_or_default())
}

fn decode_cursor(token: &str) -> Option<DeltaCursor> {
    let bytes = URL_SAFE_NO_PAD.decode(token).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// A folder's message changes. The first request starts a round; its pages
/// are linked by skip tokens and it ends with a delta token, which starts
/// the next round. Links name the folder in OData key form, as Graph's do.
///
/// A page holds as many entries as the request's `Prefer:
/// odata.maxpagesize` asks for, 10 without it; the links do not carry it, so
/// every page of a round must send it. `$top` caps the whole round, not a
/// page.
pub(crate) fn delta(ctx: &mut Ctx<'_>, folder: &str) -> Handled {
    let now_ms = ctx.state.now_ms();
    let query = ctx.query.clone();
    let page_size = ctx.call.max_page_size.unwrap_or(DEFAULT_DELTA_PAGE_SIZE);
    let mailbox = ctx.mailbox()?;
    let folder = folder_id(mailbox, folder)?;

    let token = query.skip_token.as_ref().or(query.delta_token.as_ref());
    let cursor = match token {
        Some(token) => {
            let cursor = decode_cursor(token)
                .ok_or_else(|| GraphError::bad_request("The delta or skip token is malformed."))?;
            if cursor.f != folder || !mailbox.delta_token_valid(&cursor, now_ms) {
                return Err(GraphError::sync_state_not_found());
            }
            cursor
        }
        None => {
            if query.filter.is_some() || query.order_by.is_some() {
                return Err(GraphError::bad_request(
                    "The emulator's delta query supports only $select and $top.",
                ));
            }
            mailbox.delta_start(&folder, query.select_text(), query.top, now_ms)
        }
    };

    let round = Query {
        select: cursor
            .q
            .as_ref()
            .map(|select| select.split(',').map(str::to_string).collect()),
        ..Query::default()
    };
    let page = mailbox.folder_delta(cursor, page_size, now_ms);
    let mut values = Vec::new();
    for entry in &page.entries {
        values.push(match entry {
            DeltaEntry::Changed(message) => {
                let mut value = render::message(message, &round)?;
                value["@odata.type"] = json!("#microsoft.graph.message");
                value
            }
            DeltaEntry::Removed(id) => json!({"id": id, "@removed": {"reason": "deleted"}}),
        });
    }

    let (link, parameter) = match page.done {
        true => ("@odata.deltaLink", "$deltatoken"),
        false => ("@odata.nextLink", "$skiptoken"),
    };
    let path = format!("me/mailFolders('{folder}')/messages/delta");
    let pairs = [(parameter.to_string(), encode_cursor(&page.cursor))];
    let mut body = json!({"@odata.context": ctx.context("Collection(message)"), "value": values});
    body[link] = json!(ctx.link(&path, &pairs));
    Ok(Reply::Json(200, body))
}

/// `If-Match` must name the message's current version.
pub(crate) fn check_version(ctx: &Ctx<'_>, message: &Message) -> Result<(), GraphError> {
    match ctx.call.if_match.as_deref() {
        None | Some("*") => Ok(()),
        Some(version) if version == message.etag() => Ok(()),
        Some(_) => Err(GraphError::changed_since_read()),
    }
}

fn recipients(value: &Value) -> Result<Vec<Address>, GraphError> {
    let invalid = || GraphError::bad_request("A recipient has no emailAddress.address.");
    let list = value.as_array().ok_or_else(invalid)?;
    list.iter()
        .map(|recipient| Address::from_json(recipient).ok_or_else(invalid))
        .collect()
}

/// The subject Exchange keeps: its first 255 characters. The rest is dropped
/// without an error.
fn stored_subject(subject: &str) -> String {
    subject.chars().take(MAX_SUBJECT_CHARS).collect()
}

/// Writes the properties of a JSON message onto a stored one.
pub(crate) fn apply_fields(message: &mut Message, fields: &Value) -> Result<(), GraphError> {
    let Some(fields) = fields.as_object() else {
        return Err(GraphError::bad_request(
            "The message must be a JSON object.",
        ));
    };
    for (name, value) in fields {
        match name.as_str() {
            "subject" => message.subject = stored_subject(value.as_str().unwrap_or_default()),
            "body" => {
                let content = value["content"].as_str().unwrap_or_default();
                let html = value["contentType"]
                    .as_str()
                    .is_some_and(|kind| kind.eq_ignore_ascii_case("html"));
                (message.body_type, message.body) = match html {
                    true => (BodyType::Html, normalize_html(content)),
                    false => (BodyType::Text, content.to_string()),
                };
            }
            "from" | "sender" => message.from = Address::from_json(value),
            "toRecipients" => message.to = recipients(value)?,
            "ccRecipients" => message.cc = recipients(value)?,
            "bccRecipients" => message.bcc = recipients(value)?,
            "replyTo" => message.reply_to = recipients(value)?,
            "isRead" => message.is_read = value.as_bool().unwrap_or(message.is_read),
            "flag" => message.flagged = value["flagStatus"] == "flagged",
            "categories" => {
                let names = value.as_array().into_iter().flatten();
                message.categories = names
                    .filter_map(|name| name.as_str().map(str::to_string))
                    .collect();
            }
            "inferenceClassification" => message.focused = value != "other",
            "singleValueExtendedProperties" => {
                for property in value.as_array().into_iter().flatten() {
                    let (Some(id), Some(value)) =
                        (property["id"].as_str(), property["value"].as_str())
                    else {
                        return Err(GraphError::bad_request(
                            "An extended property needs an id and a value.",
                        ));
                    };
                    message
                        .properties
                        .retain(|key, _| !key.eq_ignore_ascii_case(id));
                    message.properties.insert(id.to_string(), value.to_string());
                }
            }
            "internetMessageHeaders" => {
                for header in value.as_array().into_iter().flatten() {
                    let name = header["name"].as_str().unwrap_or_default();
                    if !name.to_ascii_lowercase().starts_with("x-") {
                        return Err(GraphError::server(
                            400,
                            "InvalidInternetMessageHeader",
                            "The internet message header name should start with 'x-' or 'X-'.",
                        ));
                    }
                }
            }
            _ => {}
        }
    }
    Ok(())
}

pub(crate) fn update(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let fields = ctx.json_body()?;
    let now = ctx.now;
    let stored = ctx
        .mailbox()?
        .messages
        .get(id)
        .cloned()
        .ok_or_else(GraphError::item_not_found)?;
    check_version(ctx, &stored)?;

    let mut changed = stored;
    apply_fields(&mut changed, &fields)?;
    let mailbox = ctx.mailbox()?;
    mailbox.messages.insert(id.to_string(), changed);
    mailbox.touch(id, now);
    let message = mailbox
        .messages
        .get(id)
        .ok_or_else(GraphError::item_not_found)?;
    Ok(Reply::Json(
        200,
        render::message(message, &Query::default())?,
    ))
}

/// Deleting moves a message out of every folder a client can list.
pub(crate) fn delete(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let stored = ctx
        .mailbox()?
        .messages
        .get(id)
        .cloned()
        .ok_or_else(GraphError::item_not_found)?;
    check_version(ctx, &stored)?;
    ctx.mailbox()?.remove_message(id)?;
    Ok(Reply::Empty(204))
}

pub(crate) fn move_or_copy(ctx: &mut Ctx<'_>, id: &str, copy: bool) -> Handled {
    let body = ctx.json_body()?;
    let destination = body["destinationId"]
        .as_str()
        .ok_or_else(|| GraphError::bad_request("destinationId is required."))?
        .to_string();
    let now = ctx.now;
    let mailbox = ctx.mailbox()?;
    let destination = folder_id(mailbox, &destination)?;

    let id = match copy {
        false => {
            mailbox.move_message(id, &destination, now)?;
            id.to_string()
        }
        true => {
            let original = mailbox
                .messages
                .get(id)
                .ok_or_else(GraphError::item_not_found)?;
            let mut duplicate = original.clone();
            duplicate.id = mailbox.new_id("message");
            duplicate.folder_id = destination;
            duplicate.version = 1;
            mailbox.insert(duplicate)
        }
    };
    let message = mailbox
        .messages
        .get(&id)
        .ok_or_else(GraphError::item_not_found)?;
    Ok(Reply::Json(
        201,
        render::message(message, &Query::default())?,
    ))
}

/// The message's MIME source.
pub(crate) fn value(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let mailbox = ctx.mailbox()?;
    let message = mailbox
        .messages
        .get(id)
        .ok_or_else(GraphError::item_not_found)?;
    let source = mime::source(message).map_err(|_| {
        GraphError::server(
            500,
            "ErrorMimeContentConversionFailed",
            "The message could not be converted to MIME.",
        )
    })?;
    Ok(Reply::Bytes("text/plain".to_string(), source))
}

pub(crate) fn attachments(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let query = ctx.query.clone();
    let mailbox = ctx.mailbox()?;
    let message = mailbox
        .messages
        .get(id)
        .ok_or_else(GraphError::item_not_found)?;
    let values: Vec<Value> = message
        .attachments
        .iter()
        .map(|attachment| render::attachment(attachment, &query))
        .collect::<Result<_, _>>()?;
    let entity = format!("users('me')/messages('{id}')/attachments");
    Ok(ctx.collection(&entity, values, None))
}

pub(crate) fn attachment(ctx: &mut Ctx<'_>, id: &str, attachment: &str, raw: bool) -> Handled {
    let query = ctx.query.clone();
    let mailbox = ctx.mailbox()?;
    let message = mailbox
        .messages
        .get(id)
        .ok_or_else(GraphError::item_not_found)?;
    let attachment = message
        .attachments
        .iter()
        .find(|candidate| candidate.id == attachment)
        .ok_or_else(GraphError::item_not_found)?;
    match raw {
        true => Ok(Reply::Bytes(
            attachment.content_type.clone(),
            attachment.bytes.clone(),
        )),
        false => Ok(Reply::Json(200, render::attachment(attachment, &query)?)),
    }
}
