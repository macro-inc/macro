use std::sync::Mutex;

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::get,
};

use super::*;

/// One owner's link token, or none.
struct Tokens(Option<&'static str>);

#[async_trait::async_trait]
impl LinkedGithubTokens for Tokens {
    async fn access_token(
        &self,
        _user_id: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Option<String>> {
        Ok(self.0.map(str::to_owned))
    }
}

/// A pull request's body on a stand-in GitHub, and who may touch it.
#[derive(Clone)]
struct Github {
    body: Arc<Mutex<Option<String>>>,
    status: StatusCode,
}

fn authorized(headers: &HeaderMap) -> bool {
    headers
        .get("authorization")
        .is_some_and(|value| value == "Bearer link-token")
}

async fn read(
    State(github): State<Github>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if !authorized(&headers) || !github.status.is_success() {
        return Err((
            github.status,
            Json(serde_json::json!({ "message": "Not Found" })),
        ));
    }
    Ok(Json(
        serde_json::json!({ "number": 7, "body": *github.body.lock().unwrap() }),
    ))
}

async fn write(
    State(github): State<Github>,
    headers: HeaderMap,
    Json(update): Json<serde_json::Value>,
) -> StatusCode {
    if !authorized(&headers) {
        return StatusCode::UNAUTHORIZED;
    }
    *github.body.lock().unwrap() = update["body"].as_str().map(str::to_owned);
    StatusCode::OK
}

async fn serve(github: Github) -> String {
    let app = Router::new()
        .route("/repos/org/repo/pulls/7", get(read).patch(write))
        .with_state(github);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await });
    format!("http://{address}")
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}

fn pull_request() -> PullRequestNumber {
    PullRequestNumber::parse("https://github.com/org/repo/pull/7").unwrap()
}

#[tokio::test]
async fn reads_and_replaces_the_description_as_the_owner() {
    let github = Github {
        body: Arc::new(Mutex::new(None)),
        status: StatusCode::OK,
    };
    let base = serve(github.clone()).await;
    let descriptions = GithubPullRequestDescriptions::with_api_base_url(
        Arc::new(Tokens(Some("link-token"))),
        &base,
    )
    .unwrap();

    assert_eq!(
        descriptions.read(&owner(), &pull_request()).await.unwrap(),
        ""
    );
    descriptions
        .write(&owner(), &pull_request(), "Links")
        .await
        .unwrap();
    assert_eq!(github.body.lock().unwrap().as_deref(), Some("Links"));
    assert_eq!(
        descriptions.read(&owner(), &pull_request()).await.unwrap(),
        "Links"
    );
}

#[tokio::test]
async fn an_unlinked_owner_or_a_refusal_is_reported() {
    let github = Github {
        body: Arc::new(Mutex::new(None)),
        status: StatusCode::NOT_FOUND,
    };
    let base = serve(github).await;
    let unlinked =
        GithubPullRequestDescriptions::with_api_base_url(Arc::new(Tokens(None)), &base).unwrap();
    assert!(matches!(
        unlinked.read(&owner(), &pull_request()).await,
        Err(PullRequestDescriptionError::NotLinked)
    ));

    let refused = GithubPullRequestDescriptions::with_api_base_url(
        Arc::new(Tokens(Some("link-token"))),
        &base,
    )
    .unwrap();
    assert!(matches!(
        refused.read(&owner(), &pull_request()).await,
        Err(PullRequestDescriptionError::Refused(message)) if message == "Not Found"
    ));
}
