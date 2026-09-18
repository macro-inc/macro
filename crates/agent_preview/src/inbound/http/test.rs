use super::*;
use crate::testing::*;
use axum::http::Request;
use entity_access::domain::models::AccessLevel;
use futures_util::StreamExt;
use http_body_util::BodyExt;
use tower::ServiceExt;

#[test]
fn proxy_preserves_app_cookies_but_never_forwards_gateway_credentials() {
    let mut headers = HeaderMap::new();
    headers.append(
        header::COOKIE,
        "app=one; __Host-macro-preview=secret".parse().unwrap(),
    );
    headers.append(header::COOKIE, "another=two".parse().unwrap());
    headers.insert("x-forwarded-host", "attacker.test".parse().unwrap());
    headers.insert("x-macro-internal-key", "secret".parse().unwrap());
    headers.insert(header::ORIGIN, "https://public.test".parse().unwrap());
    clean_request(
        &mut headers,
        "public.test",
        "https://public.test",
        "localhost:3000",
        true,
    )
    .unwrap();
    assert_eq!(headers[header::COOKIE], "app=one; another=two");
    assert_eq!(headers[header::HOST], "localhost:3000");
    assert_eq!(headers["x-forwarded-host"], "public.test");
    assert_eq!(headers[header::ORIGIN], "http://localhost:3000");
    assert!(!headers.contains_key("x-macro-internal-key"));
}
#[test]
fn response_cannot_replace_gateway_cookie_or_poison_sibling_hosts() {
    let mut headers = HeaderMap::new();
    headers.append(
        header::SET_COOKIE,
        "__Host-macro-preview=attacker; Path=/".parse().unwrap(),
    );
    headers.append(
        header::SET_COOKIE,
        "app=one; Domain=preview.test; Path=/; HttpOnly"
            .parse()
            .unwrap(),
    );
    headers.insert(
        header::LOCATION,
        "http://localhost:3000/login?next=%2F".parse().unwrap(),
    );
    clean_response(&mut headers, "https://public.test", "localhost:3000", false);
    assert_eq!(headers.get_all(header::SET_COOKIE).iter().count(), 1);
    assert_eq!(headers[header::SET_COOKIE], "app=one; Path=/; HttpOnly");
    assert_eq!(
        headers[header::LOCATION],
        "https://public.test/login?next=%2F"
    );
}
#[tokio::test]
async fn gateway_requires_ticket_and_preserves_request_target_and_streamed_response() {
    let (service, _, _) = fixture(2222);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().fallback(|request: axum::extract::Request| async move {
                format!(
                    "{}|{}|{}",
                    request.uri(),
                    request.headers()[header::HOST].to_str().unwrap(),
                    request
                        .headers()
                        .get(header::COOKIE)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                )
            }),
        )
        .await
        .unwrap();
    });
    let share = service.share(identity(), address.port()).await.unwrap();
    let lease = service.authenticate_ssh(&share.token).unwrap();
    service
        .register(&lease, "127.0.0.1", 1, Arc::new(TcpTunnel(address)))
        .unwrap();
    probe(&lease).await.unwrap();
    service.ready(&lease).await;
    let launch = service.launch(receipt(AccessLevel::View)).unwrap();
    let host = format!("{}.preview.test", share.preview.id);
    let gateway = router(service.clone());
    let denied = gateway
        .clone()
        .oneshot(
            Request::builder()
                .uri("/")
                .header(header::HOST, &host)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let response = gateway
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(AUTH_PATH)
                .header(header::HOST, &host)
                .header(header::ORIGIN, "https://macro.test")
                .body(Body::from(format!("ticket={}", launch.ticket)))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(response.headers()[header::LOCATION], "/");
    let cookie = response.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    // Redirecting the cross-origin ticket POST preserves cross-site fetch metadata.
    let response = gateway
        .clone()
        .oneshot(
            Request::builder()
                .uri("/")
                .header(header::HOST, &host)
                .header(header::COOKIE, &cookie)
                .header("sec-fetch-mode", "navigate")
                .header("sec-fetch-dest", "document")
                .header("sec-fetch-site", "cross-site")
                .header(header::ORIGIN, "null")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::REFERRER_POLICY], "same-origin");
    // A sibling preview is same-site, but must not fetch this viewer's private content.
    let denied = gateway
        .clone()
        .oneshot(
            Request::builder()
                .uri("/")
                .header(header::HOST, &host)
                .header(header::COOKIE, &cookie)
                .header("sec-fetch-site", "same-site")
                .header(header::ORIGIN, "https://sibling.preview.test")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let response = gateway
        .oneshot(
            Request::builder()
                .uri("/nested?q=a%2Fb&x=2")
                .header(header::HOST, &host)
                .header(header::COOKIE, format!("{cookie}; app=test"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        body,
        format!("/nested?q=a%2Fb&x=2|localhost:{}|app=test", address.port())
    );
    upstream.abort();
}

#[tokio::test(start_paused = true)]
async fn non_upgraded_stream_holds_permit_and_rechecks_viewer_permission() {
    let (service, authority, _) = fixture(2222);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().fallback(|| async {
                Body::from_stream(
                    futures_util::stream::once(async {
                        Ok::<_, std::io::Error>(bytes::Bytes::from_static(b"first"))
                    })
                    .chain(futures_util::stream::pending()),
                )
            }),
        )
        .await
        .unwrap();
    });
    let share = service.share(identity(), address.port()).await.unwrap();
    let lease = service.authenticate_ssh(&share.token).unwrap();
    service
        .register(&lease, "127.0.0.1", 1, Arc::new(TcpTunnel(address)))
        .unwrap();
    service.ready(&lease).await;
    let ticket = service.launch(receipt(AccessLevel::View)).unwrap();
    let cookie = service
        .redeem(&share.preview.id, &ticket.ticket)
        .await
        .unwrap();
    let host = format!("{}.preview.test", share.preview.id);
    // A server may decline an Upgrade with a streaming 200 response.
    let response = router(service)
        .oneshot(
            Request::builder()
                .uri("/events")
                .header(header::HOST, &host)
                .header(header::COOKIE, format!("{COOKIE}={cookie}"))
                .header(header::ORIGIN, format!("https://{host}"))
                .header(header::CONNECTION, "upgrade")
                .header(header::UPGRADE, "websocket")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let mut body = response.into_body();
    body.frame().await.unwrap().unwrap();
    assert_eq!(lease.requests.available_permits(), 31);
    authority
        .0
        .store(false, std::sync::atomic::Ordering::SeqCst);
    tokio::time::advance(Duration::from_secs(31)).await;
    tokio::task::yield_now().await;
    assert!(body.frame().await.is_none_or(|frame| frame.is_err()));
    assert_eq!(lease.requests.available_permits(), 32);
    upstream.abort();
}
