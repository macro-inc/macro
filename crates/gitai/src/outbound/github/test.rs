use std::time::Duration;

use upstream_error::{UpstreamError, UpstreamFailure};
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

const SQUASH: &str = "a550235529f7a6e8329525dddca0974836eeb1e1";

fn fixture(name: &str) -> serde_json::Value {
    let path = format!(
        "{}/tests/fixtures/github/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn client(server: &MockServer, token: Option<&str>) -> GithubClient {
    GithubClient::new(&server.uri(), token.map(str::to_owned), "macro-inc/macro").unwrap()
}

fn upstream_failure(error: GithubError) -> UpstreamFailure {
    match error {
        GithubError::Upstream(UpstreamError { failure, .. }) => failure,
        GithubError::BlameNeedsToken => panic!("expected an upstream failure"),
    }
}

#[tokio::test]
async fn reads_a_recorded_squash_commit_and_its_pull_request() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("/repos/macro-inc/macro/commits/{SQUASH}")))
        .and(header("user-agent", "macro-gitai-service"))
        .respond_with(ResponseTemplate::new(200).set_body_json(fixture("commit-squash-10651.json")))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/macro-inc/macro/pulls/10651"))
        .respond_with(ResponseTemplate::new(200).set_body_json(fixture("pull-request-10651.json")))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/macro-inc/macro/pulls/10651/commits"))
        .and(query_param("page", "1"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(fixture("pull-request-10651-commits.json")),
        )
        .mount(&server)
        .await;
    let github = client(&server, None);

    let commit = github.commit(SQUASH).await.unwrap().unwrap();
    let pull_request = github.pull_request(10651).await.unwrap().unwrap();
    let commits = github.pull_request_commits(10651).await.unwrap();

    assert_eq!(commit.sha, SQUASH);
    assert_eq!(
        commit.subject,
        "fix(settings): show the native binary's build date (#10651)"
    );
    assert_eq!(
        pull_request,
        GithubPullRequest {
            number: 10651,
            open: false
        }
    );
    assert_eq!(commits.len(), 6);
    assert_eq!(commits[0], "dc8a671695d4f4f75108400cf0ad9e9a16d4d7b1");
}

#[tokio::test]
async fn pages_through_pull_request_commits() {
    let server = MockServer::start().await;
    let page = |count: usize, offset: usize| {
        let commits: Vec<_> = (0..count)
            .map(|index| serde_json::json!({ "sha": format!("{:040x}", offset + index) }))
            .collect();
        ResponseTemplate::new(200).set_body_json(commits)
    };
    Mock::given(method("GET"))
        .and(path("/repos/macro-inc/macro/pulls/9/commits"))
        .and(query_param("page", "1"))
        .respond_with(page(100, 0))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/macro-inc/macro/pulls/9/commits"))
        .and(query_param("page", "2"))
        .respond_with(page(3, 100))
        .mount(&server)
        .await;

    let commits = client(&server, None).pull_request_commits(9).await.unwrap();

    assert_eq!(commits.len(), 103);
    assert_eq!(commits[102], format!("{:040x}", 102));
}

#[tokio::test]
async fn not_found_and_unresolvable_shas_are_none() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/macro-inc/macro/pulls/1"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/macro-inc/macro/commits/abcdef1"))
        .respond_with(ResponseTemplate::new(422))
        .mount(&server)
        .await;
    let github = client(&server, None);

    assert_eq!(github.pull_request(1).await.unwrap(), None);
    assert_eq!(github.commit("abcdef1").await.unwrap(), None);
}

#[tokio::test]
async fn rate_limits_and_outages_are_upstream_failures() {
    let server = MockServer::start().await;
    let reset = Utc::now().timestamp() + 120;
    Mock::given(method("GET"))
        .and(path("/repos/macro-inc/macro/pulls/1"))
        .respond_with(
            ResponseTemplate::new(403)
                .insert_header("x-ratelimit-remaining", "0")
                .insert_header("x-ratelimit-reset", reset.to_string().as_str()),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/macro-inc/macro/pulls/2"))
        .respond_with(ResponseTemplate::new(502))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/macro-inc/macro/pulls/3"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/macro-inc/macro/pulls/4"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
        .mount(&server)
        .await;
    let github = client(&server, Some("synthetic-token"));

    let rate_limited = upstream_failure(github.pull_request(1).await.unwrap_err());
    let UpstreamFailure::RateLimited {
        retry_after: Some(wait),
    } = rate_limited
    else {
        panic!("expected a rate limit with a wait: {rate_limited:?}");
    };
    assert!(wait <= Duration::from_secs(120) && wait >= Duration::from_secs(100));
    assert_eq!(
        upstream_failure(github.pull_request(2).await.unwrap_err()),
        UpstreamFailure::Unavailable
    );
    assert_eq!(
        upstream_failure(github.pull_request(3).await.unwrap_err()),
        UpstreamFailure::InvalidResponse
    );
    assert_eq!(
        upstream_failure(github.pull_request(4).await.unwrap_err()),
        UpstreamFailure::InvalidResponse
    );
}

#[tokio::test]
async fn blames_through_graphql_with_the_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .and(header("authorization", "Bearer synthetic-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(fixture("blame-app-build.json")))
        .mount(&server)
        .await;

    let blame = client(&server, Some("synthetic-token"))
        .blame(SQUASH, "apps/web/src/features/settings/app-build.ts")
        .await
        .unwrap()
        .unwrap();

    assert_eq!(blame.commit, SQUASH);
    assert_eq!(
        blame.hunks[1],
        BlameHunk {
            start: 19,
            end: 30,
            commit: SQUASH.to_owned()
        }
    );
    assert_eq!(blame.hunks.len(), 3);
}

#[tokio::test]
async fn blame_needs_a_token_and_treats_graphql_not_found_as_none() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "repository": { "object": null } },
            "errors": [{ "type": "NOT_FOUND", "message": "Could not resolve file" }],
        })))
        .mount(&server)
        .await;

    let without_token = client(&server, None).blame("main", "missing.rs").await;
    let missing = client(&server, Some("synthetic-token"))
        .blame("main", "missing.rs")
        .await
        .unwrap();

    assert_eq!(without_token, Err(GithubError::BlameNeedsToken));
    assert_eq!(missing, None);
}
