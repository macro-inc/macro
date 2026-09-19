use super::list_reminders::{ListRemindersResponse, build_summary};
use super::*;
use ai_toolset::schema::generate_validated_input_schema;
use chrono::TimeZone;
use chrono_tz::Tz;

use crate::domain::models::ReminderCron;

fn at(hour: u32, minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 8, 7, hour, minute, 0).unwrap()
}

fn reminder(schedule: ReminderSchedule, next_run_at: DateTime<Utc>) -> Reminder {
    Reminder {
        id: Uuid::new_v4(),
        description: "Reply to Dana".to_string(),
        entity_type: None,
        entity_id: None,
        schedule,
        next_run_at,
        enabled: true,
        completed_at: None,
        created_at: at(9, 0),
        updated_at: at(9, 0),
    }
}

fn one_shot(next_run_at: DateTime<Utc>) -> Reminder {
    reminder(
        ReminderSchedule::Once {
            remind_at: next_run_at,
        },
        next_run_at,
    )
}

// --- schema validation ---

#[test]
fn create_reminder_schema_is_valid() {
    let validated =
        generate_validated_input_schema::<CreateReminder>().expect("schema should validate");
    assert_eq!(validated.name, "CreateReminder");
    assert!(
        validated.description.contains("remindAt"),
        "{}",
        validated.description
    );
}

#[test]
fn list_reminders_schema_is_valid() {
    let validated =
        generate_validated_input_schema::<ListReminders>().expect("schema should validate");
    assert_eq!(validated.name, "ListReminders");
    assert!(
        validated.description.contains("soonest first"),
        "{}",
        validated.description
    );
}

#[test]
fn update_reminder_schema_is_valid() {
    let validated =
        generate_validated_input_schema::<UpdateReminder>().expect("schema should validate");
    assert_eq!(validated.name, "UpdateReminder");
    assert!(
        validated.description.contains("completed"),
        "{}",
        validated.description
    );
}

#[test]
fn delete_reminder_schema_is_valid() {
    let validated =
        generate_validated_input_schema::<DeleteReminder>().expect("schema should validate");
    assert_eq!(validated.name, "DeleteReminder");
    assert!(
        validated.description.contains("cannot be undone"),
        "{}",
        validated.description
    );
}

/// Every tool has to survive being put in a collection — that is where name
/// conflicts and schema rejections actually surface.
#[test]
fn toolset_builds_with_every_tool() {
    use crate::domain::service::NoOpRemindersService;
    use entity_access::domain::ports::NoOpEntityAccessService;

    let toolset = reminders_toolset::<NoOpRemindersService, NoOpEntityAccessService>();

    for name in [
        "CreateReminder",
        "ListReminders",
        "UpdateReminder",
        "DeleteReminder",
    ] {
        assert!(toolset.tools.contains_key(name), "missing {name}");
    }
    assert_eq!(toolset.tools.len(), 4);
    assert!(
        toolset.user_tools.is_empty(),
        "reminder tools run in the loop, none are user-executed"
    );
}

// --- entity pairing ---

#[test]
fn entity_type_and_id_map_to_a_domain_entity() {
    let id = Uuid::new_v4();
    let entity = build_entity(Some(ReminderEntityType::Email), Some(id))
        .expect("a complete pair is valid")
        .expect("a complete pair is an entity");

    assert_eq!(entity.entity_type, EntityType::EmailThread);
    assert_eq!(entity.entity_id, id.to_string());
}

#[test]
fn neither_entity_field_is_a_standalone_reminder() {
    let entity = build_entity(None, None).expect("neither field is valid");
    assert!(entity.is_none());
}

/// A model that sends one half has lost the other. Creating a standalone
/// reminder instead would hide that.
#[test]
fn half_an_entity_pair_is_rejected() {
    let only_type = build_entity(Some(ReminderEntityType::Document), None)
        .expect_err("type without id should be rejected");
    assert!(
        only_type.description.contains("must be provided together"),
        "{}",
        only_type.description
    );

    assert!(build_entity(None, Some(Uuid::new_v4())).is_err());
}

/// The tool vocabulary and the stored vocabulary have to agree in both
/// directions, or a reminder is created as one type and read back as another.
#[test]
fn entity_type_mapping_round_trips() {
    for tool_type in [
        ReminderEntityType::Document,
        ReminderEntityType::AiChat,
        ReminderEntityType::Project,
        ReminderEntityType::Email,
        ReminderEntityType::Channel,
        ReminderEntityType::Call,
        ReminderEntityType::CalendarEvent,
    ] {
        let stored = EntityType::from(tool_type);
        assert_eq!(
            ReminderEntityType::from_entity_type(stored),
            Some(tool_type),
            "{tool_type:?} did not round trip"
        );
    }
}

/// Reminders on types this toolset does not name are reachable from the UI, so
/// a read has to render them rather than fail.
#[test]
fn unnamed_entity_type_reads_back_as_no_type() {
    let mut reminder = one_shot(at(10, 0));
    reminder.entity_type = Some(EntityType::CrmCompany);
    reminder.entity_id = Some(Uuid::new_v4().to_string());

    let rendered = ToolReminder::new(reminder, at(9, 0));
    assert_eq!(rendered.entity_type, None);
    assert!(
        rendered.entity_id.is_some(),
        "the id survives even when the type has no tool-facing name"
    );
}

// --- rendering ---

#[test]
fn a_future_reminder_is_not_overdue() {
    let rendered = ToolReminder::new(one_shot(at(10, 0)), at(9, 0));
    assert!(!rendered.overdue);
    assert_eq!(rendered.recurrence, None);
    assert!(!rendered.completed);
}

/// Overdue is inclusive of the firing instant: at exactly `next_run_at` the
/// sweep has already picked the reminder up.
#[test]
fn a_reminder_at_its_firing_instant_is_overdue() {
    let rendered = ToolReminder::new(one_shot(at(9, 0)), at(9, 0));
    assert!(rendered.overdue);
}

#[test]
fn a_completed_reminder_reads_as_completed() {
    let mut reminder = one_shot(at(10, 0));
    reminder.completed_at = Some(at(9, 30));

    let rendered = ToolReminder::new(reminder, at(9, 0));
    assert!(rendered.completed);
}

/// A repeating reminder has to announce itself — these tools cannot create or
/// reschedule one, so the model needs to know before it offers to.
#[test]
fn a_recurring_reminder_reports_its_recurrence() {
    let schedule = ReminderSchedule::Recurring {
        cron: ReminderCron::parse("0 9 * * *").expect("valid cron"),
        timezone: Tz::America__New_York,
    };
    let rendered = ToolReminder::new(reminder(schedule, at(13, 0)), at(9, 0));

    let recurrence = rendered.recurrence.expect("recurring reminders say so");
    assert!(recurrence.contains("0 0 9 * * *"), "{recurrence}");
    assert!(recurrence.contains("America/New_York"), "{recurrence}");
}

// --- list summary ---

#[test]
fn empty_list_summary() {
    assert_eq!(build_summary(&[], 20), "No reminders match.");
}

#[test]
fn summary_counts_overdue_reminders() {
    let reminders = vec![
        ToolReminder::new(one_shot(at(8, 0)), at(9, 0)),
        ToolReminder::new(one_shot(at(10, 0)), at(9, 0)),
    ];

    let summary = build_summary(&reminders, 20);
    assert!(summary.contains("2 reminders"), "{summary}");
    assert!(summary.contains("1 of them overdue"), "{summary}");
    assert!(
        !summary.contains("there may be more"),
        "a short page is the whole list: {summary}"
    );
}

/// A full page is otherwise indistinguishable from a complete list, and a model
/// that cannot tell will report the truncated count as the total.
#[test]
fn summary_admits_when_the_page_is_full() {
    let reminders = vec![ToolReminder::new(one_shot(at(10, 0)), at(9, 0))];
    let summary = build_summary(&reminders, 1);
    assert!(summary.contains("there may be more"), "{summary}");
}

#[test]
fn single_reminder_summary_is_not_pluralized() {
    let reminders = vec![ToolReminder::new(one_shot(at(10, 0)), at(9, 0))];
    let summary = build_summary(&reminders, 20);
    assert!(summary.contains("Found 1 reminder."), "{summary}");
}

/// The response is what the model actually reads, so the fields it needs have
/// to survive serialization under the names the schema advertises.
#[test]
fn response_serializes_with_camel_case_keys() {
    let response = ListRemindersResponse {
        reminders: vec![ToolReminder::new(one_shot(at(10, 0)), at(9, 0))],
        summary: "Found 1 reminder.".to_string(),
    };

    let json = serde_json::to_value(&response).expect("response should serialize");
    let reminder = &json["reminders"][0];

    assert!(reminder["nextRunAt"].is_string());
    assert_eq!(reminder["overdue"], serde_json::json!(false));
    assert_eq!(reminder["completed"], serde_json::json!(false));
    assert!(
        reminder.get("recurrence").is_none(),
        "a one-shot omits recurrence rather than sending null"
    );
    assert!(
        reminder.get("entityType").is_none(),
        "a standalone reminder omits its entity fields"
    );
}
