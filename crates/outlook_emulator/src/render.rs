//! Graph's JSON for the resources a mailbox holds.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{Value, json};

use crate::error::GraphError;
use crate::mailbox::{
    Address, Attachment, BodyType, Category, Contact, Folder, MESSAGE_FLAGS_PROPERTY, Mailbox,
    Message,
};
use crate::odata::{self, Query};

const PREVIEW_LENGTH: usize = 255;

pub(crate) fn time(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn addresses(list: &[Address]) -> Vec<Value> {
    list.iter().map(Address::json).collect()
}

/// The extended properties `$expand` asked for, as Graph lists them.
fn expanded(ids: &[String], read: impl Fn(&str) -> Option<String>) -> Vec<Value> {
    ids.iter()
        .filter_map(|id| {
            let value = read(id)?;
            // Graph answers the flags property in its own spelling.
            let id = match id.eq_ignore_ascii_case("Integer 0x0E07") {
                true => MESSAGE_FLAGS_PROPERTY,
                false => id.as_str(),
            };
            Some(json!({"id": id, "value": value}))
        })
        .collect()
}

pub(crate) fn message(message: &Message, query: &Query) -> Result<Value, GraphError> {
    let preview: String = message.plain_text().chars().take(PREVIEW_LENGTH).collect();
    let from = message.from.as_ref().map(Address::json);
    let headers: Vec<Value> = message
        .headers
        .iter()
        .map(|(name, value)| json!({"name": name, "value": value}))
        .collect();
    let mut resource = json!({
        "@odata.etag": message.etag(),
        "id": message.id,
        "createdDateTime": time(message.created),
        "lastModifiedDateTime": time(message.modified),
        "changeKey": message.change_key(),
        "categories": message.categories,
        "receivedDateTime": time(message.received),
        "sentDateTime": message.sent.map(time),
        "hasAttachments": message.attachments.iter().any(|attachment| !attachment.inline),
        "internetMessageId": message.internet_message_id,
        "subject": message.subject,
        "bodyPreview": preview,
        "importance": "normal",
        "parentFolderId": message.folder_id,
        "conversationId": message.conversation_id,
        "isDeliveryReceiptRequested": false,
        "isReadReceiptRequested": false,
        "isRead": message.is_read,
        "isDraft": message.is_draft,
        "webLink": format!(
            "https://outlook.office365.com/owa/?ItemID={}&exvsurl=1&viewmodel=ReadMessageItem",
            message.id
        ),
        "inferenceClassification": if message.focused { "focused" } else { "other" },
        "body": {
            "contentType": match message.body_type {
                BodyType::Html => "html",
                BodyType::Text => "text",
            },
            "content": message.body,
        },
        "sender": from,
        "from": from,
        "toRecipients": addresses(&message.to),
        "ccRecipients": addresses(&message.cc),
        "bccRecipients": addresses(&message.bcc),
        "replyTo": addresses(&message.reply_to),
        "flag": {"flagStatus": if message.flagged { "flagged" } else { "notFlagged" }},
        "internetMessageHeaders": headers,
    });
    if message.calendar.is_some() {
        resource["@odata.type"] = json!("#microsoft.graph.eventMessage");
    }

    let mut resource = odata::select(
        resource,
        query.select.as_deref(),
        "Microsoft.OutlookServices.Message",
    )?;
    // Graph lists the headers only when they are selected.
    let headers_selected = query
        .select
        .as_ref()
        .is_some_and(|names| names.iter().any(|name| name == "internetMessageHeaders"));
    if !headers_selected && let Some(object) = resource.as_object_mut() {
        object.remove("internetMessageHeaders");
    }

    let properties = expanded(&query.properties, |id| message.property(id));
    if !properties.is_empty() {
        resource["singleValueExtendedProperties"] = Value::Array(properties);
    }
    Ok(resource)
}

pub(crate) fn folder(folder: &Folder, mailbox: &Mailbox, query: &Query) -> Value {
    let messages = || {
        mailbox
            .messages
            .values()
            .filter(|message| message.folder_id == folder.id)
    };
    let mut resource = json!({
        "id": folder.id,
        "displayName": folder.name,
        "parentFolderId": folder.parent,
        "childFolderCount": mailbox.child_folders(&folder.id).len(),
        "unreadItemCount": messages().filter(|message| !message.is_read).count(),
        "totalItemCount": messages().count(),
        "sizeInBytes": messages().map(|message| message.body.len()).sum::<usize>(),
        "isHidden": false,
    });
    let properties = expanded(&query.properties, |id| {
        folder
            .properties
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(id))
            .map(|(_, value)| value.clone())
    });
    if !properties.is_empty() {
        resource["singleValueExtendedProperties"] = Value::Array(properties);
    }
    resource
}

pub(crate) fn attachment(attachment: &Attachment, query: &Query) -> Result<Value, GraphError> {
    let resource = json!({
        "@odata.type": "#microsoft.graph.fileAttachment",
        "@odata.mediaContentType": attachment.content_type,
        "id": attachment.id,
        "lastModifiedDateTime": time(attachment.modified),
        "name": attachment.name,
        "contentType": attachment.content_type,
        "size": attachment.bytes.len(),
        "isInline": attachment.inline,
        "contentId": attachment.content_id,
        "contentLocation": null,
        "contentBytes": STANDARD.encode(&attachment.bytes),
    });
    odata::select(
        resource,
        query.select.as_deref(),
        "Microsoft.OutlookServices.Attachment",
    )
}

pub(crate) fn category(category: &Category) -> Value {
    json!({"id": category.id, "displayName": category.name, "color": category.color})
}

pub(crate) fn contact(
    contact: &Contact,
    mailbox: &Mailbox,
    query: &Query,
) -> Result<Value, GraphError> {
    let emails: Vec<Value> = contact
        .emails
        .iter()
        .map(|email| json!({"name": contact.name.as_deref().unwrap_or(email), "address": email}))
        .collect();
    let resource = json!({
        "@odata.etag": format!("W/\"EQAAABYAAAA{}\"", contact.changed_seq),
        "id": contact.id,
        "parentFolderId": mailbox.contact_folder_id,
        "displayName": contact.name,
        "emailAddresses": emails,
    });
    odata::select(
        resource,
        query.select.as_deref(),
        "Microsoft.OutlookServices.Contact",
    )
}

pub(crate) fn user(mailbox: &Mailbox, query: &Query) -> Result<Value, GraphError> {
    let resource = json!({
        "id": mailbox.user_id,
        "displayName": mailbox.name,
        "mail": mailbox.email,
        "userPrincipalName": mailbox.email,
        "givenName": null,
        "surname": null,
        "jobTitle": null,
        "mobilePhone": null,
        "officeLocation": null,
        "preferredLanguage": null,
        "businessPhones": [],
    });
    odata::select(resource, query.select.as_deref(), "microsoft.graph.user")
}
