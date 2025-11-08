use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::{document::DocumentPermissionsToken, response::ErrorResponse, user::UserContext};
use models_permissions::share_permission::access_level::ViewAccessLevel;
use serde::Deserialize;
use std::time::{SystemTime, UNIX_EPOCH};
use utoipa::ToSchema;

use crate::api::context::ApiContext;

#[derive(Deserialize)]
pub struct Params {
    pub document_id: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct DocumentPermissionsTokenResponse {
    /// The encoded document permissions token
    pub token: String,
}

/// Generates a document permissions token for a provided document id
#[utoipa::path(
        tag = "document",
        post,
        path = "/documents/permissions_token/{document_id}",
        operation_id = "get_document_permissions_token",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=DocumentPermissionsTokenResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(state, user_context, users_access_level), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    users_access_level: DocumentAccessExtractor<ViewAccessLevel>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Response, Response> {
    // Get the current time
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize;

    let user_id = if user_context.user_id.is_empty() {
        None
    } else {
        Some(user_context.user_id.clone())
    };

    let document_permissions_token = DocumentPermissionsToken {
        user_id,
        document_id,
        access_level: users_access_level.access_level,
        exp: now + 3600, // Token expires in 1 hour
        iss: "document_storage_service".to_string(),
    };

    let header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256);
    let token = jsonwebtoken::encode(
        &header,
        &document_permissions_token,
        &jsonwebtoken::EncodingKey::from_secret(
            state.config.document_permission_jwt.as_ref().as_bytes(),
        ),
    )
    .map_err(|e| {
        tracing::error!(error=?e, "unable to encode jwt");

        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to encode jwt",
            }),
        )
            .into_response()
    })?;

    Ok((
        StatusCode::OK,
        Json(DocumentPermissionsTokenResponse { token }),
    )
        .into_response())
}
