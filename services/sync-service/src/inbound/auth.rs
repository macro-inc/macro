#[cfg(test)]
mod test;

use axum::http::HeaderMap;
use constant_time_eq::constant_time_eq;
use macro_sync_service_jwt::DocumentPermissionToken;
use serde::Deserialize;

use crate::{
    constants::header_names,
    domain::{
        document_id::DocumentId,
        permissions::{AccessLevel, AuthToken},
    },
    error::ResultExt,
    outbound::secrets::Secrets,
};

#[derive(Deserialize, Debug)]
pub struct WebsocketQueryParams {
    pub token: DocumentPermissionToken,
}

pub fn decode_jwt(token: &DocumentPermissionToken, secrets: &Secrets) -> worker::Result<AuthToken> {
    macro_sync_service_jwt::decode::<AuthToken>(
        token.as_str(),
        &secrets.document_permissions_secret,
    )
    .context("failed to decode `AuthToken`")
}

/// Extract the bearer token from the `Authorization` header (no validation —
/// pair with [`decode_jwt`]). `None` if the header is absent or not `Bearer …`.
pub fn extract_jwt_from_headers(headers: &HeaderMap) -> Option<DocumentPermissionToken> {
    headers
        .get(header_names::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|header| header.strip_prefix("Bearer "))
        .map(|token| DocumentPermissionToken::from(token.to_string()))
}

/// True when the request carries the shared internal API key. Internal services
/// (e.g. the document-copy flow) use it to authenticate as
/// [`AccessLevel::Admin`] without a user JWT.
pub fn internal_request(headers: &HeaderMap, secrets: &Secrets) -> bool {
    headers
        .get(header_names::MACRO_INTERNAL_AUTH_KEY_HEADER_KEY)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|key| constant_time_eq(secrets.internal_api_secret.as_bytes(), key.as_bytes()))
}

/// The inbound auth layer. Holds the [`Secrets`] needed to validate requests and
/// is independent of the [`SyncServiceCore`](crate::domain::ports::SyncServiceCore).
///
/// This means when implementing actual sync service logic we don't have to
/// think about auth at all!
#[derive(Clone)]
pub struct Authenticator {
    secrets: Secrets,
}

impl Authenticator {
    pub fn new(secrets: Secrets) -> Self {
        Self { secrets }
    }

    /// Does the request grant `level` access to `document_id`? Internal services
    /// authenticate with the shared key and act as Admin; otherwise the bearer
    /// JWT must both cover the document and carry sufficient permission.
    ///
    /// Synchronous (no `.await`) so callers can use it inside `Send` middleware
    /// without holding a borrow across an await point.
    pub fn authorize(
        &self,
        headers: &HeaderMap,
        document_id: &DocumentId,
        level: AccessLevel,
    ) -> bool {
        // override
        if internal_request(headers, &self.secrets) {
            return true;
        }

        // real check
        extract_jwt_from_headers(headers)
            .and_then(|token| decode_jwt(&token, &self.secrets).ok())
            .is_some_and(|claims| {
                claims.has_document_id_access(document_id) && claims.has_permission(&level)
            })
    }

    /// Decode a query-string token into claims (used by the websocket `connect`
    /// upgrade, which self-authenticates). `None` if the token is invalid.
    pub fn decode_query(&self, token: &DocumentPermissionToken) -> Option<AuthToken> {
        decode_jwt(token, &self.secrets).ok()
    }
}
