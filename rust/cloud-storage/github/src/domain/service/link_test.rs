use std::sync::{Arc, Mutex};

use chrono::Utc;
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};

use crate::domain::{
    models::{
        GithubAccessToken, GithubError, GithubExchangeTokenResponse, GithubLink,
        GithubPullRequestDetails, GithubPullRequestRef, GithubUserInfo,
    },
    ports::{Auth, GithubLinkService, GithubOauth, GithubRepo},
};

use super::{GithubLinkConfig, GithubLinkServiceImpl};

#[derive(Clone)]
struct StubGithubRepo {
    link: Option<GithubLink>,
}

impl StubGithubRepo {
    fn linked(link: GithubLink) -> Self {
        Self { link: Some(link) }
    }

    fn unlinked() -> Self {
        Self { link: None }
    }
}

impl GithubRepo for StubGithubRepo {
    type Err = anyhow::Error;

    async fn get_github_link_by_user_id<'a>(
        &self,
        _macro_user_id: &MacroUserId<Lowercase<'a>>,
    ) -> Result<GithubLink, Self::Err> {
        self.link
            .clone()
            .ok_or_else(|| anyhow::anyhow!("no rows returned"))
    }

    async fn get_github_link_by_github_user_id(
        &self,
        _github_user_id: &str,
    ) -> Result<GithubLink, Self::Err> {
        Err(anyhow::anyhow!("not implemented"))
    }

    async fn get_github_link_by_id(&self, _id: &uuid::Uuid) -> Result<GithubLink, Self::Err> {
        Err(anyhow::anyhow!("not implemented"))
    }

    async fn insert_github_link(&self, _link: &GithubLink) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn delete_in_progress_user_link(
        &self,
        _in_progress_link_id: &uuid::Uuid,
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn delete_github_link(&self, _link_id: &uuid::Uuid) -> Result<(), Self::Err> {
        Ok(())
    }
}

#[derive(Clone, Default)]
struct StubGithubOauth {
    state: Arc<Mutex<StubGithubOauthState>>,
}

#[derive(Default)]
struct StubGithubOauthState {
    token_is_expired: bool,
    validated_tokens: Vec<String>,
    pull_request_detail_calls: Vec<PullRequestDetailCall>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PullRequestDetailCall {
    access_token: String,
    owner: String,
    repo: String,
    number: u64,
}

impl StubGithubOauth {
    fn new(token_is_expired: bool) -> Self {
        Self {
            state: Arc::new(Mutex::new(StubGithubOauthState {
                token_is_expired,
                ..StubGithubOauthState::default()
            })),
        }
    }

    fn validated_tokens(&self) -> Vec<String> {
        self.state.lock().unwrap().validated_tokens.clone()
    }

    fn pull_request_detail_calls(&self) -> Vec<PullRequestDetailCall> {
        self.state.lock().unwrap().pull_request_detail_calls.clone()
    }
}

impl GithubOauth for StubGithubOauth {
    type Err = anyhow::Error;

    fn construct_oauth_url<T: serde::Serialize + std::fmt::Debug + 'static>(
        &self,
        _client_id: &str,
        _redirect_uri: &str,
        _state: T,
    ) -> Result<String, Self::Err> {
        Ok("https://github.example/oauth".to_string())
    }

    async fn exchange_oauth_code_for_tokens(
        &self,
        _client_id: &str,
        _client_secret: &str,
        _redirect_uri: &str,
        _code: &str,
    ) -> Result<GithubExchangeTokenResponse, Self::Err> {
        Ok(GithubExchangeTokenResponse {
            access_token: "access-token".to_string(),
            token_type: "bearer".to_string(),
            scope: "repo user:email".to_string(),
            refresh_token: None,
            expires_in: None,
            refresh_token_expires_in: None,
        })
    }

    async fn get_user_info(&self, _access_token: &str) -> Result<GithubUserInfo, Self::Err> {
        Ok(GithubUserInfo {
            id: 1,
            login: "octocat".to_string(),
            email: None,
            name: None,
        })
    }

    async fn is_access_token_expired(&self, access_token: &str) -> Result<bool, Self::Err> {
        let mut state = self.state.lock().unwrap();
        state.validated_tokens.push(access_token.to_string());
        Ok(state.token_is_expired)
    }

    async fn get_pull_request_details(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        number: u64,
    ) -> Result<GithubPullRequestDetails, Self::Err> {
        self.state
            .lock()
            .unwrap()
            .pull_request_detail_calls
            .push(PullRequestDetailCall {
                access_token: access_token.to_string(),
                owner: owner.to_string(),
                repo: repo.to_string(),
                number,
            });

        Ok(GithubPullRequestDetails {
            title: "Add token validation".to_string(),
            state: "open".to_string(),
            merged_at: None,
            additions: 12,
            deletions: 3,
            comments: None,
            checks: None,
        })
    }
}

#[derive(Clone)]
struct StubAuth {
    access_token: String,
}

impl StubAuth {
    fn new(access_token: &str) -> Self {
        Self {
            access_token: access_token.to_string(),
        }
    }
}

impl Auth for StubAuth {
    type Err = anyhow::Error;

    async fn link_user(
        &self,
        _fusionauth_user_id: &uuid::Uuid,
        _idp_id: &str,
        _github_user_id: &str,
        _username: &str,
        _access_token: &str,
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn delete_user_link(
        &self,
        _github_link: &GithubLink,
        _github_idp_id: &str,
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn retreive_access_token(
        &self,
        _fusionauth_user_id: &uuid::Uuid,
        _github_idp_id: &str,
    ) -> Result<GithubAccessToken, Self::Err> {
        Ok(GithubAccessToken::new(self.access_token.clone()))
    }
}

fn test_user_id() -> MacroUserId<Lowercase<'static>> {
    MacroUserIdStr::try_from_email("user@example.com")
        .unwrap()
        .0
}

fn test_link(user_id: &MacroUserId<Lowercase<'static>>) -> GithubLink {
    GithubLink {
        id: uuid::Uuid::nil(),
        macro_id: MacroUserIdStr((*user_id).clone()),
        fusionauth_user_id: uuid::Uuid::nil(),
        github_username: "octocat".to_string(),
        github_user_id: "1".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn pull_request_ref() -> GithubPullRequestRef {
    GithubPullRequestRef {
        github_key: "macro/app/pull/7".to_string(),
        owner: "macro".to_string(),
        repo: "app".to_string(),
        number: 7,
        url: "https://github.com/macro/app/pull/7".to_string(),
        display_name: "macro/app#7".to_string(),
    }
}

fn service(
    repo: StubGithubRepo,
    oauth: StubGithubOauth,
    auth: StubAuth,
) -> GithubLinkServiceImpl<StubGithubRepo, StubGithubOauth, StubAuth> {
    GithubLinkServiceImpl::new(
        repo,
        oauth,
        auth,
        GithubLinkConfig {
            client_id: "client-id".to_string(),
            client_secret: "client-secret".to_string(),
            idp_id: "github-idp".to_string(),
        },
    )
}

#[tokio::test]
async fn check_user_link_token_accepts_valid_token() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(false);
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth.clone(),
        StubAuth::new("valid-token"),
    );

    let result = service.check_user_link_token(&user_id).await;

    assert!(result.is_ok());
    assert_eq!(oauth.validated_tokens(), vec!["valid-token".to_string()]);
}

#[tokio::test]
async fn check_user_link_token_returns_reauthentication_required_for_expired_token() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(true);
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth.clone(),
        StubAuth::new("expired-token"),
    );

    let result = service.check_user_link_token(&user_id).await;

    assert!(matches!(result, Err(GithubError::ReauthenticationRequired)));
    assert_eq!(oauth.validated_tokens(), vec!["expired-token".to_string()]);
}

#[tokio::test]
async fn check_user_link_token_returns_no_link_found_without_db_link() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(false);
    let service = service(
        StubGithubRepo::unlinked(),
        oauth.clone(),
        StubAuth::new("valid-token"),
    );

    let result = service.check_user_link_token(&user_id).await;

    assert!(matches!(result, Err(GithubError::NoLinkFound)));
    assert!(oauth.validated_tokens().is_empty());
}

#[tokio::test]
async fn check_user_link_token_enrich_pull_requests_reauthenticates_before_details() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(true);
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth.clone(),
        StubAuth::new("expired-token"),
    );

    let result = service
        .enrich_pull_requests(&user_id, vec![pull_request_ref()])
        .await;

    assert!(matches!(result, Err(GithubError::ReauthenticationRequired)));
    assert_eq!(oauth.validated_tokens(), vec!["expired-token".to_string()]);
    assert!(oauth.pull_request_detail_calls().is_empty());
}
