use chrono_tz::Tz;
use routine_program::RoutineProgram;
use serde_json::json;

use super::*;
use crate::domain::code_check::test::Checker;
use crate::domain::event_trigger::ActionTrigger;
use crate::domain::ports::NoRoutineCode;

#[test]
fn every_routine_is_served_with_a_trigger_the_scheduler_saves() {
    let served = catalog(&Checker::default(), Tz::Europe__Paris);
    assert_eq!(served.len(), CATALOG.len());
}

#[test]
fn schedules_run_in_the_owners_zone() {
    let served = catalog(&Checker::default(), Tz::America__New_York);
    let brief = served.iter().find(|entry| entry.key == "brief").unwrap();
    let ActionTrigger::Cron { schedule, timezone } = &brief.trigger else {
        panic!("the morning brief runs on a schedule");
    };
    assert_eq!(*timezone, Tz::America__New_York);
    assert_eq!(
        serde_json::to_value(schedule).unwrap(),
        json!("0 0 9 * * 2,3,4,5,6")
    );
}

#[test]
fn code_steps_are_served_only_where_code_can_be_saved() {
    let with_code = catalog(&Checker::default(), Tz::UTC);
    let inbox = with_code.iter().find(|entry| entry.key == "inbox").unwrap();
    let step = inbox.code.clone().expect("the inbox routine is code");
    assert_eq!(step["type"], "code");
    // Each saves as it is.
    RoutineProgram::from_task(&json!({ "steps": [step] }))
        .unwrap()
        .validate()
        .unwrap();
    let brief = with_code.iter().find(|entry| entry.key == "brief").unwrap();
    assert_eq!(brief.code, None);

    let without_code = catalog(&NoRoutineCode, Tz::UTC);
    assert!(without_code.iter().all(|entry| entry.code.is_none()));
    // Every routine still has an Ask AI step to start from.
    assert!(
        without_code
            .iter()
            .all(|entry| !entry.instructions.is_empty())
    );
}

#[test]
fn entries_carry_their_authored_marks() {
    let served = catalog(&Checker::default(), Tz::UTC);
    let tags = served
        .iter()
        .find(|entry| entry.key == "email_tags")
        .unwrap();
    assert!(tags.safe_default);
    assert!(!tags.affects_others);
    let updates = served.iter().find(|entry| entry.key == "updates").unwrap();
    assert!(!updates.safe_default);
    assert!(updates.affects_others);
    let wire = serde_json::to_value(tags).unwrap();
    assert_eq!(wire["surface"], "email");
    assert_eq!(wire["safeDefault"], true);
    assert_eq!(wire["namedKnobs"]["replyTag"], "tag");
}
