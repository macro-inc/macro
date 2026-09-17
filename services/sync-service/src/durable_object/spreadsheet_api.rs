//! HTTP adapter for the native spreadsheet snapshot/update service.
use base64::{Engine, engine::general_purpose::STANDARD};
use futures::StreamExt;
use serde::{Deserialize, Serialize};

use super::spreadsheet_effects::WorkerSpreadsheetEffects;
use super::*;
use crate::{
    spreadsheet::{self, MAX_BINARY_BYTES, MAX_REVISION_BYTES, SpreadsheetError},
    storage::SpreadsheetUpdateStorage,
};

const MAX_BODY_BYTES: usize = (MAX_BINARY_BYTES + MAX_REVISION_BYTES).div_ceil(3) * 4 + 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateRequest {
    expected_revision: String,
    update: String,
}

#[derive(Serialize)]
struct SnapshotResponse {
    snapshot: String,
    revision: String,
}

#[derive(Serialize)]
struct UpdateResponse {
    revision: String,
    applied: bool,
}

fn error_response(error: SpreadsheetError) -> Result<Response> {
    let status = match error {
        SpreadsheetError::Unauthorized => 401,
        SpreadsheetError::Forbidden => 403,
        SpreadsheetError::Conflict => 409,
        SpreadsheetError::TooLarge => 413,
        SpreadsheetError::Invalid(_) => 400,
        SpreadsheetError::Persistence => 503,
        SpreadsheetError::Notification => 500,
    };
    Ok(
        Response::from_json(&serde_json::json!({ "error": error.to_string() }))?
            .with_status(status),
    )
}

impl DocumentSyncSession {
    pub(super) async fn spreadsheet_handler(
        &self,
        mut req: Request,
        document_id: &str,
    ) -> Result<Response> {
        // A shared internal key never bypasses the user/document permission JWT.
        let (access, claims) = match crate::auth::spreadsheet_access(&req, &self.env, document_id) {
            Ok(access) => access,
            Err(error) => return error_response(error),
        };
        let is_update = req.path().ends_with("/spreadsheet-update");
        if req.method() != if is_update { Method::Post } else { Method::Get } {
            return Ok(response(405));
        }
        if is_update && let Err(error) = access.require_edit() {
            return error_response(error);
        }
        if !self.exists(document_id).await? {
            return Ok(response(404));
        }
        if !is_update {
            let state = self.document_state().await?;
            return match spreadsheet::snapshot(&access, &state.loro_doc) {
                Ok((snapshot, revision)) => Response::from_json(&SnapshotResponse {
                    snapshot: STANDARD.encode(snapshot),
                    revision: STANDARD.encode(revision),
                }),
                Err(error) => error_response(error),
            };
        }
        if req
            .headers()
            .get("content-length")?
            .and_then(|length| length.parse::<usize>().ok())
            .is_some_and(|length| length > MAX_BODY_BYTES)
        {
            return error_response(SpreadsheetError::TooLarge);
        }
        let mut bytes = Vec::new();
        let mut stream = req.stream()?;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            if bytes.len().saturating_add(chunk.len()) > MAX_BODY_BYTES {
                return error_response(SpreadsheetError::TooLarge);
            }
            bytes.extend_from_slice(&chunk);
        }
        let body: UpdateRequest = match serde_json::from_slice(&bytes) {
            Ok(body) => body,
            Err(_) => return error_response(SpreadsheetError::Invalid("Invalid update request.")),
        };
        if body.update.len() > MAX_BINARY_BYTES.div_ceil(3) * 4
            || body.expected_revision.len() > MAX_REVISION_BYTES.div_ceil(3) * 4
        {
            return error_response(SpreadsheetError::TooLarge);
        }
        let (Ok(update), Ok(revision)) = (
            STANDARD.decode(body.update),
            STANDARD.decode(body.expected_revision),
        ) else {
            return error_response(SpreadsheetError::Invalid(
                "Invalid base64 update or revision.",
            ));
        };
        let state = self.document_state().await?;
        let storage = self.session_storage().await?;
        let attribution = match claims
            .actor
            .as_ref()
            .map(|actor| {
                spreadsheet::SpreadsheetAttribution::from_signed_claims(
                    actor.clone(),
                    claims.user_id.clone(),
                )
            })
            .transpose()
        {
            Ok(attribution) => attribution,
            Err(error) => return error_response(error),
        };
        let port = SpreadsheetUpdateStorage {
            document_state: &state,
            storage: &storage,
            attribution: attribution.as_ref(),
        };
        let effects = WorkerSpreadsheetEffects {
            session: self,
            document_state: &state,
            document_id,
            attribution: attribution.as_ref(),
        };
        // The service synchronously compares + validates + imports before its
        // first storage await, just like a websocket update in this isolate.
        let prepared = match spreadsheet::update(&access, &port, &effects, &revision, &update).await
        {
            Ok(prepared) => prepared,
            Err(error) => return error_response(error),
        };
        Response::from_json(&UpdateResponse {
            revision: STANDARD.encode(prepared.revision),
            applied: prepared.applied,
        })
    }
}
