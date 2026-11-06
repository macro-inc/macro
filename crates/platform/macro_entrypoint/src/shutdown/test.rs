use super::wait_for_shutdown_signals;

use std::{future::pending, io, time::Duration};
use tokio::{task::yield_now, time::timeout};

#[tokio::test]
async fn failed_signal_listener_does_not_resolve_shutdown() {
    let ctrl_c = async { Err(io::Error::other("listener installation failed")) };
    let terminate = pending::<io::Result<()>>();

    let result = timeout(
        Duration::from_millis(10),
        wait_for_shutdown_signals(ctrl_c, terminate),
    )
    .await;

    assert!(
        result.is_err(),
        "a listener error must not trigger shutdown"
    );
}

#[tokio::test]
async fn successful_signal_resolves_shutdown() {
    let ctrl_c = async { Ok(()) };
    let terminate = pending::<io::Result<()>>();

    let result = timeout(
        Duration::from_millis(100),
        wait_for_shutdown_signals(ctrl_c, terminate),
    )
    .await;

    assert!(result.is_ok(), "an actual signal must trigger shutdown");
}

#[tokio::test]
async fn successful_signal_resolves_after_other_listener_fails() {
    let ctrl_c = async { Err(io::Error::other("listener installation failed")) };
    let terminate = async {
        yield_now().await;
        Ok(())
    };

    let result = timeout(
        Duration::from_millis(100),
        wait_for_shutdown_signals(ctrl_c, terminate),
    )
    .await;

    assert!(
        result.is_ok(),
        "a listener error must not mask a later signal"
    );
}
