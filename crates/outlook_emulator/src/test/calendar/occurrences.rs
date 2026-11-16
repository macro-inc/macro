//! Single occurrences of a series: changed, answered, deleted and reset.

use chrono::NaiveDate;
use serde_json::{Value, json};

use super::super::{ADA, BOB, start};
use super::{SEED, access_token, new_event, stored, stored_id};
use crate::calendar::occurrence_id;
use crate::{EmulatorError, OutlookEmulator};

const CAROL: &str = "carol@example.com";
const TWO_MAILBOXES: &str = "mailboxes:\n  - email: ada@example.com\n    name: Ada Example\n  - email: bob@example.com\n    name: Bob Example\n";

fn date(text: &str) -> NaiveDate {
    text.parse().unwrap()
}

fn pacific(local: &str) -> Value {
    json!({"dateTime": local, "timeZone": "America/Los_Angeles"})
}

/// A weekly meeting Ada organizes with Bob and someone outside the emulator.
fn standup(emulator: &OutlookEmulator) -> String {
    let guest = |address: &str| json!({"emailAddress": {"address": address}, "type": "required"});
    let event = new_event(json!({
        "subject": "Standup",
        "start": pacific("2026-11-02T09:00:00"),
        "end": pacific("2026-11-02T09:15:00"),
        "attendees": [guest(BOB), guest(CAROL)],
        "recurrence": {
            "pattern": {"type": "weekly", "interval": 1, "daysOfWeek": ["monday"]},
            "range": {"type": "numbered", "startDate": "2026-11-02", "numberOfOccurrences": 4},
        },
    }));
    emulator.add_event(ADA, "default", &event).unwrap()
}

async fn get(emulator: &OutlookEmulator, email: &str, path: &str) -> Value {
    let response = reqwest::Client::new()
        .get(format!("{}/{path}", emulator.graph_url()))
        .bearer_auth(emulator.access_token(email).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200, "{path}");
    response.json().await.unwrap()
}

#[tokio::test]
async fn an_occurrence_is_checked_against_its_own_times() {
    let (emulator, _) = start(SEED).await;
    let series = stored_id(&emulator, ADA, "Weekly sync");
    let second = occurrence_id(&series, date("2026-11-09"));

    // Later than the series' first occurrence ends, but before its own end.
    let start_only = new_event(json!({"start": pacific("2026-11-09T09:10:00")}));
    emulator.update_event(ADA, &second, &start_only).unwrap();

    let before_start = new_event(json!({"end": pacific("2026-11-09T08:30:00")}));
    let refused = emulator.update_event(ADA, &second, &before_start);
    assert!(matches!(refused, Err(EmulatorError::InvalidEvent(_))));

    let occurrence = get(&emulator, ADA, &format!("me/events/{second}")).await;
    assert_eq!(
        occurrence["start"]["dateTime"],
        "2026-11-09T17:10:00.0000000"
    );
    assert_eq!(occurrence["end"]["dateTime"], "2026-11-09T17:30:00.0000000");
}

#[tokio::test]
async fn every_guest_answer_to_one_occurrence_is_kept() {
    let (emulator, _) = start(TWO_MAILBOXES).await;
    let series = standup(&emulator);
    let second = occurrence_id(&series, date("2026-11-09"));

    emulator
        .answer_event(ADA, &second, BOB, "accepted")
        .unwrap();
    emulator
        .answer_event(ADA, &second, CAROL, "declined")
        .unwrap();

    let occurrence = get(&emulator, ADA, &format!("me/events/{second}")).await;
    let answers: Vec<_> = occurrence["attendees"]
        .as_array()
        .unwrap()
        .iter()
        .map(|attendee| attendee["status"]["response"].as_str().unwrap())
        .collect();
    assert_eq!(answers, ["accepted", "declined"]);
}

#[tokio::test]
async fn a_moved_series_starts_over_on_the_guests_calendar() {
    let (emulator, _) = start(TWO_MAILBOXES).await;
    let series = standup(&emulator);
    emulator
        .delete_event(ADA, &occurrence_id(&series, date("2026-11-09")))
        .unwrap();
    let copy = stored(&emulator, BOB, "default", "Standup");
    assert_eq!(copy["cancelledOccurrences"], json!(["2026-11-09"]));

    let later = new_event(json!({
        "start": pacific("2026-11-02T10:00:00"),
        "end": pacific("2026-11-02T10:15:00"),
    }));
    emulator.update_event(ADA, &series, &later).unwrap();

    let organizers = stored(&emulator, ADA, "default", "Standup");
    assert_eq!(organizers["cancelledOccurrences"], json!([]));
    let copy = stored(&emulator, BOB, "default", "Standup");
    assert_eq!(copy["cancelledOccurrences"], json!([]));
}

#[tokio::test]
async fn a_deleted_occurrence_is_reported_though_its_series_changes_mid_round() {
    let (emulator, _) = start(SEED).await;
    let http = reqwest::Client::new();
    let token = access_token(&emulator);
    let page = async |url: String| -> Value {
        let response = http.get(url).bearer_auth(&token).send().await.unwrap();
        assert_eq!(response.status(), 200);
        response.json().await.unwrap()
    };
    let removed = |page: &Value| -> Vec<String> {
        let entries = page["value"].as_array().unwrap().iter();
        entries
            .filter(|entry| entry.get("@removed").is_some())
            .map(|entry| entry["id"].as_str().unwrap().to_string())
            .collect()
    };
    let next = |page: &Value| page["@odata.nextLink"].as_str().map(str::to_string);
    let delta = |page: &Value| page["@odata.deltaLink"].as_str().map(str::to_string);

    // A first round, one entry a page.
    let mut current = page(format!(
        "{}/me/calendarView/delta?startDateTime=2026-01-01T00:00:00Z&endDateTime=2027-01-01T00:00:00Z&$top=1",
        emulator.graph_url()
    ))
    .await;
    while let Some(link) = next(&current) {
        current = page(link).await;
    }
    let series = stored_id(&emulator, ADA, "Weekly sync");
    let second = occurrence_id(&series, date("2026-11-09"));
    emulator.delete_event(ADA, &second).unwrap();

    // The series changes again between two pages of the next round.
    let mut current = page(delta(&current).unwrap()).await;
    let mut seen = removed(&current);
    let retitled = new_event(json!({"subject": "Weekly sync, renamed"}));
    emulator.update_event(ADA, &series, &retitled).unwrap();
    for _ in 0..2 {
        while let Some(link) = next(&current) {
            current = page(link).await;
            seen.extend(removed(&current));
        }
        current = page(delta(&current).unwrap()).await;
        seen.extend(removed(&current));
    }

    assert_eq!(seen, [second]);
}
