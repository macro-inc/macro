//! Re-arms a Stripe inbox cursor: an operator's fix after a dead-lettered
//! event or a drift the audit found.

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use model::response::ErrorResponse;
use stripe_inbox::domain::model::{Consumer, OrderingKey};
use stripe_inbox::domain::ports::Replayed;

use crate::api::context::{ApiContext, AuthorizationService};

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReplayRequest {
    /// The consumer, e.g. `team_subscription`.
    pub consumer: String,
    /// The Stripe customer (`cus_…`), or the object id of an event without one.
    pub ordering_key: String,
    /// Move past the event that dead-lettered the cursor instead of retrying it.
    #[serde(default)]
    pub skip_dead_event: bool,
}

#[tracing::instrument(skip(ctx, _internal_authorization), err(Debug))]
pub(crate) async fn handler(
    State(ctx): State<ApiContext>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Json(request): Json<ReplayRequest>,
) -> Result<Response, Response> {
    let consumer: Consumer = request.consumer.parse().map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "unknown consumer".into(),
            }),
        )
            .into_response()
    })?;
    let replayed = ctx
        .stripe_inbox
        .replay(
            consumer,
            &OrderingKey(request.ordering_key),
            request.skip_dead_event,
        )
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "stripe inbox replay failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        })?;
    match replayed {
        Replayed::Rearmed => Ok(StatusCode::OK.into_response()),
        Replayed::NotFound => Err(StatusCode::NOT_FOUND.into_response()),
        Replayed::Leased => Err(StatusCode::CONFLICT.into_response()),
    }
}
