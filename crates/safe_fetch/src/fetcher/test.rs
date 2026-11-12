//! Fetches against a local TCP server. DNS answers come from fake lookups, so
//! names like `rebind.test` resolve to whatever the attack needs; only
//! 127.0.0.1 is permitted, standing in for "a public address".

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::future::BoxFuture;
use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderValue};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::*;
use crate::address::AddressPolicy;
use crate::policy::{AcceptedMediaTypes, AllowedPorts, AllowedSchemes};

/// What the test server does with one connection.
enum Reply {
    /// Write this response and close.
    Complete(String),
    /// Write this much and then hold the connection open, sending nothing.
    Stall(String),
    /// Write this much and then one body byte every 10 ms, forever.
    Trickle(String),
}

struct TestServer {
    port: u16,
    /// Each request's head, in arrival order.
    requests: Arc<Mutex<Vec<String>>>,
}

/// Serve the replies `replies_for(port)` builds, in order, one per
/// connection. The port is passed in so a reply can redirect back to it.
async fn serve(replies_for: impl FnOnce(u16) -> Vec<Reply>) -> TestServer {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let replies = replies_for(port);
    let requests = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&requests);

    tokio::spawn(async move {
        for reply in replies {
            let (mut stream, _) = listener.accept().await.unwrap();

            let mut head = Vec::new();
            let mut byte = [0u8; 1];
            while !head.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).await.unwrap();
                head.push(byte[0]);
            }
            recorded
                .lock()
                .unwrap()
                .push(String::from_utf8(head).unwrap());

            match reply {
                Reply::Complete(response) => {
                    stream.write_all(response.as_bytes()).await.unwrap();
                    stream.shutdown().await.unwrap();
                }
                Reply::Stall(response) => {
                    stream.write_all(response.as_bytes()).await.unwrap();
                    tokio::spawn(async move {
                        let _held_open = stream;
                        std::future::pending::<()>().await;
                    });
                }
                Reply::Trickle(response) => {
                    stream.write_all(response.as_bytes()).await.unwrap();
                    tokio::spawn(async move {
                        let mut ticks = tokio::time::interval(Duration::from_millis(10));
                        loop {
                            ticks.tick().await;
                            if stream.write_all(b"x").await.is_err() {
                                return;
                            }
                        }
                    });
                }
            }
        }
    });

    TestServer { port, requests }
}

/// Answers each name from a fixed table.
struct FixedLookup(HashMap<&'static str, Vec<IpAddr>>);

impl HostLookup for FixedLookup {
    fn lookup(&self, host: &str) -> BoxFuture<'static, std::io::Result<Vec<IpAddr>>> {
        let answer = self.0.get(host).cloned().unwrap_or_default();
        Box::pin(async move { Ok(answer) })
    }
}

/// Gives a different answer on each lookup, like an attacker's DNS server
/// with a zero TTL.
struct ChangingLookup(Mutex<VecDeque<Vec<IpAddr>>>);

impl HostLookup for ChangingLookup {
    fn lookup(&self, _host: &str) -> BoxFuture<'static, std::io::Result<Vec<IpAddr>>> {
        let answer = self.0.lock().unwrap().pop_front().unwrap_or_default();
        Box::pin(async move { Ok(answer) })
    }
}

fn test_policy() -> FetchPolicy {
    FetchPolicy {
        schemes: AllowedSchemes::HttpAndHttps,
        ports: AllowedPorts::Any,
        addresses: AddressPolicy {
            private_networks_allowed: vec!["127.0.0.1/32".parse().unwrap()],
        },
        max_redirects: 3,
        connect_timeout: Duration::from_secs(5),
        total_timeout: Duration::from_secs(5),
        body_idle_timeout: Duration::from_secs(1),
        max_body_bytes: 1024,
        media_types: AcceptedMediaTypes::raster_images(),
    }
}

const PNG_RESPONSE: &str = "HTTP/1.1 200 OK\r\ncontent-type: image/png\r\ncontent-length: 4\r\nconnection: close\r\n\r\nPNG!";

#[tokio::test]
async fn fetches_a_public_image() {
    let server = serve(|_port| vec![Reply::Complete(PNG_RESPONSE.to_owned())]).await;
    let lookup = FixedLookup(HashMap::from([(
        "images.test",
        vec!["127.0.0.1".parse().unwrap()],
    )]));
    let fetcher = SafeFetcher::with_lookup(test_policy(), lookup).unwrap();

    let response = fetcher
        .get(
            &format!("http://images.test:{}/a.png", server.port),
            HeaderMap::new(),
        )
        .await
        .unwrap();

    assert_eq!(response.media_type.as_str(), "image/png");
    assert_eq!(response.body.collect().await.unwrap().as_ref(), b"PNG!");
}

#[tokio::test]
async fn dns_rebinding_to_an_internal_address_is_refused() {
    // The first lookup answers the permitted address, the second an internal
    // one. Each connection is checked on its own lookup, so the second fetch
    // is refused instead of reaching 10.0.0.5.
    let server = serve(|_port| vec![Reply::Complete(PNG_RESPONSE.to_owned())]).await;
    let lookup = ChangingLookup(Mutex::new(VecDeque::from([
        vec!["127.0.0.1".parse().unwrap()],
        vec!["10.0.0.5".parse().unwrap()],
    ])));
    let fetcher = SafeFetcher::with_lookup(test_policy(), lookup).unwrap();
    let url = format!("http://rebind.test:{}/a.png", server.port);

    let first = fetcher.get(&url, HeaderMap::new()).await;
    let second = fetcher.get(&url, HeaderMap::new()).await;

    assert!(first.is_ok());
    assert!(matches!(
        second,
        Err(FetchError::AddressNotAllowed { address }) if address == "10.0.0.5".parse::<IpAddr>().unwrap()
    ));
}

#[tokio::test]
async fn an_answer_mixing_public_and_internal_addresses_is_refused() {
    let lookup = FixedLookup(HashMap::from([(
        "mixed.test",
        vec![
            "127.0.0.1".parse().unwrap(),
            "169.254.169.254".parse().unwrap(),
        ],
    )]));
    let fetcher = SafeFetcher::with_lookup(test_policy(), lookup).unwrap();

    let result = fetcher
        .get("http://mixed.test/a.png", HeaderMap::new())
        .await;

    assert!(matches!(result, Err(FetchError::AddressNotAllowed { .. })));
}

#[tokio::test]
async fn internal_ip_literals_are_refused_in_every_spelling() {
    let fetcher = SafeFetcher::with_lookup(test_policy(), FixedLookup(HashMap::new())).unwrap();

    for url in [
        "http://169.254.169.254/latest/meta-data/",
        "http://127.0.0.2/",
        "http://0x7f.0.0.2/",
        "http://2130706434/",
        "http://[::ffff:169.254.169.254]/",
        "http://[fd00:ec2::254]/",
        "http://0.0.0.0/",
    ] {
        let result = fetcher.get(url, HeaderMap::new()).await;
        assert!(
            matches!(result, Err(FetchError::AddressNotAllowed { .. })),
            "{url}: {result:?}"
        );
    }
}

#[tokio::test]
async fn a_redirect_to_the_metadata_endpoint_is_refused() {
    let server = serve(|_port| vec![Reply::Complete(
        "HTTP/1.1 302 Found\r\nlocation: http://169.254.169.254/latest/meta-data/\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
            .to_owned(),
    )])
    .await;
    let lookup = FixedLookup(HashMap::from([(
        "images.test",
        vec!["127.0.0.1".parse().unwrap()],
    )]));
    let fetcher = SafeFetcher::with_lookup(test_policy(), lookup).unwrap();

    let result = fetcher
        .get(
            &format!("http://images.test:{}/a.png", server.port),
            HeaderMap::new(),
        )
        .await;

    assert!(matches!(result, Err(FetchError::AddressNotAllowed { .. })));
}

#[tokio::test]
async fn a_redirect_to_a_name_resolving_internally_is_refused() {
    let server = serve(|_port| vec![Reply::Complete(
        "HTTP/1.1 307 Temporary Redirect\r\nlocation: http://internal.test/admin\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
            .to_owned(),
    )])
    .await;
    let lookup = FixedLookup(HashMap::from([
        ("images.test", vec!["127.0.0.1".parse().unwrap()]),
        ("internal.test", vec!["10.1.2.3".parse().unwrap()]),
    ]));
    let fetcher = SafeFetcher::with_lookup(test_policy(), lookup).unwrap();

    let result = fetcher
        .get(
            &format!("http://images.test:{}/a.png", server.port),
            HeaderMap::new(),
        )
        .await;

    assert!(matches!(result, Err(FetchError::AddressNotAllowed { .. })));
}

#[tokio::test]
async fn a_redirect_to_another_scheme_is_refused() {
    let server = serve(|_port| vec![Reply::Complete(
        "HTTP/1.1 302 Found\r\nlocation: file:///etc/passwd\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
            .to_owned(),
    )])
    .await;
    let lookup = FixedLookup(HashMap::from([(
        "images.test",
        vec!["127.0.0.1".parse().unwrap()],
    )]));
    let fetcher = SafeFetcher::with_lookup(test_policy(), lookup).unwrap();

    let result = fetcher
        .get(
            &format!("http://images.test:{}/a.png", server.port),
            HeaderMap::new(),
        )
        .await;

    assert!(matches!(result, Err(FetchError::SchemeNotAllowed { .. })));
}

#[tokio::test]
async fn redirects_stop_at_the_hop_limit() {
    let redirect =
        "HTTP/1.1 302 Found\r\nlocation: /again\r\ncontent-length: 0\r\nconnection: close\r\n\r\n";
    let server = serve(|_port| {
        vec![
            Reply::Complete(redirect.to_owned()),
            Reply::Complete(redirect.to_owned()),
            Reply::Complete(redirect.to_owned()),
            Reply::Complete(redirect.to_owned()),
        ]
    })
    .await;
    let lookup = FixedLookup(HashMap::from([(
        "loop.test",
        vec!["127.0.0.1".parse().unwrap()],
    )]));
    let fetcher = SafeFetcher::with_lookup(test_policy(), lookup).unwrap();

    let result = fetcher
        .get(
            &format!("http://loop.test:{}/", server.port),
            HeaderMap::new(),
        )
        .await;

    assert!(matches!(
        result,
        Err(FetchError::TooManyRedirects { limit: 3 })
    ));
    assert_eq!(server.requests.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn a_cross_origin_redirect_does_not_carry_caller_headers() {
    // Both names reach the same server, but they are different origins, so
    // the credential sent to the first must not reach the second.
    let server = serve(|port| vec![
        Reply::Complete(format!(
            "HTTP/1.1 302 Found\r\nlocation: http://other.test:{port}/a.png\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
        )),
        Reply::Complete(PNG_RESPONSE.to_owned()),
    ])
    .await;
    let lookup = FixedLookup(HashMap::from([
        ("first.test", vec!["127.0.0.1".parse().unwrap()]),
        ("other.test", vec!["127.0.0.1".parse().unwrap()]),
    ]));
    let fetcher = SafeFetcher::with_lookup(test_policy(), lookup).unwrap();
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer secret"));

    let _ = fetcher
        .get(&format!("http://first.test:{}/a.png", server.port), headers)
        .await;

    let requests = server.requests.lock().unwrap();
    assert!(
        requests[0]
            .to_ascii_lowercase()
            .contains("authorization: bearer secret")
    );
    assert!(!requests[1].to_ascii_lowercase().contains("authorization"));
}

#[tokio::test]
async fn non_default_ports_are_refused_when_the_policy_says_so() {
    let fetcher = SafeFetcher::with_lookup(
        FetchPolicy {
            ports: AllowedPorts::SchemeDefault,
            ..test_policy()
        },
        FixedLookup(HashMap::new()),
    )
    .unwrap();

    let result = fetcher
        .get("http://images.test:6379/", HeaderMap::new())
        .await;

    assert!(matches!(
        result,
        Err(FetchError::PortNotAllowed { port: 6379 })
    ));
}

#[tokio::test]
async fn credentials_in_the_url_are_refused() {
    let fetcher = SafeFetcher::with_lookup(test_policy(), FixedLookup(HashMap::new())).unwrap();

    let result = fetcher
        .get("http://user:password@images.test/a.png", HeaderMap::new())
        .await;

    assert!(matches!(result, Err(FetchError::CredentialsInUrl)));
}

#[tokio::test]
async fn svg_is_refused_by_the_raster_image_policy() {
    let server = serve(|_port| vec![Reply::Complete(
        "HTTP/1.1 200 OK\r\ncontent-type: image/svg+xml\r\ncontent-length: 6\r\nconnection: close\r\n\r\n<svg/>"
            .to_owned(),
    )])
    .await;
    let lookup = FixedLookup(HashMap::from([(
        "images.test",
        vec!["127.0.0.1".parse().unwrap()],
    )]));
    let fetcher = SafeFetcher::with_lookup(test_policy(), lookup).unwrap();

    let result = fetcher
        .get(
            &format!("http://images.test:{}/a.svg", server.port),
            HeaderMap::new(),
        )
        .await;

    assert!(matches!(
        result,
        Err(FetchError::MediaTypeNotAllowed { media_type: Some(media_type) }) if media_type.as_str() == "image/svg+xml"
    ));
}

#[tokio::test]
async fn a_declared_oversize_body_is_refused_before_reading() {
    let server = serve(|_port| vec![Reply::Complete(
        "HTTP/1.1 200 OK\r\ncontent-type: image/png\r\ncontent-length: 5000\r\nconnection: close\r\n\r\n"
            .to_owned(),
    )])
    .await;
    let lookup = FixedLookup(HashMap::from([(
        "images.test",
        vec!["127.0.0.1".parse().unwrap()],
    )]));
    let fetcher = SafeFetcher::with_lookup(test_policy(), lookup).unwrap();

    let result = fetcher
        .get(
            &format!("http://images.test:{}/a.png", server.port),
            HeaderMap::new(),
        )
        .await;

    assert!(matches!(
        result,
        Err(FetchError::BodyTooLarge { limit: 1024 })
    ));
}

#[tokio::test]
async fn an_undeclared_oversize_body_is_cut_off_while_streaming() {
    // No Content-Length: the size is only known by reading.
    let response = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: image/png\r\nconnection: close\r\n\r\n{}",
        "x".repeat(4096)
    );
    let server = serve(|_port| vec![Reply::Complete(response)]).await;
    let lookup = FixedLookup(HashMap::from([(
        "images.test",
        vec!["127.0.0.1".parse().unwrap()],
    )]));
    let fetcher = SafeFetcher::with_lookup(test_policy(), lookup).unwrap();

    let response = fetcher
        .get(
            &format!("http://images.test:{}/a.png", server.port),
            HeaderMap::new(),
        )
        .await
        .unwrap();

    assert!(matches!(
        response.body.collect().await,
        Err(FetchError::BodyTooLarge { limit: 1024 })
    ));
}

#[tokio::test(start_paused = true)]
async fn a_body_that_stops_sending_is_abandoned() {
    let server = serve(|_port| vec![Reply::Stall(
        "HTTP/1.1 200 OK\r\ncontent-type: image/png\r\ncontent-length: 100\r\nconnection: close\r\n\r\nPN"
            .to_owned(),
    )])
    .await;
    let lookup = FixedLookup(HashMap::from([(
        "images.test",
        vec!["127.0.0.1".parse().unwrap()],
    )]));
    let fetcher = SafeFetcher::with_lookup(test_policy(), lookup).unwrap();

    let response = fetcher
        .get(
            &format!("http://images.test:{}/a.png", server.port),
            HeaderMap::new(),
        )
        .await
        .unwrap();

    assert!(matches!(
        response.body.collect().await,
        Err(FetchError::BodyStalled)
    ));
}

#[tokio::test(start_paused = true)]
async fn a_body_trickled_below_the_idle_limit_still_hits_the_total_timeout() {
    // One byte every 10 ms never trips the 1 s idle limit, and 500 bytes stay
    // under the size cap, so only the total timeout can end it.
    let server = serve(|_port| {
        vec![Reply::Trickle(
            "HTTP/1.1 200 OK\r\ncontent-type: image/png\r\nconnection: close\r\n\r\n".to_owned(),
        )]
    })
    .await;
    let lookup = FixedLookup(HashMap::from([(
        "images.test",
        vec!["127.0.0.1".parse().unwrap()],
    )]));
    let fetcher = SafeFetcher::with_lookup(
        FetchPolicy {
            total_timeout: Duration::from_secs(5),
            max_body_bytes: 1_000_000,
            ..test_policy()
        },
        lookup,
    )
    .unwrap();

    let response = fetcher
        .get(
            &format!("http://images.test:{}/a.png", server.port),
            HeaderMap::new(),
        )
        .await
        .unwrap();

    assert!(matches!(
        response.body.collect().await,
        Err(FetchError::TotalTimeout)
    ));
}
