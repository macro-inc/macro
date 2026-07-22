use std::sync::Arc;

use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use macro_authorization::{
    OptionalMacroAuthorizationExtractor, UserOrInternalService, UserOrInternalServiceAuthorization,
};
use macro_sync_service_jwt::ISSUER;
use model::{document::DocumentPermissionsToken, response::ErrorResponse};
use utoipa::ToSchema;

use crate::api::context::AuthorizationService;
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
#[tracing::instrument(
    skip(config_context, user),
    fields(actor = tracing::field::Empty)
)]
pub async fn handler(
    State(config_context): State<Arc<Config>>,
    user: OptionalMacroAuthorizationExtractor<AuthorizationService, UserOrInternalService>,
    extract::Json(DocumentPermissionsTokenRequest { token }): extract::Json<
        DocumentPermissionsTokenRequest,
    >,
) -> Result<Response, Response> {
    // Verify and decode the JWT
    let mut validation = Validation::new(Algorithm::HS256);

    validation.set_issuer(&[ISSUER]);

    if let Some(actor) = user.acting_entity() {
        tracing::Span::current().record("actor", tracing::field::display(actor));
    }
    let user_id = user
        .authorization
        .as_ref()
        .and_then(UserOrInternalServiceAuthorization::acting_user)
        .map(|user| user.macro_user_id.to_string());

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
                        message: "jwt is expired".into(),
                    }),
                )
                    .into_response());
            }
            _ => {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        message: "unable to decode jwt".into(),
                    }),
                )
                    .into_response());
            }
        },
    };

    if decoded_jwt.user_id.as_ref().map(|id| id.to_string()) != user_id {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                message: "jwt user id does not match user id".into(),
            }),
        )
            .into_response());
    }

    Ok((StatusCode::OK, Json(decoded_jwt)).into_response())
}
