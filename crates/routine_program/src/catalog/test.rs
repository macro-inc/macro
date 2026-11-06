use std::collections::HashSet;

use super::*;
use crate::model::{AgentStep, RoutineProgram, Step};

#[test]
fn every_code_step_is_a_valid_routine_with_a_sentence() {
    for routine in CATALOG.iter() {
        let Some(code) = &routine.code else { continue };
        RoutineProgram::new(vec![Step::Code(code.clone())])
            .validate()
            .unwrap_or_else(|error| panic!("{}: {error}", routine.key));
        assert!(code.sentence.is_some(), "{}", routine.key);
    }
}

#[test]
fn every_ask_ai_step_is_a_valid_routine() {
    for routine in CATALOG.iter() {
        RoutineProgram::new(vec![Step::Agent(AgentStep {
            model: Some("model".to_owned()),
            agent: None,
            instructions: routine.instructions.to_owned(),
        })])
        .validate()
        .unwrap_or_else(|error| panic!("{}: {error}", routine.key));
    }
}

#[test]
fn keys_are_unique_and_found_by_key() {
    let keys: HashSet<_> = CATALOG.iter().map(|routine| routine.key).collect();
    assert_eq!(keys.len(), CATALOG.len());
    assert_eq!(
        catalog_routine("email_tags").map(|r| r.title),
        Some("Tag new email")
    );
    assert_eq!(catalog_routine("missing"), None);
}

/// A pre-selected suggestion runs before its owner changes anything, so only
/// reviewed code that keeps to the owner's own items may be one: Ask AI acts
/// on whatever arrives at run time.
#[test]
fn only_code_that_affects_no_one_else_is_safe_by_default() {
    for routine in CATALOG.iter().filter(|routine| routine.safe_default) {
        assert!(routine.code.is_some(), "{} has no code", routine.key);
        assert!(!routine.affects_others, "{} affects others", routine.key);
    }
}

/// A safe default is switched on with one confirmation, so it can't wait on
/// a scope, a linked account or a condition the owner must set up first.
#[test]
fn safe_defaults_run_on_a_workspace_wide_event_without_a_condition() {
    for routine in CATALOG.iter().filter(|routine| routine.safe_default) {
        assert_eq!(routine.trigger["type"], "events", "{}", routine.key);
        let filters = routine.trigger["filters"].as_array().expect("filters");
        for filter in filters {
            let fields: Vec<_> = filter.as_object().expect("filter").keys().collect();
            assert_eq!(fields, ["events"], "{}", routine.key);
            for event in filter["events"].as_array().expect("events") {
                let event = event.as_str().expect("event");
                assert!(
                    event.ends_with(".created") || event == "email.message_received",
                    "{}: {event}",
                    routine.key
                );
            }
        }
    }
}

#[test]
fn every_surface_has_a_template() {
    let surfaces: HashSet<_> = CATALOG
        .iter()
        .filter(|routine| routine.template)
        .map(|routine| routine.surface)
        .collect();
    assert_eq!(surfaces.len(), 9);
}

#[test]
fn cron_schedules_leave_the_zone_to_the_owner() {
    for routine in CATALOG.iter() {
        if routine.trigger["type"] == "cron" {
            assert!(routine.trigger.get("timezone").is_none(), "{}", routine.key);
            assert!(routine.trigger["schedule"].is_string(), "{}", routine.key);
        }
    }
}

#[test]
fn named_knobs_are_text_knobs_of_the_code_step() {
    use crate::Knob;
    for routine in CATALOG.iter() {
        for (name, _) in routine.named_knobs {
            let knob = routine
                .code
                .iter()
                .flat_map(|code| &code.knobs)
                .find(|knob| knob.name().as_str() == *name);
            assert!(
                matches!(knob, Some(Knob::Text { .. })),
                "{}: {name}",
                routine.key
            );
        }
    }
    let tags = catalog_routine("email_tags").unwrap().named_knobs;
    assert_eq!(tags.len(), 4);
    assert!(tags.iter().all(|(_, item)| *item == NamedItemKind::Tag));
}
