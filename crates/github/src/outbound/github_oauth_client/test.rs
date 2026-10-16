use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{self, Receiver};
use std::thread::JoinHandle;
use std::time::Duration;

use super::*;

struct MockResponse {
    status: &'static str,
    body: String,
}

struct MockServer {
    base_url: String,
    requests: Receiver<String>,
    handle: JoinHandle<()>,
}

impl MockServer {
    fn start(response: MockResponse) -> Self {
        Self::start_many(vec![response])
    }

    /// Answers one connection per response, in order.
    fn start_many(responses: Vec<MockResponse>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let (request_sender, requests) = mpsc::channel();
        let handle = std::thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                request_sender.send(request).unwrap();
                write!(
                    stream,
                    "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response.status,
                    response.body.len(),
                    response.body
                )
                .unwrap();
            }
        });

        Self {
            base_url,
            requests,
            handle,
        }
    }

    fn finish(self) -> String {
        self.finish_all().remove(0)
    }

    fn finish_all(self) -> Vec<String> {
        self.handle.join().unwrap();
        self.requests.try_iter().collect()
    }
}

fn read_request(stream: &mut TcpStream) -> String {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut request = Vec::new();
    let mut buffer = [0_u8; 4096];

    loop {
        let bytes_read = stream.read(&mut buffer).unwrap();
        if bytes_read == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..bytes_read]);

        let Some(header_end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") else {
            continue;
        };
        let headers = String::from_utf8_lossy(&request[..header_end]);
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        if request.len() >= header_end + 4 + content_length {
            break;
        }
    }

    String::from_utf8(request).unwrap()
}

#[tokio::test]
async fn merge_pull_request_sends_method_and_reports_merge() {
    let server = MockServer::start(MockResponse {
        status: "200 OK",
        body: serde_json::json!({
            "sha": "6dcb09b5b57875f334f61aebed695e2e4193db5e",
            "merged": true,
            "message": "Pull Request successfully merged"
        })
        .to_string(),
    });
    let client = GithubOauthImpl::with_api_base_url(server.base_url.clone());

    let outcome = client
        .merge_pull_request("token", "macro", "app", 7, GithubMergeMethod::Squash)
        .await
        .unwrap();

    assert_eq!(
        outcome,
        GithubMergeOutcome::Merged(GithubPullRequestMerge {
            sha: "6dcb09b5b57875f334f61aebed695e2e4193db5e".to_string(),
            message: "Pull Request successfully merged".to_string(),
        })
    );
    let request = server.finish();
    assert!(request.starts_with("PUT /repos/macro/app/pulls/7/merge HTTP/1.1"));
    assert!(
        request
            .to_ascii_lowercase()
            .contains("authorization: bearer token")
    );
    assert!(request.ends_with(r#"{"merge_method":"squash"}"#));
}

#[tokio::test]
async fn merge_pull_request_reports_not_mergeable_with_github_message() {
    let server = MockServer::start(MockResponse {
        status: "405 Method Not Allowed",
        body: serde_json::json!({
            "message": "Required status check \"ci\" is expected.",
            "documentation_url": "https://docs.github.com"
        })
        .to_string(),
    });
    let client = GithubOauthImpl::with_api_base_url(server.base_url.clone());

    let outcome = client
        .merge_pull_request("token", "macro", "app", 7, GithubMergeMethod::Merge)
        .await
        .unwrap();

    assert_eq!(
        outcome,
        GithubMergeOutcome::Rejected {
            rejection: GithubMergeRejection::NotMergeable,
            message: "Required status check \"ci\" is expected.".to_string(),
        }
    );
    server.finish();
}

#[tokio::test]
async fn merge_pull_request_maps_head_change_and_access_statuses() {
    for (status, expected) in [
        ("409 Conflict", GithubMergeRejection::HeadChanged),
        ("404 Not Found", GithubMergeRejection::NotFound),
        ("403 Forbidden", GithubMergeRejection::Forbidden),
        ("422 Unprocessable Entity", GithubMergeRejection::Invalid),
    ] {
        let server = MockServer::start(MockResponse {
            status,
            body: serde_json::json!({ "message": "declined" }).to_string(),
        });
        let client = GithubOauthImpl::with_api_base_url(server.base_url.clone());

        let outcome = client
            .merge_pull_request("token", "macro", "app", 7, GithubMergeMethod::Merge)
            .await
            .unwrap();

        assert_eq!(
            outcome,
            GithubMergeOutcome::Rejected {
                rejection: expected,
                message: "declined".to_string(),
            },
            "status {status}"
        );
        server.finish();
    }
}

#[tokio::test]
async fn merge_pull_request_treats_unexpected_status_as_error() {
    let server = MockServer::start(MockResponse {
        status: "502 Bad Gateway",
        body: "upstream down".to_string(),
    });
    let client = GithubOauthImpl::with_api_base_url(server.base_url.clone());

    let error = client
        .merge_pull_request("token", "macro", "app", 7, GithubMergeMethod::Merge)
        .await
        .unwrap_err();

    assert!(error.to_string().contains("502"));
    server.finish();
}

#[tokio::test]
async fn get_repository_merge_settings_reads_allowed_methods() {
    let server = MockServer::start(MockResponse {
        status: "200 OK",
        body: serde_json::json!({
            "full_name": "macro/app",
            "allow_merge_commit": false,
            "allow_squash_merge": true,
            "allow_rebase_merge": false
        })
        .to_string(),
    });
    let client = GithubOauthImpl::with_api_base_url(server.base_url.clone());

    let settings = client
        .get_repository_merge_settings("token", "macro", "app")
        .await
        .unwrap();

    assert_eq!(
        settings,
        GithubRepositoryMergeSettings {
            allow_merge_commit: false,
            allow_squash_merge: true,
            allow_rebase_merge: false,
        }
    );
    assert_eq!(settings.default_method(), Some(GithubMergeMethod::Squash));
    let request = server.finish();
    assert!(request.starts_with("GET /repos/macro/app HTTP/1.1"));
}

#[tokio::test]
async fn get_repository_merge_settings_defaults_missing_fields_to_allowed() {
    let server = MockServer::start(MockResponse {
        status: "200 OK",
        body: serde_json::json!({ "full_name": "macro/app" }).to_string(),
    });
    let client = GithubOauthImpl::with_api_base_url(server.base_url.clone());

    let settings = client
        .get_repository_merge_settings("token", "macro", "app")
        .await
        .unwrap();

    assert_eq!(settings.default_method(), Some(GithubMergeMethod::Merge));
    server.finish();
}

fn graphql_body(request: &str) -> serde_json::Value {
    let body = request.split("\r\n\r\n").nth(1).unwrap();
    serde_json::from_str(body).unwrap()
}

#[tokio::test]
async fn set_pull_request_draft_converts_an_open_pull_request() {
    let server = MockServer::start_many(vec![
        MockResponse {
            status: "200 OK",
            body: serde_json::json!({
                "data": { "repository": { "pullRequest": { "id": "PR_node", "isDraft": false } } }
            })
            .to_string(),
        },
        MockResponse {
            status: "200 OK",
            body: serde_json::json!({
                "data": { "convertPullRequestToDraft": { "pullRequest": { "isDraft": true } } }
            })
            .to_string(),
        },
    ]);
    let client = GithubOauthImpl::with_api_base_url(server.base_url.clone());

    let outcome = client
        .set_pull_request_draft("token", "macro", "app", 7, true)
        .await
        .unwrap();

    assert_eq!(outcome, GithubDraftOutcome::Changed { draft: true });
    let requests = server.finish_all();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].starts_with("POST /graphql HTTP/1.1"));
    let lookup = graphql_body(&requests[0]);
    assert_eq!(
        lookup["variables"],
        serde_json::json!({ "owner": "macro", "repo": "app", "number": 7 })
    );
    let mutation = graphql_body(&requests[1]);
    assert!(
        mutation["query"]
            .as_str()
            .unwrap()
            .contains("convertPullRequestToDraft")
    );
    assert_eq!(
        mutation["variables"],
        serde_json::json!({ "id": "PR_node" })
    );
}

#[tokio::test]
async fn set_pull_request_draft_skips_the_mutation_when_already_in_state() {
    let server = MockServer::start(MockResponse {
        status: "200 OK",
        body: serde_json::json!({
            "data": { "repository": { "pullRequest": { "id": "PR_node", "isDraft": false } } }
        })
        .to_string(),
    });
    let client = GithubOauthImpl::with_api_base_url(server.base_url.clone());

    let outcome = client
        .set_pull_request_draft("token", "macro", "app", 7, false)
        .await
        .unwrap();

    assert_eq!(outcome, GithubDraftOutcome::Changed { draft: false });
    assert_eq!(server.finish_all().len(), 1);
}

#[tokio::test]
async fn set_pull_request_draft_reports_graphql_refusals() {
    let server = MockServer::start_many(vec![
        MockResponse {
            status: "200 OK",
            body: serde_json::json!({
                "data": { "repository": { "pullRequest": { "id": "PR_node", "isDraft": true } } }
            })
            .to_string(),
        },
        MockResponse {
            status: "200 OK",
            body: serde_json::json!({
                "data": { "markPullRequestReadyForReview": null },
                "errors": [{ "type": "FORBIDDEN", "message": "Resource not accessible" }]
            })
            .to_string(),
        },
    ]);
    let client = GithubOauthImpl::with_api_base_url(server.base_url.clone());

    let outcome = client
        .set_pull_request_draft("token", "macro", "app", 7, false)
        .await
        .unwrap();

    assert_eq!(
        outcome,
        GithubDraftOutcome::Rejected {
            rejection: GithubPullRequestUpdateRejection::Forbidden,
            message: "Resource not accessible".to_string(),
        }
    );
    let requests = server.finish_all();
    assert!(
        graphql_body(&requests[1])["query"]
            .as_str()
            .unwrap()
            .contains("markPullRequestReadyForReview")
    );
}

#[tokio::test]
async fn set_pull_request_draft_reports_a_missing_pull_request() {
    let server = MockServer::start(MockResponse {
        status: "200 OK",
        body: serde_json::json!({
            "data": { "repository": null },
            "errors": [{ "type": "NOT_FOUND", "message": "Could not resolve to a Repository" }]
        })
        .to_string(),
    });
    let client = GithubOauthImpl::with_api_base_url(server.base_url.clone());

    let outcome = client
        .set_pull_request_draft("token", "macro", "app", 7, true)
        .await
        .unwrap();

    assert_eq!(
        outcome,
        GithubDraftOutcome::Rejected {
            rejection: GithubPullRequestUpdateRejection::NotFound,
            message: "Could not resolve to a Repository".to_string(),
        }
    );
    server.finish();
}

#[tokio::test]
async fn get_pull_request_mergeability_batches_and_skips_hidden_pull_requests() {
    let server = MockServer::start(MockResponse {
        status: "200 OK",
        body: serde_json::json!({
            "data": {
                "p0": { "pullRequest": { "mergeable": "CONFLICTING" } },
                "p1": null,
                "p2": { "pullRequest": { "mergeable": "UNKNOWN" } }
            },
            "errors": [{ "type": "NOT_FOUND", "message": "Could not resolve to a Repository" }]
        })
        .to_string(),
    });
    let client = GithubOauthImpl::with_api_base_url(server.base_url.clone());
    let number = |repo: &str, number| GithubPullRequestNumber {
        owner: "macro".to_string(),
        repo: repo.to_string(),
        number,
    };

    let entries = client
        .get_pull_request_mergeability(
            "token",
            &[number("app", 7), number("secret", 1), number("app", 9)],
        )
        .await
        .unwrap();

    assert_eq!(
        entries,
        vec![
            GithubPullRequestMergeabilityEntry {
                owner: "macro".to_string(),
                repo: "app".to_string(),
                number: 7,
                mergeability: GithubPullRequestMergeability::Conflicting,
            },
            GithubPullRequestMergeabilityEntry {
                owner: "macro".to_string(),
                repo: "app".to_string(),
                number: 9,
                mergeability: GithubPullRequestMergeability::Unknown,
            },
        ]
    );
    let body = graphql_body(&server.finish());
    assert_eq!(body["variables"]["r1"], "secret");
    assert_eq!(body["variables"]["n2"], 9);
    assert!(body["query"].as_str().unwrap().contains("p2: repository"));
}
