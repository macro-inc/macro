use super::*;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use std::sync::atomic::{AtomicUsize, Ordering};
use tower::ServiceExt;

#[tokio::test]
async fn disabled_startup_launches_neither_consumer_nor_worker() {
    let lifecycle = ServiceLifecycle::default();
    start_event_tasks(
        false,
        &lifecycle,
        || async { panic!("disabled consumer was polled") },
        async { panic!("disabled worker was polled") },
    );
    assert!(lifecycle.consumers.is_empty());
    assert!(lifecycle.workers.is_empty());
    lifecycle.stop();
    lifecycle.drain().await;
}

#[tokio::test]
async fn enabled_startup_tracks_and_stops_both_background_tasks() {
    let lifecycle = ServiceLifecycle::default();
    let worker_shutdown = lifecycle.stop_workers.clone();
    start_event_tasks(true, &lifecycle, std::future::pending, async move {
        worker_shutdown.cancelled().await
    });
    assert_eq!(lifecycle.consumers.len(), 1);
    assert_eq!(lifecycle.workers.len(), 1);
    lifecycle.stop();
    tokio::time::timeout(Duration::from_secs(1), lifecycle.drain())
        .await
        .unwrap();
    assert!(lifecycle.consumers.is_empty());
    assert!(lifecycle.workers.is_empty());
}

#[tokio::test]
async fn consumer_failure_and_unexpected_exit_restart_from_a_fresh_factory() {
    let attempts = Arc::new(AtomicUsize::new(0));
    let shutdown = CancellationToken::new();
    let calls = Arc::clone(&attempts);
    let stop = shutdown.clone();
    supervise_consumer(
        move || {
            let call = calls.fetch_add(1, Ordering::SeqCst);
            let stop = stop.clone();
            async move {
                match call {
                    0 => Err(rootcause::report!("transient retries exhausted")),
                    1 => Ok(()),
                    _ => {
                        stop.cancel();
                        Ok(())
                    }
                }
            }
        },
        shutdown,
        Duration::ZERO,
    )
    .await;
    assert_eq!(attempts.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn shutdown_interrupts_consumer_restart_backoff() {
    let shutdown = CancellationToken::new();
    let stop = shutdown.clone();
    tokio::time::timeout(
        Duration::from_secs(1),
        supervise_consumer(
            move || {
                stop.cancel();
                async { Err(rootcause::report!("consumer failed")) }
            },
            shutdown,
            Duration::from_secs(60),
        ),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn shutdown_drains_executions_before_final_publishes() {
    let lifecycle = ServiceLifecycle::default();
    let stop = lifecycle.stop_executions.clone();
    let publishes = lifecycle.publishes.clone();
    let finished = Arc::new(AtomicUsize::new(0));
    let published = Arc::clone(&finished);
    lifecycle.executions.spawn(async move {
        stop.cancelled().await;
        assert!(!publishes.is_closed());
        publishes.spawn(async move {
            published.fetch_add(1, Ordering::SeqCst);
        });
    });
    let stop_http = lifecycle.stop_http.clone();
    serve_until_shutdown(
        async move {
            stop_http.cancelled().await;
            Ok(())
        },
        std::future::ready(()),
        &lifecycle,
        Duration::from_secs(1),
    )
    .await
    .unwrap();
    assert_eq!(finished.load(Ordering::SeqCst), 1);
    assert!(lifecycle.executions.is_empty());
    assert!(lifecycle.publishes.is_empty());
}

#[tokio::test]
async fn one_deadline_bounds_stalled_http_and_background_work() {
    let lifecycle = ServiceLifecycle::default();
    let task = lifecycle.executions.spawn(std::future::pending::<()>());
    tokio::time::timeout(
        Duration::from_secs(1),
        serve_until_shutdown(
            std::future::pending(),
            std::future::ready(()),
            &lifecycle,
            Duration::from_millis(10),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(lifecycle.stop_consumers.is_cancelled());
    assert!(lifecycle.stop_workers.is_cancelled());
    assert!(lifecycle.stop_executions.is_cancelled());
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
}

#[tokio::test]
async fn server_failure_also_stops_background_work() {
    let lifecycle = ServiceLifecycle::default();
    let error = serve_until_shutdown(
        async { anyhow::bail!("server failed") },
        std::future::pending(),
        &lifecycle,
        Duration::from_secs(1),
    )
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), "server failed");
    assert!(lifecycle.stop_consumers.is_cancelled());
    assert!(lifecycle.stop_workers.is_cancelled());
    assert!(lifecycle.stop_executions.is_cancelled());
}

fn docs_router() -> Router {
    Router::new()
        .merge(mount_at_root_and_prefix(
            Router::new().route("/health", axum::routing::get(health)),
        ))
        .merge(mount_docs_at_root_and_prefix())
}

#[tokio::test]
async fn openapi_is_served_at_root_and_gateway_prefix() {
    let app = docs_router();

    for uri in [
        "/api-doc/openapi.json",
        "/scheduled-action/api-doc/openapi.json",
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .method("GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            StatusCode::OK,
            "openapi at {uri} should be 200"
        );
    }
}

#[tokio::test]
async fn health_is_served_at_root_and_gateway_prefix() {
    let app = docs_router();

    for uri in ["/health", "/scheduled-action/health"] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .method("GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "health at {uri} should be 200"
        );
    }
}
