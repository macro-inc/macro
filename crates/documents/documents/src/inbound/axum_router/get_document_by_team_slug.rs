//! Handler for `GET /documents/slug/{slug}`.

use std::marker::PhantomData;

use axum::{
    Json, RequestPartsExt,
    extract::{FromRequestParts, Path, State},
    http::request::Parts,
    response::{IntoResponse, Response},
};
use entity_access::{
    domain::{
        models::{
            EntityAccessReceipt, EntityType, MemberTeamRole, RequiredPermission, ViewAccessLevel,
        },
        ports::EntityAccessService,
    },
    inbound::axum_extractors::{ExtractorError, MacroUserTeamExtractorV2},
};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use serde::Deserialize;

use super::DocumentRouterState;
use crate::domain::models::DocumentError;
use crate::domain::ports::DocumentService;
use crate::domain::response::GetDocumentResponse;

#[derive(Deserialize)]
struct TeamSlugParams {
    slug: String,
}

/// Resolves a team-task slug and verifies access to its document.
///
/// Authentication and team membership are required before the slug is resolved.
/// `Level` specifies the minimum document access required by the caller.
pub struct DocumentTeamSlugAccessExtractor<Level: RequiredPermission, T, Svc, Auth> {
    /// The access receipt for the document resolved from the team-task slug.
    pub entity_access_receipt: EntityAccessReceipt<Level>,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<Level, T, Svc, Auth> FromRequestParts<DocumentRouterState<T, Svc, Auth>>
    for DocumentTeamSlugAccessExtractor<Level, T, Svc, Auth>
where
    Level: RequiredPermission,
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    type Rejection = Response;

    #[tracing::instrument(err(Debug), skip(state, parts))]
    async fn from_request_parts(
        parts: &mut Parts,
        state: &DocumentRouterState<T, Svc, Auth>,
    ) -> Result<Self, Self::Rejection> {
        let user = parts
            .extract_with_state::<MacroAuthorizationExtractor<Auth, UserOrInternal>, _>(state)
            .await
            .map_err(IntoResponse::into_response)?;
        let team = parts
            .extract_with_state::<MacroUserTeamExtractorV2<MemberTeamRole, Svc, Auth>, _>(state)
            .await
            .map_err(IntoResponse::into_response)?;
        let Path(TeamSlugParams { slug }) = parts
            .extract::<Path<TeamSlugParams>>()
            .await
            .map_err(IntoResponse::into_response)?;

        let document_id = state
            .service
            .get_document_by_team_slug(team.entity_access_receipt, &slug)
            .await
            .map_err(IntoResponse::into_response)?;
        let entity_access_receipt = state
            .access_service
            .generate_entity_access_receipt::<Level>(
                &user.authorization.user.macro_user_id,
                user.authorization
                    .user
                    .user_context
                    .organization_id
                    .map(i64::from),
                &document_id,
                EntityType::Document,
            )
            .await
            .map_err(ExtractorError::from)
            .map_err(IntoResponse::into_response)?;

        Ok(Self {
            entity_access_receipt,
            _marker: PhantomData,
        })
    }
}

/// Handler for `GET /documents/slug/{slug}`.
///
/// Returns document metadata, user access level, and view location.
#[utoipa::path(
    tag = "document",
    get,
    path = "/documents/slug/{slug}",
    operation_id = "get_document_by_team_slug",
    params(
        ("slug" = String, Path, description = "Team-task reference, such as ENG-42")
    ),
    responses(
        (status = 200, body = GetDocumentResponse),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, access), err)]
pub async fn get_document_by_team_slug_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    access: DocumentTeamSlugAccessExtractor<ViewAccessLevel, T, Svc, Auth>,
) -> Result<Json<GetDocumentResponse>, DocumentError> {
    let response_data = state
        .service
        .get_document(access.entity_access_receipt)
        .await?;

    Ok(Json(GetDocumentResponse {
        error: false,
        data: response_data,
    }))
}
