use super::*;
use crate::testing::*;
use entity_access::domain::models::AccessLevel;

#[tokio::test]
async fn ssh_credentials_have_a_safe_username_prefix_without_losing_entropy() {
    let (service, _, _) = fixture(2222);
    let share = service.share(identity(), 3000).await.unwrap();
    let payload = share.token.strip_prefix("preview_").unwrap();
    assert_eq!(URL_SAFE_NO_PAD.decode(payload).unwrap().len(), 32);
    // The prefix is part of the credential, not merely a client-side decoration.
    assert!(service.authenticate_ssh(payload).await.is_err());
    assert!(service.authenticate_ssh(&share.token).await.is_ok());
}

#[tokio::test]
async fn ssh_credentials_are_single_use_and_forward_is_scoped() {
    let (service, _, _) = fixture(2222);
    let share = service.share(identity(), 3000).await.unwrap();
    assert!(service.authenticate_ssh("wrong").await.is_err());
    let lease = service.authenticate_ssh(&share.token).await.unwrap();
    assert!(service.authenticate_ssh(&share.token).await.is_err());
    let tunnel = Arc::new(TcpTunnel("127.0.0.1:1".parse().unwrap()));
    assert!(
        service
            .register(&lease, "0.0.0.0", 1, tunnel.clone())
            .is_err()
    );
    assert!(
        service
            .register(&lease, "127.0.0.1", 3000, tunnel.clone())
            .is_err()
    );
    service
        .register(&lease, "127.0.0.1", 1, tunnel.clone())
        .unwrap();
    assert!(service.register(&lease, "127.0.0.1", 1, tunnel).is_err());
    assert!(service.launch(receipt(AccessLevel::View)).await.is_err());
    service.ready(&lease).await;
    assert_eq!(
        service
            .get(receipt(AccessLevel::View))
            .await
            .unwrap()
            .unwrap()
            .status,
        PreviewStatus::Ready
    );
}
#[tokio::test]
async fn browser_tickets_are_host_bound_single_use_and_permissions_rechecked() {
    let (service, authority, _) = fixture(2222);
    let share = service.share(identity(), 3000).await.unwrap();
    let lease = service.authenticate_ssh(&share.token).await.unwrap();
    service.ready(&lease).await;
    let launch = service.launch(receipt(AccessLevel::View)).await.unwrap();
    assert!(
        service
            .redeem(&PreviewId::generate(), &launch.ticket)
            .await
            .is_err()
    );
    let cookie = service
        .redeem(&share.preview.id, &launch.ticket)
        .await
        .unwrap();
    assert!(
        service
            .redeem(&share.preview.id, &launch.ticket)
            .await
            .is_err()
    );
    assert!(
        service
            .viewer(&PreviewId::generate(), &cookie, true)
            .await
            .is_err()
    );
    assert!(
        service
            .viewer(&share.preview.id, &cookie, true)
            .await
            .is_ok()
    );
    authority
        .0
        .store(false, std::sync::atomic::Ordering::SeqCst);
    assert!(
        service
            .viewer(&share.preview.id, &cookie, true)
            .await
            .is_err()
    );
    service.sweep().await;
    assert!(lease.cancel.is_cancelled());
}
#[tokio::test]
async fn expiry_stop_and_token_timeout_close_access() {
    let (service, authority, _) = fixture(2222);
    let share = service.share(identity(), 3000).await.unwrap();
    authority
        .1
        .0
        .lock()
        .unwrap()
        .credentials
        .get_mut(&digest(&share.token))
        .unwrap()
        .1
        .expires = 0;
    assert!(service.authenticate_ssh(&share.token).await.is_err());
    authority
        .1
        .0
        .lock()
        .unwrap()
        .credentials
        .get_mut(&digest(&share.token))
        .unwrap()
        .1
        .expires = now_ms() + 120000;
    let lease = service.authenticate_ssh(&share.token).await.unwrap();
    service.ready(&lease).await;
    let launch = service.launch(receipt(AccessLevel::View)).await.unwrap();
    authority
        .1
        .0
        .lock()
        .unwrap()
        .credentials
        .get_mut(&digest(&launch.ticket))
        .unwrap()
        .1
        .expires = 0;
    assert!(
        service
            .redeem(&share.preview.id, &launch.ticket)
            .await
            .is_err()
    );
    service.stop(receipt(AccessLevel::Edit)).await.unwrap();
    assert!(lease.cancel.is_cancelled());
    assert!(service.launch(receipt(AccessLevel::View)).await.is_err());
}
#[tokio::test]
async fn quotas_bound_sessions_and_request_loops() {
    let (service, authority, _) = fixture(2222);
    assert!(service.share(identity(), 0).await.is_err());
    for _ in 0..5 {
        let mut identity = identity();
        identity.session = AgentSessionId::new();
        authority.1.0.lock().unwrap().accounts.clear();
        service.share(identity, 3000).await.unwrap();
    }
    authority.1.0.lock().unwrap().accounts.clear();
    assert!(matches!(
        service.share(identity(), 3000).await,
        Err(PreviewError::Limited)
    ));
}
#[test]
fn isolated_domains_and_shell_fields_are_validated() {
    let (service, _, _) = fixture(2222);
    let mut settings = service.settings().clone();
    for domain in [
        "macro.com",
        "preview.macro.com",
        "bad;hostname",
        "UPPERCASE.test",
        "macro.test",
        // Nested either way: the app under the preview domain, and the preview
        // domain under the app.
        "test",
        "preview.macro.test",
    ] {
        settings.domain = domain.into();
        assert!(settings.validate().is_err());
    }
}

#[tokio::test]
async fn stopping_a_preview_does_not_bypass_the_creation_interval() {
    let (service, authority, _) = fixture(2222);
    service.share(identity(), 3000).await.unwrap();
    assert!(matches!(
        service.share(identity(), 3000).await,
        Err(PreviewError::Limited)
    ));
    // Stopping releases the session slot but not the owner's pacing: otherwise
    // a stop/share loop is an unbounded lease mint.
    service.stop(receipt(AccessLevel::Edit)).await.unwrap();
    assert!(matches!(
        service.share(identity(), 3000).await,
        Err(PreviewError::Limited)
    ));
    authority.1.0.lock().unwrap().accounts.clear();
    service.share(identity(), 3000).await.unwrap();
}
#[test]
fn local_stack_accepts_https_handoff_and_loopback_http_with_docker_ssh_fallback() {
    let (service, _, _) = fixture(2222);
    let mut settings = service.settings().clone();
    settings.domain = "preview.localhost".into();
    settings.local_ssh_fallback = true;
    for origin in [
        "http://localhost:3000",
        "https://localhost:8090",
        "https://coworker-dev:23109",
        "https://coworker-dev.local:23109",
    ] {
        settings.app_origin = origin.into();
        assert!(settings.validate().is_ok(), "{origin}");
    }
    for origin in [
        "http://coworker-dev:3000",
        "https://Coworker-Dev:23109",
        "https://preview.localhost:8090",
        "https://app.preview.localhost:8090",
    ] {
        settings.app_origin = origin.into();
        assert!(settings.validate().is_err(), "{origin}");
    }
    settings.app_origin = "https://coworker-dev:23109".into();
    settings.domain = "preview.example.test".into();
    assert!(settings.validate().is_err());
}

#[tokio::test]
async fn forwarding_admission_precedes_dial_and_holds_slots_through_body() {
    use crate::domain::ports::{PeerConnector, Stream};
    use crate::inbound::http;
    use axum::{Router, body::Body, routing::get};
    use http_body_util::BodyExt;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tower::ServiceExt;
    struct CountedPeer(Arc<AtomicUsize>);
    #[async_trait::async_trait]
    impl PeerConnector for CountedPeer {
        async fn connect(&self, address: std::net::SocketAddr) -> Result<Stream, PreviewError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(Box::new(
                tokio::net::TcpStream::connect(address).await.unwrap(),
            ))
        }
    }
    let (owner, authority, _) = fixture(2222);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    owner.heartbeat(address).await.unwrap();
    // The fixture's initial heartbeat pins its address; emulate a replica
    // starting with its real listener rather than changing the registered address.
    authority
        .1
        .0
        .lock()
        .unwrap()
        .replicas
        .get_mut(&owner.replica)
        .unwrap()
        .0 = address;
    let calls = Arc::new(AtomicUsize::new(0));
    let follower = PreviewService::new(
        owner.settings().clone(),
        authority.clone(),
        Arc::new(TestEvents),
        authority.1.clone(),
        uuid::Uuid::now_v7(),
        Arc::new(CountedPeer(calls.clone())),
    )
    .unwrap();
    let release = Arc::new(tokio::sync::Notify::new());
    let body_release = release.clone();
    let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream.local_addr().unwrap();
    let upstream_task = tokio::spawn(
        axum::serve(
            upstream,
            Router::new()
                .route(
                    "/",
                    get(move || {
                        let release = body_release.clone();
                        async move {
                            Body::from_stream(futures_util::stream::once(async move {
                                release.notified().await;
                                Ok::<_, std::io::Error>(bytes::Bytes::from_static(b"streamed"))
                            }))
                        }
                    }),
                )
                .route(
                    "/socket",
                    get(|ws: axum::extract::ws::WebSocketUpgrade| async {
                        ws.on_upgrade(|mut socket| async move {
                            while let Some(Ok(message)) = socket.recv().await {
                                if socket.send(message).await.is_err() {
                                    break;
                                }
                            }
                        })
                    }),
                ),
        )
        .into_future(),
    );
    let share = follower.share(identity(), 3000).await.unwrap();
    let lease = owner.authenticate_ssh(&share.token).await.unwrap();
    owner
        .register(&lease, "127.0.0.1", 1, Arc::new(TcpTunnel(upstream_addr)))
        .unwrap();
    owner.ready(&lease).await;
    let launch = follower.launch(receipt(AccessLevel::View)).await.unwrap();
    let cookie = owner
        .redeem(&share.preview.id, &launch.ticket)
        .await
        .unwrap();
    let server = tokio::spawn(axum::serve(listener, http::router(owner.clone())).into_future());
    let app = http::router(follower.clone());
    let request = || {
        axum::http::Request::builder()
            .uri("/")
            .header("host", format!("{}.preview.test", share.preview.id))
            .header("cookie", format!("__Host-macro-preview={cookie}"))
            .body(Body::empty())
            .unwrap()
    };
    let held = follower
        .peer_slots
        .clone()
        .acquire_many_owned(1024)
        .await
        .unwrap();
    assert_eq!(
        app.clone().oneshot(request()).await.unwrap().status(),
        axum::http::StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    drop(held);
    let mut oversized = request();
    oversized
        .headers_mut()
        .insert("content-length", "16777217".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(oversized).await.unwrap().status(),
        axum::http::StatusCode::BAD_REQUEST
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let response = app.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    assert_eq!(follower.peer_slots.available_permits(), 1023);
    release.notify_one();
    assert_eq!(
        response.into_body().collect().await.unwrap().to_bytes(),
        "streamed"
    );
    let all = tokio::time::timeout(
        Duration::from_secs(3),
        follower.peer_slots.clone().acquire_many_owned(1024),
    )
    .await
    .unwrap()
    .unwrap();
    drop(all);
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let edge = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let edge_address = edge.local_addr().unwrap();
    let edge_task = tokio::spawn(axum::serve(edge, http::router(follower.clone())).into_future());
    let host = format!("{}.preview.test", share.preview.id);
    let mut upgrade = format!("ws://{host}/socket").into_client_request().unwrap();
    upgrade
        .headers_mut()
        .insert("origin", format!("https://{host}").parse().unwrap());
    upgrade.headers_mut().insert(
        "cookie",
        format!("__Host-macro-preview={cookie}").parse().unwrap(),
    );
    let (mut ws, _) = tokio_tungstenite::client_async(
        upgrade,
        tokio::net::TcpStream::connect(edge_address).await.unwrap(),
    )
    .await
    .unwrap();
    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        "held upgrade".into(),
    ))
    .await
    .unwrap();
    assert_eq!(
        ws.next().await.unwrap().unwrap().into_text().unwrap(),
        "held upgrade"
    );
    assert_eq!(follower.peer_slots.available_permits(), 1023);
    assert_eq!(follower.peer_upgrades.available_permits(), 127);
    ws.close(None).await.unwrap();
    drop(ws);
    let requests = tokio::time::timeout(
        Duration::from_secs(3),
        follower.peer_slots.clone().acquire_many_owned(1024),
    )
    .await
    .unwrap()
    .unwrap();
    let upgrades = tokio::time::timeout(
        Duration::from_secs(3),
        follower.peer_upgrades.clone().acquire_many_owned(128),
    )
    .await
    .unwrap()
    .unwrap();
    drop(requests);
    drop(upgrades);
    edge_task.abort();
    server.abort();
    upstream_task.abort();
}

#[tokio::test]
async fn disconnect_retries_fenced_cleanup_after_repository_failure() {
    let (service, authority, _) = fixture(2222);
    let share = service.share(identity(), 3000).await.unwrap();
    let lease = service.authenticate_ssh(&share.token).await.unwrap();
    service.ready(&lease).await;
    authority.1.1.store(true, Ordering::SeqCst);
    service.finish(&lease, PreviewStatus::Offline).await;
    assert!(lease.cancel.is_cancelled());
    assert_eq!(
        service
            .get(receipt(AccessLevel::View))
            .await
            .unwrap()
            .unwrap()
            .status,
        PreviewStatus::Ready
    );
    service.sweep().await;
    assert_eq!(
        service
            .get(receipt(AccessLevel::View))
            .await
            .unwrap()
            .unwrap()
            .status,
        PreviewStatus::Offline
    );
    assert!(!lease.pending_cleanup.load(Ordering::SeqCst));
}

#[tokio::test]
async fn revoked_agent_claim_retains_failed_cleanup_for_retry() {
    let (service, authority, _) = fixture(2222);
    let share = service.share(identity(), 3000).await.unwrap();
    authority.0.store(false, Ordering::SeqCst);
    authority.1.1.store(true, Ordering::SeqCst);
    assert!(matches!(
        service.authenticate_ssh(&share.token).await,
        Err(PreviewError::Denied)
    ));
    assert_eq!(
        service
            .get(receipt(AccessLevel::View))
            .await
            .unwrap()
            .unwrap()
            .status,
        PreviewStatus::Starting
    );
    service.sweep().await;
    assert_eq!(
        service
            .get(receipt(AccessLevel::View))
            .await
            .unwrap()
            .unwrap()
            .status,
        PreviewStatus::Offline
    );
}
