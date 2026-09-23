use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rootcause::Report;
use tower::ServiceExt as _;

use super::*;
use crate::domain::error::HarnessError;
use crate::domain::ports::RepositoryBranches;

const USER_ID: &str = "macro|repository-lister@example.com";

/// Admits the one token `valid`, as the user above.
#[derive(Clone)]
struct TestAuthorizationService;

impl MacroAuthorizationService for TestAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != "valid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: USER_ID.to_owned(),
            fusion_user_id: "fusion-repository-lister".to_owned(),
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

/// A canned listing that records who it was asked about, or a refusal.
struct StubRepositories {
    listing: Result<Vec<ReachableRepository>, ()>,
    asked_for: std::sync::Mutex<Vec<String>>,
}

#[async_trait::async_trait]
impl ReachableRepositories for StubRepositories {
    async fn for_user(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> crate::domain::error::Result<Vec<ReachableRepository>> {
        self.asked_for
            .lock()
            .expect("stub poisoned")
            .push(user.to_string());
        self.listing
            .clone()
            .map_err(|()| HarnessError::Repositories(rootcause::report!("github is down")))
    }
}

/// A canned branch listing that records who asked, and for which repository.
struct StubBranches {
    listing: Result<Vec<String>, StubBranchError>,
    asked_for: std::sync::Mutex<Vec<(String, String, String)>>,
}

#[derive(Clone, Copy)]
enum StubBranchError {
    Unavailable,
    Failed,
}

#[async_trait::async_trait]
impl RepositoryBranches for StubBranches {
    async fn for_repository(
        &self,
        user: &MacroUserIdStr<'_>,
        owner: &str,
        name: &str,
    ) -> crate::domain::error::Result<Vec<String>> {
        self.asked_for.lock().expect("stub poisoned").push((
            user.to_string(),
            owner.to_owned(),
            name.to_owned(),
        ));
        match self.listing.clone() {
            Ok(branches) => Ok(branches),
            Err(StubBranchError::Unavailable) => Err(HarnessError::RepositoryUnavailable),
            Err(StubBranchError::Failed) => Err(HarnessError::Repositories(rootcause::report!(
                "github is down"
            ))),
        }
    }
}

fn router(listing: Result<Vec<ReachableRepository>, ()>) -> (Router, Arc<StubRepositories>) {
    router_with_branches(listing, Ok(Vec::new()))
}

fn router_with_branches(
    listing: Result<Vec<ReachableRepository>, ()>,
    branches: Result<Vec<String>, StubBranchError>,
) -> (Router, Arc<StubRepositories>) {
    let (router, repositories, _) = router_parts(listing, branches);
    (router, repositories)
}

fn router_parts(
    listing: Result<Vec<ReachableRepository>, ()>,
    branches: Result<Vec<String>, StubBranchError>,
) -> (Router, Arc<StubRepositories>, Arc<StubBranches>) {
    let repositories = Arc::new(StubRepositories {
        listing,
        asked_for: std::sync::Mutex::new(Vec::new()),
    });
    let branch_listing = Arc::new(StubBranches {
        listing: branches,
        asked_for: std::sync::Mutex::new(Vec::new()),
    });
    let state = AgentRepositoriesRouterState::new(
        Arc::clone(&repositories) as Arc<dyn ReachableRepositories>,
        Arc::clone(&branch_listing) as Arc<dyn RepositoryBranches>,
        MacroAuthorizationState::new(Arc::new(TestAuthorizationService)),
    );
    (
        agent_repositories_router(state),
        repositories,
        branch_listing,
    )
}

fn request(token: Option<&str>) -> Request<Body> {
    request_path("/agent-repositories", token)
}

fn request_path(uri: &str, token: Option<&str>) -> Request<Body> {
    let builder = Request::builder().uri(uri).method("GET");
    let builder = match token {
        Some(token) => builder.header("authorization", format!("Bearer {token}")),
        None => builder,
    };
    builder.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn lists_the_callers_repositories_with_their_default_branches() {
    let (router, repositories) = router(Ok(vec![
        ReachableRepository {
            url: "https://github.com/macro-inc/infra".to_owned(),
            default_branch: Some("main".to_owned()),
        },
        ReachableRepository {
            url: "https://github.com/macro-inc/scratch".to_owned(),
            default_branch: None,
        },
    ]));

    let response = router.oneshot(request(Some("valid"))).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        serde_json::json!({
            "repositories": [
                {
                    "url": "https://github.com/macro-inc/infra",
                    "defaultBranch": "main"
                },
                {
                    "url": "https://github.com/macro-inc/scratch",
                    "defaultBranch": null
                }
            ]
        })
    );
    // The listing is the token's user's, never anything the request names.
    assert_eq!(
        *repositories.asked_for.lock().unwrap(),
        vec![USER_ID.to_owned()]
    );
}

#[tokio::test]
async fn reaching_nothing_is_an_empty_list() {
    let (router, _) = router(Ok(Vec::new()));

    let response = router.oneshot(request(Some("valid"))).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        serde_json::json!({ "repositories": [] })
    );
}

#[tokio::test]
async fn unauthenticated_callers_are_refused_before_github_is_asked() {
    for token in [None, Some("forged")] {
        let (router, repositories) = router(Ok(Vec::new()));

        let response = router.oneshot(request(token)).await.unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{token:?}");
        assert!(repositories.asked_for.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn a_failed_listing_is_a_bad_gateway() {
    let (router, _) = router(Err(()));

    let response = router.oneshot(request(Some("valid"))).await.unwrap();

    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
}

#[tokio::test]
async fn lists_the_named_repositorys_branches_for_the_caller() {
    let (router, _, branches) = router_parts(
        Ok(Vec::new()),
        Ok(vec!["main".to_owned(), "develop".to_owned()]),
    );

    let response = router
        .oneshot(request_path(
            "/agent-repositories/branches?repoUrl=https://github.com/macro-inc/macro",
            Some("valid"),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        serde_json::json!({ "branches": ["main", "develop"] })
    );
    assert_eq!(
        *branches.asked_for.lock().unwrap(),
        vec![(
            USER_ID.to_owned(),
            "macro-inc".to_owned(),
            "macro".to_owned()
        )]
    );
}

#[tokio::test]
async fn a_url_that_names_no_repository_is_refused_before_github_is_asked() {
    let (router, _, branches) = router_parts(Ok(Vec::new()), Ok(Vec::new()));

    let response = router
        .oneshot(request_path(
            "/agent-repositories/branches?repoUrl=https://example.com/not-github",
            Some("valid"),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(branches.asked_for.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_unreachable_repository_is_forbidden() {
    let (router, _, _) = router_parts(Ok(Vec::new()), Err(StubBranchError::Unavailable));

    let response = router
        .oneshot(request_path(
            "/agent-repositories/branches?repoUrl=https://github.com/other/private",
            Some("valid"),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_failed_branch_listing_is_a_bad_gateway() {
    let (router, _, _) = router_parts(Ok(Vec::new()), Err(StubBranchError::Failed));

    let response = router
        .oneshot(request_path(
            "/agent-repositories/branches?repoUrl=https://github.com/macro-inc/macro",
            Some("valid"),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
}
