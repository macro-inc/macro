//! Handler for `DELETE /gtm-invite/links/{id}`.

use axum::{
    Json,
    extract::{Path, State},
};
use chrono::Utc;
use macro_authorization::MacroAuthorizationService;
use uuid::Uuid;

use super::GtmInviteRouterState;
use super::dto::GtmInviteLink;
use super::gtm_macro_staff::GtmMacroStaffExtractor;
use crate::domain::models::GtmInviteError;
use crate::domain::ports::GtmInviteService;

/// Revokes an invite link nobody has signed up through. Macro staff only.
#[utoipa::path(
    tag = "gtm_invite",
    delete,
    path = "/gtm-invite/links/{id}",
    operation_id = "revoke_gtm_invite_link",
    params(("id" = Uuid, Path, description = "The invite link id")),
    responses(
        (status = 200, body = GtmInviteLink),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 403, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, fields(link_id = %id), err)]
pub async fn handler<T: GtmInviteService, R, Auth: MacroAuthorizationService>(
    State(state): State<GtmInviteRouterState<T, R, Auth>>,
    staff: GtmMacroStaffExtractor<Auth>,
    Path(id): Path<Uuid>,
) -> Result<Json<GtmInviteLink>, GtmInviteError> {
    let caller = &staff.macro_user_id;
    let link = state.service.revoke_link(caller, id).await?;
    let free_months = state.service.config().free_months;

    Ok(Json(GtmInviteLink::from_link(
        link,
        free_months,
        Utc::now(),
    )))
}
