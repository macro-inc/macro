use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use documents_hex::domain::ports::DocumentService;
use model::document::DocumentBasic;
use model::document::response::GetDocumentResponse;
use model::response::GenericErrorResponse;
use model::user::UserContext;
use serde::Deserialize;

use crate::api::context::ApiContext;
use crate::api::middleware::internal_access::InternalUser;

#[derive(Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Gets a particular document by its id (internal route).
#[tracing::instrument(skip(state, user_context, access), fields(user_id=?user_context.user_id))]
pub async fn internal_handler(
    State(state): State<ApiContext>,
    access: axum_extra::either::Either<
        macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor<
            models_permissions::share_permission::access_level::ViewAccessLevel,
        >,
        Option<Extension<InternalUser>>,
    >,
    user_context: Extension<UserContext>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Json<GetDocumentResponse>, StatusCode> {
    let access_level = match access {
        axum_extra::either::Either::E1(extractor) => extractor.access_level,
        axum_extra::either::Either::E2(Some(Extension(InternalUser { access_level }))) => {
            access_level
        }
        axum_extra::either::Either::E2(None) => return Err(StatusCode::UNAUTHORIZED),
    };

    let response_data = state
        .documents_state
        .service
        .get_document(&user_context.user_id, &document_id, access_level)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get document");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(GetDocumentResponse {
        error: false,
        data: response_data,
    }))
}

/// Gets the basic document info for a document id.
#[utoipa::path(
        tag = "document",
        get,
        path = "/documents/{document_id}/basic",
        operation_id = "get_document_basic",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=DocumentBasic),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(document_basic))]
pub async fn get_document_basic_handler(
    Extension(document_basic): Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    (StatusCode::OK, Json(document_basic)).into_response()
}
