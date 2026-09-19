//! Handler for `GET /gtm-invite/offer`.

use axum::{Json, extract::State};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};

use super::GtmInviteRouterState;
use super::dto::{GtmInviteOffer, GtmInviteOfferStatus};
use crate::domain::models::GtmInviteError;
use crate::domain::ports::GtmInviteService;

/// The promotion the signed-in user's account holds from an invite link, if
/// they redeemed one and have not started a paid subscription yet.
#[utoipa::path(
    tag = "gtm_invite",
    get,
    path = "/gtm-invite/offer",
    operation_id = "get_gtm_invite_offer",
    responses(
        (status = 200, body = GtmInviteOfferStatus),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: GtmInviteService, R, Auth: MacroAuthorizationService>(
    State(state): State<GtmInviteRouterState<T, R, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<GtmInviteOfferStatus>, GtmInviteError> {
    let user = &authorization.authorization.user.macro_user_id;
    let link = state.service.active_offer_for_user(user).await?;
    let free_months = state.service.config().free_months;

    Ok(Json(GtmInviteOfferStatus {
        offer: link.and_then(|link| GtmInviteOffer::from_link(link, free_months)),
    }))
}
