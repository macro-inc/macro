//! `/v1/credentials` (shared key) and `/v1/whoami` (device credential).

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use serde::Deserialize;
use serde_json::json;

use super::{ApiError, Service, api_key};
use crate::domain::models::{CredentialId, GitaiError};
use crate::domain::ports::{IndexStore, IngestMetrics, ObjectStore};

#[derive(Deserialize)]
pub(super) struct MintRequest {
    email: String,
    hostname: String,
}

/// `POST /v1/credentials {email, hostname}` → 201 with the credential, shown
/// only this once.
pub(super) async fn mint<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics>(
    State(service): State<Service<Objects, Index, Metrics>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<impl IntoResponse, ApiError> {
    // Authenticate before reading the body, so a caller without the key
    // learns nothing about the request shape.
    let presented = api_key(&headers);
    service.authorize_operator(presented)?;
    let request: MintRequest = serde_json::from_slice(&body)
        .map_err(|_| GitaiError::BadRequest("expected {\"email\", \"hostname\"}".to_owned()))?;

    let minted = service
        .mint_credential(presented, &request.email, &request.hostname)
        .await?;
    let body = json!({
        "id": minted.info.id,
        "credential": minted.credential.expose(),
        "email": minted.info.email,
        "hostname": minted.info.hostname,
        "created_at": minted.info.created_at,
    });
    Ok((StatusCode::CREATED, Json(body)))
}

/// `GET /v1/credentials`.
pub(super) async fn list<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics>(
    State(service): State<Service<Objects, Index, Metrics>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let credentials = service.list_credentials(api_key(&headers)).await?;
    Ok(Json(json!({ "credentials": credentials })))
}

/// `DELETE /v1/credentials/{id}` → 204.
pub(super) async fn revoke<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics>(
    State(service): State<Service<Objects, Index, Metrics>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let presented = api_key(&headers);
    // An unparseable id is checked after the key, so it is 401 without one.
    let id = match id.parse::<CredentialId>() {
        Ok(id) => id,
        Err(_) => {
            service.authorize_operator(presented)?;
            return Err(GitaiError::NotFound.into());
        }
    };
    service.revoke_credential(presented, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /v1/whoami` → `{id, email, hostname}` of the device credential.
pub(super) async fn whoami<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics>(
    State(service): State<Service<Objects, Index, Metrics>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let identity = service.whoami(api_key(&headers)).await?;
    Ok(Json(json!({
        "id": identity.credential_id,
        "email": identity.email,
        "hostname": identity.hostname,
    })))
}
