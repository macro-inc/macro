use std::time::Duration;

use axum::{
    http::{StatusCode, header::RETRY_AFTER},
    response::IntoResponse,
};
use github::domain::models::GithubError;
use http_body_util::BodyExt;
use upstream_error::{UpstreamError, UpstreamFailure};
use utoipa::OpenApi;

use super::*;
use crate::api::{
    github_pull_requests::{
        EnrichGithubPullRequestsProxyError, MergeGithubPullRequestError,
        UpdateGithubPullRequestError,
    },
    swagger::ApiDoc,
};

fn github_failing(failure: UpstreamFailure) -> GithubError {
    GithubError::Upstream(UpstreamError {
        service: "GitHub",
        failure,
    })
}

async fn json_body(response: Response) -> serde_json::Value {
    let body = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn a_github_outage_on_link_status_is_service_unavailable() {
    let response =
        GithubLinkStatusError::Github(github_failing(UpstreamFailure::Unavailable)).into_response();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = json_body(response).await;
    assert_eq!(body["code"], "upstream_unavailable");
    assert_eq!(
        body["message"],
        "GitHub is temporarily unavailable. Try again in a few minutes."
    );
}

#[test]
fn a_github_rate_limit_on_link_status_says_when_to_retry() {
    let response = GithubLinkStatusError::Github(github_failing(UpstreamFailure::RateLimited {
        retry_after: Some(Duration::from_secs(42)),
    }))
    .into_response();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(response.headers()[RETRY_AFTER], "42");
}

#[test]
fn an_unusable_github_answer_on_link_status_is_bad_gateway() {
    let response = GithubLinkStatusError::Github(github_failing(UpstreamFailure::InvalidResponse))
        .into_response();

    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
}

#[test]
fn our_own_failure_on_link_status_is_still_internal() {
    let response = GithubLinkStatusError::Github(GithubError::Internal(anyhow::anyhow!("bug")))
        .into_response();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn a_sign_in_outage_while_starting_a_link_is_service_unavailable() {
    let response = InitGithubLinkError::Upstream(UpstreamError {
        service: "The sign-in service",
        failure: UpstreamFailure::Unavailable,
    })
    .into_response();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = json_body(response).await;
    assert_eq!(
        body["message"],
        "The sign-in service is temporarily unavailable. Try again in a few minutes."
    );
}

#[test]
fn a_github_outage_while_deleting_a_link_is_service_unavailable() {
    let response =
        DeleteGithubLinkError::GithubServiceError(github_failing(UpstreamFailure::Unavailable))
            .into_response();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[test]
fn a_github_outage_on_pull_request_routes_is_service_unavailable() {
    let outage = || github_failing(UpstreamFailure::Unavailable);
    let responses = [
        EnrichGithubPullRequestsProxyError::Github(outage()).into_response(),
        MergeGithubPullRequestError::Github(outage()).into_response(),
        UpdateGithubPullRequestError::Github(outage()).into_response(),
    ];

    for response in responses {
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
}

#[test]
fn github_link_routes_document_upstream_failures() {
    let openapi = serde_json::to_value(ApiDoc::openapi()).unwrap();
    let operations = [
        ("/link/github/status", "get"),
        ("/link/github", "post"),
        ("/link/github", "delete"),
        ("/github_pull_requests/enrich", "post"),
        ("/github_pull_requests/merge", "post"),
        ("/github_pull_requests/draft", "post"),
        ("/github_pull_requests/mergeability", "post"),
    ];

    for (path, method) in operations {
        let responses = &openapi["paths"][path][method]["responses"];
        for status in ["502", "503"] {
            assert_eq!(
                responses[status]["content"]["application/json"]["schema"]["$ref"].as_str(),
                Some("#/components/schemas/UpstreamErrorResponse"),
                "{method} {path} does not document {status}"
            );
        }
    }
    assert!(
        openapi["components"]["schemas"]
            .get("UpstreamErrorResponse")
            .is_some()
    );
}
