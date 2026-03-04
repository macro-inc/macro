use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::models::{ContactInfo, CreateDraftInput};

use super::{ApiDraftInput, ApiDraftOutput};

/// Request body for sending a message (backward-compatible with `{ message: MessageToSend }`).
#[derive(Debug, Deserialize, ToSchema)]
pub struct SendMessageRequest {
    /// The message content.
    pub message: ApiDraftInput,
}

/// Response body for sending a message.
#[derive(Debug, Serialize, ToSchema)]
pub struct SendMessageResponse {
    /// The created message.
    pub message: ApiDraftOutput,
}

impl SendMessageRequest {
    /// Convert the API request into a domain `CreateDraftInput`.
    ///
    /// `send_time` is not set here — the service layer computes it from config.
    pub fn into_domain(self) -> CreateDraftInput {
        let msg = self.message;

        CreateDraftInput {
            db_id: msg.db_id,
            provider_id: msg.provider_id,
            replying_to_id: msg.replying_to_id,
            provider_thread_id: msg.provider_thread_id,
            thread_db_id: msg.thread_db_id,
            subject: msg.subject,
            to: msg
                .to
                .unwrap_or_default()
                .into_iter()
                .map(ContactInfo::from)
                .collect(),
            cc: msg
                .cc
                .unwrap_or_default()
                .into_iter()
                .map(ContactInfo::from)
                .collect(),
            bcc: msg
                .bcc
                .unwrap_or_default()
                .into_iter()
                .map(ContactInfo::from)
                .collect(),
            body_text: msg.body_text,
            body_html: msg.body_html,
            body_macro: msg.body_macro,
            headers_json: msg.headers_json,
            send_time: None,
        }
    }
}
