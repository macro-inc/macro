use super::*;

#[tokio::test]
async fn exec_runs_without_websockets_and_checks_the_guest_exit_code() {
    for exit_code in [0, 17] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/1.0/instances/mc-01900000000070008000000000000001/exec"))
            .and(body_json(json!({
                "command": ["systemctl", "restart", "macrod"],
                "interactive": false,
                "wait-for-websocket": false
            })))
            .respond_with(ResponseTemplate::new(202).set_body_json(json!({
                "metadata": { "id": "exec-operation", "status_code": 200, "metadata": { "return": exit_code } }
            })))
            .expect(1)
            .mount(&server).await;
        let client = IncusClient::with_http_client(
            &server.uri(),
            reqwest::Client::new(),
            IncusTimeouts {
                request: Duration::from_secs(90),
                connect: Duration::from_secs(10),
                operation_wait_secs: 60,
                operation_waits: 15,
                state_change_secs: 60,
            },
        );
        let result = client
            .exec(
                &InstanceName::try_new("mc-01900000000070008000000000000001").unwrap(),
                &["systemctl", "restart", "macrod"],
            )
            .await;
        if exit_code == 0 {
            result.unwrap();
        } else {
            assert!(matches!(
                result,
                Err(IncusError::ExecFailed { exit_code: 17 })
            ));
        }
    }
}
