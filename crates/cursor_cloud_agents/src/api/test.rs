//! Tests for client construction and, above all, for the key never being
//! printable.

use super::*;

const KEY: &str = "crsr_secret_do_not_print_me";

fn config() -> CursorConfig {
    CursorConfig {
        api_key: ApiKey::new(KEY),
        base_url: "https://api.cursor.test".to_owned(),
        model: None,
        starting_ref: "main".to_owned(),
        record_dir: None,
    }
}

/// The config derives `Debug`, so anything that logs it — `?config` on a
/// tracing event, a `{:?}` in an error path — used to write a live credential
/// to the user's log file.
#[test]
fn debug_output_never_contains_the_key() {
    let config = config();
    let printed = format!("{config:?}");
    assert!(
        !printed.contains(KEY),
        "the plaintext key must not appear in {printed}"
    );
    assert!(!printed.contains("secret_do_not_print_me"));

    let client = CursorClient::new(config).expect("a shape-valid key builds a client");
    let printed = format!("{client:?}");
    assert!(
        !printed.contains(KEY),
        "the plaintext key must not appear in {printed}"
    );
    assert!(!printed.contains("secret_do_not_print_me"));
}

/// The key still has to reach the Basic-auth header intact.
#[test]
fn the_key_is_still_readable_where_it_is_used() {
    assert_eq!(ApiKey::new(KEY).expose(), KEY);
}

/// Keys pasted into JSON `env` blocks arrive quoted or newline-terminated;
/// the API rejects those as *invalid* keys rather than malformed headers.
#[test]
fn surrounding_quotes_and_whitespace_are_trimmed() {
    assert_eq!(ApiKey::new("  \"crsr_abc\"\n").expose(), "crsr_abc");
    assert_eq!(ApiKey::new("'crsr_abc'").expose(), "crsr_abc");
}

/// A placeholder must fail at startup with something recognizable, which is
/// why the error deliberately reports a length and a short prefix.
#[test]
fn a_placeholder_key_is_rejected_with_a_diagnostic() {
    let error = CursorClient::new(CursorConfig {
        api_key: ApiKey::new("..."),
        ..config()
    })
    .expect_err("a placeholder is not a key");
    assert!(matches!(
        error,
        CursorClientError::MalformedKey { length: 3, .. }
    ));
}

/// A stand-in for `api.cursor.com` that answers one request with a scripted
/// status and body, then closes. Enough to exercise how a create-agent
/// failure is classified without a mock-HTTP dependency.
fn stand_in_server(status_line: &str, body: &'static str) -> String {
    stand_in_server_capturing(status_line, body).0
}

/// [`stand_in_server`] that also hands back the request it was sent, for the
/// tests that are about what went out rather than what came back — a
/// percent-encoded query string, or an `Authorization` header that must not
/// be there at all.
fn stand_in_server_capturing(
    status_line: &str,
    body: &'static str,
) -> (String, std::sync::mpsc::Receiver<String>) {
    stand_in_server_sequence(vec![(status_line.to_owned(), body)])
}

/// A stand-in that answers one request per scripted response, in order, then
/// stops listening. Each connection is closed after its answer, so a client
/// that retries has to reconnect — the same as it would against Cursor.
fn stand_in_server_sequence(
    responses: Vec<(String, &'static str)>,
) -> (String, std::sync::mpsc::Receiver<String>) {
    let (sender, receiver) = std::sync::mpsc::channel();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a loopback port");
    let base_url = format!("http://{}", listener.local_addr().expect("a bound address"));
    std::thread::spawn(move || {
        use std::io::{Read as _, Write as _};
        for (status_line, body) in responses {
            let response = format!(
                "HTTP/1.1 {status_line}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            let (mut socket, _) = listener.accept().expect("the client connects");
            // Drain the request before answering: a peer that never reads the
            // body can leave the client seeing a reset instead of the response.
            let mut request = Vec::new();
            let mut chunk = [0_u8; 4096];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                match socket.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => request.extend_from_slice(&chunk[..read]),
                }
            }
            let headers = String::from_utf8_lossy(&request).to_lowercase();
            let content_length = headers
                .split("content-length:")
                .nth(1)
                .and_then(|rest| rest.split("\r\n").next())
                .and_then(|value| value.trim().parse::<usize>().ok())
                .unwrap_or(0);
            let already_read = request
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .map_or(0, |end| request.len() - (end + 4));
            let mut remaining = content_length.saturating_sub(already_read);
            while remaining > 0 {
                match socket.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => remaining = remaining.saturating_sub(read),
                }
            }
            let _ = sender.send(String::from_utf8_lossy(&request).into_owned());
            let _ = socket.write_all(response.as_bytes());
            let _ = socket.flush();
        }
    });
    (base_url, receiver)
}

/// The body Cursor answered a real create with, for a `main` that existed.
const BRANCH_UNVERIFIABLE_BODY: &str = r#"{"error":{"code":"validation_error","message":"Failed to verify existence of branch 'main' in repository macro-inc/macro. Please ensure the branch name is correct."}}"#;

const CREATED_BODY: &str = r#"{"agent":{"id":"bc-00000000-0000-0000-0000-000000000001","url":"https://cursor.com/agents/bc-00000000-0000-0000-0000-000000000001"},"run":{"id":"run-00000000-0000-0000-0000-000000000001"}}"#;

/// A client whose retry schedule does not sleep, so the retry path runs in
/// test time rather than the production seven seconds.
fn client_with_instant_retries(base_url: String, retries: usize) -> CursorClient {
    client_against(base_url).with_branch_retry_backoff(vec![std::time::Duration::ZERO; retries])
}

fn client_against(base_url: String) -> CursorClient {
    CursorClient::new(CursorConfig {
        base_url,
        ..config()
    })
    .expect("a shape-valid key builds a client")
}

fn repo() -> RepoUrl {
    RepoUrl::parse("https://github.com/macro-inc/macro").expect("an https remote")
}

/// The one rejection a person can act on has to arrive typed, carrying the
/// repository, or the adapter above has nothing to name in its message.
#[tokio::test]
async fn a_repository_rejection_is_typed_with_the_repository() {
    let base_url = stand_in_server(
        "400 Bad Request",
        r#"{"error":{"code":"repository_access","message":"Repository not accessible"}}"#,
    );
    let error = client_against(base_url)
        .create_agent("prompt", Some(&repo()), true, &[], None)
        .await
        .expect_err("the stand-in rejects every create");
    let unavailable = error
        .downcast_current_context::<crate::domain::error::RepositoryUnavailable>()
        .expect("a repository rejection is typed as one");
    assert_eq!(unavailable.repo, repo());
    assert_eq!(
        unavailable.reason,
        crate::domain::error::RepositoryRejection::Inaccessible
    );
    assert!(
        unavailable.detail.contains("repository_access"),
        "cursor's own body is kept for the logs: {}",
        unavailable.detail
    );
    assert!(
        unavailable
            .user_message()
            .contains("Connect the repository"),
        "got {}",
        unavailable.user_message()
    );
}

/// Cursor's branch check flakes for refs that exist, and a 400 proves no
/// agent was minted, so the create is simply asked again — and the caller
/// sees only the eventual success.
#[tokio::test]
async fn a_branch_cursor_could_not_verify_is_retried() {
    let (base_url, requests) = stand_in_server_sequence(vec![
        ("400 Bad Request".to_owned(), BRANCH_UNVERIFIABLE_BODY),
        ("400 Bad Request".to_owned(), BRANCH_UNVERIFIABLE_BODY),
        ("200 OK".to_owned(), CREATED_BODY),
    ]);
    let (agent, run) = client_with_instant_retries(base_url, 2)
        .create_agent("prompt", Some(&repo()), true, &[], None)
        .await
        .expect("the third answer is a created agent");
    assert_eq!(agent.as_str(), "bc-00000000-0000-0000-0000-000000000001");
    assert_eq!(run.as_str(), "run-00000000-0000-0000-0000-000000000001");

    let sent: Vec<String> = requests.try_iter().collect();
    assert_eq!(sent.len(), 3, "one request per scripted answer");
    for request in &sent {
        assert!(
            request.contains(r#""startingRef":"main""#),
            "every attempt asks for the same ref: {request}"
        );
    }
}

/// Once the budget is spent the rejection is still typed as a repository
/// problem — and names the branch, so the message does not read like a
/// generic internal error — rather than the raw report.
#[tokio::test]
async fn a_branch_still_unverifiable_after_retrying_is_typed_with_the_branch() {
    let (base_url, requests) = stand_in_server_sequence(vec![
        ("400 Bad Request".to_owned(), BRANCH_UNVERIFIABLE_BODY),
        ("400 Bad Request".to_owned(), BRANCH_UNVERIFIABLE_BODY),
    ]);
    let error = client_with_instant_retries(base_url, 1)
        .create_agent("prompt", Some(&repo()), true, &[], None)
        .await
        .expect_err("the stand-in never relents");
    let unavailable = error
        .downcast_current_context::<crate::domain::error::RepositoryUnavailable>()
        .expect("an exhausted branch retry is a repository rejection");
    assert_eq!(unavailable.repo, repo());
    assert_eq!(
        unavailable.reason,
        crate::domain::error::RepositoryRejection::BranchUnverifiable {
            starting_ref: "main".to_owned(),
        }
    );
    let message = unavailable.user_message();
    assert!(message.contains("'main'"), "names the ref: {message}");
    assert!(
        message.contains("macro-inc/macro"),
        "names the repo: {message}"
    );
    assert!(
        !message.contains("Bad Request") && !message.contains("api.rs"),
        "no transport or source decorations reach the user: {message}"
    );
    assert_eq!(requests.try_iter().count(), 2, "one retry, then give up");
}

/// The retry exists for one wording only. A `validation_error` about anything
/// else is not asked again — a malformed model id will not fix itself.
#[tokio::test]
async fn other_validation_errors_are_not_retried() {
    let (base_url, requests) = stand_in_server_sequence(vec![(
        "400 Bad Request".to_owned(),
        r#"{"error":{"code":"validation_error","message":"Model 'nope' does not match a known variant"}}"#,
    )]);
    let error = client_with_instant_retries(base_url, 2)
        .create_agent("prompt", Some(&repo()), true, &[], None)
        .await
        .expect_err("the stand-in rejects the create");
    assert!(
        error
            .downcast_current_context::<crate::domain::error::PromptRejected>()
            .is_some(),
        "still a plain rejection"
    );
    assert_eq!(requests.try_iter().count(), 1, "asked exactly once");
}

/// Every other 4xx must keep behaving exactly as it did — a generic
/// rejection — so a new Cursor error code is never sold to the user as a
/// repository they need to go connect.
#[tokio::test]
async fn an_unrelated_client_error_is_still_a_plain_rejection() {
    let base_url = stand_in_server(
        "400 Bad Request",
        r#"{"error":{"code":"validation_error","message":"Model 'nope' does not match a known variant"}}"#,
    );
    let error = client_against(base_url)
        .create_agent("prompt", Some(&repo()), true, &[], None)
        .await
        .expect_err("the stand-in rejects every create");
    assert!(
        error
            .downcast_current_context::<crate::domain::error::RepositoryUnavailable>()
            .is_none(),
        "an unrecognized code is not a repository problem"
    );
    let rejected = error
        .downcast_current_context::<crate::domain::error::PromptRejected>()
        .expect("a 4xx is still a definite rejection");
    assert!(
        rejected.0.contains("validation_error"),
        "the raw body still travels: {}",
        rejected.0
    );
}

fn agent() -> CursorAgentId {
    CursorAgentId::new("bc-00000000-0000-0000-0000-000000000001".to_owned())
}

/// The documented listing body reads, and an extra field Cursor may add
/// later does not break it.
#[tokio::test]
async fn artifact_listings_read_the_documented_body() {
    let base_url = stand_in_server(
        "200 OK",
        r#"{"items":[{"path":"artifacts/mobile_selection_menu_format_option.png","sizeBytes":12345,"updatedAt":"2026-04-13T18:45:00.000Z","contentType":"image/png"}]}"#,
    );
    let listing = client_against(base_url)
        .list_artifacts(&agent())
        .await
        .expect("the documented body parses");
    assert_eq!(listing.items.len(), 1);
    assert_eq!(
        listing.items[0].path,
        "artifacts/mobile_selection_menu_format_option.png"
    );
    assert_eq!(listing.items[0].size_bytes, 12345);
    assert_eq!(listing.items[0].updated_at, "2026-04-13T18:45:00.000Z");
}

/// An agent that has written nothing is the ordinary case for most sessions,
/// so an empty list must be a clean empty answer, not a parse failure.
#[tokio::test]
async fn an_agent_with_no_artifacts_lists_nothing() {
    let base_url = stand_in_server("200 OK", r#"{"items":[]}"#);
    let listing = client_against(base_url)
        .list_artifacts(&agent())
        .await
        .expect("an empty page parses");
    assert!(listing.items.is_empty());
}

/// The artifact path travels as a percent-encoded query parameter. Spelled
/// into the path by hand, a name with a space or a `#` would arrive
/// truncated or as a different file.
#[tokio::test]
async fn the_download_request_percent_encodes_the_artifact_path() {
    let (base_url, requests) = stand_in_server_capturing(
        "200 OK",
        r#"{"url":"https://cloud-agent-artifacts.s3.us-east-1.amazonaws.com/x?sig=1","expiresAt":"2026-04-13T19:00:00.000Z"}"#,
    );
    let download = client_against(base_url)
        .artifact_download_url(&agent(), "artifacts/walkthrough one.mp4")
        .await
        .expect("the documented body parses");
    assert!(
        download
            .url
            .starts_with("https://cloud-agent-artifacts.s3."),
        "got {}",
        download.url
    );
    assert_eq!(download.expires_at, "2026-04-13T19:00:00.000Z");

    let request = requests.recv().expect("the stand-in saw the request");
    let request_line = request.lines().next().expect("a request line");
    assert!(
        request_line.contains("path=artifacts%2Fwalkthrough%20one.mp4"),
        "got {request_line}"
    );
}

/// The presigned url authenticates itself in its query string, and it points
/// at S3 rather than Cursor. Attaching our API key to it would hand a live
/// credential to a third-party host.
#[tokio::test]
async fn fetching_an_artifact_sends_no_api_key() {
    let (base_url, requests) = stand_in_server_capturing("200 OK", "bytes");
    let response = client_against(config().base_url)
        .fetch_artifact(&format!("{base_url}/artifacts/screenshot.png?sig=1"))
        .await
        .expect("the stand-in serves the bytes");
    assert!(response.status().is_success());

    let request = requests.recv().expect("the stand-in saw the request");
    assert!(
        !request.to_lowercase().contains("authorization:"),
        "the presigned fetch must be unauthenticated: {request}"
    );
}

/// A presigned url outlives its usefulness after fifteen minutes, and S3
/// answers a stale one with a 403. The status has to survive into the report,
/// since that is what tells an expiry apart from a genuinely missing file.
#[tokio::test]
async fn an_expired_presigned_url_fails_with_its_status() {
    let (base_url, _requests) = stand_in_server_capturing(
        "403 Forbidden",
        "<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>",
    );
    let error = client_against(config().base_url)
        .fetch_artifact(&format!("{base_url}/artifacts/screenshot.png?sig=stale"))
        .await
        .expect_err("a 403 is not bytes");
    let printed = format!("{error}");
    assert!(printed.contains("403"), "got {printed}");
    assert!(printed.contains("Request has expired"), "got {printed}");
}
