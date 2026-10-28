//! Handler for `POST /gtm-invite/redeem`.

use axum::{Json, extract::State};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};

use super::GtmInviteRouterState;
use super::dto::{GtmInviteOffer, RedeemGtmInviteLinkRequest};
use crate::domain::models::{GtmInviteError, InviteToken};
use crate::domain::ports::GtmInviteService;

/// Attributes the signed-in user's account to the invite link they opened and
/// grants them its offer. Idempotent for the same account.
#[utoipa::path(
    tag = "gtm_invite",
    post,
    path = "/gtm-invite/redeem",
    operation_id = "redeem_gtm_invite_link",
    request_body = RedeemGtmInviteLinkRequest,
    responses(
        (status = 200, body = GtmInviteOffer),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 404, body = model_error_response::ErrorResponse),
        (status = 409, body = model_error_response::ErrorResponse),
        (status = 410, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: GtmInviteService, R, Auth: MacroAuthorizationService>(
    State(state): State<GtmInviteRouterState<T, R, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(request): Json<RedeemGtmInviteLinkRequest>,
) -> Result<Json<GtmInviteOffer>, GtmInviteError> {
    let token: InviteToken = request.token.parse()?;
    let user = &authorization.authorization.user.macro_user_id;
    let link = state.service.redeem_link(&token, user).await?;
    let free_months = state.service.config().free_months;

    GtmInviteOffer::from_link(link, free_months)
        .map(Json)
        .ok_or_else(|| GtmInviteError::Internal(anyhow::anyhow!("redeemed link has no redemption")))
}
