//! Handlers for `GET`/`PUT /documents/{document_id}/skill_description`.

use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use macro_authorization::MacroAuthorizationService;
use models_permissions::share_permission::access_level::{EditAccessLevel, ViewAccessLevel};

use super::DocumentRouterState;
use crate::domain::models::{DocumentError, SetSkillDescriptionRequest, SkillDescriptionBody};
use crate::domain::ports::DocumentService;
use crate::domain::skill_description::SkillDescription;

/// Gets when to use a skill. `description` is absent for a skill created
/// before descriptions existed.
#[utoipa::path(
    tag = "document",
    get,
    path = "/documents/{document_id}/skill_description",
    operation_id = "get_skill_description",
    params(
        ("document_id" = String, Path, description = "Skill document ID")
    ),
    responses(
        (status = 200, body = SkillDescriptionBody),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, access), err)]
pub async fn get_skill_description_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    access: DocumentAccessExtractor<ViewAccessLevel, Svc, Auth>,
) -> Result<Json<SkillDescriptionBody>, DocumentError> {
    let document_id = access.entity_access_receipt.entity().entity_id.clone();
    let mut descriptions = state
        .service
        .skill_descriptions(std::slice::from_ref(&document_id))
        .await?;
    Ok(Json(SkillDescriptionBody {
        description: descriptions
            .remove(&document_id)
            .map(|description| description.as_str().to_owned()),
    }))
}

/// Sets when to use a skill: one line starting "Use when", at most 300
/// characters. Agents choose skills for a request by it.
#[utoipa::path(
    tag = "document",
    put,
    path = "/documents/{document_id}/skill_description",
    operation_id = "set_skill_description",
    params(
        ("document_id" = String, Path, description = "Skill document ID")
    ),
    request_body = SetSkillDescriptionRequest,
    responses(
        (status = 200, body = SkillDescriptionBody),
        (status = 400, description = "The document is not a skill, or the description is invalid", body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, access, request), err)]
pub async fn set_skill_description_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    access: DocumentAccessExtractor<EditAccessLevel, Svc, Auth>,
    Json(request): Json<SetSkillDescriptionRequest>,
) -> Result<Json<SkillDescriptionBody>, DocumentError> {
    let description = SkillDescription::parse(&request.description)?;
    let stored = description.as_str().to_owned();
    state
        .service
        .set_skill_description(access.entity_access_receipt, description)
        .await?;
    Ok(Json(SkillDescriptionBody {
        description: Some(stored),
    }))
}
