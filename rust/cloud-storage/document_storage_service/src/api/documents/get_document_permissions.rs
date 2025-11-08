use crate::model::response::documents::get::GetDocumentPermissionsResponseDataV2;
use axum::{
    Extension,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::response::GenericErrorResponse;
use model::user::UserContext;
use model::version::ApiVersionEnum;
use models_permissions::share_permission::access_level::OwnerAccessLevel;
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Gets the current documents share permissions
#[utoipa::path(
        tag = "document",
        get,
        operation_id="get_document_permissions_v2",
        path = "/v2/documents/{document_id}/permissions",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=GetDocumentPermissionsResponseDataV2),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[allow(unused, reason = "used to generate OpenAPI documentation")]
pub(in crate::api) async fn get_document_permissions_handler_v2(
    _user_context: Extension<UserContext>,
    _api_version: Extension<ApiVersionEnum>,
    Path(Params { document_id: _ }): Path<Params>,
) -> impl IntoResponse {
    StatusCode::OK
}

/// Gets the current documents share permissions
#[tracing::instrument(skip(db, _access))]
pub async fn get_document_permissions_handler(
    _access: DocumentAccessExtractor<OwnerAccessLevel>,
    State(db): State<PgPool>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Response, Response> {
    get_document_permissions_v2(&db, &document_id).await
}

#[tracing::instrument(skip(db))]
async fn get_document_permissions_v2(db: &PgPool, document_id: &str) -> Result<Response, Response> {
    let document_permissions = macro_db_client::share_permission::get::get_document_share_permission(
        db,
        document_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, document_id=?document_id, "unable to get document permissions");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GenericErrorResponse {
                error: true,
                message: "unable to get document permissions".to_string(),
            }),
        )
            .into_response()
    })?;

    Ok((
        StatusCode::OK,
        Json(GetDocumentPermissionsResponseDataV2 {
            document_permissions,
        }),
    )
        .into_response())
}
