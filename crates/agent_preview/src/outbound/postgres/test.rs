use super::*;
use crate::{
    domain::{PreviewService, ports::Events},
    inbound,
    outbound::{peer::TcpPeerConnector, ssh_tunnel::SshTunnel},
    testing::*,
};
use axum::{
    Router,
    extract::ws::{Message, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
};
use entity_access::domain::models::AccessLevel;
use futures_util::{SinkExt, StreamExt};
use http_body_util::BodyExt;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::sync::{Arc, Mutex};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::Notify,
};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct RecordedEvents {
    changes: Mutex<Vec<crate::domain::Preview>>,
    ready: Notify,
}
#[async_trait]
impl Events for RecordedEvents {
    async fn changed(
        &self,
        p: &crate::domain::Preview,
        _: &[MacroUserIdStr<'static>],
    ) -> Result<(), PreviewError> {
        self.changes.lock().unwrap().push(p.clone());
        if p.status == PreviewStatus::Ready {
            self.ready.notify_one();
        }
        Ok(())
    }
}
fn repository(pool: PgPool) -> Arc<PgPreviewRepository> {
    Arc::new(PgPreviewRepository::new(pool))
}
fn replica(
    base: &PreviewService,
    authority: Arc<TestAuthority>,
    repo: Arc<PgPreviewRepository>,
    events: Arc<RecordedEvents>,
    id: Uuid,
) -> PreviewService {
    PreviewService::new(
        base.settings().clone(),
        authority,
        events,
        repo,
        id,
        Arc::new(TcpPeerConnector),
    )
    .unwrap()
}
async fn http(
    address: SocketAddr,
    host: &str,
    path: &str,
    method: &str,
    headers: &[(&str, String)],
    body: &str,
) -> axum::response::Response {
    let socket = TcpStream::connect(address).await.unwrap();
    let (mut sender, connection) =
        hyper::client::conn::http1::handshake(hyper_util::rt::TokioIo::new(socket))
            .await
            .unwrap();
    tokio::spawn(async move {
        connection.with_upgrades().await.unwrap();
    });
    let mut request = hyper::Request::builder()
        .method(method)
        .uri(path)
        .header("host", host);
    for (k, v) in headers {
        request = request.header(*k, v);
    }
    let result = sender
        .send_request(
            request
                .body(axum::body::Body::from(body.to_owned()))
                .unwrap(),
        )
        .await
        .unwrap();
    result.map(axum::body::Body::new)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn two_replicas_route_stock_ssh_browser_http_and_websocket(pool: PgPool) {
    let repo = repository(pool.clone());
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let app_port = upstream.local_addr().unwrap().port();
    let upstream_task = tokio::spawn(
        axum::serve(
            upstream,
            Router::new()
                .route("/", get(|| async { "cross replica preview" }))
                .route(
                    "/socket",
                    get(|ws: WebSocketUpgrade| async {
                        ws.on_upgrade(|mut s| async move {
                            while let Some(Ok(Message::Text(t))) = s.recv().await {
                                if s.send(Message::Text(t)).await.is_err() {
                                    break;
                                }
                            }
                        })
                        .into_response()
                    }),
                ),
        )
        .into_future(),
    );
    let ssh_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (a_base, authority, key) = fixture(ssh_listener.local_addr().unwrap().port());
    let events = Arc::new(RecordedEvents::default());
    let a_id = Uuid::now_v7();
    let b_id = Uuid::now_v7();
    let a = replica(
        &a_base,
        authority.clone(),
        repo.clone(),
        events.clone(),
        a_id,
    );
    let b = replica(&a_base, authority, repo.clone(), events.clone(), b_id);
    let public_a = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let a_addr = public_a.local_addr().unwrap();
    let public_b = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let b_addr = public_b.local_addr().unwrap();
    a.heartbeat(a_addr).await.unwrap();
    b.heartbeat(b_addr).await.unwrap();
    let a_server =
        tokio::spawn(axum::serve(public_a, inbound::http::router(a.clone())).into_future());
    let b_server =
        tokio::spawn(axum::serve(public_b, inbound::http::router(b.clone())).into_future());
    let shutdown = CancellationToken::new();
    let ssh_server = tokio::spawn(inbound::ssh::serve(
        ssh_listener,
        key.clone(),
        b.clone(),
        Arc::new(|h| Arc::new(SshTunnel::new(h))),
        shutdown.clone(),
    ));
    let share = a.share(identity(), app_port).await.unwrap();
    let host = format!("{}.preview.test", share.preview.id);
    assert!(matches!(
        a.destination(&share.preview.id).await,
        Err(PreviewError::Offline)
    ));
    assert_eq!(
        http(a_addr, &host, "/", "GET", &[], "").await.status(),
        axum::http::StatusCode::GONE
    );
    // The agent's create reaches A; independently balanced SSH reaches B.
    let dir = tempfile::tempdir().unwrap();
    let known = dir.path().join("known_hosts");
    std::fs::write(
        &known,
        format!(
            "[localhost]:{} {}\n",
            a.settings().ssh_port,
            inbound::ssh::public_key(&key).unwrap()
        ),
    )
    .unwrap();
    let mut ssh = tokio::process::Command::new("ssh")
        .args([
            "-F",
            "/dev/null",
            "-NT",
            "-o",
            "BatchMode=yes",
            "-o",
            "PubkeyAuthentication=no",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
        ])
        .arg(format!("UserKnownHostsFile={}", known.display()))
        .args([
            "-p",
            &a.settings().ssh_port.to_string(),
            "-l",
            &share.token,
            "-R",
            &format!("127.0.0.1:1:127.0.0.1:{app_port}"),
            "localhost",
        ])
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(15), events.ready.notified())
        .await
        .unwrap();
    assert!(a.authenticate_ssh(&share.token).await.is_err());
    assert_eq!(
        a.get(receipt(AccessLevel::View))
            .await
            .unwrap()
            .unwrap()
            .status,
        PreviewStatus::Ready
    );
    let ticket = a.launch(receipt(AccessLevel::View)).await.unwrap();
    // Wrong origin is rejected on the forwarding edge without consuming a ticket.
    assert_eq!(
        http(
            a_addr,
            &host,
            "/.macro-preview/auth",
            "POST",
            &[("origin", "https://evil.test".into())],
            &format!("ticket={}", ticket.ticket)
        )
        .await
        .status(),
        axum::http::StatusCode::FORBIDDEN
    );
    let auth = http(
        a_addr,
        &host,
        "/.macro-preview/auth",
        "POST",
        &[("origin", "https://macro.test".into())],
        &format!("ticket={}", ticket.ticket),
    )
    .await;
    assert_eq!(auth.status(), axum::http::StatusCode::SEE_OTHER);
    let cookie = auth.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    assert_eq!(
        http(
            b_addr,
            &host,
            "/.macro-preview/auth",
            "POST",
            &[("origin", "https://macro.test".into())],
            &format!("ticket={}", ticket.ticket)
        )
        .await
        .status(),
        axum::http::StatusCode::FORBIDDEN
    );
    let response = http(a_addr, &host, "/", "GET", &[("cookie", cookie.clone())], "").await;
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    assert_eq!(
        response.into_body().collect().await.unwrap().to_bytes(),
        "cross replica preview"
    );
    // Forged markers cannot induce another hop, even with valid browser credentials.
    assert_eq!(
        http(
            a_addr,
            &host,
            "/",
            "GET",
            &[
                ("cookie", cookie.clone()),
                ("x-macro-preview-hop", "1".into())
            ],
            ""
        )
        .await
        .status(),
        axum::http::StatusCode::GONE
    );
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let mut request = format!("ws://{host}/socket").into_client_request().unwrap();
    request
        .headers_mut()
        .insert("origin", format!("https://{host}").parse().unwrap());
    request
        .headers_mut()
        .insert("cookie", cookie.parse().unwrap());
    let (mut ws, _) =
        tokio_tungstenite::client_async(request, TcpStream::connect(a_addr).await.unwrap())
            .await
            .unwrap();
    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        "hmr across replicas".into(),
    ))
    .await
    .unwrap();
    assert_eq!(
        ws.next().await.unwrap().unwrap().into_text().unwrap(),
        "hmr across replicas"
    );
    sqlx::query!(
        "UPDATE agent_preview_replica SET expires_at = now() - interval '1 second' WHERE id = $1",
        b_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        http(a_addr, &host, "/", "GET", &[("cookie", cookie.clone())], "")
            .await
            .status(),
        axum::http::StatusCode::GONE
    );
    a.sweep().await;
    a.stop(receipt(AccessLevel::Edit)).await.unwrap();
    b.sweep().await;
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(3), ws.next())
            .await
            .unwrap()
            .is_none_or(|r| r.is_err()
                || matches!(r, Ok(tokio_tungstenite::tungstenite::Message::Close(_))))
    );
    assert_eq!(
        http(a_addr, &host, "/", "GET", &[], "").await.status(),
        axum::http::StatusCode::GONE
    );
    ssh.kill().await.unwrap();
    shutdown.cancel();
    ssh_server.await.unwrap().unwrap();
    a_server.abort();
    b_server.abort();
    upstream_task.abort();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replacement_stop_stale_owner_and_late_cleanup_are_fenced(pool: PgPool) {
    let repo = repository(pool.clone());
    let (base, authority, _) = fixture(2222);
    let events = Arc::new(RecordedEvents::default());
    let a_id = Uuid::now_v7();
    let b_id = Uuid::now_v7();
    let a = replica(&base, authority.clone(), repo.clone(), events.clone(), a_id);
    let b = replica(&base, authority, repo.clone(), events.clone(), b_id);
    a.heartbeat("127.0.0.1:10001".parse().unwrap())
        .await
        .unwrap();
    b.heartbeat("127.0.0.1:10002".parse().unwrap())
        .await
        .unwrap();
    let first = a.share(identity(), 3000).await.unwrap();
    let old = b.authenticate_ssh(&first.token).await.unwrap();
    struct TrackedTunnel(Arc<std::sync::atomic::AtomicBool>);
    #[async_trait]
    impl crate::domain::ports::Tunnel for TrackedTunnel {
        async fn open(&self) -> Result<crate::domain::ports::Stream, PreviewError> {
            Err(PreviewError::Unavailable)
        }
        async fn close(&self) {
            self.0.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
    let closed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    b.register(
        &old,
        "127.0.0.1",
        1,
        Arc::new(TrackedTunnel(closed.clone())),
    )
    .unwrap();
    b.ready(&old).await;
    sqlx::query!("UPDATE agent_preview_lease SET created_at = now() - interval '1 minute'")
        .execute(&pool)
        .await
        .unwrap();
    let next = a.share(identity(), 3000).await.unwrap();
    let successor = a.authenticate_ssh(&next.token).await.unwrap();
    a.ready(&successor).await;
    b.sweep().await;
    assert!(old.cancel.is_cancelled());
    assert!(closed.load(std::sync::atomic::Ordering::SeqCst));
    assert!(
        !repo
            .status(&first.preview.id, b_id, PreviewStatus::Offline)
            .await
            .unwrap()
    );
    b.finish(&old, PreviewStatus::Offline).await;
    b.ready(&old).await;
    assert_eq!(
        a.get(receipt(AccessLevel::View)).await.unwrap().unwrap().id,
        next.preview.id
    );
    assert_eq!(
        a.get(receipt(AccessLevel::View))
            .await
            .unwrap()
            .unwrap()
            .status,
        PreviewStatus::Ready
    );
    b.stop(receipt(AccessLevel::Edit)).await.unwrap();
    a.ready(&successor).await;
    assert_eq!(
        a.get(receipt(AccessLevel::View))
            .await
            .unwrap()
            .unwrap()
            .status,
        PreviewStatus::Stopped
    );
    a.sweep().await;
    assert!(successor.cancel.is_cancelled());
    sqlx::query!("UPDATE agent_preview_lease SET created_at = now() - interval '1 minute'")
        .execute(&pool)
        .await
        .unwrap();
    let third = b.share(identity(), 3000).await.unwrap();
    let lease = a.authenticate_ssh(&third.token).await.unwrap();
    a.ready(&lease).await;
    events.changes.lock().unwrap().clear();
    sqlx::query!(
        "UPDATE agent_preview_replica SET expires_at = now() - interval '1 second' WHERE id = $1",
        a_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(b.destination(&third.preview.id).await.is_err());
    assert!(b.launch(receipt(AccessLevel::View)).await.is_err());
    // Survivor owns no local handle for this generation, but publishes its atomic transition.
    b.sweep().await;
    assert_eq!(
        events
            .changes
            .lock()
            .unwrap()
            .iter()
            .filter(|p| p.id == third.preview.id && p.status == PreviewStatus::Offline)
            .count(),
        1
    );
    b.sweep().await;
    assert_eq!(
        events
            .changes
            .lock()
            .unwrap()
            .iter()
            .filter(|p| p.id == third.preview.id && p.status == PreviewStatus::Offline)
            .count(),
        1
    );
    a.heartbeat("127.0.0.1:10001".parse().unwrap())
        .await
        .unwrap();
    a.ready(&lease).await;
    assert!(repo.destination(&third.preview.id).await.is_err());
    assert!(
        !repo
            .status(&third.preview.id, a_id, PreviewStatus::Ready)
            .await
            .unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_credentials_are_single_use_host_bound_and_bounded(pool: PgPool) {
    let repo = repository(pool.clone());
    let (base, authority, _) = fixture(2222);
    let events = Arc::new(RecordedEvents::default());
    let a_id = Uuid::now_v7();
    let b_id = Uuid::now_v7();
    let a = replica(&base, authority.clone(), repo.clone(), events.clone(), a_id);
    let b = replica(&base, authority, repo.clone(), events, b_id);
    a.heartbeat("127.0.0.1:10001".parse().unwrap())
        .await
        .unwrap();
    b.heartbeat("127.0.0.1:10002".parse().unwrap())
        .await
        .unwrap();
    let share = a.share(identity(), 3000).await.unwrap();
    let (left, right) = tokio::join!(
        a.authenticate_ssh(&share.token),
        b.authenticate_ssh(&share.token)
    );
    assert_ne!(left.is_ok(), right.is_ok());
    if let Ok(l) = left {
        a.ready(&l).await;
    }
    if let Ok(l) = right {
        b.ready(&l).await;
    }
    let ticket = a.launch(receipt(AccessLevel::View)).await.unwrap();
    assert!(
        b.redeem(&PreviewId::generate(), &ticket.ticket)
            .await
            .is_err()
    );
    let (left, right) = tokio::join!(
        a.redeem(&share.preview.id, &ticket.ticket),
        b.redeem(&share.preview.id, &ticket.ticket)
    );
    assert_ne!(left.is_ok(), right.is_ok());
    sqlx::query!("DELETE FROM agent_preview_credential WHERE kind = 'ticket'")
        .execute(&pool)
        .await
        .unwrap();
    let c1 = StoredCredential {
        hash: [1; 32],
        preview: share.preview.id.clone(),
        user: Some(user()),
        expires: Utc::now().timestamp_millis() + 30000,
    };
    let c2 = StoredCredential {
        hash: [2; 32],
        ..c1.clone()
    };
    let (left, right) = tokio::join!(
        repo.credential(CredentialKind::Ticket, c1, 1),
        repo.credential(CredentialKind::Ticket, c2, 1)
    );
    assert_ne!(left.is_ok(), right.is_ok());
    let count =
        sqlx::query_scalar!("SELECT count(*) FROM agent_preview_credential WHERE kind = 'ticket'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, Some(1));
    sqlx::query!("UPDATE agent_preview_replica SET expires_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        repo.credential(
            CredentialKind::Ticket,
            StoredCredential {
                hash: [3; 32],
                preview: share.preview.id,
                user: Some(user()),
                expires: Utc::now().timestamp_millis() + 30000,
            },
            1,
        )
        .await,
        Err(PreviewError::Offline)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn expired_watchers_cannot_renew_past_active_limits(pool: PgPool) {
    let repo = repository(pool.clone());
    let other = MacroUserIdStr::try_from("macro|second@example.com".to_owned()).unwrap();
    let limits = WatchLimits {
        sessions: 1,
        viewers: 1,
        expires: Utc::now().timestamp_millis() + 30000,
    };
    repo.watch(session(), &user(), limits).await.unwrap();
    sqlx::query!("UPDATE agent_preview_watcher SET expires_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    repo.watch(session(), &other, limits).await.unwrap();
    repo.watch(session(), &user(), limits).await.unwrap();
    assert_eq!(
        repo.watchers(session(), 10).await.unwrap(),
        vec![other.clone()]
    );
    sqlx::query!("UPDATE agent_preview_watcher SET expires_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    let second = AgentSessionId::new();
    repo.watch(second, &other, limits).await.unwrap();
    repo.watch(session(), &user(), limits).await.unwrap();
    assert!(repo.watchers(session(), 10).await.unwrap().is_empty());
    assert_eq!(repo.watchers(second, 10).await.unwrap(), vec![other]);
}
