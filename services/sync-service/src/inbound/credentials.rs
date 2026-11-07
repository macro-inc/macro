pub use crate::domain::permissions::{AccessLevel, AuthToken, WriteAccess};
use macro_sync_service_jwt::session::{
    SessionIdentity, SessionKind, SurfaceAccessLevel, decode_surface,
};
use serde::Deserialize;
use worker::Error;

use crate::error::ResultExt;

#[derive(Deserialize)]
struct DocumentClaims {
    agent_correlation_id: Option<uuid::Uuid>,
    user_id: Option<String>,
    document_id: String,
    access_level: AccessLevel,
    actor: Option<String>,
    session_kind: Option<SessionKind>,
    surface_id: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct WebsocketQueryParams {
    pub token: String,
}

pub(crate) fn decode_document_token(token: &str, secret: &str) -> worker::Result<AuthToken> {
    let claims = macro_sync_service_jwt::decode::<DocumentClaims>(token, secret)
        .context("failed to decode document grant")?;
    if claims
        .session_kind
        .is_some_and(|kind| kind != SessionKind::Document)
        || claims.surface_id.is_some()
    {
        return Err(Error::from("surface grant cannot authorize a document"));
    }
    Ok(AuthToken::new(
        claims.document_id,
        claims.access_level,
        SessionKind::Document,
        claims.user_id,
        claims.actor,
        claims.agent_correlation_id,
        None,
    ))
}

pub(crate) fn decode_surface_token(
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
    Ok(AuthToken::new(
        identity.storage_key(),
        access_level,
        SessionKind::Surface,
        claims.user_id,
        claims.actor,
        None,
        Some(claims.exp),
    ))
}

#[cfg(test)]
mod test;
