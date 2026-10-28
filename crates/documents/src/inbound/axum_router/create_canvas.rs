//! Handler for `POST /documents/create_canvas`.

use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::ProjectBodyAccessLevelExtractorV2;
use entity_registry::CreationPrincipalExtractor;
use macro_authorization::MacroAuthorizationService;
use models_permissions::share_permission::access_level::{AccessLevel, EditAccessLevel};

use super::DocumentRouterState;
use crate::domain::create::NewDocumentMetadata;
use crate::domain::models::{
    CreateCanvasDocumentRequest, CreateCanvasDocumentResponse, DocumentError,
};
use crate::domain::permission_token::encode_principal_permission_token;
use crate::domain::ports::DocumentService;
use crate::domain::ports::create::DocumentCreationService;

/// Creates and initializes a Canvas in one backend-owned lifecycle.
#[utoipa::path(
    tag = "document",
    post,
    path = "/documents/create_canvas",
    request_body = CreateCanvasDocumentRequest,
    responses(
        (status = 200, body = inline(CreateCanvasDocumentResponse)),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 409, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, project))]
pub async fn create_canvas_handler<
    T: DocumentService + DocumentCreationService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    project: ProjectBodyAccessLevelExtractorV2<
        EditAccessLevel,
        CreateCanvasDocumentRequest,
        Svc,
        Auth,
    >,
) -> Result<Json<CreateCanvasDocumentResponse>, DocumentError> {
    let req = project.into_inner();

    let mut metadata = NewDocumentMetadata::builder(req.document_name);
    if let Some(project_id) = req.project_id {
        metadata = metadata.project_id(project_id);
    }

    let created = state
        .creator
        .create_canvas(&principal, metadata.build())
        .await?;

    let document_id = created.document_id().to_string();
    let document_metadata = created
        .response()
        .document_response
        .document_metadata
        .metadata
        .clone();

    let token = encode_principal_permission_token(
        &principal,
        document_id.clone(),
        AccessLevel::Edit,
        &state.document_permission_jwt_secret,
    )
    .map_err(|e| {
        tracing::error!(error=?e, "failed to encode permission token");
        DocumentError::Internal(e.into())
    })?
    .into_inner();

    Ok(Json(CreateCanvasDocumentResponse {
        document_id,
        document_metadata,
        token,
    }))
}
