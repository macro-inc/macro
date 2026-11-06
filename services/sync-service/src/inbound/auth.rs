use axum::http::HeaderMap;
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
        .is_some_and(|key| secrets.internal_api_secret == key)
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

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;

    use super::*;

    const PERM_SECRET: &str = "perm-secret";
    const INTERNAL_KEY: &str = "internal-key";

    fn authenticator() -> Authenticator {
        Authenticator::new(Secrets::new(
            INTERNAL_KEY.to_string(),
            PERM_SECRET.to_string(),
        ))
    }

    fn bearer(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header_names::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
        );
        headers
    }

    fn jwt(document_id: &str, access_level: &str) -> String {
        let claims = serde_json::json!({
            "user_id": null,
            "document_id": document_id,
            "access_level": access_level,
            // decoding validates `exp` by default; set it far in the future.
            "exp": 4_102_444_800u64,
        });
        macro_sync_service_jwt::encode(&claims, PERM_SECRET)
            .unwrap()
            .into_inner()
    }

    #[test]
    fn internal_key_authenticates_as_admin() {
        let headers = {
            let mut h = HeaderMap::new();
            h.insert(
                header_names::MACRO_INTERNAL_AUTH_KEY_HEADER_KEY,
                HeaderValue::from_static(INTERNAL_KEY),
            );
            h
        };
        assert!(authenticator().authorize(
            &headers,
            &DocumentId::from("any-doc"),
            AccessLevel::Admin,
        ));
    }

    #[test]
    fn valid_token_grants_up_to_its_level() {
        let headers = bearer(&jwt("doc-1", "edit"));
        let auth = authenticator();
        assert!(auth.authorize(&headers, &DocumentId::from("doc-1"), AccessLevel::View));
        assert!(auth.authorize(&headers, &DocumentId::from("doc-1"), AccessLevel::Edit));
    }

    #[test]
    fn view_token_rejected_for_higher_level() {
        let headers = bearer(&jwt("doc-1", "view"));
        assert!(!authenticator().authorize(
            &headers,
            &DocumentId::from("doc-1"),
            AccessLevel::Admin,
        ));
    }

    #[test]
    fn token_rejected_for_other_document() {
        let headers = bearer(&jwt("doc-1", "edit"));
        assert!(!authenticator().authorize(
            &headers,
            &DocumentId::from("doc-2"),
            AccessLevel::View,
        ));
    }

    #[test]
    fn missing_token_is_unauthorized() {
        assert!(!authenticator().authorize(
            &HeaderMap::new(),
            &DocumentId::from("doc-1"),
            AccessLevel::View,
        ));
    }
}
