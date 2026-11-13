use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use serde_json::{Value, json};

use crate::domain::event_trigger::ActionTrigger;

fn now() -> DateTime<Utc> {
    "2026-11-13T12:00:00Z".parse().unwrap()
}

fn describe(trigger: Value) -> String {
    serde_json::from_value::<ActionTrigger>(trigger)
        .unwrap()
        .describe(chrono_tz::America::New_York, now())
}

fn cron(schedule: &str) -> String {
    describe(json!({ "type": "cron", "schedule": schedule, "timezone": "Europe/Paris" }))
}

fn events(filter: Value) -> String {
    describe(json!({ "type": "events", "filters": [filter] }))
}

#[test]
fn a_plain_schedule_reads_as_the_editor_words_it() {
    for (schedule, words) in [
        ("0 0 * * * *", "Every hour"),
        ("0 15 * * * ?", "Every hour at :15"),
        ("0 0 9 * * *", "Every day at 9:00 AM"),
        ("0 30 17 * * ?", "Every day at 5:30 PM"),
        ("0 0 0 * * *", "Every day at 12:00 AM"),
        ("0 0 9 * * 1-7", "Every day at 9:00 AM"),
        ("0 0 9 * * MON-FRI", "Weekdays at 9:00 AM"),
        ("0 0 9 ? * 2-6", "Weekdays at 9:00 AM"),
        ("0 0 10 * * SAT,SUN", "Weekends at 10:00 AM"),
        ("0 0 9 * * FRI", "Fridays at 9:00 AM"),
        ("0 0 9 * * MON,WED,FRI", "Mon, Wed and Fri at 9:00 AM"),
        ("0 0 9 * * SUN,MON", "Mon and Sun at 9:00 AM"),
        ("0 0 9 1 * ?", "Monthly on the 1st at 9:00 AM"),
        ("0 0 9 2 * *", "Monthly on the 2nd at 9:00 AM"),
        ("0 0 9 3 * *", "Monthly on the 3rd at 9:00 AM"),
        ("0 0 9 11 * *", "Monthly on the 11th at 9:00 AM"),
        ("0 0 9 22 * *", "Monthly on the 22nd at 9:00 AM"),
        ("0 0 9 * * * *", "Every day at 9:00 AM"),
    ] {
        assert_eq!(cron(schedule), words, "{schedule}");
    }
}

#[test]
fn a_schedule_for_one_date_reads_as_that_date() {
    assert_eq!(cron("0 0 9 31 12 * 2026"), "Dec 31 at 9:00 AM");
    assert_eq!(cron("0 5 14 2 1 * 2027"), "Jan 2, 2027 at 2:05 PM");
}

#[test]
fn any_other_schedule_reads_as_its_cron() {
    for schedule in [
        "0 */10 * * * *",
        "30 0 9 * * *",
        "0 0 9,17 * * *",
        "0 0 9 1,15 * *",
        "0 0 9 * 1 *",
        "0 0 9 1 * MON",
        "0 0 * * * MON",
        "0 0 9 25 12 *",
    ] {
        assert_eq!(cron(schedule), format!("Custom schedule ({schedule})"));
    }
}

#[test]
fn a_one_off_time_reads_in_the_readers_zone() {
    assert_eq!(
        describe(json!({ "type": "once", "at": "2026-11-20T14:00:00Z" })),
        "Nov 20 at 9:00 AM"
    );
    assert_eq!(
        describe(json!({ "type": "once", "at": "2027-01-01T04:30:00Z" })),
        "Dec 31 at 11:30 PM"
    );
    assert_eq!(
        describe(json!({ "type": "once", "at": "2027-03-01T15:00:00Z" })),
        "Mar 1, 2027 at 10:00 AM"
    );
    let paris = serde_json::from_value::<ActionTrigger>(
        json!({ "type": "once", "at": "2026-11-20T14:00:00Z" }),
    )
    .unwrap()
    .describe(Tz::Europe__Paris, now());
    assert_eq!(paris, "Nov 20 at 3:00 PM");
}

#[test]
fn macro_events_read_by_their_names() {
    assert_eq!(
        events(json!({ "events": ["email.message_received"] })),
        "New email received"
    );
    assert_eq!(
        events(json!({ "events": ["document.created", "channel.mentioned"] })),
        "Document created, @ mentioned in channel"
    );
    assert_eq!(
        events(json!({ "events": ["channel.message_patched"] })),
        "Message edited"
    );
    assert_eq!(events(json!({ "events": ["call.ended"] })), "Call ended");
}

#[test]
fn a_task_property_change_reads_by_its_property() {
    let property = |definition: &str| {
        events(json!({
            "events": ["task.property_changed"],
            "property": { "definitionId": definition },
        }))
    };
    assert_eq!(
        property("00000001-0000-0000-0000-000000000004"),
        "Due date changed"
    );
    assert_eq!(
        property("00000001-0000-0000-0000-000000000001"),
        "Assignees changed"
    );
    assert_eq!(
        property("00000001-0000-0000-0000-000000000014"),
        "Project changed"
    );
    assert_eq!(
        property("00000001-0000-0000-0000-000000000009"),
        "Property changed"
    );
    assert_eq!(
        events(json!({ "events": ["task.property_changed"] })),
        "Any property changed"
    );
}

#[test]
fn github_deliveries_read_as_the_menus_presets() {
    let github = |selector: Value, matches: Option<Value>| {
        let mut filter = json!({ "events": ["github"], "github": selector });
        if let Some(matches) = matches {
            filter["match"] = matches;
        }
        events(filter)
    };
    assert_eq!(
        github(
            json!({ "events": ["pull_request"], "actions": ["opened"] }),
            None
        ),
        "Pull request opened"
    );
    assert_eq!(
        github(
            json!({ "events": ["workflow_run"], "actions": ["completed"] }),
            Some(json!([{ "path": ["workflow_run", "conclusion"], "equals": "failure" }]))
        ),
        "Workflow failed"
    );
    assert_eq!(
        github(
            json!({ "events": ["workflow_run"], "actions": ["completed"] }),
            None
        ),
        "Workflow finished"
    );
    assert_eq!(github(json!({ "events": ["push"] }), None), "Code pushed");
    assert_eq!(github(json!({}), None), "Any GitHub event");
    assert_eq!(
        github(json!({ "events": ["star", "fork"] }), None),
        "GitHub fork, star"
    );
}

#[test]
fn several_triggers_read_as_the_first() {
    assert_eq!(
        describe(json!({
            "type": "multiple",
            "triggers": [
                { "type": "events", "filters": [{ "events": ["task.created"] }] },
                { "type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC" },
            ],
        })),
        "Task created"
    );
    assert_eq!(
        describe(json!({
            "type": "multiple",
            "triggers": [
                { "type": "cron", "schedule": "0 0 9 * * MON", "timezone": "UTC" },
                { "type": "events", "filters": [{ "events": ["task.created"] }] },
            ],
        })),
        "Mondays at 9:00 AM"
    );
}
