//! Re-arms Stripe inbox cursors: an operator's fix after a dead-lettered
//! event or a drift the audit found, one cursor or every dead one.

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

/// The most dead cursors one bulk replay re-arms.
const MAX_BULK_REPLAY: u32 = 1000;
/// How many dead cursors a bulk replay re-arms when the request says none.
const DEFAULT_BULK_REPLAY: u32 = 100;

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReplayDeadRequest {
    /// Only this consumer's dead cursors, e.g. `personal_plan`; every
    /// consumer's when absent.
    pub consumer: Option<String>,
    /// Move each past the event that dead-lettered it instead of retrying it.
    #[serde(default)]
    pub skip_dead_event: bool,
    /// At most this many (default 100, at most 1000); repeat until it
    /// answers 0.
    pub limit: Option<u32>,
}

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReplayDeadResponse {
    /// How many dead cursors are due again.
    pub rearmed: u64,
}

fn unknown_consumer() -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            message: "unknown consumer".into(),
        }),
    )
        .into_response()
}

#[tracing::instrument(
    skip(ctx, _internal_authorization),
    fields(rearmed = tracing::field::Empty),
    err(Debug)
)]
pub(crate) async fn replay_dead_handler(
    State(ctx): State<ApiContext>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Json(request): Json<ReplayDeadRequest>,
) -> Result<Json<ReplayDeadResponse>, Response> {
    let consumer = request
        .consumer
        .as_deref()
        .map(str::parse::<Consumer>)
        .transpose()
        .map_err(|_| unknown_consumer())?;
    let limit = request
        .limit
        .unwrap_or(DEFAULT_BULK_REPLAY)
        .clamp(1, MAX_BULK_REPLAY);
    let rearmed = ctx
        .stripe_inbox
        .replay_dead(consumer, request.skip_dead_event, limit)
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "stripe inbox bulk replay failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        })?;
    tracing::Span::current().record("rearmed", rearmed);
    Ok(Json(ReplayDeadResponse { rearmed }))
}

#[tracing::instrument(skip(ctx, _internal_authorization), err(Debug))]
pub(crate) async fn handler(
    State(ctx): State<ApiContext>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Json(request): Json<ReplayRequest>,
) -> Result<Response, Response> {
    let consumer: Consumer = request
        .consumer
        .parse()
        .map_err(|_| unknown_consumer())?;
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
