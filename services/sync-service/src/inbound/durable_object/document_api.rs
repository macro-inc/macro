//! HTTP adapter for the document snapshot/update service.
use base64::{Engine, engine::general_purpose::STANDARD};
use futures::StreamExt;
use serde::{Deserialize, Serialize};

use super::*;
use crate::domain::document::{DocumentError, MAX_BINARY_BYTES, MAX_REVISION_BYTES};

const MAX_BODY_BYTES: usize = (MAX_BINARY_BYTES + MAX_REVISION_BYTES).div_ceil(3) * 4 + 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub(crate) struct UpdateRequest {
    expected_revision: String,
    update: String,
}

#[derive(Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub(crate) struct SnapshotResponse {
    snapshot: String,
    revision: String,
}

#[derive(Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub(crate) struct UpdateResponse {
    revision: String,
    applied: bool,
}

fn error_response(error: DocumentError) -> Result<Response> {
    let status = match error {
        DocumentError::Unauthorized => 401,
        DocumentError::Forbidden => 403,
        DocumentError::Conflict => 409,
        DocumentError::TooLarge => 413,
        DocumentError::Invalid(_) => 400,
        DocumentError::Persistence => 503,
        DocumentError::Notification => 500,
    };
    Ok(
        Response::from_json(&serde_json::json!({ "error": error.to_string() }))?
            .with_status(status),
    )
}

fn room_error_response(error: sync_server_core::domain::room::RoomError) -> Result<Response> {
    match error {
        sync_server_core::domain::room::RoomError::Document(error) => error_response(error),
        other => Err(room_error(other)),
    }
}

impl HttpHandlers<'_> {
    pub(in crate::inbound) async fn document_handler(
        &mut self,
        mut req: Request,
        document_id: &str,
        is_update: bool,
        access: crate::domain::document::DocumentAccess,
        claims: crate::auth::AuthToken,
    ) -> Result<Response> {
        if req.method() != if is_update { Method::Post } else { Method::Get } {
            return Ok(response(405));
        }
        let key = SessionKey::new(document_id.to_owned());
        if !is_update {
            let shallow = req
                .url()?
                .query_pairs()
                .any(|(key, value)| key == "shallow" && value == "true");
            return match self.room.read_document(&key, &access, shallow).await {
                Ok(Some((snapshot, revision))) => Response::from_json(&SnapshotResponse {
                    snapshot: STANDARD.encode(snapshot),
                    revision: STANDARD.encode(revision),
                }),
                Ok(None) => Ok(response(404)),
                Err(error) => room_error_response(error),
            };
        }
        match self.room.prepare_document_update(&key, &access).await {
            Ok(true) => {}
            Ok(false) => return Ok(response(404)),
            Err(error) => return room_error_response(error),
        }
        if req
            .headers()
            .get("content-length")?
            .and_then(|length| length.parse::<usize>().ok())
            .is_some_and(|length| length > MAX_BODY_BYTES)
        {
            return error_response(DocumentError::TooLarge);
        }
        let mut bytes = Vec::new();
        let mut stream = req.stream()?;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            if bytes.len().saturating_add(chunk.len()) > MAX_BODY_BYTES {
                return error_response(DocumentError::TooLarge);
            }
            bytes.extend_from_slice(&chunk);
        }
        let body: UpdateRequest = match serde_json::from_slice(&bytes) {
            Ok(body) => body,
            Err(_) => return error_response(DocumentError::Invalid("Invalid update request.")),
        };
        if body.update.len() > MAX_BINARY_BYTES.div_ceil(3) * 4
            || body.expected_revision.len() > MAX_REVISION_BYTES.div_ceil(3) * 4
        {
            return error_response(DocumentError::TooLarge);
        }
        let (Ok(update), Ok(revision)) = (
            STANDARD.decode(body.update),
            STANDARD.decode(body.expected_revision),
        ) else {
            return error_response(DocumentError::Invalid("Invalid base64 update or revision."));
        };
        match self
            .room
            .update_document(&key, &access, claims, &revision, &update)
            .await
        {
            Ok(prepared) => Response::from_json(&UpdateResponse {
                revision: STANDARD.encode(prepared.revision),
                applied: prepared.applied,
            }),
            Err(error) => room_error_response(error),
        }
    }
}
