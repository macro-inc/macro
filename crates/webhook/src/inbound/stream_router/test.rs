use super::{WebhookStreamRouterState, webhook_stream_router};
use crate::domain::{
    models::{NormalizedWebhookEvent, WebhookFilter, WebhookFilters, WebhookScope},
    stream::{WebhookEventStreamService, WebhookStreamError},
};
use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use futures::{StreamExt as _, stream::BoxStream};
use macro_authorization::{
    BOT_FOR_MACRO_USER_ID_HEADER, BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotActingUserClaims,
    BotAuthentication, BotScope, CredentialOrigin, InternalIdentityClaims, MacroAuthorizationError,
    MacroAuthorizationService, MacroAuthorizationState, MacroUserAuthentication,
    ValidatedCredential,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rootcause::Report;
use std::sync::{Arc, Mutex};
use tower::ServiceExt as _;

const USER_ID: &str = "macro|webhook-stream-test@example.com";

#[derive(Clone, Default)]
struct FakeStreamService {
    calls: Arc<Mutex<Vec<(MacroUserIdStr<'static>, WebhookScope, WebhookFilters)>>>,
}

impl WebhookEventStreamService for FakeStreamService {
    async fn open_stream(
        &self,
        subscriber: MacroUserIdStr<'static>,
        scope: WebhookScope,
        filters: WebhookFilters,
    ) -> Result<BoxStream<'static, NormalizedWebhookEvent>, WebhookStreamError> {
        self.calls
            .lock()
            .unwrap()
            .push((subscriber, scope, filters));
        Ok(futures::stream::empty().boxed())
    }
}

#[derive(Clone, Default)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != "valid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(UserContext {
            user_id: USER_ID.to_string(),
            ..UserContext::default()
        })
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt).await.map(ValidatedCredential::session)
    }

    async fn authorize_bot(
        &self,
        bot_token: &str,
        bot_scope: BotScope,
        acting_user: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        if bot_token != "mbot_stream_test" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        let acting_user = acting_user
            .and_then(|claims| claims.user_id)
            .map(|user_id| MacroUserAuthentication {
                origin: CredentialOrigin::Bot,
                agent_id: None,
                agent_via: None,
                macro_user_id: MacroUserIdStr::try_from(user_id).unwrap(),
                user_context: UserContext::default(),
            });

        Ok(BotAuthentication {
            bot_id: bot_id::BotId::TEST_A,
            token_id: uuid::Uuid::nil(),
            bot_scope,
            team_id: None,
            acting_user,
        })
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

#[tokio::test]
async fn bot_email_filter_returns_forbidden_without_opening_stream() {
    let service = FakeStreamService::default();
    let response = send(service.clone(), true, "email.message_received").await;

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        body["message"],
        "email events require the inbox owner's own credential"
    );
    assert!(service.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn bot_non_email_filter_opens_stream() {
    let service = FakeStreamService::default();
    let response = send(service.clone(), true, "document.created").await;

    assert_eq!(response.status(), StatusCode::OK);
    let calls = service.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0.as_ref(), USER_ID);
    assert_eq!(calls[0].1, WebhookScope::User);
    assert_eq!(calls[0].2[0].events, vec!["document.created"]);
}

#[tokio::test]
async fn session_user_email_filter_opens_stream_with_filters() {
    let service = FakeStreamService::default();
    let response = send(service.clone(), false, "email.message_received").await;

    assert_eq!(response.status(), StatusCode::OK);
    let calls = service.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0.as_ref(), USER_ID);
    assert_eq!(calls[0].1, WebhookScope::User);
    assert_eq!(
        calls[0].2,
        vec![WebhookFilter {
            events: vec!["email.message_received".to_string()],
            ids: None,
        }]
    );
}

async fn send(service: FakeStreamService, bot: bool, event: &str) -> axum::response::Response {
    let filters = vec![WebhookFilter {
        events: vec![event.to_string()],
        ids: None,
    }];
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    serializer.append_pair("scope", "user");
    serializer.append_pair("filters", &serde_json::to_string(&filters).unwrap());
    let query = serializer.finish();
    let authorization_state = MacroAuthorizationState::new(Arc::new(FakeAuthorizationService));
    let router = webhook_stream_router::<_, _, ()>(WebhookStreamRouterState::new(
        service,
        authorization_state,
    ));
    let request = Request::builder()
        .uri(format!("/events/stream?{query}"))
        .method("GET");
    let request = if bot {
        request
            .header(BOT_TOKEN_HEADER, "mbot_stream_test")
            .header(BOT_SCOPE_HEADER, BotScope::User.as_str())
            .header(BOT_FOR_MACRO_USER_ID_HEADER, USER_ID)
    } else {
        request.header(header::AUTHORIZATION, "Bearer valid")
    };

    router
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
}
