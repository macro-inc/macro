//! `POST /soup/graphql/stream`: the streamed cache sync. Lane planning, the
//! lane loop and the wire format live in `crates/soup_sync_stream`; this
//! adapter authenticates, answers a body of a protocol it does not speak with
//! 426,
//! limits each user to one open stream and each task to
//! [`MAX_STREAMS_PER_TASK`] open streams that take turns on [`PAGE_SLOTS`]
//! pages at once, and runs every page through the Soup schema with the same
//! request context as `POST /soup/graphql`.

use super::{ContextScope, graphql_query_context_data, opaque_viewer_id, telemetry};
use crate::api::context::{ApiContext, AuthorizationService};
use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{HeaderValue, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
};
use axum_extra::extract::Cached;
use complete_graph::{GraphqlRequestParts, MAIL_CACHE_PROFILE_HEADER, MailCacheProfile};
use futures::StreamExt as _;
use macro_authorization::{
    OptionalMacroAuthorizationExtractor, UserOrInternalService, UserOrInternalServiceAuthorization,
};
use macro_user_id::user_id::MacroUserIdStr;
use soup_sync_stream::{
    ActiveStreamGuard, ActiveStreams, PageExecutor, PageTurn, PageTurns, RequestError, StreamTurns,
    SyncPlan,
};
use std::{
    convert::Infallible,
    sync::{Arc, LazyLock},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

const NDJSON_CONTENT_TYPE: &str = "application/x-ndjson";

/// Pages of sync streams one server task runs at once: what the streams
/// together ask of the database, however many are open. Open streams take
/// turns on these slots, the user whose pages took the least time first.
const PAGE_SLOTS: usize = 8;
/// Most sync streams one server task keeps open. A stream that waits for its
/// turn holds its plan, its lane's list and at most one unsent page, so this
/// bounds memory, not database load; streams past it are told to retry.
const MAX_STREAMS_PER_TASK: usize = 128;
/// What a client told to come back later waits, in seconds.
const RETRY_AFTER_SECONDS: &str = "30";

/// Users with an open sync stream on this server task.
static ACTIVE_STREAMS: LazyLock<ActiveStreams<MacroUserIdStr<'static>>> =
    LazyLock::new(ActiveStreams::default);
/// Open-stream slots on this server task.
static STREAM_SLOTS: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(MAX_STREAMS_PER_TASK)));
/// Page slots on this server task.
static PAGE_TURNS: LazyLock<PageTurns<MacroUserIdStr<'static>>> =
    LazyLock::new(|| PageTurns::new(PAGE_SLOTS));

pub(super) async fn sync_stream_handler(
    State(state): State<ApiContext>,
    Cached(auth): Cached<
        OptionalMacroAuthorizationExtractor<AuthorizationService, UserOrInternalService>,
    >,
    request_parts: Parts,
    body: Bytes,
) -> Response {
    let Some(acting_user) = auth
        .authorization
        .as_ref()
        .and_then(UserOrInternalServiceAuthorization::acting_user)
    else {
        return (
            StatusCode::UNAUTHORIZED,
            "authentication required for the Soup sync stream",
        )
            .into_response();
    };
    // The message echoes only the caller's own request; it is not logged.
    let plan = match SyncPlan::from_json(&body, chrono::Utc::now()) {
        Ok(plan) => plan,
        // The client's cache engine speaks another protocol: it cannot sync
        // through this server and pages instead.
        Err(error @ RequestError::UnsupportedProtocol(_)) => {
            return (StatusCode::UPGRADE_REQUIRED, error.to_string()).into_response();
        }
        Err(error @ RequestError::Catalog { .. }) => {
            tracing::error!(error = %error, "soup sync stream lane catalog is invalid");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "the server could not plan the Soup sync stream",
            )
                .into_response();
        }
        Err(error) => return (StatusCode::BAD_REQUEST, error.to_string()).into_response(),
    };
    let Some(active) = ACTIVE_STREAMS.try_acquire(acting_user.macro_user_id.clone()) else {
        return (
            StatusCode::CONFLICT,
            "a Soup sync stream is already open for this user",
        )
            .into_response();
    };
    let Ok(slot) = Arc::clone(&STREAM_SLOTS).try_acquire_owned() else {
        tracing::warn!(
            sync.max_streams = MAX_STREAMS_PER_TASK,
            "soup sync stream refused: every stream slot is taken"
        );
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::RETRY_AFTER, RETRY_AFTER_SECONDS)],
            "the server holds its most open Soup sync streams; retry later",
        )
            .into_response();
    };
    let mail_profile = MailCacheProfile::from_advertised(
        request_parts
            .headers
            .get(MAIL_CACHE_PROFILE_HEADER)
            .and_then(|value| value.to_str().ok()),
    );
    let executor = SchemaPageExecutor {
        state,
        request_parts,
        mail_profile,
        macro_user_id: acting_user.macro_user_id.clone(),
        organization_id: acting_user.user_context.organization_id.map(i64::from),
        viewer_id: opaque_viewer_id(acting_user),
        lane_lists: graphql_soup::SoupLaneLists::default(),
        turns: PAGE_TURNS.stream(acting_user.macro_user_id.clone()),
        _active: active,
        _slot: slot,
    };
    let lines = soup_sync_stream::ndjson_stream(plan, executor).map(Ok::<_, Infallible>);
    (
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static(NDJSON_CONTENT_TYPE),
        )],
        Body::from_stream(lines),
    )
        .into_response()
}

/// Runs one page as `POST /soup/graphql` runs a request, when the stream's
/// turn comes. Owned by the response body, so the user's stream slot is
/// released when the body ends or the client disconnects.
struct SchemaPageExecutor {
    state: ApiContext,
    request_parts: Parts,
    mail_profile: MailCacheProfile,
    macro_user_id: MacroUserIdStr<'static>,
    organization_id: Option<i64>,
    viewer_id: Option<Uuid>,
    /// The ordered lists Soup lanes page through, one lane at a time.
    lane_lists: graphql_soup::SoupLaneLists,
    /// This stream's turns on [`PAGE_TURNS`].
    turns: StreamTurns<MacroUserIdStr<'static>>,
    _active: ActiveStreamGuard<MacroUserIdStr<'static>>,
    /// This stream's slot of [`STREAM_SLOTS`], released with the body.
    _slot: OwnedSemaphorePermit,
}

impl PageExecutor for SchemaPageExecutor {
    type Error = serde_json::Error;
    type Turn = PageTurn<MacroUserIdStr<'static>>;

    fn turn(&self) -> impl Future<Output = Self::Turn> + Send {
        self.turns.next()
    }

    async fn execute(
        &self,
        request: async_graphql::Request,
    ) -> Result<serde_json::Value, Self::Error> {
        let response = telemetry::observe(request, true, |request| {
            let request = graphql_query_context_data(
                request,
                &self.state,
                Some(self.macro_user_id.clone()),
                self.organization_id,
                self.viewer_id,
                ContextScope::SyncStreamPage,
            );
            self.state.graphql_soup_schema.execute(
                request
                    .data(self.mail_profile)
                    .data(self.lane_lists.clone())
                    .data(GraphqlRequestParts::new(self.request_parts.clone())),
            )
        })
        .await;
        serde_json::to_value(&response)
    }
}
