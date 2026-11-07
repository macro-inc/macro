use super::*;
use crate::{
    AuthorizedUserApiKey, InternalIdentityClaims, MacroAuthorizationError, ValidatedCredential,
};
use ::axum::http::header;
use model_user::UserContext;
use rootcause::Report;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

/// Counts credential checks: `agent`, `routine` and `person` are JWTs signed
/// for an agent, a routine run and nobody; a user API key lookup is the
/// database round trip that must never happen here.
#[derive(Clone, Default)]
struct Counting {
    jwt_checks: Arc<AtomicUsize>,
    api_key_lookups: Arc<AtomicUsize>,
}

impl MacroAuthorizationService for Counting {
    async fn authorize(&self, _: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        unreachable!("only authorize_identity is used")
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        self.jwt_checks.fetch_add(1, Ordering::SeqCst);
        if !matches!(jwt, "agent" | "routine" | "person") {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        let mut credential = ValidatedCredential::session(UserContext {
            user_id: "macro|owner@example.com".to_owned(),
            fusion_user_id: "fusion-user-id".to_owned(),
            organization_id: None,
            permissions: None,
        });
        credential.identity.agent_id = (jwt == "agent").then_some(bot_id::MACRO_AI_BOT_ID);
        credential.identity.routine_id = (jwt == "routine").then(uuid::Uuid::nil);
        Ok(credential)
    }

    async fn authorize_user_api_key(
        &self,
        _: &str,
    ) -> Result<AuthorizedUserApiKey, Report<MacroAuthorizationError>> {
        self.api_key_lookups.fetch_add(1, Ordering::SeqCst);
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }

    async fn authorize_internal(
        &self,
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        unreachable!("internal credentials are never checked here")
    }
}

async fn is_program(service: &Counting, request: Request) -> bool {
    request_is_program(
        request,
        &MacroAuthorizationState::new(Arc::new(service.clone())),
    )
    .await
    .1
}

fn bearer(token: &str) -> Request {
    Request::get("/")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn a_jwt_signed_for_a_program_counts_and_a_persons_does_not() {
    let service = Counting::default();
    assert!(is_program(&service, bearer("agent")).await);
    assert!(is_program(&service, bearer("routine")).await);
    assert!(!is_program(&service, bearer("person")).await);
    assert!(!is_program(&service, bearer("not-a-jwt")).await);
    let query = Request::get("/?limit=5&macro-api-token=agent")
        .body(Body::empty())
        .unwrap();
    assert!(is_program(&service, query).await);
    let header = Request::get("/")
        .header(super::super::CODE_EXECUTION_HEADER, "1")
        .body(Body::empty())
        .unwrap();
    assert!(is_program(&service, header).await);
    assert_eq!(
        service.jwt_checks.load(Ordering::SeqCst),
        5,
        "one signature check per JWT"
    );
}

/// A user API key carries no program claims, so its request is decided
/// without its database lookup, even when a cookie rides along.
#[tokio::test]
async fn a_user_api_key_is_never_looked_up() {
    let service = Counting::default();
    let request = Request::get("/")
        .header(super::super::USER_API_KEY_HEADER, "mk_key")
        .header(header::COOKIE, "macro-access-token=agent")
        .body(Body::empty())
        .unwrap();

    assert!(!is_program(&service, request).await);
    assert_eq!(service.api_key_lookups.load(Ordering::SeqCst), 0);
    assert_eq!(service.jwt_checks.load(Ordering::SeqCst), 0);
}
