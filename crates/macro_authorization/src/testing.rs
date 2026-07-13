//! Shared test doubles and credential helpers for authorization-aware routers.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[cfg(feature = "axum")]
use ::axum::http::{Request, header, request};
use model_user::UserContext;
use rootcause::Report;

use crate::{MacroAuthorizationError, MacroAuthorizationService};

const TEST_USER_ID: &str = "macro|test@example.com";
const TEST_FUSION_USER_ID: &str = "test-fusion-user-id";

type AuthorizationResult = Result<UserContext, MacroAuthorizationError>;

#[derive(Default)]
struct FakeState {
    calls: Mutex<Vec<String>>,
    token_results: Mutex<HashMap<String, AuthorizationResult>>,
}

/// A programmable authorization service for tests.
///
/// The fake records every raw token passed to [`MacroAuthorizationService::authorize`].
/// Individual token outcomes can override the fallback configured by [`Self::always`]
/// or [`Self::never`]. The default fake accepts every token as a fixed test user.
#[derive(Clone)]
pub struct FakeMacroAuthorizationService {
    state: Arc<FakeState>,
    fallback: AuthorizationResult,
}

impl Default for FakeMacroAuthorizationService {
    fn default() -> Self {
        Self::always(test_user_context(TEST_USER_ID))
    }
}

impl FakeMacroAuthorizationService {
    /// Create a fake that authorizes every token as `user_context` unless that
    /// token has a configured override.
    pub fn always(user_context: UserContext) -> Self {
        Self {
            state: Arc::new(FakeState::default()),
            fallback: Ok(user_context),
        }
    }

    /// Create a fake that rejects every token with `error` unless that token
    /// has a configured override.
    pub fn never(error: MacroAuthorizationError) -> Self {
        Self {
            state: Arc::new(FakeState::default()),
            fallback: Err(error),
        }
    }

    /// Configure a token to authorize as `user_context`.
    ///
    /// This builder-style method can be chained to map multiple actors before
    /// the fake is placed in application state.
    pub fn with_token(self, token: impl Into<String>, user_context: UserContext) -> Self {
        self.set_token_result(token, Ok(user_context));
        self
    }

    /// Configure a token to fail with `error`.
    pub fn with_token_error(
        self,
        token: impl Into<String>,
        error: MacroAuthorizationError,
    ) -> Self {
        self.set_token_result(token, Err(error));
        self
    }

    /// Configure or replace the authorization result for a raw token.
    ///
    /// The shared state uses interior mutability, so this method can program a
    /// fake after cloning it into router state.
    pub fn set_token_result(
        &self,
        token: impl Into<String>,
        result: Result<UserContext, MacroAuthorizationError>,
    ) {
        self.state
            .token_results
            .lock()
            .expect("fake authorization token-results lock poisoned")
            .insert(token.into(), result);
    }

    /// Return the raw tokens passed to the service, in call order.
    pub fn calls(&self) -> Vec<String> {
        self.state
            .calls
            .lock()
            .expect("fake authorization calls lock poisoned")
            .clone()
    }
}

impl MacroAuthorizationService for FakeMacroAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        self.state
            .calls
            .lock()
            .expect("fake authorization calls lock poisoned")
            .push(jwt.to_string());

        self.state
            .token_results
            .lock()
            .expect("fake authorization token-results lock poisoned")
            .get(jwt)
            .cloned()
            .unwrap_or_else(|| self.fallback.clone())
            .map_err(Report::new)
    }
}

/// Construct a minimal user context for authorization tests.
pub fn test_user_context(user_id: &str) -> UserContext {
    UserContext {
        user_id: user_id.to_string(),
        fusion_user_id: TEST_FUSION_USER_ID.to_string(),
        permissions: None,
        organization_id: None,
    }
}

/// Add a bearer credential to an HTTP request builder.
///
/// # Panics
///
/// Panics if `token` cannot be represented as an HTTP header value.
#[cfg(feature = "axum")]
pub fn bearer(builder: request::Builder, token: &str) -> request::Builder {
    builder.header(header::AUTHORIZATION, bearer_value(token))
}

/// Add or replace the bearer credential on a built HTTP request.
///
/// # Panics
///
/// Panics if `token` cannot be represented as an HTTP header value.
#[cfg(feature = "axum")]
pub fn bearer_request<B>(mut request: Request<B>, token: &str) -> Request<B> {
    request
        .headers_mut()
        .insert(header::AUTHORIZATION, bearer_value(token));
    request
}

#[cfg(feature = "axum")]
fn bearer_value(token: &str) -> ::axum::http::HeaderValue {
    format!("Bearer {token}")
        .parse()
        .expect("test bearer token should be a valid HTTP header value")
}
