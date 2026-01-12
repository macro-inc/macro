use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_db_client::{
    document::get_document, user_document_view_location::get::get_user_document_view_location,
};
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::{
    document::{
        DocumentBasic,
        response::{GetDocumentResponse, GetDocumentResponseData},
    },
    response::GenericErrorResponse,
    user::UserContext,
};
use models_permissions::share_permission::access_level::ViewAccessLevel;
use serde::Deserialize;
use sqlx::PgPool;

use crate::api::middleware::internal_access::InternalUser;

#[derive(Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Gets a particular document by its id
#[utoipa::path(
        tag = "document",
        get,
        path = "/documents/{document_id}",
        operation_id = "get_document",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=GetDocumentResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(db, user_context, access), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(db): State<PgPool>,
    access: axum_extra::either::Either<
        DocumentAccessExtractor<ViewAccessLevel>,
        Option<Extension<InternalUser>>,
    >,
    user_context: Extension<UserContext>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Json<GetDocumentResponse>, StatusCode> {
    let access_level = match access {
        axum_extra::either::Either::E1(DocumentAccessExtractor { access_level, .. }) => {
            access_level
        }
        axum_extra::either::Either::E2(Some(Extension(InternalUser { access_level }))) => {
            access_level
        }
        axum_extra::either::Either::E2(None) => return Err(StatusCode::UNAUTHORIZED),
    };

    let document_metadata = match get_document(&db, &document_id).await {
        Ok(document_metadata) => document_metadata,
        Err(e) => {
            tracing::error!(document_id=?document_id, error=?e, "unable to get document metadata");
            let mut status_code = StatusCode::INTERNAL_SERVER_ERROR;
            if e.to_string()
                .contains("no rows returned by a query that expected to return at least one row")
            {
                status_code = StatusCode::NOT_FOUND;
            }
            return Err(status_code);
        }
    };

    let view_location =
        match get_user_document_view_location(&db, &user_context.user_id, &document_id).await {
            Ok(view_location) => view_location,
            Err(e) => {
                tracing::error!(error=?e, "error getting view location");
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        };

    Ok(Json(GetDocumentResponse {
        error: false,
        data: GetDocumentResponseData {
            document_metadata,
            user_access_level: access_level,
            view_location: view_location.map(|v| v.location),
        },
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
