//! Handler for `GET /code`.

use axum::{Json, extract::State};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService};

use super::ReferralRouterState;
use crate::domain::models::{ReferralCode, ReferralError};
use crate::domain::ports::ReferralService;

/// Handler for `GET /referral-code`.
///
/// Returns the authenticated user's referral code.
#[utoipa::path(
    tag = "referral",
    get,
    path = "/referral/code",
    operation_id = "get_referral_code",
    responses(
        (status = 200, body = String),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, authorization), err)]
pub async fn get_referral_code_handler<T: ReferralService, R, Auth: MacroAuthorizationService>(
    State(state): State<ReferralRouterState<T, R, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth>,
) -> Result<Json<ReferralCode>, ReferralError> {
    let code = state
        .service
        .get_referral_code_for_user(&authorization.macro_user_id)
        .await?;

    Ok(Json(code))
}
