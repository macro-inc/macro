use macro_sync_service_jwt::session::{
    SessionIdentity, SessionKind, SurfaceAccessLevel, decode_surface,
};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use worker::Error;

use crate::{constants::header_names, error::ResultExt, secrets::Secrets};

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone, PartialOrd, Ord, Default)]
#[serde(rename_all = "lowercase")]
pub enum AccessLevel {
    #[default]
    View = 0,
    /// Legacy document sockets permit Comment writes; surfaces do not.
    Comment = 1,
    Edit = 2,
    Owner = 3,
    Admin = 4,
}

impl AccessLevel {
    pub fn can_edit_for(&self, kind: SessionKind) -> bool {
        let minimum = match kind {
            SessionKind::Document => Self::Comment,
            SessionKind::Surface => Self::Edit,
        };
        self >= &minimum
    }
}

/// Verified grant normalized at the dedicated session access boundary.
#[derive(Debug)]
pub struct AuthToken {
    pub user_id: Option<String>,
    document_id: String,
    pub access_level: AccessLevel,
    pub actor: Option<String>,
    pub session_kind: SessionKind,
    pub expires_at: Option<usize>,
}

#[derive(Deserialize)]
struct DocumentClaims {
    user_id: Option<String>,
    document_id: String,
    access_level: AccessLevel,
    actor: Option<String>,
    session_kind: Option<SessionKind>,
    surface_id: Option<String>,
}

impl AuthToken {
    pub fn has_permission(&self, level: &AccessLevel) -> bool {
        self.access_level >= *level
    }

    pub fn has_document_id_access(&self, document_id: &str) -> bool {
        self.session_kind == SessionKind::Document
            && (self.document_id == document_id || self.access_level == AccessLevel::Admin)
    }
}

#[derive(Deserialize, Debug)]
pub struct WebsocketQueryParams {
    pub token: String,
}

pub enum TokenFrom {
    Headers,
    QueryParams,
}

pub fn is_internal(req: &worker::Request, env: &worker::Env) -> worker::Result<bool> {
    let Some(key) = req
        .headers()
        .get(header_names::MACRO_INTERNAL_AUTH_KEY_HEADER_KEY)?
    else {
        return Ok(false);
    };
    Ok(key
        .as_bytes()
        .ct_eq(Secrets::from(env).internal_api_secret.as_bytes())
        .into())
}

fn request_token(req: &worker::Request, source: TokenFrom) -> worker::Result<String> {
    match source {
        TokenFrom::Headers => req
            .headers()
            .get(header_names::AUTHORIZATION)?
            .and_then(|header| header.strip_prefix("Bearer ").map(str::to_owned))
            .ok_or_else(|| Error::from("Missing or malformed Bearer authorization")),
        TokenFrom::QueryParams => Ok(req.query::<WebsocketQueryParams>()?.token),
    }
}

fn decode_document_token(token: &str, secret: &str) -> worker::Result<AuthToken> {
    let claims = macro_sync_service_jwt::decode::<DocumentClaims>(token, secret)
        .context("failed to decode document grant")?;
    if claims
        .session_kind
        .is_some_and(|kind| kind != SessionKind::Document)
        || claims.surface_id.is_some()
    {
        return Err(Error::from("surface grant cannot authorize a document"));
    }
    Ok(AuthToken {
        user_id: claims.user_id,
        document_id: claims.document_id,
        access_level: claims.access_level,
        actor: claims.actor,
        session_kind: SessionKind::Document,
        expires_at: None,
    })
}

fn decode_surface_token(
    token: &str,
    secret: &str,
    identity: &SessionIdentity,
) -> worker::Result<AuthToken> {
    let claims = decode_surface(token, secret).context("failed to decode surface grant")?;
    if claims.session_identity() != *identity {
        return Err(Error::from("surface grant does not match session"));
    }
    let access_level = match claims.access_level {
        SurfaceAccessLevel::View => AccessLevel::View,
        SurfaceAccessLevel::Comment => AccessLevel::Comment,
        SurfaceAccessLevel::Edit => AccessLevel::Edit,
        SurfaceAccessLevel::Owner => AccessLevel::Owner,
    };
    Ok(AuthToken {
        user_id: claims.user_id,
        document_id: identity.storage_key(),
        access_level,
        actor: claims.actor,
        session_kind: SessionKind::Surface,
        expires_at: Some(claims.exp),
    })
}

pub fn surface_access(
    req: &worker::Request,
    env: &worker::Env,
    source: TokenFrom,
    identity: &SessionIdentity,
) -> worker::Result<AuthToken> {
    decode_surface_token(
        &request_token(req, source)?,
        &Secrets::from(env).document_permissions_secret,
        identity,
    )
}

/// Authenticate a socket against the persisted, kind-discriminated storage key.
pub fn socket_access(
    req: &worker::Request,
    env: &worker::Env,
    session_key: &str,
) -> worker::Result<AuthToken> {
    if let Some(id) = session_key.strip_prefix("surface:") {
        let identity = SessionIdentity::new(SessionKind::Surface, id)
            .map_err(|error| Error::from(error.to_string()))?;
        return surface_access(req, env, TokenFrom::QueryParams, &identity);
    }
    let claims = decode_jwt(req, env, TokenFrom::QueryParams)?;
    if !claims.has_document_id_access(session_key) {
        return Err(Error::from("document grant does not match session"));
    }
    Ok(claims)
}

pub fn decode_jwt(
    req: &worker::Request,
    env: &worker::Env,
    source: TokenFrom,
) -> worker::Result<AuthToken> {
    if matches!(source, TokenFrom::Headers) && is_internal(req, env)? {
        return Ok(AuthToken {
            user_id: None,
            document_id: String::new(),
            access_level: AccessLevel::Admin,
            actor: None,
            session_kind: SessionKind::Document,
            expires_at: None,
        });
    }
    decode_document_token(
        &request_token(req, source)?,
        &Secrets::from(env).document_permissions_secret,
    )
}

/// Dedicated access boundary for document HTTP requests. Internal service
/// credentials do not substitute for a signed, document-scoped user grant.
pub fn document_access(
    req: &worker::Request,
    env: &worker::Env,
    document_id: &str,
) -> Result<
    (crate::domain::document::DocumentAccess, AuthToken),
    crate::domain::document::DocumentError,
> {
    use crate::domain::document::DocumentError;
    let token = request_token(req, TokenFrom::Headers).map_err(|_| DocumentError::Unauthorized)?;
    let claims = decode_document_token(&token, &Secrets::from(env).document_permissions_secret)
        .map_err(|_| DocumentError::Unauthorized)?;
    let access = crate::domain::document::DocumentAccess::authorize(
        document_id,
        &claims.document_id,
        claims.access_level >= AccessLevel::Edit,
    )?;
    Ok((access, claims))
}

#[cfg(test)]
mod test;
