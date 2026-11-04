use super::*;
use axum::{Json, Router, routing::post};
use chrono::{TimeZone, Utc};
use std::sync::{Arc, Mutex};
use trigger_context::{ContextPerson, ProjectRef, TaskAssignedContext, TaskSnapshot};
use uuid::Uuid;

/// Everyone keeps time in New York, the way their primary calendars say.
struct NewYork;

impl UserTimeZones for NewYork {
    async fn time_zone(&self, _user: &MacroUserIdStr<'static>) -> Option<String> {
        Some("America/New_York".to_owned())
    }
}

/// Nobody's time zone is known.
struct Unknown;

impl UserTimeZones for Unknown {
    async fn time_zone(&self, _user: &MacroUserIdStr<'static>) -> Option<String> {
        None
    }
}

fn afternoon_in_new_york() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 24, 20, 3, 36).unwrap()
}

/// The trigger crosses a service boundary, so the body the lexical service
/// validates is asserted here rather than only in its own types.
#[tokio::test]
async fn the_trigger_reaches_the_lexical_service_beside_the_people() {
    let received: Arc<Mutex<Option<serde_json::Value>>> = Arc::default();
    let seen = received.clone();
    let app = Router::new().route(
        "/agent-context",
        post(move |Json(body): Json<serde_json::Value>| {
            let seen = seen.clone();
            async move {
                *seen.lock().unwrap() = Some(body);
                Json(serde_json::json!({ "markdown": "composed" }))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let composer = LexicalAgentPromptComposer::new(
        LexicalClient::new("test".into(), format!("http://{address}")),
        NewYork,
    )
    .with_clock(afternoon_in_new_york);
    let owner = MacroUserIdStr::try_from_email("julia@example.com").unwrap();
    let trigger = TriggerContext::TaskAssigned(TaskAssignedContext {
        task: TaskSnapshot {
            id: "task-1".to_owned(),
            title: "Fix calendar popover scroll".to_owned(),
            markdown: "The popover scrolls the page behind it.".to_owned(),
            status: Some("Todo".to_owned()),
            priority: None,
            due: None,
            assignees: Vec::new(),
            project: Some(ProjectRef {
                id: Uuid::from_u128(0xA1),
                name: "Calendar polish".to_owned(),
            }),
        },
        assigned_by: ContextPerson {
            id: "macro|julia@example.com".to_owned(),
            name: "Julia".to_owned(),
            email: Some("julia@example.com".to_owned()),
        },
        assigned_at: Utc.with_ymd_and_hms(2026, 10, 8, 14, 2, 0).unwrap(),
        discussion_id: Uuid::from_u128(0xD1),
    });

    let composed = composer
        .compose(
            "Work on the task",
            Some("Be brief."),
            Some(&PromptPeople {
                owner: owner.clone(),
                sender: Some(owner),
            }),
            Some(&trigger),
        )
        .await
        .unwrap();

    assert_eq!(composed, "composed");
    assert_eq!(
        received.lock().unwrap().take().unwrap(),
        serde_json::json!({
            "promptMarkdown": "Work on the task",
            "instructions": "Be brief.",
            "owner": { "id": "macro|julia@example.com", "name": "julia@example.com" },
            "sender": { "id": "macro|julia@example.com", "name": "julia@example.com" },
            "currentTime": {
                "iso": "2026-09-24T16:03:36-04:00",
                "local": "Thursday, September 24, 2026, 4:03 PM",
                "timeZone": "America/New_York"
            },
            "trigger": {
                "kind": "task_assigned",
                "task": {
                    "id": "task-1",
                    "title": "Fix calendar popover scroll",
                    "markdown": "The popover scrolls the page behind it.",
                    "status": "Todo",
                    "project": {
                        "id": "00000000-0000-0000-0000-0000000000a1",
                        "name": "Calendar polish"
                    }
                },
                "assigned_by": {
                    "id": "macro|julia@example.com",
                    "name": "Julia",
                    "email": "julia@example.com"
                },
                "assigned_at": "2026-10-08T14:02:00Z",
                "discussion_id": "00000000-0000-0000-0000-0000000000d1"
            }
        })
    );
    server.abort();
}

#[tokio::test]
async fn a_prompt_without_a_trigger_sends_none() {
    let received: Arc<Mutex<Option<serde_json::Value>>> = Arc::default();
    let seen = received.clone();
    let app = Router::new().route(
        "/agent-context",
        post(move |Json(body): Json<serde_json::Value>| {
            let seen = seen.clone();
            async move {
                *seen.lock().unwrap() = Some(body);
                Json(serde_json::json!({ "markdown": "Sanitized prompt" }))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let composer = LexicalAgentPromptComposer::new(
        LexicalClient::new("test".into(), format!("http://{address}")),
        Unknown,
    )
    .with_clock(afternoon_in_new_york);

    let composed = composer
        .compose("Raw prompt", None, None, None)
        .await
        .unwrap();

    assert_eq!(composed, "Sanitized prompt");
    assert_eq!(
        received.lock().unwrap().take().unwrap(),
        serde_json::json!({
            "promptMarkdown": "Raw prompt",
            "currentTime": {
                "iso": "2026-09-24T20:03:36+00:00",
                "local": "Thursday, September 24, 2026, 8:03 PM"
            }
        })
    );
    server.abort();
}
