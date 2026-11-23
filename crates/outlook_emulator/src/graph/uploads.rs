//! Attachment upload sessions: a large attachment uploaded in ranges to a
//! preauthorized URL.

use chrono::Duration;
use nom::Parser;
use nom::bytes::complete::tag;
use nom::character::complete::{char, u64 as number};
use nom::combinator::all_consuming;
use nom::sequence::{preceded, separated_pair};
use serde_json::{Value, json};

use super::{Ctx, Handled, Reply};
use crate::error::GraphError;
use crate::mailbox::Attachment;
use crate::render;
use crate::state::Upload;

/// The path segment upload URLs live under.
pub(crate) const SEGMENT: &str = "attachmentUploadSessions";
const SESSION_LIFETIME_MINUTES: i64 = 60;
const MAX_ATTACHMENT_SIZE: u64 = 150 * 1024 * 1024;

fn progress(upload: &Upload) -> Value {
    json!({
        "expirationDateTime": render::time(upload.expires_at),
        "nextExpectedRanges": [upload.received.len().to_string()],
    })
}

fn session_not_found() -> GraphError {
    GraphError::server(
        404,
        "ErrorItemNotFound",
        "The upload session was not found; it may have expired or completed.",
    )
}

pub(crate) fn create(ctx: &mut Ctx<'_>, message_id: &str) -> Handled {
    let body = ctx.json_body()?;
    let item = &body["AttachmentItem"];
    let invalid = |what: &str| GraphError::bad_request(&format!("AttachmentItem needs {what}."));
    let name = item["name"].as_str().ok_or_else(|| invalid("a name"))?;
    let size = item["size"].as_u64().ok_or_else(|| invalid("a size"))?;
    if item["attachmentType"] != "file" {
        return Err(invalid("attachmentType 'file'"));
    }
    if size > MAX_ATTACHMENT_SIZE {
        return Err(GraphError::too_large(
            "The attachment is larger than the 150 MB an upload session accepts.",
        ));
    }

    let now = ctx.now;
    let email = ctx.email.clone();
    let mailbox = ctx.mailbox()?;
    if !mailbox.messages.contains_key(message_id) {
        return Err(GraphError::item_not_found());
    }
    let id = mailbox.new_id("upload");
    let upload = Upload {
        email,
        message_id: message_id.to_string(),
        name: name.to_string(),
        content_type: item["contentType"]
            .as_str()
            .unwrap_or("application/octet-stream")
            .to_string(),
        content_id: item["contentId"].as_str().map(str::to_string),
        inline: item["isInline"] == true,
        size: usize::try_from(size).map_err(|_| invalid("a smaller size"))?,
        received: Vec::new(),
        expires_at: now + Duration::minutes(SESSION_LIFETIME_MINUTES),
    };

    let authorization = [("authtoken".to_string(), "preauthorized".to_string())];
    let mut session = progress(&upload);
    session["uploadUrl"] = json!(ctx.link(&format!("{SEGMENT}/{id}"), &authorization));
    session["nextExpectedRanges"] = json!(["0-"]);
    ctx.state.uploads.insert(id, upload);
    Ok(Reply::Json(201, session))
}

pub(crate) fn status(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let upload = ctx.state.uploads.get(id).ok_or_else(session_not_found)?;
    Ok(Reply::Json(200, progress(upload)))
}

/// `bytes <first>-<last>/<total>`
fn content_range(header: &str) -> Option<(u64, u64, u64)> {
    let range = separated_pair(number::<&str, nom::error::Error<&str>>, char('-'), number);
    let mut parser = all_consuming(preceded(
        tag("bytes "),
        separated_pair(range, char('/'), number),
    ));
    let (_, ((first, last), total)) = parser.parse(header.trim()).ok()?;
    Some((first, last, total))
}

/// One range of the file. Ranges arrive in order; the last one turns the
/// session into an attachment and answers 201.
pub(crate) fn put(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let now = ctx.now;
    let range = ctx.call.content_range.as_deref().and_then(content_range);
    let Some((first, last, total)) = range else {
        return Err(GraphError::invalid_range(
            "A Content-Range header is required.",
        ));
    };
    let chunk = &ctx.call.body;
    let upload = ctx
        .state
        .uploads
        .get_mut(id)
        .ok_or_else(session_not_found)?;

    let expected_first = upload.received.len() as u64;
    let consistent = first == expected_first
        && total == upload.size as u64
        && last >= first
        && last - first + 1 == chunk.len() as u64
        && last < total;
    if !consistent {
        return Err(GraphError::invalid_range(&format!(
            "The range does not continue the upload; the next expected byte is {expected_first}."
        )));
    }
    upload.received.extend_from_slice(chunk);
    if upload.received.len() < upload.size {
        return Ok(Reply::Json(200, progress(upload)));
    }

    let upload = ctx.state.uploads.remove(id).ok_or_else(session_not_found)?;
    let mailbox = ctx
        .state
        .mailboxes
        .get_mut(&upload.email)
        .ok_or_else(GraphError::item_not_found)?;
    let attachment = Attachment {
        id: mailbox.new_id("attachment"),
        name: upload.name,
        content_type: upload.content_type,
        bytes: upload.received,
        content_id: upload.content_id,
        inline: upload.inline,
        modified: now,
    };
    let message = mailbox
        .messages
        .get_mut(&upload.message_id)
        .ok_or_else(GraphError::item_not_found)?;
    message.attachments.push(attachment);
    mailbox.touch(&upload.message_id, now);
    Ok(Reply::Empty(201))
}

pub(crate) fn cancel(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    ctx.state.uploads.remove(id).ok_or_else(session_not_found)?;
    Ok(Reply::Empty(204))
}
