use std::sync::{Arc, Mutex};

use super::*;
use crate::domain::{models::ResolvedApiKeyUser, ports::UserApiKeyAuthorizationRepo};
use macro_user_id::user_id::MacroUserIdStr;

const API_KEY: &str = "mak_test_secret";
const USER_ID: &str = "macro|api-key@example.com";
const FUSION_USER_ID: &str = "fusion-api-key-user";
const ORGANIZATION_ID: i32 = 42;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Failure {
    FindKeyOwner,
}

#[derive(Clone)]
struct FakeRepo {
    owner: Option<ResolvedApiKeyUser>,
    failure: Option<Failure>,
    keys: Arc<Mutex<Vec<String>>>,
}

impl FakeRepo {
    fn found() -> Self {
        Self {
            owner: Some(resolved_user()),
            failure: None,
            keys: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn missing() -> Self {
        Self {
            owner: None,
            failure: None,
            keys: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn fail() -> Self {
        Self {
            owner: None,
            failure: Some(Failure::FindKeyOwner),
            keys: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn keys(&self) -> Vec<String> {
        self.keys.lock().expect("keys lock poisoned").clone()
    }
}

impl UserApiKeyAuthorizationRepo for FakeRepo {
    type Err = &'static str;

    async fn find_key_owner(&self, api_key: &str) -> Result<Option<ResolvedApiKeyUser>, Self::Err> {
        self.keys
            .lock()
            .expect("keys lock poisoned")
            .push(api_key.to_string());
        if self.failure == Some(Failure::FindKeyOwner) {
            return Err("find key owner failed");
        }
        Ok(self.owner.clone())
    }
}

fn resolved_user() -> ResolvedApiKeyUser {
    ResolvedApiKeyUser {
        macro_user_id: MacroUserIdStr::try_from(USER_ID.to_string()).expect("valid Macro user id"),
        fusion_user_id: FUSION_USER_ID.to_string(),
        organization_id: Some(ORGANIZATION_ID),
    }
}

#[tokio::test]
async fn found_key_constructs_user_context() {
    let repo = FakeRepo::found();
    let authorizer = UserApiKeyAuthorizerService::new(repo.clone());

    let context = authorizer.authorize_user_api_key(API_KEY).await.unwrap();

    assert_eq!(context.user_id, USER_ID);
    assert_eq!(context.fusion_user_id, FUSION_USER_ID);
    assert_eq!(context.organization_id, Some(ORGANIZATION_ID));
    assert_eq!(context.permissions, None);
    assert_eq!(repo.keys(), vec![API_KEY.to_string()]);
}

#[tokio::test]
async fn missing_key_is_invalid_credentials() {
    let error = UserApiKeyAuthorizerService::new(FakeRepo::missing())
        .authorize_user_api_key(API_KEY)
        .await
        .unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::InvalidCredentials
    );
}

#[tokio::test]
async fn repository_error_is_unavailable() {
    let error = UserApiKeyAuthorizerService::new(FakeRepo::fail())
        .authorize_user_api_key(API_KEY)
        .await
        .unwrap_err();

    assert_eq!(
        error.current_context(),
        &MacroAuthorizationError::Unavailable
    );
}
