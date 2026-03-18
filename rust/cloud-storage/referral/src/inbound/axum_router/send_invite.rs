//! Handler for `GET /code`.

use axum::http::StatusCode;
use axum::{Json, extract::State};
use macro_user_id::email::EmailStr;
use model_user::axum_extractor::MacroUserExtractor;
use serde::Deserialize;

use super::ReferralRouterState;
use crate::domain::models::{ReferralCode, ReferralError};
use crate::domain::ports::ReferralService;

#[derive(Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct SendInviteBody {
    #[cfg_attr(feature = "axum", schema(value_type = String))]
    recipient: EmailStr<'static>,
}

/// Handler for `GET /referral-code`.
///
/// Returns the authenticated user's referral code.
#[utoipa::path(
    tag = "referral",
    post,
    path = "/referral/send",
    operation_id = "get_referral_code",
    responses(
        (status = 200, body = ReferralCode),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user_context), err)]
pub async fn post_referral_invite_handler<T: ReferralService>(
    State(state): State<ReferralRouterState<T>>,
    user_context: MacroUserExtractor,
    Json(SendInviteBody { recipient }): Json<SendInviteBody>,
) -> Result<StatusCode, ReferralError> {
    let () = state
        .service
        .send_referral_invite(user_context.macro_user_id, recipient)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}
