use crate::db;
use crate::email::service::address::ContactInfo;
use crate::email::service::attachment::Attachment;
use crate::email::service::label::{LabelInfo, system_labels};
use crate::service::attachment::AttachmentMacro;
use crate::service::body_parsing::body_parsed::{
    get_body_parsed_for_message, get_body_parsed_linkless_for_message,
};
use crate::service::body_parsing::body_replyless::get_body_replyless_for_message;
use crate::service::label::Label;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ParsedMessage {
    pub db_id: Uuid,
    pub link_id: Uuid,
    pub thread_db_id: Uuid,
    pub subject: Option<String>,
    pub from: Option<ContactInfo>,
    pub to: Vec<ContactInfo>,
    pub cc: Vec<ContactInfo>,
    pub bcc: Vec<ContactInfo>,
    pub labels: Vec<LabelInfo>,
    // contains the html of the message parsed into plaintext, with hyperlinks
    pub body_parsed: Option<String>,
    pub internal_date_ts: Option<DateTime<Utc>>,
}

// same as ParsedMessage except it has body_parsed_linkless instead of body_parsed
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ParsedSearchMessage {
    pub db_id: Uuid,
    pub link_id: Uuid,
    pub thread_db_id: Uuid,
    pub subject: Option<String>,
    pub from: Option<ContactInfo>,
    pub to: Vec<ContactInfo>,
    pub cc: Vec<ContactInfo>,
    pub bcc: Vec<ContactInfo>,
    pub labels: Vec<LabelInfo>,
    // contains the html of the message parsed into plaintext, without hyperlinks
    pub body_parsed_linkless: Option<String>,
    pub internal_date_ts: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Message {
    // the uuid we generated for the message in our database
    pub db_id: Option<Uuid>,
    // the id the user's provider (i.e. gmail) uses to identify the message
    pub provider_id: Option<String>,
    // the uuid we generated for the message's thread in the database
    pub thread_db_id: Option<Uuid>,
    // the id the user's provider (i.e. gmail) uses to identify the thread
    pub provider_thread_id: Option<String>,
    // the db id of the specific message this message is replying to (if any)
    pub replying_to_id: Option<Uuid>,
    /// The globally unique Message-ID header value created by the sender to uniquely identify this email
    /// Used for threading across all providers (In-Reply-To header, References header)
    pub global_id: Option<String>,
    pub link_id: Uuid,
    pub subject: Option<String>,
    pub snippet: Option<String>,
    pub provider_history_id: Option<String>,
    pub internal_date_ts: Option<DateTime<Utc>>,
    pub sent_at: Option<DateTime<Utc>>,
    pub size_estimate: Option<i64>,
    pub is_read: bool,
    pub is_starred: bool,
    pub is_sent: bool,
    pub is_draft: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_send_time: Option<DateTime<Utc>>,
    pub has_attachments: bool,
    pub from: Option<ContactInfo>,
    pub to: Vec<ContactInfo>,
    pub cc: Vec<ContactInfo>,
    pub bcc: Vec<ContactInfo>,
    pub labels: Vec<Label>,
    pub body_text: Option<String>,
    pub body_html_sanitized: Option<String>,
    pub body_macro: Option<String>,
    pub attachments: Vec<Attachment>,
    pub attachments_macro: Vec<AttachmentMacro>,
    pub headers_json: Option<JsonValue>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct MessageWithBodyReplyless {
    #[serde(flatten)]
    pub inner: Message,
    // the message body, without any replies nested underneath.
    pub body_replyless: Option<String>,
}

impl From<Message> for MessageWithBodyReplyless {
    fn from(message: Message) -> Self {
        Self {
            body_replyless: get_body_replyless_for_message(&message),
            inner: message,
        }
    }
}

impl From<MessageWithBodyReplyless> for ParsedMessage {
    fn from(msg: MessageWithBodyReplyless) -> Self {
        Self {
            body_parsed: get_body_parsed_for_message(&msg),
            db_id: msg.inner.db_id.unwrap_or_default(),
            link_id: msg.inner.link_id,
            thread_db_id: msg.inner.thread_db_id.unwrap_or_default(),
            subject: msg.inner.subject,
            from: msg.inner.from,
            to: msg.inner.to,
            cc: msg.inner.cc,
            bcc: msg.inner.bcc,
            labels: msg
                .inner
                .labels
                .into_iter()
                .map(|l| LabelInfo {
                    provider_id: l.provider_label_id,
                    name: l.name.unwrap_or_default(),
                })
                .collect(),
            internal_date_ts: msg.inner.internal_date_ts,
        }
    }
}

impl From<MessageWithBodyReplyless> for ParsedSearchMessage {
    fn from(msg: MessageWithBodyReplyless) -> Self {
        Self {
            body_parsed_linkless: get_body_parsed_linkless_for_message(&msg),
            db_id: msg.inner.db_id.unwrap_or_default(),
            link_id: msg.inner.link_id,
            thread_db_id: msg.inner.thread_db_id.unwrap_or_default(),
            subject: msg.inner.subject,
            from: msg.inner.from,
            to: msg.inner.to,
            cc: msg.inner.cc,
            bcc: msg.inner.bcc,
            labels: msg
                .inner
                .labels
                .into_iter()
                .map(|l| LabelInfo {
                    provider_id: l.provider_label_id,
                    name: l.name.unwrap_or_default(),
                })
                .collect(),
            internal_date_ts: msg.inner.internal_date_ts,
        }
    }
}

/// determine if a message is an inbound message for use in latest_inbound_message_ts
/// - for thread ordering purposes in the FE. (inbox view)
pub fn is_inbound(msg: &Message) -> bool {
    // if it's not in the inbox, don't count it as inbound
    if !msg
        .labels
        .iter()
        .any(|label| label.provider_label_id == system_labels::INBOX)
    {
        return false;
    }

    // if it's not a draft, it's not sent by us, and it has an inbox label, it's a valid inbound message
    if !(msg.is_draft || msg.is_sent) {
        return true;
    }

    // edge case for messages a user send to themselves
    if let Some(from) = &msg.from {
        let sender_email = &from.email;

        let in_to = msg.to.iter().any(|contact| &contact.email == sender_email);

        let in_cc = msg.cc.iter().any(|contact| &contact.email == sender_email);

        let in_bcc = msg.bcc.iter().any(|contact| &contact.email == sender_email);

        if in_to || in_cc || in_bcc {
            return true;
        }
    }
    false
}

/// determine if a message is an outbound message for use in latest_outbound_message_ts
/// - for thread ordering purposes in the FE. (sent view)
pub fn is_outbound(msg: &Message) -> bool {
    // if it has the TRASH label, don't count it as outbound
    if msg
        .labels
        .iter()
        .any(|label| label.provider_label_id == system_labels::TRASH)
    {
        return false;
    }

    msg.is_sent
}

/// determine if a message is spam/trash for use in latest_non_spam_message_ts
/// - for thread ordering purposes in the FE. (all mail view)
pub fn is_spam_or_trash(msg: &Message) -> bool {
    msg.labels.iter().any(|label| {
        matches!(
            label.provider_label_id.as_str(),
            system_labels::SPAM | system_labels::TRASH
        )
    })
}
/// the message resource returned by the provider layer to the service layer after inserting a
/// message
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SentMessageResource {
    pub db_id: Option<String>,
    pub provider_id: String,
    pub provider_thread_id: String,
    pub thread_db_id: Option<String>,
}

/// Simplified version of message that has no nested fields (contacts, labels, attachments). Direct
/// map from the db::message::Message object, with no body attributes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimpleMessage {
    pub db_id: Uuid,
    pub provider_id: Option<String>,
    pub thread_db_id: Uuid,
    pub provider_thread_id: Option<String>,
    pub replying_to_id: Option<Uuid>,
    pub global_id: String,
    pub link_id: Uuid,
    pub subject: Option<String>,
    pub snippet: Option<String>,
    pub from_contact_id: Option<Uuid>,
    pub provider_history_id: Option<String>,
    pub internal_date_ts: Option<DateTime<Utc>>,
    pub sent_at: Option<DateTime<Utc>>,
    pub size_estimate: Option<i64>,
    pub is_read: bool,
    pub is_starred: bool,
    pub is_sent: bool,
    pub is_draft: bool,
    pub has_attachments: bool,
    pub headers_json: Option<JsonValue>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// message format we get from the FE when sending a message
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct MessageToSend {
    pub db_id: Option<Uuid>,
    pub provider_id: Option<String>,
    pub replying_to_id: Option<Uuid>,
    pub provider_thread_id: Option<String>,
    pub thread_db_id: Option<Uuid>,
    pub link_id: Uuid,
    pub subject: String,
    pub to: Option<Vec<ContactInfo>>,
    pub cc: Option<Vec<ContactInfo>>,
    pub bcc: Option<Vec<ContactInfo>>,
    pub body_text: Option<String>,
    pub body_html: Option<String>,
    pub body_macro: Option<String>,
    pub attachments: Option<Vec<Attachment>>,
    pub attachments_macro: Option<Vec<AttachmentMacro>>,
    pub headers_json: Option<JsonValue>,
    pub send_time: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledMessage {
    pub link_id: Uuid,
    pub message_id: Uuid,
    pub send_time: DateTime<Utc>,
    pub sent: bool,
}

impl From<db::message::ScheduledMessage> for ScheduledMessage {
    fn from(other: db::message::ScheduledMessage) -> Self {
        Self {
            link_id: other.link_id,
            message_id: other.message_id,
            send_time: other.send_time,
            sent: other.sent,
        }
    }
}

/// Information about an email used in search responses
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ThreadHistoryInfo {
    pub item_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub viewed_at: Option<DateTime<Utc>>,
    pub snippet: Option<String>,
    pub user_id: String,
    pub subject: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadHistoryRequest {
    pub user_id: String,
    pub thread_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadHistoryResponse {
    pub history_map: HashMap<Uuid, ThreadHistoryInfo>,
}

pub trait HasContactInfo {
    fn get_from(&self) -> Option<&ContactInfo>;
    fn get_to(&self) -> &[ContactInfo];
    fn get_cc(&self) -> &[ContactInfo];
    fn get_bcc(&self) -> &[ContactInfo];
}

// Implement the trait for Message
impl HasContactInfo for Message {
    fn get_from(&self) -> Option<&ContactInfo> {
        self.from.as_ref()
    }

    fn get_to(&self) -> &[ContactInfo] {
        &self.to
    }

    fn get_cc(&self) -> &[ContactInfo] {
        &self.cc
    }

    fn get_bcc(&self) -> &[ContactInfo] {
        &self.bcc
    }
}

// Implement the trait for MessageToSend
impl HasContactInfo for MessageToSend {
    fn get_from(&self) -> Option<&ContactInfo> {
        None // MessageToSend doesn't have a from field directly
    }

    fn get_to(&self) -> &[ContactInfo] {
        self.to.as_deref().unwrap_or(&[])
    }

    fn get_cc(&self) -> &[ContactInfo] {
        self.cc.as_deref().unwrap_or(&[])
    }

    fn get_bcc(&self) -> &[ContactInfo] {
        self.bcc.as_deref().unwrap_or(&[])
    }
}
