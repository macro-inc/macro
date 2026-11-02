pub use crate::domain::permissions::{AccessLevel, AuthToken, WriteAccess};
use macro_sync_service_jwt::session::{
    SessionIdentity, SessionKind, SurfaceAccessLevel, decode_surface,
};
use serde::Deserialize;
use worker::Error;

use crate::error::ResultExt;

#[derive(Deserialize)]
struct DocumentClaims {
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
    Ok(AuthToken {
        user_id: claims.user_id,
        document_id: claims.document_id,
        access_level: claims.access_level,
        actor: claims.actor,
        session_kind: SessionKind::Document,
        expires_at: None,
    })
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
    Ok(AuthToken {
        user_id: claims.user_id,
        document_id: identity.storage_key(),
        access_level,
        actor: claims.actor,
        session_kind: SessionKind::Surface,
        expires_at: Some(claims.exp),
    })
}

#[cfg(test)]
mod test;
