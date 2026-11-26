use std::time::Duration;

use super::MacroServices;

/// A request a scenario still holds does not keep the stand-in from
/// stopping: without that, tearing the stack down would wait for ever.
#[tokio::test]
async fn stopping_lets_a_held_request_go() {
    // Nothing listens here; the request is held before anything is passed on.
    let nowhere = "http://127.0.0.1:1";
    let services = MacroServices::start(nowhere, nowhere, nowhere)
        .await
        .unwrap();
    let mut held = services.hold_next("contacts", "GET", "/held");
    let request = tokio::spawn(
        reqwest::Client::new()
            .get(format!("{}/held", services.url("contacts")))
            .send(),
    );
    held.arrived().await.unwrap();

    tokio::time::timeout(Duration::from_secs(10), services.stop())
        .await
        .expect("the stand-in did not stop while a request was held");

    // The request was answered, not cut off.
    assert!(request.await.unwrap().is_ok());
    drop(held);
}
