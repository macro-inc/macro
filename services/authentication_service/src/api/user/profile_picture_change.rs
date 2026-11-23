//! Shared by the routes that set a profile picture: throttling, and telling
//! other people's clients the picture changed.

use axum::{Json, http::StatusCode};
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use model::response::ErrorResponse;
use rate_limit::domain::{
    models::{RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitResult},
    ports::RateLimitService,
};
use user_events::{UserMacroEvent, UserPictureChangedMetadata};

use crate::api::{context::ApiContext, middleware::rate_limit::RATE_LIMIT_ENABLED};

#[cfg(test)]
mod test;

type ApiError = (StatusCode, Json<ErrorResponse<'static>>);

/// Picture changes one user may make per second. A client changing the picture
/// faster than this is a loop, and each change fans out to all their contacts.
const PROFILE_PICTURE_SETS_PER_SECOND: u64 = 1;

fn error(status: StatusCode, message: &str) -> ApiError {
    (
        status,
        Json(ErrorResponse {
            message: message.to_string().into(),
        }),
    )
}

/// Maps a rate limit check to the response for a set request.
fn throttle_result(result: RateLimitResult) -> Result<(), ApiError> {
    result.map(drop).map_err(|_: RateLimitExceeded| {
        error(
            StatusCode::TOO_MANY_REQUESTS,
            "profile picture changed too recently, try again shortly",
        )
    })
}

/// Rejects a set request when the user already changed their picture this
/// second.
pub(super) async fn throttle_set(ctx: &ApiContext, user_id: &str) -> Result<(), ApiError> {
    if !RATE_LIMIT_ENABLED {
        return Ok(());
    }
    let key = RateLimitKey::builder(&"profile-picture-set")
        .append(&user_id)
        .finish();
    let config = RateLimitConfig::new(
        PROFILE_PICTURE_SETS_PER_SECOND,
        std::time::Duration::from_secs(1),
    );
    let result = ctx
        .rate_limit_service
        .check_rate_limit(key, config)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to check profile picture set rate limit");
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to update profile picture",
            )
        })?;
    tracing::Span::current().record("rate_limited", result.is_err());
    throttle_result(result)
}

/// Event metadata for a new picture. An empty url means it was removed.
pub(super) fn picture_changed_metadata(
    user_id: MacroUserIdStr<'static>,
    file_id: Option<String>,
    url: &str,
) -> UserPictureChangedMetadata {
    if url.is_empty() {
        return UserPictureChangedMetadata {
            user_id,
            file_id: None,
            url: None,
        };
    }
    UserPictureChangedMetadata {
        user_id,
        file_id,
        url: Some(url.to_string()),
    }
}

/// Publishes `user.picture_changed`. The picture is already saved, so a
/// failure is logged and never fails the request.
pub(super) fn publish_picture_changed(ctx: &ApiContext, metadata: UserPictureChangedMetadata) {
    let user_id = metadata.user_id.to_string();
    let file_id = metadata.file_id.clone();
    let removed = metadata.url.is_none();
    let event = UserMacroEvent::picture_changed(metadata);
    if let Err(error) = ctx.event_broker.send_event(&event) {
        tracing::warn!(
            error = ?error,
            user_id = %user_id,
            file_id = ?file_id,
            removed,
            "failed to publish user picture changed event"
        );
    }
}
