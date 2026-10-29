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
async fn shutdown_drains_executions() {
    let lifecycle = ServiceLifecycle::default();
    let stop = lifecycle.stop_executions.clone();
    let finished = Arc::new(AtomicUsize::new(0));
    let completed = Arc::clone(&finished);
    lifecycle.executions.spawn(async move {
        stop.cancelled().await;
        completed.fetch_add(1, Ordering::SeqCst);
    });
    let executions = lifecycle.executions.clone();
    SchedulingRuntime {
        router: Router::new(),
        lifecycle,
    }
    .shutdown()
    .await;
    assert_eq!(finished.load(Ordering::SeqCst), 1);
    assert!(executions.is_empty());
}

#[tokio::test(start_paused = true)]
async fn one_deadline_bounds_stalled_background_work() {
    let lifecycle = ServiceLifecycle::default();
    let task = lifecycle.executions.spawn(std::future::pending::<()>());
    let consumers = lifecycle.stop_consumers.clone();
    let workers = lifecycle.stop_workers.clone();
    let executions = lifecycle.stop_executions.clone();
    let started = tokio::time::Instant::now();
    SchedulingRuntime {
        router: Router::new(),
        lifecycle,
    }
    .shutdown()
    .await;
    assert_eq!(started.elapsed(), SHUTDOWN_TIMEOUT);
    assert!(consumers.is_cancelled());
    assert!(workers.is_cancelled());
    assert!(executions.is_cancelled());
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
}

fn docs_router() -> Router {
    mount_router(Router::new().route(
        "/health",
        axum::routing::get(scheduled_action::inbound::axum_router::health),
    ))
}

#[tokio::test]
async fn openapi_is_served_at_gateway_prefix() {
    let app = docs_router();

    for (uri, expected) in [
        ("/scheduled-action/api-doc/openapi.json", StatusCode::OK),
        ("/api-doc/openapi.json", StatusCode::NOT_FOUND),
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

        assert_eq!(response.status(), expected, "openapi at {uri}");
    }
}

#[tokio::test]
async fn health_is_served_at_gateway_prefix() {
    let app = docs_router();

    for (uri, expected) in [
        ("/scheduled-action/health", StatusCode::OK),
        ("/health", StatusCode::NOT_FOUND),
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
        assert_eq!(response.status(), expected, "health at {uri}");
    }
}
