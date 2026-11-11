use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tower::ServiceExt;

use super::{Liveness, MainRuntimeHeartbeat, health_router};

async fn check(liveness: Liveness) -> StatusCode {
    health_router(liveness)
        .oneshot(
            Request::builder()
                .uri("/health")
                .method("GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test(start_paused = true)]
async fn a_main_runtime_that_stops_ticking_fails_the_check_after_thirty_seconds() {
    // Never ticked again: what the health thread sees while every main
    // runtime worker is busy.
    let heartbeat = MainRuntimeHeartbeat {
        last_tick: Arc::new(Mutex::new(Some(Instant::now()))),
    };
    let liveness = Liveness {
        heartbeat,
        api_listening: tokio::sync::watch::channel(true).1,
        runtime_commands_ready: tokio::sync::watch::channel(true).1,
    };

    tokio::time::advance(Duration::from_secs(29)).await;
    assert_eq!(
        check(liveness.clone()).await,
        StatusCode::OK,
        "a runtime that is slow but within the limit stays in service"
    );

    tokio::time::advance(Duration::from_secs(1)).await;
    assert_eq!(check(liveness).await, StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test(start_paused = true)]
async fn a_heartbeat_task_that_exits_fails_the_check_at_once() {
    let shutdown = CancellationToken::new();
    let tasks = TaskTracker::new();
    let liveness = Liveness {
        heartbeat: MainRuntimeHeartbeat::spawn(shutdown.clone(), &tasks),
        api_listening: tokio::sync::watch::channel(true).1,
        runtime_commands_ready: tokio::sync::watch::channel(true).1,
    };
    assert_eq!(check(liveness.clone()).await, StatusCode::OK);

    shutdown.cancel();
    tasks.close();
    tasks.wait().await;

    assert_eq!(check(liveness).await, StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test(start_paused = true)]
async fn the_check_fails_until_the_api_listens_and_the_command_bus_connects() {
    let heartbeat = MainRuntimeHeartbeat {
        last_tick: Arc::new(Mutex::new(Some(Instant::now()))),
    };
    let (api_listening, api_listening_receiver) = tokio::sync::watch::channel(false);
    let (runtime_commands_ready, runtime_commands_receiver) = tokio::sync::watch::channel(false);
    let liveness = Liveness {
        heartbeat,
        api_listening: api_listening_receiver,
        runtime_commands_ready: runtime_commands_receiver,
    };
    assert_eq!(
        check(liveness.clone()).await,
        StatusCode::SERVICE_UNAVAILABLE
    );

    api_listening.send_replace(true);
    assert_eq!(
        check(liveness.clone()).await,
        StatusCode::SERVICE_UNAVAILABLE
    );

    runtime_commands_ready.send_replace(true);
    assert_eq!(check(liveness).await, StatusCode::OK);
}
