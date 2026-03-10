//! Handler for `POST /documents`.

use std::str::FromStr;

use axum::{Extension, Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::{InternalUser, ProjectBodyAccessLevelExtractor};
use model::document::response::{CreateDocumentRequest, CreateDocumentResponse};
use model::document::{FileType, FileTypeExt};
use model_user::axum_extractor::MacroUserExtractor;
use models_permissions::share_permission::access_level::EditAccessLevel;

use super::DocumentRouterState;
use crate::domain::models::{CreateDocumentRepoArgs, DocumentError};
use crate::domain::ports::DocumentService;

/// Handler for `POST /documents`.
///
/// Creates a new document, generates an S3 presigned upload URL, and returns
/// the document metadata with the URL for the client to upload to.
#[utoipa::path(
    tag = "document",
    post,
    path = "/documents",
    operation_id = "create_document",
    request_body = CreateDocumentRequest,
    responses(
        (status = 200, body = inline(CreateDocumentResponse)),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 409, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user_context, project), fields(user_id=?user_context.macro_user_id))]
pub async fn create_document_handler<T: DocumentService, Svc: EntityAccessService>(
    State(state): State<DocumentRouterState<T, Svc>>,
    internal_user: Option<Extension<InternalUser>>,
    user_context: MacroUserExtractor,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, CreateDocumentRequest, Svc>,
) -> Result<Json<CreateDocumentResponse>, DocumentError> {
    let req = project.into_inner();

    // Email linking is internal only
    if req.email_attachment_id.is_some() && internal_user.is_none() {
        return Err(DocumentError::Unauthorized);
    }

    // Parse file type from the request
    let user_provided_file_type: Option<FileType> = req
        .file_type
        .as_deref()
        .and_then(|f| FileType::from_str(f).ok());

    let (document_name, file_type) = match user_provided_file_type {
        Some(file_type) => {
            let document_name = FileType::clean_document_name(&req.document_name);
            (document_name.unwrap_or(req.document_name), Some(file_type))
        }
        None => match FileType::split_suffix_match(req.document_name.as_str()) {
            Some((file_name, extension)) => {
                let file_type: Option<FileType> = FileType::from_str(extension).ok();
                (file_name.to_string(), file_type)
            }
            None => (req.document_name, None),
        },
    };

    // Log if the user-provided mime type does not match the file type
    if let (Some(ft), Some(user_mime_type)) = (file_type, &req.mime_type)
        && *user_mime_type != ft.mime_type()
    {
        tracing::warn!(
            file_type=?ft,
            mime_type=?user_mime_type,
            "provided mime type does not match file type"
        );
    }

    let args = CreateDocumentRepoArgs {
        id: req.id,
        sha: req.sha,
        document_name,
        user_id: user_context.macro_user_id.clone(),
        file_type,
        project_id: req.project_id,
        email_attachment_id: req.email_attachment_id,
        created_at: req.created_at,
        is_task: req.is_task,
        skip_history: req.skip_history,
    };

    let response_data = state
        .service
        .create_document(user_context.macro_user_id, args, req.job_id)
        .await?;

    Ok(Json(CreateDocumentResponse {
        error: false,
        data: response_data,
    }))
}
