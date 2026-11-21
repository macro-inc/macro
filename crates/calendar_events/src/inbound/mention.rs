//! Refuse notification-producing calendar writes from a signed mention run.

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};

pub(super) async fn refuse_notifications(request: Request, next: Next) -> Response {
    if !request.method().is_safe()
        && let Some(mention) = agent_correlation::context::current_channel_mention()
    {
        tracing::warn!(
            channel_mention_id = %mention,
            "refused a channel-mention program's calendar notification"
        );
        return (
            StatusCode::FORBIDDEN,
            "Calendar changes that may notify guests cannot run from a channel or document mention. Make this change from Macro.",
        )
            .into_response();
    }
    next.run(request).await
}
