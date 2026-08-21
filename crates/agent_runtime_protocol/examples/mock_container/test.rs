use super::*;
use tokio::time::{Duration, timeout};

#[tokio::test]
async fn startup_observes_container_failure_before_subscription() {
    let carrier: ServerTransport<ToRuntimeMessage, ToServerMessage> = ServerTransport::new();
    let mut container = tokio::spawn(async {
        Err::<(), AnyError>(std::io::Error::other("container startup failed").into())
    });

    let error = timeout(
        Duration::from_secs(1),
        accept_runtime(&carrier, &mut container),
    )
    .await
    .expect("container failure should be observed promptly")
    .expect_err("startup should fail when the container exits");

    assert!(error.to_string().contains("container startup failed"));
}

#[tokio::test]
async fn startup_observes_container_failure_before_acp_is_ready() {
    let ready = Notify::new();
    let mut container = tokio::spawn(async {
        Err::<(), AnyError>(std::io::Error::other("ACP startup failed").into())
    });

    let error = timeout(Duration::from_secs(1), wait_for_acp(&ready, &mut container))
        .await
        .expect("container failure should be observed promptly")
        .expect_err("startup should fail when ACP never becomes ready");

    assert!(error.to_string().contains("ACP startup failed"));
}

#[test]
fn permission_requests_are_cancelled_without_user_confirmation() {
    let response = cancelled_permission_response();

    assert_eq!(response.outcome, RequestPermissionOutcome::Cancelled);
}
