use axum::{Extension, extract::State, http::StatusCode, response::IntoResponse};
use macro_middleware::cloud_storage::ensure_access::project::ProjectBodyAccessLevelExtractor;
use models_permissions::share_permission::access_level::EditAccessLevel;

use crate::api::{
    context::ApiContext,
    documents::{
        create_document::create_document_v2,
        utils::{self},
    },
};
use model::document::response::{
    CreateDocumentRequest, CreateDocumentResponse, CreateDocumentResponseData,
};
use model::{
    document::FileType,
    response::{GenericErrorResponse, GenericResponse, TypedSuccessResponse},
    user::UserContext,
};

/// Handles creating a document
#[utoipa::path(
        tag = "document",
        post,
        path = "/documents",
        request_body = CreateDocumentRequest,
        responses(
            (status = 200, body=inline(CreateDocumentResponse)),
            (status = 401, body=GenericErrorResponse),
            (status = 403, body=GenericErrorResponse),
            (status = 400, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(state, user_context, project), fields(user_id=?user_context.user_id))]
#[axum::debug_handler(state = ApiContext)]
pub(in crate::api) async fn create_document_handler(
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, CreateDocumentRequest>,
) -> impl IntoResponse {
    let req = project.into_inner();

    let user_provided_file_type: Option<FileType> =
        req.file_type.as_deref().and_then(|f| f.try_into().ok());

    let (document_name, file_type) = match user_provided_file_type {
        Some(file_type) => {
            // Strips any accidentally added extension from document name
            let document_name = FileType::clean_document_name(req.document_name);
            (document_name, Some(file_type))
        }
        None => match FileType::split_suffix_match(req.document_name.as_str()) {
            Some((file_name, extension)) => {
                let file_type: Option<FileType> = extension.try_into().ok();
                (file_name.to_string(), file_type)
            }
            None => (req.document_name, None),
        },
    };

    // Log if the user provided mime type does not match the file type
    if let (Some(file_type), Some(user_mime_type)) = (file_type, req.mime_type)
        && user_mime_type != file_type.mime_type()
    {
        tracing::warn!(
            file_type=?file_type,
            mime_type=?user_mime_type,
            "provided mime type does not match file type"
        );
    }

    let create_document_response_data = create_document_v2::create_document(
        &state,
        req.id.as_deref(),
        &req.sha,
        &document_name,
        &user_context.user_id,
        user_context.organization_id,
        file_type,
        req.job_id.as_deref(),
        req.project_id.as_deref(),
    )
    .await;

    let response_data = match create_document_response_data {
        Ok(response_data) => response_data,
        Err((status_code, message, document_id)) => {
            tracing::error!(error=?message, "unable to create document");
            if let Some(document_id) = document_id {
                tracing::info!(document_id=?document_id, "cleaning up document");
                utils::handle_document_creation_error_cleanup(&state.db, document_id).await;
            }
            return GenericResponse::builder()
                .message(message.as_str())
                .is_error(true)
                .send(status_code);
        }
    };

    return GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK);
}
