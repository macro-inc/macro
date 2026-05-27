//! Bot bearer-token middleware.

use crate::domain::ports::{BotError, BotService};
use axum::{
    extract::{Request, State},
    http::{StatusCode, header::AUTHORIZATION},
    middleware::Next,
    response::{IntoResponse, Response},
};
use entity_access::domain::models::BotPrincipal;
use model_error_response::ErrorResponse;

/// Middleware state for bot bearer authentication.
#[derive(Clone)]
pub struct BotAuthState<S> {
    service: S,
}

impl<S> BotAuthState<S> {
    /// Create a bot auth state.
    pub fn new(service: S) -> Self {
        Self { service }
    }
}

/// Authenticate `Authorization: Bearer mbot_...` and attach a bot principal.
///
/// Non-bot bearer tokens are left alone so normal user auth can handle them.
pub async fn bot_bearer_auth<S>(
    State(state): State<BotAuthState<S>>,
    mut req: Request,
    next: Next,
) -> Result<Response, Response>
where
    S: BotService,
{
    let Some(header_value) = req.headers().get(AUTHORIZATION).cloned() else {
        return Ok(next.run(req).await);
    };
    let Ok(header_value) = header_value.to_str() else {
        return Ok(next.run(req).await);
    };
    let Some(token) = header_value.strip_prefix("Bearer ") else {
        return Ok(next.run(req).await);
    };
    if !token.starts_with("mbot_") {
        return Ok(next.run(req).await);
    }

    let bot = match state.service.authenticate_token(token).await {
        Ok(bot) => bot,
        Err(BotError::Unauthorized) => {
            return Err((
                StatusCode::UNAUTHORIZED,
                axum::Json(ErrorResponse {
                    message: "unauthorized".into(),
                }),
            )
                .into_response());
        }
        Err(err) => {
            tracing::error!(error=?err, "bot token authentication failed");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(ErrorResponse {
                    message: "An internal server error occurred".into(),
                }),
            )
                .into_response());
        }
    };

    req.headers_mut().remove(AUTHORIZATION);
    req.extensions_mut()
        .insert(BotPrincipal { bot_id: bot.bot_id });

    Ok(next.run(req).await)
}
