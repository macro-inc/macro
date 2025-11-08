use axum::extract::State;
use axum::{Extension, extract::Path, http::StatusCode, response::IntoResponse};
use macro_db_client::document::get_document_version;
use macro_db_client::user_document_view_location::get::get_user_document_view_location;
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::document::response::{GetDocumentResponse, GetDocumentResponseData};
use model::response::{GenericErrorResponse, GenericResponse};
use model::user::UserContext;
use models_permissions::share_permission::access_level::ViewAccessLevel;
use serde::Deserialize;
use sqlx::PgPool;

#[derive(Deserialize)]
pub struct Params {
    pub document_id: String,
    pub document_version_id: i64,
}

/// Gets a particular document by its id
#[utoipa::path(
        tag = "document",
        get,
        path = "/documents/{document_id}/{document_version_id}",
        operation_id = "get_document_version",
        params(
            ("document_id" = String, Path, description = "Document ID"),
            ("document_version_id" = i64, Path, description = "Document Version ID")
        ),
        responses(
            (status = 200, body=GetDocumentResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(db, user_context, access_level), fields(user_id=?user_context.user_id))]
pub async fn handler(
    DocumentAccessExtractor { access_level, .. }: DocumentAccessExtractor<ViewAccessLevel>,
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    Path(Params {
        document_id,
        document_version_id,
    }): Path<Params>,
) -> impl IntoResponse {
    let document_metadata = match get_document_version(&db, &document_id, document_version_id).await
    {
        Ok(document_metadata) => document_metadata,
        Err(e) => {
            tracing::error!(error=?e, document_id=?document_id, document_version_id=?document_version_id, "unable to get document metadata");
            let mut status_code = StatusCode::INTERNAL_SERVER_ERROR;
            if e.to_string()
                .contains("no rows returned by a query that expected to return at least one row")
            {
                status_code = StatusCode::NOT_FOUND;
            }
            return GenericResponse::builder()
                .message("unable to get document")
                .is_error(true)
                .send(status_code);
        }
    };

    let view_location =
        match get_user_document_view_location(&db, &user_context.user_id, &document_id).await {
            Ok(view_location) => view_location,
            Err(e) => {
                tracing::error!(error=?e, "error getting view location");
                return GenericResponse::builder()
                    .message("error getting view location")
                    .is_error(true)
                    .send(StatusCode::INTERNAL_SERVER_ERROR);
            }
        };

    let response_data = GetDocumentResponseData {
        document_metadata,
        user_access_level: access_level,
        view_location: view_location.map(|v| v.location),
    };
    GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK)
}
