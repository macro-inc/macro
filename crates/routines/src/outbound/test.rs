use super::*;
use crate::domain::RoutineSchedule;
#[test]
fn agent_tasks_do_not_silently_become_model_tasks_or_override_defaults() {
    let agent_id = Uuid::from_u128(1);
    let config = RoutineConfiguration {
        name: "Check in".into(),
        instructions: "Summarize blockers".into(),
        target: RoutineTarget::Agent { agent_id },
        schedule: RoutineSchedule::Cron {
            expression: "0 0 9 * * *".into(),
            timezone: "UTC".into(),
        },
    };
    let body = configuration_body(&config, Utc::now()).unwrap();
    assert_eq!(body["task"]["agent"]["bot_id"], agent_id.to_string());
    assert!(body["task"].get("model").is_none());
    assert!(body.get("enabled").is_none());
    assert!(body.get("owner").is_none());
}

#[tokio::test]
async fn requests_forward_authenticated_identity_and_preserve_target_and_activation() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/scheduled-action", listener.local_addr().unwrap());
    let id = Uuid::from_u128(1);
    let wire = serde_json::json!({ "id": id, "name": "Check in", "enabled": true, "trigger": { "type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC" }, "task": {}, "next_run_at": null }).to_string();
    let history = serde_json::json!([{ "id": id, "status": "Completed" }]);
    let responses = [
        wire.clone(),
        wire.clone(),
        wire.clone(),
        wire,
        history.to_string(),
    ];
    let server = tokio::spawn(async move {
        let mut requests = Vec::new();
        for wire in responses {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut chunk = [0_u8; 4096];
                let read = stream.read(&mut chunk).await.unwrap();
                assert!(read > 0);
                bytes.extend_from_slice(&chunk[..read]);
                let text = String::from_utf8_lossy(&bytes);
                if let Some(header_end) = text.find("\r\n\r\n") {
                    let length = text[..header_end]
                        .lines()
                        .find_map(|line| {
                            line.to_lowercase()
                                .strip_prefix("content-length: ")
                                .map(|n| n.parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= header_end + 4 + length {
                        break;
                    }
                }
            }
            requests.push(String::from_utf8(bytes).unwrap());
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                wire.len(),
                wire
            );
            stream.write_all(response.as_bytes()).await.unwrap();
        }
        requests
    });
    let client = RoutineClient::new(&url, "test-internal-key").unwrap();
    let user = MacroUserIdStr::parse_from_str("macro|routine@example.com").unwrap();
    let config = RoutineConfiguration {
        name: "Check in".into(),
        instructions: "Prepare a brief".into(),
        target: RoutineTarget::Agent { agent_id: id },
        schedule: RoutineSchedule::Once {
            at: Utc::now() + chrono::Duration::hours(1),
        },
    };
    client.create(&user, &config).await.unwrap();
    client.update(&user, id, &config).await.unwrap();
    client.set_enabled(&user, id, false).await.unwrap();
    let details = client.read(&user, id).await.unwrap();
    assert_eq!(details.routine.id, id);
    assert_eq!(serde_json::to_value(details.runs).unwrap(), history);
    let requests = server.await.unwrap();
    for request in &requests {
        assert!(request.contains("x-internal-auth-key: test-internal-key\r\n"));
        assert!(request.contains("x-internal-macro-user-id: macro|routine@example.com\r\n"));
    }
    assert!(requests[0].starts_with("POST /scheduled-action/scheduled-actions HTTP/1.1"));
    assert!(requests[3].starts_with(&format!(
        "GET /scheduled-action/scheduled-actions/{id} HTTP/1.1"
    )));
    assert!(requests[4].starts_with(&format!(
        "GET /scheduled-action/scheduled-actions/{id}/history HTTP/1.1"
    )));
    let bodies: Vec<Value> = requests[..3]
        .iter()
        .map(|r| serde_json::from_str(r.split_once("\r\n\r\n").unwrap().1).unwrap())
        .collect();
    assert_eq!(bodies[0]["enabled"], true);
    assert!(bodies[0].get("owner").is_none());
    assert_eq!(bodies[0]["task"]["agent"]["bot_id"], id.to_string());
    assert!(bodies[1].get("enabled").is_none());
    assert_eq!(bodies[2], serde_json::json!({"enabled": false}));
}
