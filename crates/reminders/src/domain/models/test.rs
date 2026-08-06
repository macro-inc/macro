use chrono::TimeZone;
use chrono_tz::America::New_York;

use super::*;

/// Daily at 09:00 in the cron crate's 6-field form.
const DAILY_9AM: &str = "0 0 9 * * *";

fn utc(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(y, m, d, h, min, 0)
        .single()
        .expect("unambiguous instant")
}

#[test]
fn cron_parse_accepts_six_field_expression() {
    let cron = ReminderCron::parse(DAILY_9AM).expect("six-field cron should parse");
    assert_eq!(cron.as_str(), DAILY_9AM);
}

#[test]
fn cron_parse_rejects_garbage() {
    assert!(ReminderCron::parse("not a cron").is_err());
}

#[test]
fn cron_parse_normalizes_conventional_five_field_expression() {
    // The cron crate wants a seconds field, but 5-field is what clients
    // actually send, so it is promoted rather than rejected.
    let cron = ReminderCron::parse("0 9 * * *").expect("five-field cron should normalize");
    assert_eq!(cron.as_str(), DAILY_9AM);

    // The normalized form means the same thing as the explicit one.
    let five = ReminderSchedule::Recurring {
        cron: ReminderCron::parse("0 9 * * *").expect("valid cron"),
        timezone: New_York,
    };
    let six = ReminderSchedule::Recurring {
        cron: ReminderCron::parse(DAILY_9AM).expect("valid cron"),
        timezone: New_York,
    };
    assert_eq!(
        five.next_run_after(utc(2026, 7, 1, 0, 0)),
        six.next_run_after(utc(2026, 7, 1, 0, 0))
    );
}

#[test]
fn cron_parse_rejects_a_field_count_it_cannot_interpret() {
    // Four fields is not a form either convention uses.
    assert!(ReminderCron::parse("9 * * *").is_err());
}

#[test]
fn invalid_cron_error_names_both_accepted_forms() {
    let err = ReminderCron::parse("not a cron").expect_err("garbage should be rejected");
    let message = err.to_string();
    assert!(
        message.contains("5 fields"),
        "unexpected message: {message}"
    );
    assert!(
        message.contains("6-7 fields"),
        "unexpected message: {message}"
    );
    assert!(
        message.contains("0 0 9 * * *"),
        "unexpected message: {message}"
    );
}

#[test]
fn recurring_next_run_is_evaluated_in_the_reminder_timezone() {
    let schedule = ReminderSchedule::Recurring {
        cron: ReminderCron::parse(DAILY_9AM).expect("valid cron"),
        timezone: New_York,
    };

    // July: New York is UTC-4, so 09:00 local is 13:00Z.
    let next = schedule
        .next_run_after(utc(2026, 7, 1, 0, 0))
        .expect("daily cron always has an upcoming firing");
    assert_eq!(next, utc(2026, 7, 1, 13, 0));

    // January: New York is UTC-5, so the same expression lands at 14:00Z.
    let next = schedule
        .next_run_after(utc(2026, 1, 1, 0, 0))
        .expect("daily cron always has an upcoming firing");
    assert_eq!(next, utc(2026, 1, 1, 14, 0));
}

#[test]
fn recurring_next_run_skips_todays_firing_once_it_has_passed() {
    let schedule = ReminderSchedule::Recurring {
        cron: ReminderCron::parse(DAILY_9AM).expect("valid cron"),
        timezone: New_York,
    };

    let next = schedule
        .next_run_after(utc(2026, 7, 1, 13, 0))
        .expect("daily cron always has an upcoming firing");
    assert_eq!(next, utc(2026, 7, 2, 13, 0));
}

#[test]
fn once_next_run_is_the_instant_itself() {
    let remind_at = utc(2026, 7, 1, 13, 0);
    let schedule = ReminderSchedule::Once { remind_at };

    assert_eq!(
        schedule.next_run_after(utc(2026, 7, 1, 12, 0)),
        Some(remind_at)
    );
}

#[test]
fn once_next_run_is_none_once_the_instant_has_passed() {
    let schedule = ReminderSchedule::Once {
        remind_at: utc(2026, 7, 1, 13, 0),
    };

    assert_eq!(schedule.next_run_after(utc(2026, 7, 1, 13, 0)), None);
    assert_eq!(schedule.next_run_after(utc(2026, 7, 1, 14, 0)), None);
}

#[test]
fn repeats_distinguishes_the_two_modes() {
    let once = ReminderSchedule::Once {
        remind_at: utc(2026, 7, 1, 13, 0),
    };
    let recurring = ReminderSchedule::Recurring {
        cron: ReminderCron::parse(DAILY_9AM).expect("valid cron"),
        timezone: New_York,
    };

    assert!(!once.repeats());
    assert!(recurring.repeats());
}

#[test]
fn schedule_round_trips_through_the_wire_format() {
    let once: ReminderSchedule =
        serde_json::from_str(r#"{"type":"once","remindAt":"2026-07-01T13:00:00Z"}"#)
            .expect("one-shot schedule should deserialize");
    assert_eq!(
        once,
        ReminderSchedule::Once {
            remind_at: utc(2026, 7, 1, 13, 0)
        }
    );

    let recurring: ReminderSchedule = serde_json::from_str(
        r#"{"type":"recurring","cron":"0 0 9 * * *","timezone":"America/New_York"}"#,
    )
    .expect("recurring schedule should deserialize");
    assert_eq!(
        recurring,
        ReminderSchedule::Recurring {
            cron: ReminderCron::parse(DAILY_9AM).expect("valid cron"),
            timezone: New_York,
        }
    );

    let json = serde_json::to_value(&recurring).expect("schedule should serialize");
    assert_eq!(json["type"], "recurring");
    assert_eq!(json["cron"], DAILY_9AM);
    assert_eq!(json["timezone"], "America/New_York");
}

#[test]
fn deserializing_an_invalid_cron_fails_at_the_edge() {
    let err = serde_json::from_str::<ReminderSchedule>(
        r#"{"type":"recurring","cron":"every tuesday","timezone":"America/New_York"}"#,
    )
    .expect_err("an uninterpretable cron should be rejected");
    assert!(
        err.to_string().contains("invalid cron expression"),
        "unexpected error: {err}"
    );
}

#[test]
fn entity_is_present_only_when_both_columns_are() {
    let reminder = |entity_type, entity_id| Reminder {
        id: Uuid::nil(),
        description: "ping".to_string(),
        entity_type,
        entity_id,
        schedule: ReminderSchedule::Once {
            remind_at: utc(2026, 7, 1, 13, 0),
        },
        next_run_at: utc(2026, 7, 1, 13, 0),
        enabled: true,
        completed_at: None,
        created_at: utc(2026, 6, 1, 0, 0),
        updated_at: utc(2026, 6, 1, 0, 0),
    };

    let attached = reminder(Some(EntityType::Document), Some("doc-1".to_string()));
    let entity = attached.entity().expect("attached reminder has an entity");
    assert_eq!(entity.entity_type, EntityType::Document);
    assert_eq!(entity.entity_id, "doc-1");

    assert!(reminder(None, None).entity().is_none());
}

#[test]
fn empty_patch_is_detected() {
    assert!(ReminderPatch::default().is_empty());
    assert!(
        !ReminderPatch {
            enabled: Some(false),
            ..Default::default()
        }
        .is_empty()
    );
}

/// 02:30 daily — a local time that does not exist on the spring-forward date.
const DAILY_230AM: &str = "0 30 2 * * *";
/// 01:30 daily — a local time that happens twice on the fall-back date.
const DAILY_130AM: &str = "0 30 1 * * *";

fn ny_recurring(cron: &str) -> ReminderSchedule {
    ReminderSchedule::Recurring {
        cron: ReminderCron::parse(cron).expect("valid cron"),
        timezone: New_York,
    }
}

#[test]
fn a_local_time_skipped_by_spring_forward_does_not_fire_that_day() {
    // New York springs forward 2026-03-08: 02:00 becomes 03:00, so 02:30 never
    // occurs. The firing is skipped rather than shifted into the new offset.
    let schedule = ny_recurring(DAILY_230AM);

    // From late on the 6th, the next firing is the 7th at 02:30 EST (07:30Z).
    assert_eq!(
        schedule.next_run_after(utc(2026, 3, 7, 0, 0)),
        Some(utc(2026, 3, 7, 7, 30))
    );

    // Past the 7th's firing, the next is the 9th at 02:30 EDT (06:30Z) — the
    // 8th is skipped entirely.
    assert_eq!(
        schedule.next_run_after(utc(2026, 3, 8, 0, 0)),
        Some(utc(2026, 3, 9, 6, 30))
    );
}

#[test]
fn a_local_time_repeated_by_fall_back_fires_only_once() {
    // New York falls back 2026-11-01: 02:00 becomes 01:00, so 01:30 occurs
    // twice — once at 05:30Z (EDT) and again at 06:30Z (EST). Only the first
    // fires, so the user is not reminded twice.
    let schedule = ny_recurring(DAILY_130AM);

    assert_eq!(
        schedule.next_run_after(utc(2026, 11, 1, 0, 0)),
        Some(utc(2026, 11, 1, 5, 30))
    );

    // After the first occurrence, the schedule moves to the next day rather
    // than firing the repeated 01:30 an hour later.
    assert_eq!(
        schedule.next_run_after(utc(2026, 11, 1, 5, 45)),
        Some(utc(2026, 11, 2, 6, 30))
    );
}

#[test]
fn a_daily_cron_holds_its_local_time_across_a_dst_boundary() {
    // The product-visible promise: "remind me at 9am daily" stays 9am local,
    // even though the UTC instant shifts by an hour.
    let schedule = ny_recurring(DAILY_9AM);

    // 2026-03-07 (EST): 09:00 local is 14:00Z.
    assert_eq!(
        schedule.next_run_after(utc(2026, 3, 6, 15, 0)),
        Some(utc(2026, 3, 7, 14, 0))
    );
    // 2026-03-08 onward (EDT): 09:00 local is 13:00Z.
    assert_eq!(
        schedule.next_run_after(utc(2026, 3, 7, 15, 0)),
        Some(utc(2026, 3, 8, 13, 0))
    );
    assert_eq!(
        schedule.next_run_after(utc(2026, 3, 8, 15, 0)),
        Some(utc(2026, 3, 9, 13, 0))
    );
}

#[test]
fn cursor_round_trips_through_its_encoding() {
    let reminder = Reminder {
        id: Uuid::from_u128(7),
        description: "ping".to_string(),
        entity_type: None,
        entity_id: None,
        schedule: ReminderSchedule::Once {
            remind_at: utc(2026, 7, 1, 13, 0),
        },
        next_run_at: utc(2026, 7, 1, 13, 0),
        enabled: true,
        completed_at: None,
        created_at: utc(2026, 6, 1, 0, 0),
        updated_at: utc(2026, 6, 1, 0, 0),
    };

    let cursor = ReminderCursor::after(&reminder);
    let encoded = cursor.encode();
    assert_eq!(
        ReminderCursor::decode(&encoded).expect("cursor should decode"),
        cursor
    );

    // Only RFC 3986 unreserved characters, so no client, proxy, or query-string
    // parser has cause to re-encode or mangle it.
    assert!(
        encoded
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._~".contains(c)),
        "cursor is not URL-safe: {encoded}"
    );
    assert!(
        !encoded.contains('|'),
        "the pipe delimiter is not unreserved"
    );
}

#[test]
fn cursor_preserves_sub_second_precision() {
    // Postgres timestamps carry microseconds; a cursor that rounded to seconds
    // would skip or repeat rows sharing a second.
    let precise = DateTime::from_timestamp_micros(1_780_000_000_123_456).expect("valid instant");
    let cursor = ReminderCursor {
        next_run_at: precise,
        created_at: precise,
        id: Uuid::from_u128(1),
    };

    let decoded = ReminderCursor::decode(&cursor.encode()).expect("cursor should decode");
    assert_eq!(decoded.next_run_at, precise);
    assert_eq!(decoded.next_run_at.timestamp_subsec_micros(), 123_456);
}

#[test]
fn a_malformed_cursor_is_rejected() {
    for raw in [
        "",
        "abc",
        // Too few parts, too many, then a bad component in each position.
        "1",
        "1.2",
        "1.2.00000000-0000-0000-0000-000000000001.4",
        "notanumber.2.00000000-0000-0000-0000-000000000001",
        "1.notanumber.00000000-0000-0000-0000-000000000001",
        "1.2.not-a-uuid",
    ] {
        assert!(
            ReminderCursor::decode(raw).is_err(),
            "should have rejected {raw:?}"
        );
    }
}

#[test]
fn page_size_defaults_and_clamps() {
    assert_eq!(ReminderFilter::default().page_size(), DEFAULT_PAGE_SIZE);
    assert_eq!(
        ReminderFilter {
            limit: Some(25),
            ..Default::default()
        }
        .page_size(),
        25
    );
    assert_eq!(
        ReminderFilter {
            limit: Some(u32::MAX),
            ..Default::default()
        }
        .page_size(),
        MAX_PAGE_SIZE
    );
    assert_eq!(
        ReminderFilter {
            limit: Some(0),
            ..Default::default()
        }
        .page_size(),
        1
    );
}

/// The literal payload the EventBridge rule is configured to send. A rule can
/// only publish a constant, so this string is the contract: if the enum stops
/// round-tripping it, the minutely tick silently stops working.
const EVENTBRIDGE_SWEEP_PAYLOAD: &str = r#"{"operation":"sweep"}"#;

#[test]
fn the_eventbridge_sweep_payload_round_trips() {
    let parsed: ReminderDispatchMessage =
        serde_json::from_str(EVENTBRIDGE_SWEEP_PAYLOAD).expect("parses");

    assert_eq!(parsed.operation, ReminderDispatchOperation::Sweep);
    assert_eq!(
        serde_json::to_string(&parsed).expect("serializes"),
        EVENTBRIDGE_SWEEP_PAYLOAD
    );
}

#[test]
fn a_deliver_message_round_trips() {
    let firing = DueFiring {
        reminder_id: uuid::Uuid::from_bytes([7; 16]),
        scheduled_for: utc(2026, 7, 1, 12, 0),
    };
    let message = ReminderDispatchMessage::deliver(firing);

    let encoded = serde_json::to_string(&message).expect("serializes");
    let decoded: ReminderDispatchMessage = serde_json::from_str(&encoded).expect("parses");

    assert_eq!(decoded, message);
    assert_eq!(
        decoded.operation,
        ReminderDispatchOperation::Deliver {
            reminder_id: firing.reminder_id,
            scheduled_for: firing.scheduled_for,
        }
    );
}

#[test]
fn an_unknown_operation_is_rejected() {
    // The worker relies on this to discard a message it cannot act on rather
    // than letting it cycle to the dead-letter queue.
    let result = serde_json::from_str::<ReminderDispatchMessage>(r#"{"operation":"explode"}"#);

    assert!(result.is_err());
}
