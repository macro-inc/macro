use std::io::{Read, Write};

use super::*;

/// What the peer received, for assertions after the client returns.
struct CapturedRequest {
    head: String,
    body: Vec<u8>,
}

impl CapturedRequest {
    fn header(&self, name: &str) -> Option<String> {
        self.head.lines().find_map(|line| {
            let (header_name, value) = line.split_once(':')?;
            header_name
                .eq_ignore_ascii_case(name)
                .then(|| value.trim().to_string())
        })
    }
}

/// A one-request HTTP peer answering `status` with `response_head_extra`
/// headers and `response_body`. Joining the handle yields the request it read.
fn peer(
    status: u16,
    response_head_extra: &'static str,
    response_body: &'static str,
) -> (String, std::thread::JoinHandle<CapturedRequest>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let handle = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0; 4096];
        let head_end = loop {
            let count = socket.read(&mut buffer).unwrap();
            assert_ne!(count, 0, "client closed before sending its head");
            bytes.extend_from_slice(&buffer[..count]);
            if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                break position;
            }
        };
        let head = String::from_utf8(bytes[..head_end].to_vec()).unwrap();
        let captured = CapturedRequest {
            head: head.clone(),
            body: Vec::new(),
        };
        let content_length = captured
            .header("content-length")
            .map_or(0, |length| length.parse::<usize>().unwrap());
        while bytes.len() < head_end + 4 + content_length {
            let count = socket.read(&mut buffer).unwrap();
            assert_ne!(count, 0, "client closed before sending its body");
            bytes.extend_from_slice(&buffer[..count]);
        }
        let content_length_header = if response_head_extra.contains("Content-Length") {
            String::new()
        } else {
            format!("Content-Length: {}\r\n", response_body.len())
        };
        write!(
            socket,
            "HTTP/1.1 {status} Status\r\nContent-Type: application/json\r\n{content_length_header}{response_head_extra}Connection: close\r\n\r\n{response_body}"
        )
        .unwrap();
        CapturedRequest {
            head,
            body: bytes[head_end + 4..head_end + 4 + content_length].to_vec(),
        }
    });
    (format!("http://{address}"), handle)
}

fn token() -> DocumentPermissionToken {
    DocumentPermissionToken::from("header.claims.signature".to_string())
}

#[tokio::test]
async fn state_reads_a_snapshot_with_the_signed_grant() {
    let (url, handle) = peer(200, "", r#"{"snapshot":"AQID","revision":"BAU="}"#);
    let client = SyncServiceClient::new("internal-key".to_string(), url);

    let state = client
        .document_state("0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90", &token())
        .await
        .unwrap();

    assert_eq!(
        state,
        DocumentState {
            snapshot: vec![1, 2, 3],
            revision: vec![4, 5],
        }
    );
    let request = handle.join().unwrap();
    assert!(
        request.head.starts_with(
            "GET /document/0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90/state?shallow=true HTTP/1.1"
        ),
        "{}",
        request.head
    );
    assert_eq!(
        request.header("authorization").as_deref(),
        Some("Bearer header.claims.signature")
    );
    assert!(request.body.is_empty());
}

#[tokio::test]
async fn update_posts_base64_bytes_and_reads_the_new_revision() {
    let (url, handle) = peer(200, "", r#"{"revision":"CQ==","applied":true}"#);
    let client = SyncServiceClient::new("internal-key".to_string(), url);

    let outcome = client
        .update_document(
            "0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90",
            &token(),
            &[4, 5],
            &[6, 7, 8],
        )
        .await
        .unwrap();

    assert_eq!(outcome, DocumentUpdate::Applied { revision: vec![9] });
    let request = handle.join().unwrap();
    assert!(
        request
            .head
            .starts_with("POST /document/0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90/update HTTP/1.1"),
        "{}",
        request.head
    );
    assert_eq!(
        request.header("authorization").as_deref(),
        Some("Bearer header.claims.signature")
    );
    assert_eq!(
        request.header("content-type").as_deref(),
        Some("application/json")
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&request.body).unwrap(),
        serde_json::json!({"expectedRevision": "BAU=", "update": "BgcI"})
    );
}

#[tokio::test]
async fn an_update_already_applied_reports_the_current_revision() {
    let (url, handle) = peer(200, "", r#"{"revision":"CQ==","applied":false}"#);
    let client = SyncServiceClient::new("internal-key".to_string(), url);

    let outcome = client
        .update_document(
            "0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90",
            &token(),
            &[4, 5],
            &[6, 7, 8],
        )
        .await
        .unwrap();

    assert_eq!(outcome, DocumentUpdate::Applied { revision: vec![9] });
    handle.join().unwrap();
}

#[tokio::test]
async fn a_stale_revision_is_a_conflict_not_an_error() {
    let (url, handle) = peer(
        409,
        "",
        r#"{"error":"The document changed. Read a fresh snapshot before editing."}"#,
    );
    let client = SyncServiceClient::new("internal-key".to_string(), url);

    let outcome = client
        .update_document(
            "0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90",
            &token(),
            &[4, 5],
            &[6, 7, 8],
        )
        .await
        .unwrap();

    assert_eq!(outcome, DocumentUpdate::Conflict);
    handle.join().unwrap();
}

#[tokio::test]
async fn rejections_are_typed_by_status() {
    for (status, expected) in [
        (400, "Invalid"),
        (401, "Unauthorized"),
        (403, "Forbidden"),
        (404, "NotFound"),
        (413, "TooLarge"),
        (503, "Rejected(503)"),
    ] {
        let (url, handle) = peer(status, "", r#"{"error":"refused"}"#);
        let client = SyncServiceClient::new("internal-key".to_string(), url);

        let error = client
            .document_state("0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90", &token())
            .await
            .unwrap_err();

        let kind = match error {
            DocumentStateError::Invalid => "Invalid".to_string(),
            DocumentStateError::Unauthorized => "Unauthorized".to_string(),
            DocumentStateError::Forbidden => "Forbidden".to_string(),
            DocumentStateError::NotFound => "NotFound".to_string(),
            DocumentStateError::TooLarge => "TooLarge".to_string(),
            DocumentStateError::Rejected(status) => format!("Rejected({})", status.as_u16()),
            other => format!("unexpected {other}"),
        };
        assert_eq!(kind, expected);
        handle.join().unwrap();
    }
}

#[tokio::test]
async fn a_conflict_reading_state_is_a_rejection() {
    let (url, handle) = peer(409, "", r#"{"error":"conflict"}"#);
    let client = SyncServiceClient::new("internal-key".to_string(), url);

    let error = client
        .document_state("0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90", &token())
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        DocumentStateError::Rejected(StatusCode::CONFLICT)
    ));
    handle.join().unwrap();
}

#[tokio::test]
async fn an_oversized_update_is_refused_before_any_request() {
    // Nothing listens here; a request would surface as a transport error.
    let client = SyncServiceClient::new("internal-key".to_string(), "http://127.0.0.1:9".into());

    let oversized_update = client
        .update_document(
            "0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90",
            &token(),
            &[4, 5],
            &vec![0; 4 * 1024 * 1024 + 1],
        )
        .await
        .unwrap_err();
    let oversized_revision = client
        .update_document(
            "0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90",
            &token(),
            &vec![0; 64 * 1024 + 1],
            &[6, 7, 8],
        )
        .await
        .unwrap_err();

    assert!(matches!(oversized_update, DocumentStateError::TooLarge));
    assert!(matches!(oversized_revision, DocumentStateError::TooLarge));
}

#[tokio::test]
async fn an_oversized_response_is_refused_unread() {
    let (url, handle) = peer(200, "Content-Length: 99999999\r\n", "{}");
    let client = SyncServiceClient::new("internal-key".to_string(), url);

    let error = client
        .document_state("0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90", &token())
        .await
        .unwrap_err();

    assert!(matches!(error, DocumentStateError::TooLarge), "{error}");
    handle.join().unwrap();
}

#[tokio::test]
async fn a_malformed_state_response_is_invalid() {
    let (url, handle) = peer(200, "", r#"{"snapshot":"not base64!","revision":"BAU="}"#);
    let client = SyncServiceClient::new("internal-key".to_string(), url);

    let error = client
        .document_state("0199b4a2-7c1e-7d3a-9f2b-4c5d6e7f8a90", &token())
        .await
        .unwrap_err();

    assert!(
        matches!(error, DocumentStateError::InvalidResponse(_)),
        "{error}"
    );
    handle.join().unwrap();
}

#[test]
fn state_debug_output_carries_lengths_not_bytes() {
    let state = DocumentState {
        snapshot: vec![104, 105],
        revision: vec![4, 5],
    };

    assert_eq!(
        format!("{state:?}"),
        "DocumentState { snapshot_len: 2, revision_len: 2 }"
    );
}
