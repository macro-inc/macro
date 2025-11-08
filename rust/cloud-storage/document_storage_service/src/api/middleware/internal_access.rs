use crate::api::{
    MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY, MACRO_INTERNAL_USER_ID_HEADER_KEY,
    context::DocumentStorageServiceAuthKey,
};
use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use model::user::UserContext;
use models_permissions::share_permission::access_level::AccessLevel;
use reqwest::header::ToStrError;
use thiserror::Error;
use tracing::Level;

#[cfg(test)]
mod tests;

/// marker struct which denotes that this is an internal user via the [MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY]
#[derive(Debug, Clone)]
pub(crate) struct InternalUser {
    pub access_level: AccessLevel,
}

#[derive(Debug, Error)]
pub(crate) enum InternalAccessErr {
    #[error(
        "The {} header value was not provided",
        MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY
    )]
    MissingHeader,
    #[error("Failed to parse header value to ascii {0:?}")]
    NonAsciiBytes(#[from] ToStrError),
    #[error("Received invalid header value {0}")]
    InvalidHeaderValue(String),
}

impl IntoResponse for InternalAccessErr {
    fn into_response(self) -> Response {
        let status = match &self {
            InternalAccessErr::MissingHeader | InternalAccessErr::NonAsciiBytes(_) => {
                StatusCode::BAD_REQUEST
            }
            InternalAccessErr::InvalidHeaderValue(_) => StatusCode::UNAUTHORIZED,
        };
        (status, self.to_string()).into_response()
    }
}

/// Validates that the x-document-storage-service-auth-key header is
/// provided and valid
#[axum::debug_middleware]
#[tracing::instrument(skip_all, err(level = Level::WARN))]
pub(in crate::api) async fn handler(
    State(auth_key): State<DocumentStorageServiceAuthKey>,
    mut req: Request,
    next: Next,
) -> Result<Response, InternalAccessErr> {
    let auth_token_header = req
        .headers()
        .get(MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY)
        .map(|header| header.to_str())
        .transpose()?;

    let Some(auth_token) = auth_token_header else {
        tracing::error!(
            "missing {} header on request to {}",
            MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY,
            req.uri()
        );
        tracing::info!("{:?}", req.headers());

        return Err(InternalAccessErr::MissingHeader);
    };
    if auth_token != auth_key.as_ref() {
        return Err(InternalAccessErr::InvalidHeaderValue(
            auth_token.to_string(),
        ));
    }

    let user_id: String = req
        .headers()
        .get(MACRO_INTERNAL_USER_ID_HEADER_KEY)
        .and_then(|header| header.to_str().ok())
        .map(|header| header.to_string())
        .unwrap_or("INTERNAL".to_string());

    // Attach user_id to the UserContext
    req.extensions_mut().insert(UserContext {
        user_id: user_id.clone(),
        fusion_user_id: "".to_string(), // not needed in this use case
        permissions: None,
        organization_id: None,
    });

    req.extensions_mut().insert(InternalUser {
        access_level: AccessLevel::Owner,
    });

    Ok(next.run(req).await)
}
