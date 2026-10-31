use super::*;
use crate::domain::RoutineApp;
use crate::domain::RoutineTrigger;
use routine_program::{AgentSelection, AgentStep, Step};

fn agent(agent_id: Uuid) -> Vec<Step> {
    vec![Step::Agent(AgentStep {
        model: None,
        agent: Some(AgentSelection { bot_id: agent_id }),
        instructions: "Summarize blockers".into(),
    })]
}

#[test]
fn agent_steps_do_not_silently_become_model_steps_or_override_defaults() {
    let agent_id = Uuid::from_u128(1);
    let config = RoutineConfiguration {
        name: "Check in".into(),
        triggers: vec![RoutineTrigger::Cron {
            expression: "0 0 9 * * *".into(),
            timezone: "UTC".into(),
        }],
        steps: agent(agent_id),
        required_apps: Some(vec![RoutineApp {
            app_slug: "linear".into(),
            name: "Linear".into(),
        }]),
    };
    let body = configuration_body(&config, Utc::now(), None).unwrap();
    // A lone agent is stored as the single agent task every scheduler reads.
    assert_eq!(
        body["task"],
        serde_json::json!({
            "agent": { "bot_id": agent_id },
            "mcp_servers": [{ "app_slug": "linear", "server_name": "Linear" }],
            "prompt": "",
            "user_prompt": "Summarize blockers",
        })
    );
    assert_eq!(
        body["trigger"],
        serde_json::json!({ "type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC" })
    );
    assert!(body.get("enabled").is_none());
    assert!(body.get("owner").is_none());
}

#[test]
fn schedules_and_activity_combine_into_one_scheduler_trigger() {
    let config: RoutineConfiguration = serde_json::from_value(serde_json::json!({
        "name": "Inbox triage",
        "triggers": [
            { "type": "cron", "expression": "0 0 9 * * MON-FRI", "timezone": "UTC" },
            { "type": "event", "events": ["email.message_received"], "condition": " Is it urgent? " },
            { "type": "event", "events": ["task.status_changed"], "ids": [Uuid::from_u128(7)] }
        ],
        "steps": [{ "type": "agent", "model": "m", "instructions": "Triage" }]
    }))
    .unwrap();
    let body = configuration_body(&config, Utc::now(), None).unwrap();
    assert_eq!(
        body["trigger"],
        serde_json::json!({ "type": "multiple", "triggers": [
            { "type": "cron", "schedule": "0 0 9 * * MON-FRI", "timezone": "UTC" },
            { "type": "events", "filters": [
                { "events": ["email.message_received"], "condition": "Is it urgent?" },
                { "events": ["task.status_changed"], "ids": [Uuid::from_u128(7)] }
            ] }
        ] })
    );
}

#[test]
fn invalid_steps_and_trigger_mismatches_explain_themselves_before_any_request() {
    let triage = serde_json::json!([{ "type": "if", "condition": "Urgent?", "then": [] }]);
    for (triggers, steps, expected) in [
        (
            serde_json::json!([]),
            serde_json::json!([{ "type": "agent", "model": "m", "instructions": "x" }]),
            "Add a trigger",
        ),
        (
            serde_json::json!([{ "type": "event", "events": ["email.message_received"] }]),
            serde_json::json!([]),
            "Invalid steps: add at least one step.",
        ),
        (
            serde_json::json!([{ "type": "cron", "expression": "0 0 9 * * *", "timezone": "UTC" }]),
            triage,
            "need activity triggers only",
        ),
    ] {
        let config: RoutineConfiguration = serde_json::from_value(serde_json::json!({
            "name": "Routine", "triggers": triggers, "steps": steps,
        }))
        .unwrap();
        let error = configuration_body(&config, Utc::now(), None)
            .unwrap_err()
            .to_string();
        assert!(error.contains(expected), "{error}");
    }
}

#[tokio::test]
async fn requests_forward_authenticated_identity_and_preserve_target_and_activation() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/scheduled-action", listener.local_addr().unwrap());
    let id = Uuid::from_u128(1);
    let wire = serde_json::json!({ "id": id, "name": "Check in", "enabled": true, "trigger": { "type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC" }, "task": { "agent": { "bot_id": id }, "prompt": "", "user_prompt": "Summarize blockers" }, "next_run_at": null }).to_string();
    let history = serde_json::json!([{ "id": id, "status": "Completed" }]);
    // Create; update reads the saved routine, then replaces it; pause; read.
    let responses = [
        wire.clone(),
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
        triggers: vec![RoutineTrigger::Once {
            at: Utc::now() + chrono::Duration::hours(1),
        }],
        steps: agent(id),
        required_apps: None,
    };
    client.create(&user, &config).await.unwrap();
    client.update(&user, id, &config).await.unwrap();
    client.set_enabled(&user, id, false).await.unwrap();
    let details = client.read(&user, id).await.unwrap();
    assert_eq!(details.routine.id, id);
    // The saved routine reads back in the shape UpdateRoutine takes.
    let saved = details.routine.configuration.as_ref().unwrap();
    assert_eq!(saved.steps, agent(id));
    assert!(saved.required_apps.as_ref().unwrap().is_empty());
    assert_eq!(serde_json::to_value(details.runs).unwrap(), history);
    let requests = server.await.unwrap();
    for request in &requests {
        assert!(request.contains("x-internal-auth-key: test-internal-key\r\n"));
        assert!(request.contains("x-internal-macro-user-id: macro|routine@example.com\r\n"));
    }
    assert!(requests[0].starts_with("POST /scheduled-action/scheduled-actions HTTP/1.1"));
    for read in [1, 4] {
        assert!(requests[read].starts_with(&format!(
            "GET /scheduled-action/scheduled-actions/{id} HTTP/1.1"
        )));
    }
    assert!(requests[2].starts_with(&format!(
        "PUT /scheduled-action/scheduled-actions/{id} HTTP/1.1"
    )));
    assert!(requests[5].starts_with(&format!(
        "GET /scheduled-action/scheduled-actions/{id}/history HTTP/1.1"
    )));
    let body = |request: &String| -> Value {
        serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap()
    };
    let (created, replaced, paused) = (body(&requests[0]), body(&requests[2]), body(&requests[3]));
    assert_eq!(created["enabled"], true);
    assert!(created.get("owner").is_none());
    assert_eq!(created["task"]["agent"]["bot_id"], id.to_string());
    assert!(created["task"].get("steps").is_none());
    assert!(replaced.get("enabled").is_none());
    assert_eq!(paused, serde_json::json!({"enabled": false}));
}

/// Serve one canned `(status, body)` per request and return the raw requests.
fn serve_responses(
    listener: tokio::net::TcpListener,
    responses: Vec<(&'static str, String)>,
) -> tokio::task::JoinHandle<Vec<String>> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    tokio::spawn(async move {
        let mut requests = Vec::new();
        for (status, body) in responses {
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
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len(),
            );
            stream.write_all(response.as_bytes()).await.unwrap();
        }
        requests
    })
}

#[tokio::test]
async fn delete_and_run_now_call_the_owner_routes() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/scheduled-action", listener.local_addr().unwrap());
    let id = Uuid::from_u128(7);
    let execution = serde_json::json!({
        "action_id": id,
        "chat_id": null,
        "resource": { "type": "agent", "id": "session-1" },
    })
    .to_string();
    let server = serve_responses(
        listener,
        vec![("204 No Content", String::new()), ("200 OK", execution)],
    );
    let client = RoutineClient::new(&url, "test-internal-key").unwrap();
    let user = MacroUserIdStr::parse_from_str("macro|routine@example.com").unwrap();

    client
        .delete(&user, id)
        .await
        .expect("204 is a successful delete");
    let started = client.run_now(&user, id).await.expect("run starts");

    assert_eq!(started.routine_id, id);
    assert_eq!(started.resource.unwrap()["id"], "session-1");
    let requests = server.await.unwrap();
    assert!(requests[0].starts_with(&format!("DELETE /scheduled-action/scheduled-actions/{id} ")));
    assert!(requests[1].starts_with(&format!(
        "POST /scheduled-action/scheduled-actions/{id}/execute "
    )));
    for request in &requests {
        assert!(request.to_lowercase().contains("macro|routine@example.com"));
    }
}

#[tokio::test]
async fn run_now_explains_an_exhausted_ai_allowance() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/scheduled-action", listener.local_addr().unwrap());
    let server = serve_responses(listener, vec![("402 Payment Required", "{}".to_owned())]);
    let client = RoutineClient::new(&url, "test-internal-key").unwrap();
    let user = MacroUserIdStr::parse_from_str("macro|routine@example.com").unwrap();

    let error = client
        .run_now(&user, Uuid::from_u128(7))
        .await
        .expect_err("402 is not a successful run");

    assert!(error.to_string().contains("allowance"), "{error}");
    server.await.unwrap();
}

#[test]
fn the_documented_example_is_a_valid_event_routine() {
    let doc = include_str!("../create_routine.md");
    let (_, example) = doc.split_once("Its `steps` string holds:\n").unwrap();
    let config: RoutineConfiguration = serde_json::from_value(serde_json::json!({
        "name": "Inbox triage",
        "triggers": [{ "type": "event", "events": ["email.message_received"] }],
        "steps": example.trim(),
    }))
    .unwrap();
    let body = configuration_body(&config, Utc::now(), None).unwrap();
    assert_eq!(body["task"]["steps"][0]["type"], "choose");
}

#[test]
fn steps_are_a_json_string_in_the_tool_schema_but_arrays_are_accepted() {
    let schema =
        ai_toolset::schema::generate_validated_input_schema::<crate::inbound::CreateRoutine>()
            .unwrap();
    let text = serde_json::to_string(&schema.schema).unwrap();
    // Recursive or free-form schemas break providers that only accept flat ones.
    assert!(!text.contains("$ref"), "{text}");
    assert!(!text.contains("\"additionalProperties\":true"), "{text}");
    let steps = serde_json::json!([{ "type": "agent", "model": "m", "instructions": "Go" }]);
    for encoded in [serde_json::json!(steps.to_string()), steps] {
        let config: RoutineConfiguration = serde_json::from_value(serde_json::json!({
            "name": "Daily", "steps": encoded,
            "triggers": [{ "type": "cron", "expression": "0 0 9 * * *", "timezone": "UTC" }],
        }))
        .unwrap();
        assert_eq!(config.steps.len(), 1);
    }
}

#[test]
fn required_apps_need_an_agent_step_to_use_them() {
    let config: RoutineConfiguration = serde_json::from_value(serde_json::json!({
        "name": "Post standup",
        "triggers": [{ "type": "cron", "expression": "0 0 9 * * *", "timezone": "UTC" }],
        "steps": [{ "type": "tool", "tool": "SendChannelMessage",
                    "arguments": { "channel_id": "c", "content": "Standup" } }],
        "requiredApps": [{ "appSlug": "linear", "name": "Linear" }],
    }))
    .unwrap();
    let error = configuration_body(&config, Utc::now(), None)
        .unwrap_err()
        .to_string();
    assert!(error.contains("add an agent step"), "{error}");
}
