use serde_json::{Value, json};

use super::super::{ADA, start};
use super::SEED;
use crate::Seed;

async fn body(response: reqwest::Response) -> Value {
    assert_eq!(response.status(), 200);
    response.json().await.unwrap()
}

#[tokio::test]
async fn the_example_seed_has_calendars_for_a_stack_to_show() {
    let seed = Seed::parse(include_str!("../../../seed.example.yaml")).unwrap();
    let (emulator, _) = start(&serde_json::to_string(&seed).unwrap()).await;

    let calendars = emulator.calendars(ADA).unwrap();

    assert!(calendars.len() > 1);
    assert!(calendars[0].is_default && calendars[0].events > 0);
}

#[tokio::test]
async fn the_control_api_lists_adds_changes_answers_and_deletes_events() {
    let (emulator, _) = start(SEED).await;
    let http = reqwest::Client::new();
    let mailbox = format!("{}/_emulator/mailboxes/{ADA}", emulator.base_url());

    let calendars = body(
        http.get(format!("{mailbox}/calendars"))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(calendars[0]["name"], "Calendar");
    assert_eq!(calendars[0]["events"], 3);
    assert_eq!(calendars[1]["can_edit"], false);

    let added = http
        .post(format!("{mailbox}/calendars/default/events"))
        .json(&json!({
            "subject": "Interview",
            "start": {"dateTime": "2026-11-25T15:00:00", "timeZone": "UTC"},
            "end": {"dateTime": "2026-11-25T16:00:00", "timeZone": "UTC"},
            "attendees": [{"emailAddress": {"address": "grace@example.com", "name": "Grace"}}],
        }))
        .send()
        .await
        .unwrap();
    let added = body(added).await;
    let id = added["id"].as_str().unwrap();

    let changed = http
        .patch(format!("{mailbox}/events/{id}"))
        .json(&json!({"subject": "Interview: Grace", "showAs": "tentative"}))
        .send()
        .await
        .unwrap();
    assert_eq!(changed.status(), 200);
    let answered = http
        .post(format!("{mailbox}/events/{id}/answers"))
        .json(&json!({"attendee": "grace@example.com", "response": "declined"}))
        .send()
        .await
        .unwrap();
    assert_eq!(answered.status(), 200);

    let events = body(
        http.get(format!("{mailbox}/calendars/Calendar/events"))
            .send()
            .await
            .unwrap(),
    )
    .await;
    let interview = events.as_array().unwrap().last().unwrap();
    assert_eq!(interview["subject"], "Interview: Grace");
    assert_eq!(interview["showAs"], "tentative");
    assert_eq!(interview["attendees"][0]["status"]["response"], "declined");

    let zone = http
        .put(format!("{mailbox}/time-zone"))
        .json(&json!({"time_zone": "Europe/Paris"}))
        .send()
        .await
        .unwrap();
    assert_eq!(zone.status(), 200);
    let deleted = http
        .delete(format!("{mailbox}/events/{id}"))
        .send()
        .await
        .unwrap();
    assert_eq!(deleted.status(), 200);
    let unknown = http
        .delete(format!("{mailbox}/events/{id}"))
        .send()
        .await
        .unwrap();
    assert_eq!(unknown.status(), 404);
    let invalid = http
        .post(format!("{mailbox}/calendars/default/events"))
        .json(&json!({"subject": "No time"}))
        .send()
        .await
        .unwrap();
    assert_eq!(invalid.status(), 400);
}
