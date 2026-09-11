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
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a loopback port");
    let base_url = format!("http://{}", listener.local_addr().expect("a bound address"));
    let response = format!(
        "HTTP/1.1 {status_line}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    std::thread::spawn(move || {
        use std::io::{Read as _, Write as _};
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
        let _ = socket.write_all(response.as_bytes());
        let _ = socket.flush();
    });
    base_url
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
    assert!(
        unavailable.detail.contains("repository_access"),
        "cursor's own body is kept for the logs: {}",
        unavailable.detail
    );
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
