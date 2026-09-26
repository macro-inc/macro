use super::*;
use crate::domain::model::{ChangesetId, ChangesetRange};
use axum::{body::Body, http::Request};
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use std::sync::Mutex;
use tower::ServiceExt;

const VIEWER: &str = "macro|pr-viewer@example.com";

#[derive(Clone)]
struct Auth;

impl MacroAuthorizationService for Auth {
    async fn authorize(
        &self,
        token: &str,
    ) -> Result<UserContext, rootcause::Report<MacroAuthorizationError>> {
        if token != "valid" {
            return Err(rootcause::Report::new(
                MacroAuthorizationError::InvalidCredentials,
            ));
        }
        Ok(UserContext {
            user_id: VIEWER.to_owned(),
            fusion_user_id: "fusion-pr-viewer".to_owned(),
            permissions: None,
            organization_id: None,
        })
    }

    async fn authorize_internal(
        &self,
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, rootcause::Report<MacroAuthorizationError>> {
        Err(rootcause::Report::new(
            MacroAuthorizationError::InvalidCredentials,
        ))
    }
}

#[derive(Default)]
struct Service {
    calls: Mutex<Vec<(String, PullRequestRef)>>,
}

impl PullRequestChangesService for Service {
    async fn changes(
        &self,
        viewer: &MacroUserIdStr<'static>,
        reference: &PullRequestRef,
    ) -> Result<PullRequestSnapshot, CompareError> {
        self.calls
            .lock()
            .unwrap()
            .push((viewer.to_string(), reference.clone()));
        Err(CompareError::Unavailable)
    }
}

fn route() -> (Router, Arc<Service>) {
    let state = PullRequestChangesRouterState::new(
        Service::default(),
        MacroAuthorizationState::new(Arc::new(Auth)),
    );
    let service = Arc::clone(&state.service);
    (pull_request_changes_router(state), service)
}

#[tokio::test]
async fn invalid_urls_do_not_reach_the_service() {
    let (router, service) = route();
    for url in [
        "https://evil.example/o/r/pull/1",
        "https://github.com/o/r/tree/main",
        "https://github.com/o/r/pull/0",
    ] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/pull-requests/changes?url={url}"))
                    .header("Authorization", "Bearer valid")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    assert!(service.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn authenticated_viewer_and_validated_pr_reach_the_service_and_preserve_denial() {
    let (router, service) = route();
    let response = router
        .oneshot(
            Request::builder()
                .uri("/pull-requests/changes?url=https://github.com/upstream/repo/pull/42")
                .header("Authorization", "Bearer valid")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        *service.calls.lock().unwrap(),
        vec![(
            VIEWER.to_owned(),
            PullRequestRef::parse("https://github.com/upstream/repo/pull/42").unwrap()
        )]
    );
}

#[tokio::test]
async fn invalid_credentials_cannot_reach_the_service() {
    let (router, service) = route();
    let response = router
        .oneshot(
            Request::builder()
                .uri("/pull-requests/changes?url=https://github.com/upstream/repo/pull/42")
                .header("Authorization", "Bearer invalid")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(service.calls.lock().unwrap().is_empty());
}

#[test]
fn snapshot_response_keeps_patch_and_summary_in_the_same_body() {
    let response: PullRequestChangesResponse = PullRequestSnapshot {
        id: ChangesetId::new(),
        range: ChangesetRange::default(),
        files: vec![],
        additions: 0,
        deletions: 0,
        patch: "patch".to_owned(),
        truncated: true,
        captured_at: chrono::Utc::now(),
    }
    .into();
    assert_eq!(response.patch, "patch");
    assert_eq!(response.changeset.patch_bytes, 5);
    assert!(response.changeset.truncated);
    assert_eq!(
        response.changeset.source,
        ChangesetSourceDto::GithubPullRequest
    );
}

#[test]
fn repository_denials_and_large_diffs_have_explicit_public_statuses() {
    for (error, expected) in [
        (
            PullRequestChangesApiError::InvalidUrl,
            StatusCode::BAD_REQUEST,
        ),
        (CompareError::Unavailable.into(), StatusCode::FORBIDDEN),
        (CompareError::NotFound.into(), StatusCode::NOT_FOUND),
        (
            CompareError::TooLarge.into(),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        assert_eq!(error.into_response().status(), expected);
    }
}
