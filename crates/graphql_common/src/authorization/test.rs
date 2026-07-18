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
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use model_user::UserContext;
use rootcause::Report;

use super::*;
use crate::GraphqlSoupRequestParts;

const VALID_USER_ID: &str = "macro|user@example.com";

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

async fn execute(
    service: &FakeAuthorizationService,
    bearer_token: Option<&str>,
    query: &str,
) -> async_graphql::Response {
    let request = match bearer_token {
        Some(token) => HttpRequest::builder()
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .body(())
            .unwrap(),
        None => HttpRequest::new(()),
    };
    let (parts, ()) = request.into_parts();
    let state = TestState {
        authorization: MacroAuthorizationState::new(Arc::new(service.clone())),
    };
    let schema = Schema::build(TestQuery, EmptyMutation, EmptySubscription).finish();
    let request = async_graphql::Request::new(query)
        .data(GraphqlSoupRequestParts::new(parts))
        .data(state);

    schema.execute(request).await
}

#[tokio::test]
async fn valid_bearer_returns_macro_user_id() {
    let service = FakeAuthorizationService::default();

    let response = execute(&service, Some("valid"), "{ userId }").await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.to_string(),
        r#"{userId: "macro|user@example.com"}"#
    );
}

#[tokio::test]
async fn missing_credentials_require_authentication() {
    let service = FakeAuthorizationService::default();

    let response = execute(&service, None, "{ userId }").await;

    assert_eq!(response.errors.len(), 1);
    assert_eq!(response.errors[0].message, "authentication required");
    assert_eq!(service.authorization_calls(), 0);
}

#[tokio::test]
async fn invalid_credentials_preserve_safe_authorization_message() {
    let service = FakeAuthorizationService::default();

    let response = execute(&service, Some("invalid"), "{ userId }").await;

    assert_eq!(response.errors.len(), 1);
    assert_eq!(response.errors[0].message, "unauthorized");
    assert_eq!(service.authorization_calls(), 1);
}

#[tokio::test]
async fn repeated_helper_calls_share_cached_authorization() {
    let service = FakeAuthorizationService::default();

    let response = execute(&service, Some("valid"), "{ repeatedUserIds }").await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.to_string(),
        r#"{repeatedUserIds: ["macro|user@example.com", "macro|user@example.com"]}"#
    );
    assert_eq!(service.authorization_calls(), 1);
}
