use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use async_graphql::{Context, EmptyMutation, EmptySubscription, Object, Schema};
use axum::{
    extract::FromRef,
    http::{Request as HttpRequest, header},
};
use macro_authorization::{
    BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotActingUserClaims, BotAuthentication, BotScope,
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use model_user::UserContext;
use rootcause::Report;

use super::*;
use crate::GraphqlRequestParts;

const VALID_USER_ID: &str = "macro|user@example.com";
const VALID_BOT_TOKEN: &str = "valid-bot";

#[derive(Clone, Default)]
struct FakeAuthorizationService {
    authorization_calls: Arc<AtomicUsize>,
}

impl FakeAuthorizationService {
    fn authorization_calls(&self) -> usize {
        self.authorization_calls.load(Ordering::SeqCst)
    }
}

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        self.authorization_calls.fetch_add(1, Ordering::SeqCst);

        if jwt != "valid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(UserContext {
            user_id: VALID_USER_ID.to_string(),
            fusion_user_id: "fusion-user-id".to_string(),
            permissions: None,
            organization_id: None,
        })
    }

    async fn authorize_bot(
        &self,
        token: &str,
        bot_scope: BotScope,
        _acting_user: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        self.authorization_calls.fetch_add(1, Ordering::SeqCst);

        if token != VALID_BOT_TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(BotAuthentication {
            bot_id: "00000000-0000-0000-0000-000000000001"
                .parse()
                .expect("valid bot ID"),
            token_id: uuid::Uuid::from_u128(2),
            bot_scope,
            team_id: (bot_scope == BotScope::Team).then_some(uuid::Uuid::from_u128(3)),
            acting_user: None,
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

#[derive(Clone)]
struct TestState {
    authorization: MacroAuthorizationState<FakeAuthorizationService>,
}

impl FromRef<TestState> for MacroAuthorizationState<FakeAuthorizationService> {
    fn from_ref(state: &TestState) -> Self {
        state.authorization.clone()
    }
}

struct TestQuery;

#[Object]
impl TestQuery {
    async fn user_id(&self, ctx: &Context<'_>) -> async_graphql::Result<String> {
        Ok(
            require_authorized_user::<FakeAuthorizationService, TestState>(ctx)
                .await?
                .to_string(),
        )
    }

    async fn repeated_user_ids(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<String>> {
        let first = require_authorized_user::<FakeAuthorizationService, TestState>(ctx).await?;
        let second = require_authorized_user::<FakeAuthorizationService, TestState>(ctx).await?;

        Ok(vec![first.to_string(), second.to_string()])
    }
}

enum RequestCredentials<'a> {
    Anonymous,
    Bearer(&'a str),
    Bot(&'a str),
}

async fn execute(
    service: &FakeAuthorizationService,
    credentials: RequestCredentials<'_>,
    query: &str,
) -> async_graphql::Response {
    let request = match credentials {
        RequestCredentials::Anonymous => HttpRequest::new(()),
        RequestCredentials::Bearer(token) => HttpRequest::builder()
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .body(())
            .unwrap(),
        RequestCredentials::Bot(token) => HttpRequest::builder()
            .header(BOT_TOKEN_HEADER, token)
            .header(BOT_SCOPE_HEADER, BotScope::User.as_str())
            .body(())
            .unwrap(),
    };
    let (parts, ()) = request.into_parts();
    let state = TestState {
        authorization: MacroAuthorizationState::new(Arc::new(service.clone())),
    };
    let schema = Schema::build(TestQuery, EmptyMutation, EmptySubscription).finish();
    let request = async_graphql::Request::new(query)
        .data(GraphqlRequestParts::new(parts))
        .data(state);

    schema.execute(request).await
}

#[tokio::test]
async fn valid_bearer_returns_macro_user_id() {
    let service = FakeAuthorizationService::default();

    let response = execute(&service, RequestCredentials::Bearer("valid"), "{ userId }").await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.to_string(),
        r#"{userId: "macro|user@example.com"}"#
    );
}

#[tokio::test]
async fn missing_credentials_require_authentication() {
    let service = FakeAuthorizationService::default();

    let response = execute(&service, RequestCredentials::Anonymous, "{ userId }").await;

    assert_eq!(response.errors.len(), 1);
    assert_eq!(response.errors[0].message, "authentication required");
    assert_eq!(service.authorization_calls(), 0);
}

#[tokio::test]
async fn invalid_credentials_preserve_safe_authorization_message() {
    let service = FakeAuthorizationService::default();

    let response = execute(
        &service,
        RequestCredentials::Bearer("invalid"),
        "{ userId }",
    )
    .await;

    assert_eq!(response.errors.len(), 1);
    assert_eq!(response.errors[0].message, "unauthorized");
    assert_eq!(service.authorization_calls(), 1);
}

#[tokio::test]
async fn valid_bot_credentials_return_safe_forbidden_message() {
    let service = FakeAuthorizationService::default();

    let response = execute(
        &service,
        RequestCredentials::Bot(VALID_BOT_TOKEN),
        "{ userId }",
    )
    .await;

    assert_eq!(response.errors.len(), 1);
    assert_eq!(response.errors[0].message, "forbidden");
    assert_eq!(service.authorization_calls(), 1);
}

#[tokio::test]
async fn repeated_helper_calls_share_cached_authorization() {
    let service = FakeAuthorizationService::default();

    let response = execute(
        &service,
        RequestCredentials::Bearer("valid"),
        "{ repeatedUserIds }",
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.to_string(),
        r#"{repeatedUserIds: ["macro|user@example.com", "macro|user@example.com"]}"#
    );
    assert_eq!(service.authorization_calls(), 1);
}
