use super::*;
use axum::{Router, http::StatusCode, response::IntoResponse, routing::get};
use std::sync::atomic::{AtomicUsize, Ordering};

#[test]
fn ip_literal_hosts_are_checked_directly() {
    let http = McpHttp::new(AddressPolicy::PublicOnly).unwrap();
    for refused in [
        "http://127.0.0.1:8080/mcp",
        "https://169.254.169.254/latest/meta-data",
        "https://[::ffff:10.0.0.1]/mcp",
        "https://[fd00:ec2::254]/",
    ] {
        assert!(
            http.check_url(&Url::parse(refused).unwrap()).is_err(),
            "{refused}"
        );
    }
    assert!(
        http.check_url(&Url::parse("https://8.8.8.8/mcp").unwrap())
            .is_ok()
    );
    assert!(
        http.check_url(&Url::parse("https://mcp.example.com/mcp").unwrap())
            .is_ok()
    );

    let local = McpHttp::new(AddressPolicy::AnyAddress).unwrap();
    assert!(
        local
            .check_url(&Url::parse("http://127.0.0.1:8080/mcp").unwrap())
            .is_ok()
    );
}

/// A name answering one public and one private address is refused whole, so
/// a second answer cannot slip an internal target in beside a public one.
#[test]
fn an_answer_with_any_refused_address_is_refused_whole() {
    let public: SocketAddr = "8.8.8.8:0".parse().unwrap();
    let private: SocketAddr = "10.0.0.1:0".parse().unwrap();
    let mapped: SocketAddr = "[::ffff:127.0.0.1]:0".parse().unwrap();
    let policy = AddressPolicy::PublicOnly;

    assert_eq!(
        screen(policy, "a.test", vec![public]).unwrap(),
        vec![public]
    );
    assert!(screen(policy, "a.test", vec![public, private]).is_err());
    assert!(screen(policy, "a.test", vec![mapped, public]).is_err());
    assert_eq!(
        screen(AddressPolicy::AnyAddress, "a.test", vec![public, private]).unwrap(),
        vec![public, private]
    );
}

/// Serve `router` on loopback, returning its port.
async fn serve(router: Router) -> u16 {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    port
}

fn counting(hits: Arc<AtomicUsize>) -> Router {
    Router::new().route(
        "/",
        get(move || {
            hits.fetch_add(1, Ordering::SeqCst);
            async { "reached" }
        }),
    )
}

/// The check runs where the connection is made: a name resolving to
/// loopback is refused by the transport and OAuth clients alike, and the
/// server never sees a request.
#[tokio::test]
async fn names_resolving_to_internal_addresses_are_never_connected() {
    let hits = Arc::new(AtomicUsize::new(0));
    let port = serve(counting(Arc::clone(&hits))).await;
    let http = McpHttp::new(AddressPolicy::PublicOnly).unwrap();
    let url = format!("http://localhost:{port}/");

    assert!(http.transport().get(&url).send().await.is_err());

    let request = oauth2::http::Request::get(&url).body(Vec::new()).unwrap();
    assert!(http.oauth.send(request).await.is_err());

    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn oauth_requests_to_internal_ip_literals_are_refused() {
    let hits = Arc::new(AtomicUsize::new(0));
    let port = serve(counting(Arc::clone(&hits))).await;
    let http = McpHttp::new(AddressPolicy::PublicOnly).unwrap();

    let request = oauth2::http::Request::get(format!("http://127.0.0.1:{port}/"))
        .body(Vec::new())
        .unwrap();
    assert!(http.oauth.send(request).await.is_err());
    assert!(
        http.authorization_manager(&format!("http://127.0.0.1:{port}/mcp"))
            .await
            .is_err()
    );
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn local_development_reaches_local_servers() {
    let hits = Arc::new(AtomicUsize::new(0));
    let port = serve(counting(Arc::clone(&hits))).await;
    let http = McpHttp::new(AddressPolicy::AnyAddress).unwrap();

    let response = http
        .transport()
        .get(format!("http://localhost:{port}/"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

/// The transport follows a same-origin 307 (a trailing-slash redirect, say)
/// but returns a redirect to another host, and the OAuth client follows
/// none at all.
#[tokio::test]
async fn only_same_origin_transport_redirects_are_followed() {
    let elsewhere_hits = Arc::new(AtomicUsize::new(0));
    let elsewhere = serve(counting(Arc::clone(&elsewhere_hits))).await;
    let port = serve(
        Router::new()
            .route(
                "/mcp",
                get(|| async {
                    (StatusCode::TEMPORARY_REDIRECT, [("location", "/mcp/")]).into_response()
                }),
            )
            .route("/mcp/", get(|| async { "followed" }))
            .route(
                "/away",
                get(move || async move {
                    (
                        StatusCode::TEMPORARY_REDIRECT,
                        [("location", format!("http://localhost:{elsewhere}/"))],
                    )
                        .into_response()
                }),
            ),
    )
    .await;
    let http = McpHttp::new(AddressPolicy::AnyAddress).unwrap();
    let transport = http.transport();

    let same_origin = transport
        .get(format!("http://127.0.0.1:{port}/mcp"))
        .send()
        .await
        .unwrap();
    assert_eq!(same_origin.text().await.unwrap(), "followed");

    let other_host = transport
        .get(format!("http://127.0.0.1:{port}/away"))
        .send()
        .await
        .unwrap();
    assert_eq!(other_host.status(), StatusCode::TEMPORARY_REDIRECT);

    let request = oauth2::http::Request::get(format!("http://127.0.0.1:{port}/away"))
        .body(Vec::new())
        .unwrap();
    let oauth = http.oauth.send(request).await.unwrap();
    assert_eq!(oauth.status(), StatusCode::TEMPORARY_REDIRECT);

    assert_eq!(elsewhere_hits.load(Ordering::SeqCst), 0);
}
