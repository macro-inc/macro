//! Signed reads and writes of a session's Loro state through sync-service's
//! document API.
//!
//! - `GET /document/{id}/state` answers `{"snapshot", "revision"}`, both
//!   standard base64: a full Loro snapshot and its encoded version vector.
//! - `POST /document/{id}/update` takes `{"expectedRevision", "update"}` (a
//!   Loro update, not a snapshot) and answers `{"revision", "applied"}`; `409`
//!   when the state moved past the expected revision.
//!
//! Both authenticate with `Authorization: Bearer <document permission JWT>`
//! scoped to `id`; sync-service never accepts the internal key for these
//! routes. The token and the payloads are never logged.

use base64::{Engine, engine::general_purpose::STANDARD};
use macro_sync_service_jwt::DocumentPermissionToken;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

use crate::SyncServiceClient;

#[cfg(test)]
mod test;

/// Sync-service's bound on a snapshot or update, in raw bytes.
pub const MAX_DOCUMENT_BINARY_BYTES: usize = 4 * 1024 * 1024;
/// Sync-service's bound on an encoded revision, in raw bytes.
pub const MAX_DOCUMENT_REVISION_BYTES: usize = 64 * 1024;
/// The largest response body: both bounds, base64-encoded, plus JSON framing.
const MAX_RESPONSE_BYTES: usize =
    (MAX_DOCUMENT_BINARY_BYTES + MAX_DOCUMENT_REVISION_BYTES).div_ceil(3) * 4 + 1024;

/// A session's full Loro state.
#[derive(Clone, PartialEq, Eq)]
pub struct DocumentState {
    /// A full Loro snapshot export.
    pub snapshot: Vec<u8>,
    /// The encoded Loro version vector the snapshot is at.
    pub revision: Vec<u8>,
}

/// Lengths only: document content stays out of logs.
impl std::fmt::Debug for DocumentState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DocumentState")
            .field("snapshot_len", &self.snapshot.len())
            .field("revision_len", &self.revision.len())
            .finish()
    }
}

/// The outcome of [`SyncServiceClient::update_document`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DocumentUpdate {
    /// The state includes the update, at `revision`. A retried update the
    /// state already held reports this too, with the current revision.
    Applied {
        /// The encoded Loro version vector after the update.
        revision: Vec<u8>,
    },
    /// The state moved past the expected revision (`409`); nothing applied.
    Conflict,
}

/// Why a state read or update failed. Never carries the token or a payload.
#[derive(Debug)]
pub enum DocumentStateError {
    /// The request failed in flight or its body could not be read.
    Transport(reqwest::Error),
    /// `400`: sync-service rejected the update or revision bytes.
    Invalid,
    /// `401`: the grant was missing, malformed, expired or for another id.
    Unauthorized,
    /// `403`: the grant is read-only, or the session is frozen or retired.
    Forbidden,
    /// `404`: the session has no state.
    NotFound,
    /// `413`, or a request or response past the sync-service bounds.
    TooLarge,
    /// Any other non-success status.
    Rejected(StatusCode),
    /// A `200` whose body is not the documented shape.
    InvalidResponse(&'static str),
}

impl std::fmt::Display for DocumentStateError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Transport(error) => write!(formatter, "document state transport: {error}"),
            Self::Invalid => write!(formatter, "document state request rejected as invalid"),
            Self::Unauthorized => write!(formatter, "document state grant refused"),
            Self::Forbidden => write!(formatter, "document state access forbidden"),
            Self::NotFound => write!(formatter, "document state not found"),
            Self::TooLarge => write!(formatter, "document state exceeds the size limit"),
            Self::Rejected(status) => write!(formatter, "document state rejected: {status}"),
            Self::InvalidResponse(reason) => {
                write!(formatter, "invalid document state response: {reason}")
            }
        }
    }
}

impl std::error::Error for DocumentStateError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Transport(error) => Some(error),
            _ => None,
        }
    }
}

#[derive(Deserialize)]
struct StateResponse {
    snapshot: String,
    revision: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateRequest {
    expected_revision: String,
    update: String,
}

/// Its `applied` flag is `false` for an update the state already held; both
/// mean the state includes the update.
#[derive(Deserialize)]
struct UpdateResponse {
    revision: String,
}

fn rejection(status: StatusCode) -> DocumentStateError {
    match status {
        StatusCode::BAD_REQUEST => DocumentStateError::Invalid,
        StatusCode::UNAUTHORIZED => DocumentStateError::Unauthorized,
        StatusCode::FORBIDDEN => DocumentStateError::Forbidden,
        StatusCode::NOT_FOUND => DocumentStateError::NotFound,
        StatusCode::PAYLOAD_TOO_LARGE => DocumentStateError::TooLarge,
        status => DocumentStateError::Rejected(status),
    }
}

/// Read a success body, refusing one past [`MAX_RESPONSE_BYTES`] before or
/// while reading it.
async fn bounded_body(mut response: reqwest::Response) -> Result<Vec<u8>, DocumentStateError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(DocumentStateError::TooLarge);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(DocumentStateError::Transport)?
    {
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(DocumentStateError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn decode_bounded(
    encoded: &str,
    bound: usize,
    field: &'static str,
) -> Result<Vec<u8>, DocumentStateError> {
    if encoded.len() > bound.div_ceil(3) * 4 {
        return Err(DocumentStateError::TooLarge);
    }
    STANDARD
        .decode(encoded)
        .map_err(|_| DocumentStateError::InvalidResponse(field))
}

impl SyncServiceClient {
    /// Read `document_id`'s full Loro state with a grant scoped to it.
    #[tracing::instrument(err, skip(self, token))]
    pub async fn document_state(
        &self,
        document_id: &str,
        token: &DocumentPermissionToken,
    ) -> Result<DocumentState, DocumentStateError> {
        let response = self
            .client
            .get(format!("{}/document/{document_id}/state", self.url))
            .bearer_auth(token.as_str())
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .map_err(DocumentStateError::Transport)?;
        if response.status() != StatusCode::OK {
            return Err(rejection(response.status()));
        }
        let body: StateResponse = serde_json::from_slice(&bounded_body(response).await?)
            .map_err(|_| DocumentStateError::InvalidResponse("not a state response"))?;
        Ok(DocumentState {
            snapshot: decode_bounded(&body.snapshot, MAX_DOCUMENT_BINARY_BYTES, "snapshot")?,
            revision: decode_bounded(&body.revision, MAX_DOCUMENT_REVISION_BYTES, "revision")?,
        })
    }

    /// Apply a Loro `update` to `document_id` if its state is still at
    /// `expected_revision`, with an Edit grant scoped to it. Refuses bytes
    /// past the sync-service bounds without sending them.
    #[tracing::instrument(
        err,
        skip(self, token, expected_revision, update),
        fields(update_len = update.len())
    )]
    pub async fn update_document(
        &self,
        document_id: &str,
        token: &DocumentPermissionToken,
        expected_revision: &[u8],
        update: &[u8],
    ) -> Result<DocumentUpdate, DocumentStateError> {
        if update.len() > MAX_DOCUMENT_BINARY_BYTES
            || expected_revision.len() > MAX_DOCUMENT_REVISION_BYTES
        {
            return Err(DocumentStateError::TooLarge);
        }
        let response = self
            .client
            .post(format!("{}/document/{document_id}/update", self.url))
            .bearer_auth(token.as_str())
            .json(&UpdateRequest {
                expected_revision: STANDARD.encode(expected_revision),
                update: STANDARD.encode(update),
            })
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .map_err(DocumentStateError::Transport)?;
        match response.status() {
            StatusCode::OK => {}
            StatusCode::CONFLICT => return Ok(DocumentUpdate::Conflict),
            status => return Err(rejection(status)),
        }
        let body: UpdateResponse = serde_json::from_slice(&bounded_body(response).await?)
            .map_err(|_| DocumentStateError::InvalidResponse("not an update response"))?;
        Ok(DocumentUpdate::Applied {
            revision: decode_bounded(&body.revision, MAX_DOCUMENT_REVISION_BYTES, "revision")?,
        })
    }
}
