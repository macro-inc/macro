//! The viewer's current CRM authority, available even when CRM is denied.

use super::CrmRouterState;
use crate::domain::{model::CrmError, service::CrmService};
use axum::{Json, extract::State};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

/// Current authority for the authenticated viewer; contribution consent is separate.
#[derive(Serialize, ToSchema)]
pub struct CrmMemberAccessResponse {
    /// The viewer's current team, if any.
    pub team_id: Option<Uuid>,
    /// Whether the viewer may access that team's CRM.
    pub allowed: bool,
}

/// Read fresh authority without requiring CRM access.
#[utoipa::path(get, path = "/crm/member-access", operation_id = "get_crm_member_access",
    responses((status = 200, body = CrmMemberAccessResponse)))]
#[tracing::instrument(skip_all, err)]
pub async fn handler<C: CrmService, St, Eas, Auth: MacroAuthorizationService>(
    auth: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
) -> Result<Json<CrmMemberAccessResponse>, CrmError> {
    let access = state
        .service
        .current_member_access(auth.authorization.user.macro_user_id.as_ref())
        .await?;
    Ok(Json(CrmMemberAccessResponse {
        team_id: access.map(|(team, _)| team),
        allowed: access.is_some_and(|(_, allowed)| allowed),
    }))
}
