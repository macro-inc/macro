use super::*;
use crate::domain::ports::ClaimedCredential;
use axum::{
    body::{Body, to_bytes},
    http::{Request, header},
};
use macro_authorization::{
    CODE_EXECUTION_HEADER, CredentialOrigin, InternalIdentityClaims, MacroAuthorizationError,
    ValidatedCredential,
};
use model_user::UserContext;
use rootcause::Report;
use std::sync::atomic::{AtomicUsize, Ordering};
use tower::ServiceExt;

const USER_ID: &str = "macro|person@example.com";
const GRANT_ID: Uuid = Uuid::from_u128(7);

/// "person" is the user's own session; "agent" is their credential signed
/// for an agent's program.
#[derive(Clone)]
struct Credentials;

impl MacroAuthorizationService for Credentials {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        match jwt {
            "person" | "agent" => Ok(UserContext {
                user_id: USER_ID.to_owned(),
                fusion_user_id: "fusion-user-id".to_owned(),
                organization_id: None,
                permissions: None,
            }),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        let mut credential = ValidatedCredential::session(self.authorize(jwt).await?);
        if jwt == "agent" {
            credential.origin = CredentialOrigin::MacroApiJwt;
            credential.identity.agent_id = Some(
                serde_json::from_value(serde_json::json!(Uuid::from_u128(1))).unwrap(),
            );
        }
        Ok(credential)
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

/// Counts the calls that reach it and answers each with "not found".
#[derive(Default)]
struct FakeGrants {
    calls: AtomicUsize,
}

impl FakeGrants {
    fn reached(&self) -> AccountManagerError {
        self.calls.fetch_add(1, Ordering::SeqCst);
        AccountManagerError::NotFound
    }
}

impl AccountManagerService for FakeGrants {
    async fn request(
        &self,
        _caller: &MacroUserIdStr<'static>,
        _counterparty: &MacroUserIdStr<'static>,
        _caller_role: AccountManagerRole,
    ) -> Result<AccountManagerGrant, AccountManagerError> {
        Err(self.reached())
    }

    async fn get(
        &self,
        _caller: &MacroUserIdStr<'static>,
        _id: Uuid,
    ) -> Result<AccountManagerGrant, AccountManagerError> {
        Err(self.reached())
    }

    async fn list_managers(
        &self,
        _caller: &MacroUserIdStr<'static>,
    ) -> Result<Vec<AccountManagerGrant>, AccountManagerError> {
        Err(self.reached())
    }

    async fn respond(
        &self,
        _caller: &MacroUserIdStr<'static>,
        _id: Uuid,
        _decision: AccountManagerDecision,
    ) -> Result<AccountManagerGrant, AccountManagerError> {
        Err(self.reached())
    }

    async fn claim(
        &self,
        _caller: &MacroUserIdStr<'static>,
        _id: Uuid,
    ) -> Result<ClaimedCredential, AccountManagerError> {
        Err(self.reached())
    }

    async fn revoke(
        &self,
        _caller: &MacroUserIdStr<'static>,
        _id: Uuid,
    ) -> Result<AccountManagerGrant, AccountManagerError> {
        Err(self.reached())
    }
}

/// The routes that hand account access to someone: ask, answer, claim.
fn grant_routes() -> [(String, &'static str); 3] {
    [
        (
            "/".to_owned(),
            r#"{"counterpartyId":"macro|agent@example.com","callerRole":"managed"}"#,
        ),
        (format!("/{GRANT_ID}/response"), r#"{"decision":"approve"}"#),
        (format!("/{GRANT_ID}/token"), ""),
    ]
}

fn post(uri: &str, body: &'static str, bearer: &str, code_mode: bool) -> Request<Body> {
    let request = Request::post(uri)
        .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
        .header(header::CONTENT_TYPE, "application/json");
    let request = if code_mode {
        request.header(CODE_EXECUTION_HEADER, "1")
    } else {
        request
    };
    request.body(Body::from(body)).unwrap()
}

async fn send(grants: Arc<FakeGrants>, request: Request<Body>) -> axum::response::Response {
    account_manager_router::<_, _, ()>(AccountManagerRouterState::new(
        grants,
        MacroAuthorizationState::new(Arc::new(Credentials)),
    ))
    .oneshot(request)
    .await
    .unwrap()
}

#[tokio::test]
async fn an_agents_program_cannot_request_answer_or_claim_a_grant() {
    for (uri, body) in grant_routes() {
        for (bearer, code_mode) in [("agent", false), ("person", true)] {
            let grants = Arc::new(FakeGrants::default());
            let response = send(grants.clone(), post(&uri, body, bearer, code_mode)).await;

            assert_eq!(response.status(), StatusCode::FORBIDDEN, "{uri} {bearer}");
            let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            let message: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(message["message"], PROGRAM_ACCOUNT_MANAGER_REFUSAL);
            assert_eq!(grants.calls.load(Ordering::SeqCst), 0, "{uri} reached the service");
        }
    }
}

#[tokio::test]
async fn a_person_still_reaches_the_grant_service() {
    for (uri, body) in grant_routes() {
        let grants = Arc::new(FakeGrants::default());
        let response = send(grants.clone(), post(&uri, body, "person", false)).await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{uri}");
        assert_eq!(grants.calls.load(Ordering::SeqCst), 1, "{uri}");
    }
}
