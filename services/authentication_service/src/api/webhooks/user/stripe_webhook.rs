//! Stripe's webhook. It verifies the signature, stores the event in the
//! Stripe inbox and answers 200; the inbox's consumers apply it in the
//! background (`crates/stripe_inbox`). It calls no Stripe API and does no
//! domain work, so Stripe never waits on, or redelivers because of, one.

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
};
use model::response::ErrorResponse;
use stripe_inbox::domain::service::ReceiveError;

use crate::api::context::ApiContext;

fn bad_request(message: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            message: message.into(),
        }),
    )
        .into_response()
}

/// Verifies and stores one Stripe event.
#[tracing::instrument(skip_all)]
pub(crate) async fn handler(
    State(ctx): State<ApiContext>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    let signature = headers
        .get("stripe-signature")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            tracing::warn!("missing stripe-signature header");
            bad_request("Missing Stripe-Signature header")
        })?;
    let payload = std::str::from_utf8(&body).map_err(|error| {
        tracing::warn!(error = ?error, "invalid UTF-8 in webhook body");
        bad_request("Invalid webhook payload encoding")
    })?;
    stripe_webhook::Webhook::construct_event(
        payload,
        signature,
        ctx.stripe_webhook_secret.as_ref(),
    )
    .map_err(|error| {
        tracing::warn!(error = ?error, "stripe event signature did not verify");
        bad_request("failed to construct stripe event")
    })?;

    match ctx.stripe_inbox.receive(payload).await {
        Ok(_) => Ok(StatusCode::OK.into_response()),
        Err(ReceiveError::Invalid(_) | ReceiveError::WrongMode) => {
            Err(bad_request("invalid stripe event"))
        }
        // Stripe redelivers on a 5xx; the error stays in our span.
        Err(ReceiveError::Storage(_)) => Err(StatusCode::INTERNAL_SERVER_ERROR.into_response()),
    }
}
