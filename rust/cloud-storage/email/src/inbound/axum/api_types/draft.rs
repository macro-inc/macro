use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::models::{ContactInfo, CreateDraftInput, CreatedDraft};

/// Contact info for draft request/response (backward-compatible with MessageToSend shape).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ApiDraftContactInfo {
    /// Email address.
    pub email: String,
    /// Display name.
    pub name: Option<String>,
    /// Profile photo URL.
    pub photo_url: Option<String>,
}

impl From<ApiDraftContactInfo> for ContactInfo {
    fn from(c: ApiDraftContactInfo) -> Self {
        ContactInfo {
            email: c.email,
            name: c.name,
            photo_url: c.photo_url,
        }
    }
}

impl From<ContactInfo> for ApiDraftContactInfo {
    fn from(c: ContactInfo) -> Self {
        ApiDraftContactInfo {
            email: c.email,
            name: c.name,
            photo_url: c.photo_url,
        }
    }
}

/// The draft input matching the current `MessageToSend` JSON shape for backward compat.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ApiDraftInput {
    /// Existing message DB ID (for updating an existing draft).
    pub db_id: Option<Uuid>,
    /// Provider message ID.
    pub provider_id: Option<String>,
    /// ID of the message this draft is replying to.
    pub replying_to_id: Option<Uuid>,
    /// Provider thread ID.
    pub provider_thread_id: Option<String>,
    /// Thread DB ID.
    pub thread_db_id: Option<Uuid>,
    /// Subject line.
    pub subject: String,
    /// To recipients.
    pub to: Option<Vec<ApiDraftContactInfo>>,
    /// Cc recipients.
    pub cc: Option<Vec<ApiDraftContactInfo>>,
    /// Bcc recipients.
    pub bcc: Option<Vec<ApiDraftContactInfo>>,
    /// Plain text body.
    pub body_text: Option<String>,
    /// HTML body (base64 URL_SAFE_NO_PAD encoded).
    pub body_html: Option<String>,
    /// Macro body format.
    pub body_macro: Option<String>,
    /// Headers JSON.
    pub headers_json: Option<JsonValue>,
}

/// Request body for creating a draft.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateDraftRequest {
    /// The draft content.
    pub draft: ApiDraftInput,
    /// Scheduled send time.
    pub send_time: Option<DateTime<Utc>>,
}

/// The draft output matching the current `MessageToSend` JSON shape for backward compat.
#[derive(Debug, Serialize, ToSchema)]
pub struct ApiDraftOutput {
    /// Message DB ID.
    pub db_id: Option<Uuid>,
    /// Provider message ID.
    pub provider_id: Option<String>,
    /// ID of the message this draft is replying to.
    pub replying_to_id: Option<Uuid>,
    /// Provider thread ID.
    pub provider_thread_id: Option<String>,
    /// Thread DB ID.
    pub thread_db_id: Option<Uuid>,
    /// Link ID.
    pub link_id: Uuid,
    /// Subject line.
    pub subject: String,
    /// To recipients.
    pub to: Option<Vec<ApiDraftContactInfo>>,
    /// Cc recipients.
    pub cc: Option<Vec<ApiDraftContactInfo>>,
    /// Bcc recipients.
    pub bcc: Option<Vec<ApiDraftContactInfo>>,
    /// Plain text body.
    pub body_text: Option<String>,
    /// HTML body (decoded).
    pub body_html: Option<String>,
    /// Macro body.
    pub body_macro: Option<String>,
    /// Headers JSON.
    pub headers_json: Option<JsonValue>,
    /// Send time.
    pub send_time: Option<DateTime<Utc>>,
}

/// Response body for creating a draft.
#[derive(Debug, Serialize, ToSchema)]
pub struct CreateDraftResponse {
    /// The created draft.
    pub draft: ApiDraftOutput,
}

impl CreateDraftRequest {
    /// Convert the API request into a domain `CreateDraftInput`.
    pub fn into_domain(self) -> CreateDraftInput {
        let draft = self.draft;

        CreateDraftInput {
            db_id: draft.db_id,
            provider_id: draft.provider_id,
            replying_to_id: draft.replying_to_id,
            provider_thread_id: draft.provider_thread_id,
            thread_db_id: draft.thread_db_id,
            subject: draft.subject,
            to: draft
                .to
                .unwrap_or_default()
                .into_iter()
                .map(ContactInfo::from)
                .collect(),
            cc: draft
                .cc
                .unwrap_or_default()
                .into_iter()
                .map(ContactInfo::from)
                .collect(),
            bcc: draft
                .bcc
                .unwrap_or_default()
                .into_iter()
                .map(ContactInfo::from)
                .collect(),
            body_text: draft.body_text,
            body_html: draft.body_html,
            body_macro: draft.body_macro,
            headers_json: draft.headers_json,
            send_time: self.send_time,
        }
    }
}

impl From<CreatedDraft> for ApiDraftOutput {
    fn from(d: CreatedDraft) -> Self {
        let to: Vec<ApiDraftContactInfo> =
            d.to.into_iter().map(ApiDraftContactInfo::from).collect();
        let cc: Vec<ApiDraftContactInfo> =
            d.cc.into_iter().map(ApiDraftContactInfo::from).collect();
        let bcc: Vec<ApiDraftContactInfo> =
            d.bcc.into_iter().map(ApiDraftContactInfo::from).collect();

        ApiDraftOutput {
            db_id: Some(d.db_id),
            provider_id: d.provider_id,
            replying_to_id: d.replying_to_id,
            provider_thread_id: d.provider_thread_id,
            thread_db_id: Some(d.thread_db_id),
            link_id: d.link_id,
            subject: d.subject,
            to: if to.is_empty() { None } else { Some(to) },
            cc: if cc.is_empty() { None } else { Some(cc) },
            bcc: if bcc.is_empty() { None } else { Some(bcc) },
            body_text: d.body_text,
            body_html: d.body_html,
            body_macro: d.body_macro,
            headers_json: d.headers_json,
            send_time: d.send_time,
        }
    }
}
