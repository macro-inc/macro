use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::StatusCode;
use upstream_error::{UpstreamError, UpstreamFailure};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header, method, path},
};

use super::{GithubHttp, GithubRequest};
use crate::domain::models::GithubError;

fn unix_seconds_from_now(seconds: u64) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    (now + seconds).to_string()
}

#[tokio::test]
async fn holds_and_retries_when_the_quota_resets_within_the_window() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/user"))
        .respond_with(
            ResponseTemplate::new(403)
                .insert_header("x-ratelimit-remaining", "0")
                .insert_header("x-ratelimit-reset", unix_seconds_from_now(1).as_str())
                .set_body_string(r#"{"message":"API rate limit exceeded"}"#),
        )
        .up_to_n_times(1)
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/user"))
        .respond_with(ResponseTemplate::new(200).set_body_string(r#"{"login":"octocat"}"#))
        .expect(1)
        .mount(&server)
        .await;
    let http = GithubHttp::with_api_base_url(reqwest::Client::new(), server.uri());

    let response = http
        .send(GithubRequest::get("token", "/user".to_string()))
        .await
        .unwrap();

    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.text(), r#"{"login":"octocat"}"#);
}

#[tokio::test]
async fn gives_up_when_the_quota_resets_past_the_window_and_stops_calling_github() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/user"))
        .respond_with(
            ResponseTemplate::new(403)
                .insert_header("x-ratelimit-remaining", "0")
                .insert_header("x-ratelimit-reset", unix_seconds_from_now(600).as_str())
                .set_body_string(r#"{"message":"API rate limit exceeded"}"#),
        )
        .expect(1)
        .mount(&server)
        .await;
    let http = GithubHttp::with_api_base_url(reqwest::Client::new(), server.uri());

    let first = http
        .send(GithubRequest::get("token", "/user".to_string()))
        .await;
    let second = http
        .send(GithubRequest::get("token", "/repos/octo/hello".to_string()))
        .await;

    for result in [first, second] {
        let Err(GithubError::Upstream(UpstreamError {
            failure:
                UpstreamFailure::RateLimited {
                    retry_after: Some(retry_after),
                },
            ..
        })) = result
        else {
            panic!("expected a rate limit with a retry time, got {result:?}");
        };
        assert!(retry_after > Duration::from_secs(590), "{retry_after:?}");
        assert!(retry_after <= Duration::from_secs(600), "{retry_after:?}");
    }
}

#[tokio::test]
async fn a_throttled_token_does_not_hold_back_other_tokens() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/user"))
        .and(header("authorization", "Bearer spent"))
        .respond_with(
            ResponseTemplate::new(403)
                .insert_header("x-ratelimit-remaining", "0")
                .insert_header("x-ratelimit-reset", unix_seconds_from_now(600).as_str()),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/user"))
        .and(header("authorization", "Bearer fresh"))
        .respond_with(ResponseTemplate::new(200).set_body_string("{}"))
        .expect(1)
        .mount(&server)
        .await;
    let http = GithubHttp::with_api_base_url(reqwest::Client::new(), server.uri());

    let spent = http
        .send(GithubRequest::get("spent", "/user".to_string()))
        .await;
    let fresh = http
        .send(GithubRequest::get("fresh", "/user".to_string()))
        .await
        .unwrap();

    assert!(spent.is_err());
    assert_eq!(fresh.status, StatusCode::OK);
}

#[tokio::test]
async fn concurrent_identical_reads_share_one_request() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/octo/hello/pulls/1"))
        .respond_with(ResponseTemplate::new(200).set_body_string(r#"{"number":1}"#))
        .expect(1)
        .mount(&server)
        .await;
    let http = GithubHttp::with_api_base_url(reqwest::Client::new(), server.uri());

    let (first, second, third) = tokio::join!(
        http.send(GithubRequest::get(
            "token",
            "/repos/octo/hello/pulls/1".to_string()
        )),
        http.send(GithubRequest::get(
            "token",
            "/repos/octo/hello/pulls/1".to_string()
        )),
        http.send(GithubRequest::get(
            "token",
            "/repos/octo/hello/pulls/1".to_string()
        )),
    );

    for response in [first, second, third] {
        assert_eq!(response.unwrap().text(), r#"{"number":1}"#);
    }
}

#[tokio::test]
async fn a_not_modified_answer_is_served_from_the_etag_cache() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/octo/hello/pulls/1"))
        .and(header("if-none-match", r#""abc""#))
        .respond_with(ResponseTemplate::new(304).insert_header("etag", r#""abc""#))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/octo/hello/pulls/1"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("etag", r#""abc""#)
                .set_body_string(r#"{"number":1}"#),
        )
        .up_to_n_times(1)
        .expect(1)
        .mount(&server)
        .await;
    let http = GithubHttp::with_api_base_url(reqwest::Client::new(), server.uri());

    let fetched = http
        .send(GithubRequest::get(
            "token",
            "/repos/octo/hello/pulls/1".to_string(),
        ))
        .await
        .unwrap();
    let revalidated = http
        .send(GithubRequest::get(
            "token",
            "/repos/octo/hello/pulls/1".to_string(),
        ))
        .await
        .unwrap();

    assert_eq!(fetched.text(), r#"{"number":1}"#);
    assert_eq!(revalidated.status, StatusCode::OK);
    assert_eq!(revalidated.text(), r#"{"number":1}"#);
}

#[tokio::test]
async fn the_etag_cache_is_per_token() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/octo/hello"))
        .and(header("if-none-match", r#""abc""#))
        .respond_with(ResponseTemplate::new(304))
        .expect(0)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/octo/hello"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("etag", r#""abc""#)
                .set_body_string("{}"),
        )
        .expect(2)
        .mount(&server)
        .await;
    let http = GithubHttp::with_api_base_url(reqwest::Client::new(), server.uri());

    for token in ["first", "second"] {
        let response = http
            .send(GithubRequest::get(token, "/repos/octo/hello".to_string()))
            .await
            .unwrap();
        assert_eq!(response.status, StatusCode::OK);
    }
}
