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

impl MockResponse {
    fn json(body: serde_json::Value) -> Self {
        Self {
            status: "200 OK",
            body: body.to_string(),
        }
    }
}

struct MockServer {
    base_url: String,
    requests: Receiver<String>,
    handle: JoinHandle<()>,
}

impl MockServer {
    fn start(responses: Vec<MockResponse>) -> Self {
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

    fn finish(self) -> Vec<String> {
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
                    .then(|| value.trim().parse::<usize>().unwrap())
            })
            .unwrap_or(0);
        if request.len() >= header_end + 4 + content_length {
            break;
        }
    }

    String::from_utf8(request).unwrap()
}

#[tokio::test]
async fn exchanges_setup_code_for_access_token() {
    let server = MockServer::start(vec![MockResponse::json(serde_json::json!({
        "access_token": "returned-user-token",
        "token_type": "bearer",
        "scope": ""
    }))]);
    let client = GithubSyncClientImpl::with_api_base_url(server.base_url.clone());

    let token = client
        .exchange_setup_code("sync-client-id", "client-secret", "callback-code")
        .await
        .unwrap();

    assert_eq!(token.as_str(), "returned-user-token");
    let requests = server.finish();
    assert!(requests[0].starts_with("POST /login/oauth/access_token HTTP/1.1"));
    assert!(
        requests[0]
            .to_ascii_lowercase()
            .contains("accept: application/json")
    );
    assert!(requests[0].contains("\"client_id\":\"sync-client-id\""));
    assert!(requests[0].contains("\"client_secret\":\"client-secret\""));
    assert!(requests[0].contains("\"code\":\"callback-code\""));
}

#[tokio::test]
async fn rejects_unsuccessful_setup_code_exchange_without_leaking_secrets() {
    let server = MockServer::start(vec![MockResponse {
        status: "401 Unauthorized",
        body: "{\"error\":\"bad_verification_code\"}".to_string(),
    }]);
    let client = GithubSyncClientImpl::with_api_base_url(server.base_url.clone());

    let error = client
        .exchange_setup_code("sync-client-id", "very-secret", "sensitive-code")
        .await
        .err()
        .unwrap()
        .to_string();

    assert!(error.contains("401 Unauthorized"));
    assert!(!error.contains("very-secret"));
    assert!(!error.contains("sensitive-code"));
    server.finish();
}

#[tokio::test]
async fn finds_installation_on_a_later_page() {
    let first_page: Vec<_> = (1..=100)
        .map(|id| serde_json::json!({ "id": id }))
        .collect();
    let server = MockServer::start(vec![
        MockResponse::json(serde_json::json!({
            "total_count": 101,
            "installations": first_page
        })),
        MockResponse::json(serde_json::json!({
            "total_count": 101,
            "installations": [{ "id": 999 }]
        })),
    ]);
    let client = GithubSyncClientImpl::with_api_base_url(server.base_url.clone());

    let installations = client
        .list_user_installations("user-access-token")
        .await
        .unwrap();

    assert_eq!(installations.len(), 101);
    assert!(
        installations
            .iter()
            .any(|installation| installation.id == 999)
    );
    let requests = server.finish();
    assert!(requests[0].starts_with("GET /user/installations?per_page=100&page=1 HTTP/1.1"));
    assert!(requests[1].starts_with("GET /user/installations?per_page=100&page=2 HTTP/1.1"));
    for request in requests {
        let lowercase_request = request.to_ascii_lowercase();
        assert!(lowercase_request.contains("authorization: bearer user-access-token"));
        assert!(lowercase_request.contains("accept: application/vnd.github+json"));
        assert!(lowercase_request.contains("x-github-api-version: 2022-11-28"));
        assert!(lowercase_request.contains("user-agent: macro-auth-service"));
    }
}

#[tokio::test]
async fn rejects_unsuccessful_installation_list_without_leaking_token() {
    let server = MockServer::start(vec![MockResponse {
        status: "403 Forbidden",
        body: "{\"message\":\"forbidden\"}".to_string(),
    }]);
    let client = GithubSyncClientImpl::with_api_base_url(server.base_url.clone());

    let error = client
        .list_user_installations("sensitive-user-token")
        .await
        .unwrap_err()
        .to_string();

    assert!(error.contains("403 Forbidden"));
    assert!(!error.contains("sensitive-user-token"));
    server.finish();
}

#[tokio::test]
async fn rejects_malformed_later_pagination_response_without_leaking_token() {
    let server = MockServer::start(vec![
        MockResponse::json(serde_json::json!({
            "total_count": 2,
            "installations": [{ "id": 1 }]
        })),
        MockResponse {
            status: "200 OK",
            body: "not-json sensitive-user-token".to_string(),
        },
    ]);
    let client = GithubSyncClientImpl::with_api_base_url(server.base_url.clone());

    let error = client
        .list_user_installations("sensitive-user-token")
        .await
        .unwrap_err()
        .to_string();

    assert!(error.contains("malformed response"));
    assert!(!error.contains("sensitive-user-token"));
    assert_eq!(server.finish().len(), 2);
}
