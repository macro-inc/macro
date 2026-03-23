//! Handler for `POST /send`.

use axum::http::StatusCode;
use axum::{Json, extract::State};
use macro_user_id::email::EmailStr;
use model_user::axum_extractor::MacroUserExtractor;
use serde::Deserialize;

use super::ReferralRouterState;
use crate::domain::models::ReferralError;
use crate::domain::ports::ReferralService;

/// The body which is used to describe the recipient email
#[derive(Deserialize, utoipa::ToSchema)]
pub struct SendInviteBody {
    /// the recipient of the referral email
    #[schema(value_type = String)]
    recipient: EmailStr<'static>,
}

/// Handler for `POST /referral/send`.
///
/// Sends a referral code via email to a user
#[utoipa::path(
    tag = "referral",
    post,
    path = "/referral/send",
    operation_id = "send_referral_code",
    responses(
        (status = StatusCode::NO_CONTENT),
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
