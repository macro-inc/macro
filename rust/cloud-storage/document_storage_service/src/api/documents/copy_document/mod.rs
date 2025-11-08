mod copy_document_cleanup;
mod copy_document_v2;

use crate::{
    api::context::ApiContext,
    model::request::documents::copy::{CopyDocumentQueryParams, CopyDocumentRequest},
};
use axum::{
    Extension,
    extract::{Json, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::{
    document::{DocumentBasic, DocumentMetadata, FileType, response::GetDocumentResponse},
    response::{ErrorResponse, GenericErrorResponse, GenericResponse},
    user::UserContext,
};

use models_permissions::share_permission::access_level::ViewAccessLevel;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Handles copying a given document. This is the similar to
/// create_document_handler where you provide the branched_from_id,
/// branched_from_version_id and document_family_id in the request body. Except
/// this will not require you to re-upload the document when it's made saving
/// time and resources.
#[utoipa::path(
        tag = "document",
        post,
        path = "/documents/{document_id}/copy",
        params(
            ("document_id" = String, Path, description = "Document ID"),
            ("version_id" = Option<i64>, Query, description = "The version id of the document to copy. Defaults to copying the latest version of the document.")
        ),
        responses(
            (status = 200, body=GetDocumentResponse),
            (status = 400, body=GenericErrorResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 403, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(state, user_context, document_context, req, _access), fields(user_id=?user_context.user_id, document_version_id=?params.version_id))]
pub(in crate::api) async fn copy_document_handler(
    _access: DocumentAccessExtractor<ViewAccessLevel>,
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
    Query(params): Query<CopyDocumentQueryParams>,
    Json(mut req): Json<CopyDocumentRequest>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    if document_context.deleted_at.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "cannot copy deleted document",
            }),
        )
            .into_response());
    }

    // Overrides the document name cleaned document name (removing file extension)
    // if it was accidentally included
    req.document_name = FileType::clean_document_name(req.document_name);

    let mut document_metadata: DocumentMetadata = if let Some(version_id) = params.version_id {
        match macro_db_client::document::get_document_version(
            &state.db,
            document_id.as_str(),
            version_id,
        )
        .await
        {
            Ok(document_metadata) => document_metadata,
            Err(e) => {
                tracing::error!(error=?e, "unable to get document metadata");
                return Err(GenericResponse::builder()
                    .message("unable to get document metadata")
                    .is_error(true)
                    .send(StatusCode::INTERNAL_SERVER_ERROR));
            }
        }
    } else {
        match macro_db_client::document::get_document(&state.db, document_id.as_str()).await {
            Ok(document_metadata) => document_metadata,
            Err(e) => {
                tracing::error!(error=?e, "unable to get document metadata");
                return Err(GenericResponse::builder()
                    .message("unable to get document metadata")
                    .is_error(true)
                    .send(StatusCode::INTERNAL_SERVER_ERROR));
            }
        }
    };

    if let Some(project_id) = &document_metadata.project_id {
        // Depending on if you are the project owner, we should copy the project id
        let project = macro_db_client::projects::get_project::get_basic_project::get_basic_project(
            &state.db, project_id,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get project");
            GenericResponse::builder()
                .message("unable to get project")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR)
        })?;

        if !project.user_id.eq(&user_context.user_id) {
            // Do not copy the project id of the document
            document_metadata.project_id = None;
            document_metadata.project_name = None;
        }
    }

    let file_type: Option<FileType> = document_context
        .file_type
        .as_deref()
        .and_then(|f| f.try_into().ok());

    // If the docx doesn't have a document bom associated with it, we cannot copy it
    if file_type == Some(FileType::Docx) && document_metadata.document_bom.is_none() {
        tracing::error!("document bom is missing");
        return Err(GenericResponse::builder()
            .message("document bom is missing")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR));
    }

    match copy_document_v2::copy_document(
        &state,
        user_context.user_id.as_str(),
        &document_metadata,
        &req.document_name,
        file_type.as_ref(),
        req.version_id,
    )
    .await
    {
        Ok(response) => Ok(response),
        Err((document, e, msg)) => {
            tracing::error!(error=?e, msg, "unable to copy document");
            // TODO: cleanup if document exists
            if let Some(document_id) = document {
                tracing::trace!("document exists, cleaning up");
                copy_document_cleanup::copy_document_cleanup(
                    &state.db,
                    &state.s3_client,
                    user_context.user_id.clone(),
                    document_id,
                )
                .await;
            }

            Err(GenericResponse::builder()
                .message(msg)
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR))
        }
    }
}
