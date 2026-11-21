//! Host booking writes may email participants without passing calendar HTTP routes.

use axum::{
    extract::{MatchedPath, Request},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};

pub(super) async fn refuse_host_management(request: Request, next: Next) -> Response {
    // The host's manage read exposes the booker's cancel/reschedule token:
    // handing that capability out would bypass the host-write refusal.
    let exposes_token = request
        .extensions()
        .get::<MatchedPath>()
        .is_some_and(|path| path.as_str().ends_with("/bookings/{id}/manage"));
    if (!request.method().is_safe() || exposes_token)
        && let Some(mention) = agent_correlation::context::current_channel_mention()
    {
        tracing::warn!(channel_mention_id = %mention, "refused a channel-mention program's booking management");
        return (
            StatusCode::FORBIDDEN,
            "Booking management cannot run from a channel or document mention because it can email participants. Make this change from Macro.",
        ).into_response();
    }
    next.run(request).await
}

#[cfg(test)]
mod test;
