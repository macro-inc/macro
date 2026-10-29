use serde_json::{Value, json};
use strum::IntoEnumIterator;

use super::*;

fn raw(surface: &str, title: &str, trigger: Value) -> Value {
    json!({
        "surface": surface,
        "title": title,
        "summary": " Tags every invoice. ",
        "reason": "Invoices arrive weekly",
        "instructions": " Label invoices from Acme. ",
        "icon": "tag",
        "keepProbability": 0.9,
        "affectsOthers": false,
        "notify": false,
        "trigger": trigger,
    })
}

fn email_event() -> Value {
    json!({ "kind": "event", "event": "email.message_received", "condition": " Is this an invoice? " })
}

fn decode(items: Vec<Value>) -> Vec<RoutineSuggestion> {
    decode_suggestions(RawSuggestions { suggestions: items })
}

#[test]
fn decodes_an_event_suggestion_trimming_its_text() {
    let decoded = decode(vec![raw("email", " Tag invoices ", email_event())]);

    assert_eq!(
        decoded,
        vec![RoutineSuggestion {
            surface: RoutineSurface::Email,
            title: "Tag invoices".to_owned(),
            summary: "Tags every invoice.".to_owned(),
            reason: "Invoices arrive weekly".to_owned(),
            instructions: "Label invoices from Acme.".to_owned(),
            icon: SuggestionIcon::Tag,
            keep_probability: 0.9,
            affects_others: false,
            notify: false,
            trigger: SuggestionTrigger::Event {
                event: SuggestedEvent::EmailMessageReceived,
                condition: Some("Is this an invoice?".to_owned()),
            },
        }]
    );
}

#[test]
fn decodes_each_schedule_frequency() {
    let time = || ClockTime::try_from("08:30".to_owned()).unwrap();
    let cases = [
        (
            json!({ "kind": "schedule", "frequency": "hour" }),
            SuggestionSchedule::Hour,
        ),
        (
            json!({ "kind": "schedule", "frequency": "day", "time": "08:30" }),
            SuggestionSchedule::Day { time: time() },
        ),
        (
            json!({ "kind": "schedule", "frequency": "week", "time": "08:30", "weekdays": ["Mon", "fri", "mon"] }),
            SuggestionSchedule::Week {
                time: time(),
                weekdays: vec![Weekday::Mon, Weekday::Fri],
            },
        ),
        (
            json!({ "kind": "schedule", "frequency": "month", "time": "08:30", "dayOfMonth": 28 }),
            SuggestionSchedule::Month {
                time: time(),
                day_of_month: 28,
            },
        ),
        (
            json!({ "kind": "schedule", "frequency": "month", "time": "08:30" }),
            SuggestionSchedule::Month {
                time: time(),
                day_of_month: 1,
            },
        ),
    ];
    for (trigger, schedule) in cases {
        let decoded = decode(vec![raw("agents", "Brief me", trigger.clone())]);
        assert_eq!(
            decoded.first().map(|suggestion| &suggestion.trigger),
            Some(&SuggestionTrigger::Schedule { schedule }),
            "{trigger}"
        );
    }
}

#[test]
fn drops_suggestions_it_cannot_use() {
    let long_condition = "x".repeat(MAX_CONDITION_CHARS + 1);
    let unusable = [
        raw("billing", "Tag invoices", email_event()),
        raw("email", "  ", email_event()),
        json!({ "surface": "email", "title": "Missing fields" }),
        raw(
            "email",
            "Unknown event",
            json!({ "kind": "event", "event": "channel.message_posted" }),
        ),
        raw(
            "email",
            "Long condition",
            json!({ "kind": "event", "event": "email.message_received", "condition": long_condition }),
        ),
        raw("agents", "Unknown kind", json!({ "kind": "webhook" })),
        raw(
            "agents",
            "No time",
            json!({ "kind": "schedule", "frequency": "day" }),
        ),
        raw(
            "agents",
            "Bad time",
            json!({ "kind": "schedule", "frequency": "day", "time": "8:30" }),
        ),
        raw(
            "agents",
            "Late time",
            json!({ "kind": "schedule", "frequency": "day", "time": "24:00" }),
        ),
        raw(
            "agents",
            "No days",
            json!({ "kind": "schedule", "frequency": "week", "time": "08:30", "weekdays": [] }),
        ),
        raw(
            "agents",
            "Bad day",
            json!({ "kind": "schedule", "frequency": "week", "time": "08:30", "weekdays": ["mon", "someday"] }),
        ),
        raw(
            "agents",
            "Day 29",
            json!({ "kind": "schedule", "frequency": "month", "time": "08:30", "dayOfMonth": 29 }),
        ),
        raw(
            "agents",
            "Day 0",
            json!({ "kind": "schedule", "frequency": "month", "time": "08:30", "dayOfMonth": 0 }),
        ),
        raw(
            "agents",
            "Yearly",
            json!({ "kind": "schedule", "frequency": "year", "time": "08:30" }),
        ),
    ];

    assert_eq!(decode(unusable.to_vec()), Vec::new());
}

#[test]
fn keeps_a_condition_at_the_limit_and_drops_a_blank_one() {
    let at_limit = "é".repeat(MAX_CONDITION_CHARS);
    let decoded = decode(vec![
        raw(
            "email",
            "At limit",
            json!({ "kind": "event", "event": "email.message_received", "condition": at_limit }),
        ),
        raw(
            "email",
            "Blank",
            json!({ "kind": "event", "event": "email.message_received", "condition": "  " }),
        ),
    ]);

    assert_eq!(decoded.len(), 2);
    assert_eq!(
        decoded[1].trigger,
        SuggestionTrigger::Event {
            event: SuggestedEvent::EmailMessageReceived,
            condition: None,
        }
    );
}

#[test]
fn caps_each_surface_and_skips_repeats() {
    let decoded = decode(vec![
        raw("email", "One", email_event()),
        raw("email", "one", email_event()),
        raw("email", "Two", email_event()),
        raw("crm", "One", email_event()),
        raw("email", "Three", email_event()),
        raw("email", "Four", email_event()),
    ]);

    let titles: Vec<_> = decoded
        .iter()
        .map(|suggestion| (suggestion.surface, suggestion.title.as_str()))
        .collect();
    assert_eq!(
        titles,
        [
            (RoutineSurface::Email, "One"),
            (RoutineSurface::Email, "Two"),
            (RoutineSurface::Crm, "One"),
            (RoutineSurface::Email, "Three"),
        ]
    );
}

#[test]
fn falls_back_to_sparkle_and_clamps_keep_probability() {
    let mut item = raw("email", "Tag invoices", email_event());
    item["icon"] = json!("rocket");
    item["keepProbability"] = json!(1.4);
    let mut low = raw("email", "Flag mail", email_event());
    low["keepProbability"] = json!(-0.2);

    let decoded = decode(vec![item, low]);

    assert_eq!(decoded[0].icon, SuggestionIcon::Sparkle);
    assert_eq!(decoded[0].keep_probability, 1.0);
    assert_eq!(decoded[1].keep_probability, 0.0);
}

#[test]
fn schema_names_every_value_the_decoder_accepts() {
    let schema = response_schema().to_string();

    let values = RoutineSurface::iter()
        .map(|surface| surface.to_string())
        .chain(SuggestionIcon::iter().map(|icon| icon.to_string()))
        .chain(SuggestedEvent::iter().map(|event| event.to_string()))
        .chain(Weekday::iter().map(|day| day.to_string()));
    for value in values {
        assert!(schema.contains(&value), "schema never mentions {value}");
    }
    assert!(
        agent::structured_output::validate_schema(&agent::structured_output::DynamicSchema {
            schema: response_schema(),
            name: "RoutineSuggestions".to_owned(),
            description: None,
        })
        .is_ok()
    );
}

#[test]
fn suggestions_round_trip_through_their_stored_shape() {
    let decoded = decode(vec![
        raw("email", "Tag invoices", email_event()),
        raw(
            "agents",
            "Weekly review",
            json!({ "kind": "schedule", "frequency": "week", "time": "16:00", "weekdays": ["fri"] }),
        ),
    ]);

    let stored = serde_json::to_value(&decoded).unwrap();

    assert_eq!(
        stored[1]["trigger"],
        json!({ "kind": "schedule", "schedule": { "frequency": "week", "time": "16:00", "weekdays": ["fri"] } })
    );
    assert_eq!(stored[0]["keepProbability"], json!(0.9));
    assert_eq!(
        serde_json::from_value::<Vec<RoutineSuggestion>>(stored).unwrap(),
        decoded
    );
}
