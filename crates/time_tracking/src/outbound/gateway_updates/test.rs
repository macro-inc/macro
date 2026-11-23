use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde_json::{Value, json};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path_regex},
};

use super::*;

const PERSON: &str = "macro|author@example.com";
const TASK: &str = "00000000-0000-0000-0000-0000000000a1";

async fn gateway() -> (MockServer, ConnectionGatewayClient) {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path_regex("^/message/send/user/.+$"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "receipts": [] })))
        .mount(&server)
        .await;
    let client = ConnectionGatewayClient::new("test".to_string(), server.uri());
    (server, client)
}

/// Send `change` and wait for its push, as shutdown drains it.
async fn send(client: ConnectionGatewayClient, change: TimeTrackingChange) {
    let tasks = TaskTracker::new();
    let person = MacroUserIdStr::parse_from_str(PERSON)
        .expect("valid user id")
        .into_owned();
    GatewayTimeTrackingUpdates::new(client, tasks.clone()).changed(&person, change);
    tasks.close();
    tasks.wait().await;
}

/// `(path, message_type, message)` of every push the gateway received.
async fn pushes(server: &MockServer) -> Vec<(String, Value, Value)> {
    server
        .received_requests()
        .await
        .expect("request recording is on")
        .iter()
        .map(|request| {
            let body: Value = request.body_json().expect("a JSON body");
            (
                request.url.path().to_owned(),
                body["message_type"].clone(),
                body["message"].clone(),
            )
        })
        .collect()
}

#[tokio::test]
async fn an_entry_change_tells_the_persons_sessions_which_task_to_read_again() {
    let (server, client) = gateway().await;

    send(
        client,
        TimeTrackingChange {
            timer: false,
            task_id: Some(TASK.to_owned()),
        },
    )
    .await;

    let pushes = pushes(&server).await;
    assert_eq!(pushes.len(), 1);
    let (path, message_type, message) = &pushes[0];
    assert!(path.starts_with("/message/send/user/"), "{path}");
    assert_eq!(message_type, &json!("time_tracking_changed"));
    assert_eq!(message, &json!({ "timer": false, "taskId": TASK }));
}

#[tokio::test]
async fn a_discarded_timer_names_no_task() {
    let (server, client) = gateway().await;

    send(
        client,
        TimeTrackingChange {
            timer: true,
            task_id: None,
        },
    )
    .await;

    let pushes = pushes(&server).await;
    assert_eq!(pushes.len(), 1);
    assert_eq!(pushes[0].2, json!({ "timer": true, "taskId": null }));
}

#[tokio::test]
async fn a_gateway_failure_is_not_the_callers_problem() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;
    let client = ConnectionGatewayClient::new("test".to_string(), server.uri());

    send(
        client,
        TimeTrackingChange {
            timer: true,
            task_id: None,
        },
    )
    .await;

    assert_eq!(
        server
            .received_requests()
            .await
            .expect("request recording is on")
            .len(),
        1
    );
}
