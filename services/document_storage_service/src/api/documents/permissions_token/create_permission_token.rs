use crate::api::context::{AuthorizationService, EntityAccessService};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use documents_hex::domain::permission_token::encode_permission_token;
use entity_access::domain::models::EntityPermission;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use macro_authorization::OptionalMacroAuthorizationExtractor;
use model::response::ErrorResponse;
use models_permissions::share_permission::access_level::{AccessLevel, ViewAccessLevel};
use serde::Deserialize;
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
#[tracing::instrument(skip(state, user, users_access_level), fields(user_id=?user.macro_user_id))]
pub async fn handler(
    State(state): State<ApiContext>,
    user: OptionalMacroAuthorizationExtractor<AuthorizationService>,
    users_access_level: DocumentAccessExtractor<
        ViewAccessLevel,
        EntityAccessService,
        AuthorizationService,
    >,
    Path(Params { document_id }): Path<Params>,
) -> Result<Response, Response> {
    let user_id = user.macro_user_id.map(|user_id| user_id.to_string());

    let access_level = match users_access_level.entity_access_receipt.entity_permission() {
        EntityPermission::AccessLevel { access_level } => *access_level,
        _ => AccessLevel::View,
    };

    let token = encode_permission_token(
        user_id,
        document_id,
        access_level,
        state.config.document_permission_jwt.as_ref(),
    )
    .map_err(|e| {
        tracing::error!(error=?e, "unable to encode jwt");

        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to encode jwt".into(),
            }),
        )
            .into_response()
    })?
    .into_inner();

    Ok((
        StatusCode::OK,
        Json(DocumentPermissionsTokenResponse { token }),
    )
        .into_response())
}
