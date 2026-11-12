use super::*;
use axum::{
    body::{Body, to_bytes},
    http::{Request, header},
};
use macro_authorization::{
    CODE_EXECUTION_HEADER, CredentialOrigin, InternalIdentityClaims, MacroAuthorizationError,
    ValidatedCredential,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rootcause::Report;
use std::sync::atomic::{AtomicUsize, Ordering};
use tower::ServiceExt;

const USER_ID: &str = "macro|person@example.com";

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
                serde_json::from_value(serde_json::json!(uuid::Uuid::from_u128(1))).unwrap(),
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

#[derive(Default)]
struct FakeKeys {
    created: AtomicUsize,
}

impl UserApiKeyService for FakeKeys {
    async fn create_key(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        name: &str,
    ) -> Result<CreatedUserApiKey, UserApiKeyError> {
        self.created.fetch_add(1, Ordering::SeqCst);
        Ok(CreatedUserApiKey {
            id: UserApiKeyId::generate(),
            name: name.to_owned(),
            created_at: chrono::Utc::now(),
            key: "mk_test_secret".to_owned(),
        })
    }

    async fn replace_key(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _name: &str,
    ) -> Result<CreatedUserApiKey, UserApiKeyError> {
        panic!("unexpected replace_key call")
    }

    async fn list_keys(
        &self,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<UserApiKeyInfo>, UserApiKeyError> {
        panic!("unexpected list_keys call")
    }

    async fn delete_key(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _id: UserApiKeyId,
    ) -> Result<(), UserApiKeyError> {
        panic!("unexpected delete_key call")
    }
}

fn create(bearer: &str, code_mode: bool) -> Request<Body> {
    let request = Request::post("/")
        .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
        .header(header::CONTENT_TYPE, "application/json");
    let request = if code_mode {
        request.header(CODE_EXECUTION_HEADER, "1")
    } else {
        request
    };
    request.body(Body::from(r#"{"name":"deploy"}"#)).unwrap()
}

async fn send(keys: Arc<FakeKeys>, request: Request<Body>) -> axum::response::Response {
    user_api_key_router::<_, _, ()>(UserApiKeyRouterState::new(
        keys,
        MacroAuthorizationState::new(Arc::new(Credentials)),
    ))
    .oneshot(request)
    .await
    .unwrap()
}

#[tokio::test]
async fn an_agents_program_cannot_create_api_keys() {
    for request in [create("agent", false), create("person", true)] {
        let keys = Arc::new(FakeKeys::default());
        let response = send(keys.clone(), request).await;

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["message"], PROGRAM_API_KEY_REFUSAL);
        assert_eq!(keys.created.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn a_person_still_creates_api_keys() {
    let keys = Arc::new(FakeKeys::default());
    let response = send(keys.clone(), create("person", false)).await;

    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(keys.created.load(Ordering::SeqCst), 1);
}
