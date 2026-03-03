use std::sync::Arc;

use axum::{Router, http::Request};
use http_body_util::BodyExt;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use tower::util::ServiceExt;

use crate::domain::{
    models::{GithubError, GithubInstallationAccessToken, GithubLink, ValidatedGithubWebhookEvent},
    ports::GithubService,
};

use super::{GithubSyncRouterState, github_sync_router};

struct MockGithubService {
    sync_app_url: String,
}

impl GithubService for MockGithubService {
    fn construct_oauth_url<T: serde::Serialize + std::fmt::Debug + 'static>(
        &self,
        _redirect_uri: &str,
        _state: T,
    ) -> Result<String, GithubError> {
        unimplemented!()
    }

    async fn link_user(
        &self,
        _user_id: &MacroUserId<Lowercase<'static>>,
        _fusionauth_user_id: &uuid::Uuid,
        _in_progress_user_link: &uuid::Uuid,
        _redirect_uri: &str,
        _code: &str,
    ) -> Result<GithubLink, GithubError> {
        unimplemented!()
    }

    async fn validate_webhook_event(
        &self,
        _event_type: &str,
        _signature: &str,
        _body: &[u8],
    ) -> Result<ValidatedGithubWebhookEvent, GithubError> {
        unimplemented!()
    }

    async fn process_webhook_event(
        &self,
        _webhook_event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        unimplemented!()
    }

    fn get_github_sync_app_url(&self) -> &str {
        &self.sync_app_url
    }

    async fn generate_installation_access_token(
        &self,
        _installation_id: u64,
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        unimplemented!()
    }
}

fn mock_router(sync_app_url: &str) -> Router {
    github_sync_router(GithubSyncRouterState {
        service: Arc::new(MockGithubService {
            sync_app_url: sync_app_url.to_string(),
        }),
    })
}

#[tokio::test]
async fn install_sync_redirects_to_github_sync_app_url() {
    let url = "https://github.com/apps/my-sync-app/installations/new";
    let router = mock_router(url);

    let request = Request::builder()
        .uri("/install-sync")
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();

    assert_eq!(res.status(), axum::http::StatusCode::TEMPORARY_REDIRECT);
    assert_eq!(res.headers().get("location").unwrap(), url);
}

#[tokio::test]
async fn install_sync_returns_empty_body() {
    let url = "https://github.com/apps/my-sync-app/installations/new";
    let router = mock_router(url);

    let request = Request::builder()
        .uri("/install-sync")
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();

    assert!(bytes.is_empty());
}

#[tokio::test]
async fn install_sync_returns_not_found_for_wrong_path() {
    let router = mock_router("https://github.com/apps/my-sync-app");

    let request = Request::builder()
        .uri("/wrong-path")
        .body(axum::body::Body::empty())
        .unwrap();

    let res = router.oneshot(request).await.unwrap();

    assert_eq!(res.status(), axum::http::StatusCode::NOT_FOUND);
}
