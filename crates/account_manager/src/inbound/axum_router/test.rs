use super::*;
use crate::domain::{
    models::{AccountManagerDecision, AccountManagerRole},
    ports::ClaimedCredential,
};
use axum::{body::Body, http::Request};
use macro_authorization::{
    CredentialOrigin, InternalAuthConfig, JwtValidator, MacroAuthorizationError,
    MacroAuthorizationServiceImpl, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedCredential,
    ValidatedIdentity,
};
use rootcause::Report;
use std::sync::atomic::{AtomicUsize, Ordering};
use tower::ServiceExt;

const PERSON: &str = "macro|owner@example.com";

/// Counts every call and answers it with a conflict, so a request the route
/// let through shows as 409.
#[derive(Default)]
struct Reached(AtomicUsize);

impl Reached {
    fn reached<T>(&self) -> Result<T, AccountManagerError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Err(AccountManagerError::Conflict("reached the service"))
    }
}

impl AccountManagerService for Reached {
    async fn request(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &MacroUserIdStr<'static>,
        _: AccountManagerRole,
    ) -> Result<AccountManagerGrant, AccountManagerError> {
        self.reached()
    }
    async fn get(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
    ) -> Result<AccountManagerGrant, AccountManagerError> {
        self.reached()
    }
    async fn list_managers(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> Result<Vec<AccountManagerGrant>, AccountManagerError> {
        self.reached()
    }
    async fn respond(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        _: AccountManagerDecision,
    ) -> Result<AccountManagerGrant, AccountManagerError> {
        self.reached()
    }
    async fn claim(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
    ) -> Result<ClaimedCredential, AccountManagerError> {
        self.reached()
    }
    async fn revoke(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
    ) -> Result<AccountManagerGrant, AccountManagerError> {
        self.reached()
    }
}

/// A bearer `agent:` or `routine:` stands for a Macro API JWT signed for an
/// agent or a routine run; any other bearer is a person's session.
#[derive(Clone)]
struct Validator;

impl JwtValidator for Validator {
    fn validate_credential(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        let agent = jwt.strip_prefix("agent:");
        let routine = jwt.strip_prefix("routine:");
        let user_id = agent.or(routine).unwrap_or(jwt);
        Ok(ValidatedCredential {
            origin: if user_id == jwt {
                CredentialOrigin::Session
            } else {
                CredentialOrigin::MacroApiJwt
            },
            identity: ValidatedIdentity {
                agent_id: agent.map(|_| bot_id::MACRO_AI_BOT_ID),
                agent_via: None,
                routine_id: routine.map(|_| Uuid::nil()),
                user_id: user_id.to_owned(),
                fusion_user_id: "fusion-user".to_owned(),
                organization_id: None,
                permissions: None,
            },
        })
    }
}

fn router(service: Arc<Reached>) -> axum::Router {
    let authorization = MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
        Validator,
        InternalAuthConfig {
            api_key: "test-internal-key".to_owned(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    )));
    account_manager_router(AccountManagerRouterState::new(service, authorization))
}

fn requests(bearer: &str, code_execution: bool) -> Vec<(&'static str, Request<Body>)> {
    let grant = Uuid::now_v7();
    let post = |uri: String, body: &'static str| {
        let mut request = Request::post(uri)
            .header("authorization", format!("Bearer {bearer}"))
            .header("content-type", "application/json");
        if code_execution {
            request = request.header(macro_authorization::CODE_EXECUTION_HEADER, "1");
        }
        request.body(Body::from(body)).unwrap()
    };
    vec![
        (
            "request",
            post(
                "/".to_owned(),
                r#"{"counterpartyId": "macro|agent@example.com", "callerRole": "managed"}"#,
            ),
        ),
        (
            "respond",
            post(format!("/{grant}/response"), r#"{"decision": "approve"}"#),
        ),
        ("claim", post(format!("/{grant}/token"), "")),
    ]
}

/// Approving a manager hands an outside account a lasting credential for
/// this one, and claiming returns that credential: only a person does either,
/// whatever the program's credential or the code-mode header says.
#[tokio::test]
async fn a_program_cannot_request_approve_or_claim_a_manager() {
    for (program, bearer, code_execution) in [
        ("an agent run", format!("agent:{PERSON}"), false),
        (
            "an owner-identity routine run",
            format!("routine:{PERSON}"),
            false,
        ),
        ("the code-mode runtime", PERSON.to_owned(), true),
    ] {
        for (route, request) in requests(&bearer, code_execution) {
            let service = Arc::new(Reached::default());

            let response = router(service.clone()).oneshot(request).await.unwrap();

            assert_eq!(
                response.status(),
                axum::http::StatusCode::FORBIDDEN,
                "{program} {route}"
            );
            assert_eq!(service.0.load(Ordering::SeqCst), 0, "{program} {route}");
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            assert!(
                String::from_utf8_lossy(&body).contains("cannot ask for, approve or claim"),
                "{program} {route}"
            );
        }
    }
}

#[tokio::test]
async fn a_person_reaches_the_service() {
    for (route, request) in requests(PERSON, false) {
        let service = Arc::new(Reached::default());

        let response = router(service.clone()).oneshot(request).await.unwrap();

        assert_eq!(
            response.status(),
            axum::http::StatusCode::CONFLICT,
            "{route}"
        );
        assert_eq!(service.0.load(Ordering::SeqCst), 1, "{route}");
    }
}

/// Declining and revoking only take access away, so a program may do both.
#[tokio::test]
async fn a_program_may_still_decline_or_revoke() {
    let grant = Uuid::now_v7();
    let bearer = format!("agent:{PERSON}");
    for (route, request) in [
        (
            "decline",
            Request::post(format!("/{grant}/response"))
                .header("authorization", format!("Bearer {bearer}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"decision": "decline"}"#))
                .unwrap(),
        ),
        (
            "revoke",
            Request::delete(format!("/{grant}"))
                .header("authorization", format!("Bearer {bearer}"))
                .body(Body::empty())
                .unwrap(),
        ),
    ] {
        let service = Arc::new(Reached::default());

        let response = router(service.clone()).oneshot(request).await.unwrap();

        assert_eq!(
            response.status(),
            axum::http::StatusCode::CONFLICT,
            "{route}"
        );
        assert_eq!(service.0.load(Ordering::SeqCst), 1, "{route}");
    }
}
