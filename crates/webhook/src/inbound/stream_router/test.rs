use super::{WebhookStreamRouterState, webhook_stream_router};
use crate::domain::models::{NormalizedWebhookEvent, WebhookFilters, WebhookScope};
use crate::domain::stream::{StreamCursor, WebhookEventStreamService, WebhookStreamError};
use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use futures::stream::BoxStream;
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rootcause::Report;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

const SUBSCRIBER_ID: &str = "macro|reader@example.com";

/// Records the cursor each open asked to resume after.
#[derive(Clone, Default)]
struct RecordingStreams {
    opened: Arc<Mutex<Vec<Option<StreamCursor>>>>,
}

impl WebhookEventStreamService for RecordingStreams {
    async fn open_stream(
        &self,
        _subscriber: MacroUserIdStr<'static>,
        _scope: WebhookScope,
        _filters: WebhookFilters,
        after: Option<StreamCursor>,
    ) -> Result<BoxStream<'static, NormalizedWebhookEvent>, WebhookStreamError> {
        self.opened.lock().unwrap().push(after);
        Ok(Box::pin(futures::stream::empty()))
    }
}

#[derive(Clone, Default)]
struct SignedIn;

impl MacroAuthorizationService for SignedIn {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != "valid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: SUBSCRIBER_ID.to_string(),
            ..UserContext::default()
        })
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<macro_authorization::ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt)
            .await
            .map(macro_authorization::ValidatedCredential::session)
    }

    async fn authorize_bot(
        &self,
        _bot_token: &str,
        _bot_scope: macro_authorization::BotScope,
        _acting_user: Option<macro_authorization::BotActingUserClaims>,
    ) -> Result<macro_authorization::BotAuthentication, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

/// Open the stream with `last_event_id` and report the status and the cursor
/// the service was asked to resume after.
async fn open_with(last_event_id: &str) -> (StatusCode, Option<StreamCursor>) {
    open(last_event_id, "&resume=true").await
}

async fn open(last_event_id: &str, extra_query: &str) -> (StatusCode, Option<StreamCursor>) {
    let streams = RecordingStreams::default();
    let router = webhook_stream_router::<_, _, ()>(WebhookStreamRouterState::new(
        streams.clone(),
        MacroAuthorizationState::new(Arc::new(SignedIn)),
    ));
    // `[{"events":["document.updated"]}]`, percent-encoded.
    let filters = "%5B%7B%22events%22%3A%5B%22document.updated%22%5D%7D%5D";
    let request = Request::builder()
        .uri(format!(
            "/events/stream?scope=user&filters={filters}{extra_query}"
        ))
        .header(header::AUTHORIZATION, "Bearer valid")
        .header("last-event-id", last_event_id)
        .body(Body::empty())
        .unwrap();
    let status = router.oneshot(request).await.unwrap().status();
    let opened = streams.opened.lock().unwrap().first().copied().flatten();
    (status, opened)
}

/// A `Last-Event-ID` the service cannot read is no cursor at all: the
/// stream opens live, as it did before resuming existed. A 400 would stop
/// a browser `EventSource` from ever reconnecting.
#[tokio::test]
async fn an_unreadable_last_event_id_opens_the_stream_without_a_cursor() {
    for unreadable in [
        "garbage",
        "not-a-uuid-at-all",
        &uuid::Uuid::new_v4().to_string(),
    ] {
        let (status, opened) = open_with(unreadable).await;
        assert_eq!(status, StatusCode::OK, "{unreadable}");
        assert_eq!(opened, None, "{unreadable}");
    }
}

/// Replay is opt-in: a client that does not ask to resume (a browser
/// `EventSource` reconnecting, an SDK listener) gets the live stream it
/// always got, whatever `Last-Event-ID` it sends.
#[tokio::test]
async fn only_a_client_that_asks_to_resume_gets_a_cursor() {
    let id = uuid::Uuid::now_v7().to_string();
    let cursor = StreamCursor::parse(&id).unwrap();

    assert_eq!(open(&id, "").await, (StatusCode::OK, None));
    assert_eq!(open(&id, "&resume=false").await, (StatusCode::OK, None));
    assert_eq!(
        open(&id, "&resume=true").await,
        (StatusCode::OK, Some(cursor))
    );
}

/// A `resume` this service cannot read is no request to resume: the
/// stream opens live rather than refusing the client.
#[tokio::test]
async fn an_unreadable_resume_opens_the_stream_live() {
    let id = uuid::Uuid::now_v7().to_string();

    assert_eq!(open(&id, "&resume=1").await, (StatusCode::OK, None));
    assert_eq!(open(&id, "&resume=yes").await, (StatusCode::OK, None));
}
