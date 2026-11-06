//! Session-scoped credentials for the worker runtime. These are document grants,
//! not the application session credentials consumed by macro_authorization.
use std::collections::HashMap;

use axum::{
    extract::{FromRef, FromRequestParts, Path, Query},
    http::{StatusCode, request::Parts},
};
use subtle::ConstantTimeEq;

use crate::secrets::Secrets;
use crate::{
    auth::{WebsocketQueryParams, decode_document_token},
    constants::header_names,
    domain::{
        document::DocumentAccess,
        permissions::{AccessLevel, AuthToken},
    },
};

/// Verified document grant with the minimum permission required by its route.
/// Internal credentials are accepted only by the legacy service APIs.
pub struct SessionAccess<L> {
    pub document_id: String,
    level: std::marker::PhantomData<L>,
}

pub trait RequiredAccess: Send + Sync {
    const LEVEL: AccessLevel;
}

pub struct View;
impl RequiredAccess for View {
    const LEVEL: AccessLevel = AccessLevel::View;
}
pub struct Edit;
impl RequiredAccess for Edit {
    const LEVEL: AccessLevel = AccessLevel::Edit;
}
pub struct Admin;
impl RequiredAccess for Admin {
    const LEVEL: AccessLevel = AccessLevel::Admin;
}

pub type ViewAccess = SessionAccess<View>;
pub type EditAccess = SessionAccess<Edit>;
pub type AdminAccess = SessionAccess<Admin>;

async fn document_id(parts: &mut Parts) -> Result<String, StatusCode> {
    let Path(params) = Path::<HashMap<String, String>>::from_request_parts(parts, &())
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let id = params.get("document_id").ok_or(StatusCode::BAD_REQUEST)?;
    tracing::Span::current().record("document.id", id.as_str());
    Ok(id.clone())
}

fn internal(parts: &Parts, state: &Secrets) -> bool {
    parts
        .headers
        .get(header_names::MACRO_INTERNAL_AUTH_KEY_HEADER_KEY)
        .is_some_and(|key| bool::from(key.as_bytes().ct_eq(state.internal_api_secret.as_bytes())))
}

fn bearer(parts: &Parts, state: &Secrets) -> Result<AuthToken, StatusCode> {
    let token = parts
        .headers
        .get(header_names::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    decode_document_token(token, &state.document_permissions_secret)
        .map_err(|_| StatusCode::UNAUTHORIZED)
}

impl<S: Send + Sync, L: RequiredAccess> FromRequestParts<S> for SessionAccess<L>
where
    Secrets: FromRef<S>,
{
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let secrets = Secrets::from_ref(state);
        let state = &secrets;
        let document_id = document_id(parts).await?;
        if !internal(parts, state) {
            let claims = bearer(parts, state)?;
            claims
                .require_document_permission(&document_id, &L::LEVEL)
                .map_err(|_| StatusCode::UNAUTHORIZED)?;
        }
        Ok(Self {
            document_id,
            level: std::marker::PhantomData,
        })
    }
}

/// Query-token authentication scoped to the document being connected to.
pub struct SocketAccess {
    pub document_id: String,
    pub claims: AuthToken,
}

impl<S: Send + Sync> FromRequestParts<S> for SocketAccess
where
    Secrets: FromRef<S>,
{
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let secrets = Secrets::from_ref(state);
        let state = &secrets;
        let document_id = document_id(parts).await?;
        let Query(params) = Query::<WebsocketQueryParams>::from_request_parts(parts, state)
            .await
            .map_err(|_| StatusCode::UNAUTHORIZED)?;
        let claims = decode_document_token(&params.token, &state.document_permissions_secret)
            .map_err(|_| StatusCode::UNAUTHORIZED)?;
        claims
            .require_document_permission(&document_id, &AccessLevel::View)
            .map_err(|_| StatusCode::UNAUTHORIZED)?;
        Ok(Self {
            document_id,
            claims,
        })
    }
}

/// Atomic document reads/updates require a signed user grant even when an
/// internal key is also present. The capability is passed into the domain.
pub struct SignedDocumentAccess {
    pub document_id: String,
    pub access: DocumentAccess,
    pub claims: AuthToken,
}

impl<S: Send + Sync> FromRequestParts<S> for SignedDocumentAccess
where
    Secrets: FromRef<S>,
{
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let secrets = Secrets::from_ref(state);
        let state = &secrets;
        let document_id = document_id(parts).await?;
        let claims = bearer(parts, state)?;
        let access = claims
            .document_access(&document_id)
            .map_err(|_| StatusCode::UNAUTHORIZED)?;
        Ok(Self {
            document_id,
            access,
            claims,
        })
    }
}

/// Destructive service APIs accept only the shared internal credential.
pub struct InternalAccess;

impl<S: Send + Sync> FromRequestParts<S> for InternalAccess
where
    Secrets: FromRef<S>,
{
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let secrets = Secrets::from_ref(state);
        let state = &secrets;
        if internal(parts, state) {
            Ok(Self)
        } else {
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

#[cfg(test)]
mod test;

/// A kind-discriminated, exact surface grant. Management keys cannot be used
/// in place of a surface grant on read or connect routes.
pub struct SurfaceAccess<const QUERY: bool> {
    pub claims: AuthToken,
}

impl<S: Send + Sync, const QUERY: bool> FromRequestParts<S> for SurfaceAccess<QUERY>
where
    Secrets: FromRef<S>,
{
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        use macro_sync_service_jwt::session::{SessionIdentity, SessionKind};
        let secrets = Secrets::from_ref(state);
        let Path(params) = Path::<HashMap<String, String>>::from_request_parts(parts, state)
            .await
            .map_err(|_| StatusCode::BAD_REQUEST)?;
        let id = params.get("surface_id").ok_or(StatusCode::BAD_REQUEST)?;
        let identity =
            SessionIdentity::new(SessionKind::Surface, id).map_err(|_| StatusCode::BAD_REQUEST)?;
        let token = if QUERY {
            let Query(params) = Query::<WebsocketQueryParams>::from_request_parts(parts, state)
                .await
                .map_err(|_| StatusCode::UNAUTHORIZED)?;
            params.token
        } else {
            parts
                .headers
                .get(header_names::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.strip_prefix("Bearer "))
                .ok_or(StatusCode::UNAUTHORIZED)?
                .to_owned()
        };
        let claims = crate::auth::decode_surface_token(
            &token,
            &secrets.document_permissions_secret,
            &identity,
        )
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
        Ok(Self { claims })
    }
}
