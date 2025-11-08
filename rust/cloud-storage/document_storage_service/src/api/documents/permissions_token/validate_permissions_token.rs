use std::sync::Arc;

use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use model::{document::DocumentPermissionsToken, response::ErrorResponse, user::UserContext};
use utoipa::ToSchema;

use crate::config::Config;

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct DocumentPermissionsTokenRequest {
    /// The encoded document permissions token
    pub token: String,
}

/// Validates the provided document permissions token
#[utoipa::path(
        tag = "document",
        post,
        path = "/documents/permissions_token/validate",
        operation_id = "validate_document_permissions_token",
        responses(
            (status = 200, body=DocumentPermissionsToken),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(config_context, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(config_context): State<Arc<Config>>,
    user_context: Extension<UserContext>,
    extract::Json(DocumentPermissionsTokenRequest { token }): extract::Json<
        DocumentPermissionsTokenRequest,
    >,
) -> Result<Response, Response> {
    // Verify and decode the JWT
    let mut validation = Validation::new(Algorithm::HS256);

    validation.set_issuer(&["document_storage_service"]);

    let user_id = if user_context.user_id.is_empty() {
        None
    } else {
        Some(user_context.user_id.clone())
    };

    // Attempt to decode the token.
    let decoded_jwt: DocumentPermissionsToken = match jsonwebtoken::decode::<DocumentPermissionsToken>(
        &token,
        &DecodingKey::from_secret(config_context.document_permission_jwt.as_ref().as_bytes()),
        &validation,
    ) {
        Ok(decoded) => decoded.claims,
        Err(e) => match e.kind() {
            jsonwebtoken::errors::ErrorKind::ExpiredSignature => {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        message: "jwt is expired",
                    }),
                )
                    .into_response());
            }
            _ => {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        message: "unable to decode jwt",
                    }),
                )
                    .into_response());
            }
        },
    };

    if decoded_jwt.user_id != user_id {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                message: "jwt user id does not match user id",
            }),
        )
            .into_response());
    }

    Ok((StatusCode::OK, Json(decoded_jwt)).into_response())
}
