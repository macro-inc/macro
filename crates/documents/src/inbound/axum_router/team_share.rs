//! Handlers for `GET`/`PUT /documents/{document_id}/team_share`.

use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use models_permissions::share_permission::access_level::{EditAccessLevel, ViewAccessLevel};

use super::DocumentRouterState;
use crate::domain::models::{
    DocumentError, DocumentTeamShareResponse, SetDocumentTeamShareRequest,
};
use crate::domain::ports::DocumentService;

/// Gets the team-share state of a document. The team is resolved from the
/// document owner's team membership; `teamId` is omitted when the owner does
/// not belong to a team.
#[utoipa::path(
    tag = "document",
    get,
    path = "/documents/{document_id}/team_share",
    operation_id = "get_document_team_share",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
    responses(
        (status = 200, body = DocumentTeamShareResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, access), err)]
pub async fn get_team_share_handler<T: DocumentService, Svc: EntityAccessService>(
    State(state): State<DocumentRouterState<T, Svc>>,
    access: DocumentAccessExtractor<ViewAccessLevel, Svc>,
) -> Result<Json<DocumentTeamShareResponse>, DocumentError> {
    let response = state
        .service
        .get_team_share(access.entity_access_receipt)
        .await?;

    Ok(Json(response))
}

/// Sets the team-share state of a document. Sharing grants the document
/// owner's team Edit access; unsharing removes the team's access. Requires
/// Edit access on the document.
#[utoipa::path(
    tag = "document",
    put,
    path = "/documents/{document_id}/team_share",
    operation_id = "set_document_team_share",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
    request_body = SetDocumentTeamShareRequest,
    responses(
        (status = 200, body = DocumentTeamShareResponse),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, access, request), err)]
pub async fn set_team_share_handler<T: DocumentService, Svc: EntityAccessService>(
    State(state): State<DocumentRouterState<T, Svc>>,
    access: DocumentAccessExtractor<EditAccessLevel, Svc>,
    Json(request): Json<SetDocumentTeamShareRequest>,
) -> Result<Json<DocumentTeamShareResponse>, DocumentError> {
    let response = state
        .service
        .set_team_share(access.entity_access_receipt, request.share_with_team)
        .await?;

    Ok(Json(response))
}
