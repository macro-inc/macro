//! Handler for `POST /gtm-invite/links`.

use axum::{Json, extract::State};
use chrono::Utc;
use macro_authorization::MacroAuthorizationService;

use super::GtmInviteRouterState;
use super::dto::{CreateGtmInviteLinkRequest, GtmInviteLink};
use super::gtm_macro_staff::GtmMacroStaffExtractor;
use crate::domain::models::GtmInviteError;
use crate::domain::ports::GtmInviteService;

/// Creates an invite link. Macro staff only.
#[utoipa::path(
    tag = "gtm_invite",
    post,
    path = "/gtm-invite/links",
    operation_id = "create_gtm_invite_link",
    request_body = CreateGtmInviteLinkRequest,
    responses(
        (status = 200, body = GtmInviteLink),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 403, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: GtmInviteService, R, Auth: MacroAuthorizationService>(
    State(state): State<GtmInviteRouterState<T, R, Auth>>,
    staff: GtmMacroStaffExtractor<Auth>,
    Json(request): Json<CreateGtmInviteLinkRequest>,
) -> Result<Json<GtmInviteLink>, GtmInviteError> {
    let creator = &staff.macro_user_id;
    let link = state.service.create_link(creator, request.into()).await?;
    let free_months = state.service.config().free_months;

    Ok(Json(GtmInviteLink::from_link(
        link,
        free_months,
        Utc::now(),
    )))
}
