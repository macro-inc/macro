use crate::api::context::{AuthorizationService, EntityAccessService};
use crate::model::response::user_views::UserViewsResponse;
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::{document::DocumentBasic, response::GenericErrorResponse};

use models_permissions::share_permission::access_level::ViewAccessLevel;
use serde::Deserialize;
use sqlx::PgPool;

#[derive(Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Gets the list of users who have viewed a given document
#[utoipa::path(
        tag = "document",
        get,
        path = "/documents/{document_id}/views",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=UserViewsResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(db, user, document_id, _access), fields(user_id=?user.authorization.user.macro_user_id, document_id=?document_context.document_id, original_document_id=?document_id))]
pub async fn get_document_views_handler(
    _access: DocumentAccessExtractor<ViewAccessLevel, EntityAccessService, AuthorizationService>,
    Path(Params { document_id }): Path<Params>,
    State(db): State<PgPool>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    document_context: Extension<DocumentBasic>,
) -> Result<Response, Response> {
    let users = macro_db_client::document::get_document_views(&db, &document_context.document_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get document views");
            (StatusCode::INTERNAL_SERVER_ERROR).into_response()
        })?;

    let count =
        macro_db_client::document::get_document_view_count(&db, &document_context.document_id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to get document view count");
                (StatusCode::INTERNAL_SERVER_ERROR).into_response()
            })?;

    Ok((StatusCode::OK, Json(UserViewsResponse { users, count })).into_response())
}
