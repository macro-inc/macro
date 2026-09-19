use super::*;

#[tokio::test]
async fn stop_does_not_wait_for_in_flight_work() {
    let daemon = Daemon {
        cancel: CancellationToken::new(),
        task: tokio::spawn(std::future::pending()),
    };

    tokio::time::timeout(Duration::from_secs(1), daemon.stop())
        .await
        .expect("daemon shutdown should abort in-flight work");
}
