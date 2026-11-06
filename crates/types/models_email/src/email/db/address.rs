use crate::email::db::message::MessageRecipient;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Type};
use uuid::Uuid;

#[derive(FromRow, Debug, Clone, Serialize, Deserialize)]
pub struct EmailAddress {
    pub id: Uuid,
    pub email_address: String,
    pub name: Option<String>,
    pub created_at: DateTime<Utc>,
}

// Contact differs from EmailAddress in that it relates to a link_id, not an email. Last_interaction
// is the last time a message was sent to or received from this contact for the link_id. Contacts
// are what we use for a user's contacts list in the frontend.
#[derive(FromRow, Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub link_id: Uuid,
    pub email_address: String,
    pub name: Option<String>,
    pub photo_url: Option<String>,
    pub last_interaction: DateTime<Utc>,
}

#[derive(Debug, Default)]
pub struct ParsedAddresses {
    pub from: Option<EmailAddress>,
    pub to: Vec<EmailAddress>,
    pub cc: Vec<EmailAddress>,
    pub bcc: Vec<EmailAddress>,
}

#[derive(Debug, Default)]
pub struct UpsertedRecipients {
    pub from_contact_id: Option<Uuid>,
    pub recipients: Vec<MessageRecipient>,
}

#[derive(Debug, sqlx::FromRow)]
pub struct FetchedAddressId {
    pub email_address: String,
    pub id: Uuid,
}

#[derive(Type, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[sqlx(type_name = "email_recipient_type", rename_all = "UPPERCASE")]
pub enum EmailRecipientType {
    To,
    Cc,
    Bcc,
}
