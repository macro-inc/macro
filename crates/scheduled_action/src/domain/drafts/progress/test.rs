use serde_json::json;

use super::*;
use crate::domain::models::{ActionConfiguration, ActionKind, CheckedStepProblems};

fn check(ok: bool, failing: Vec<CheckedStepProblems>) -> RoutineCheck {
    RoutineCheck {
        ok,
        problems: if ok {
            Vec::new()
        } else {
            vec!["name it".into()]
        },
        steps: failing,
        routine: ActionConfiguration {
            name: " Bug tasks ".into(),
            trigger: serde_json::from_value(
                json!({ "type": "once", "at": "2030-01-01T00:00:00Z" }),
            )
            .unwrap(),
            kind: ActionKind::Agent,
            task: json!({ "steps": [
                { "type": "code", "title": "Make a task ", "source": "secret code" },
                { "type": "agent", "model": "m", "instructions": "Research it." },
            ] }),
            enabled: true,
            run_visibility: Default::default(),
            description: String::new(),
        },
    }
}

#[test]
fn a_check_reads_as_its_counts_trigger_and_step_titles_never_its_code() {
    let summary = CheckSummary::of(
        &check(
            false,
            vec![CheckedStepProblems {
                index: 0,
                title: "Make a task".into(),
                problems: vec!["one".into(), "two".into()],
            }],
        ),
        3,
    );

    assert_eq!(summary.checks, 3);
    assert!(!summary.ok);
    // The routine's own problem and its code's two.
    assert_eq!(summary.problems, 3);
    assert_eq!(summary.name, "Bug tasks");
    assert_eq!(
        summary.steps,
        [
            StepTitle {
                kind: StepKind::Code,
                title: "Make a task".into(),
            },
            StepTitle {
                kind: StepKind::Agent,
                title: String::new(),
            },
        ]
    );
    let wire = serde_json::to_string(&summary).unwrap();
    assert!(!wire.contains("secret code"), "{wire}");
    assert!(!wire.contains("Research it"), "{wire}");
}

#[test]
fn progress_moves_through_its_milestones_keeping_what_each_found() {
    let mut progress = DraftJobProgress::default();
    assert_eq!(progress.stage, DraftStage::Started);
    // Admission only answers a background start; nothing to show yet.
    progress.reach(DraftMilestone::Admitted);
    assert_eq!(progress, DraftJobProgress::default());

    progress.reach(DraftMilestone::Found(FoundNames {
        found: vec![
            FoundName {
                name: "Finance".to_owned(),
                kind: ItemKind::Label,
            },
            FoundName {
                name: "engineering".to_owned(),
                kind: ItemKind::Channel,
            },
        ],
        left: vec![LeftName {
            name: "Jordan".to_owned(),
            kind: Some(ItemKind::Person),
            matches: 2,
        }],
    }));
    progress.reach(DraftMilestone::Writing);
    assert_eq!(progress.stage, DraftStage::Writing);
    assert_eq!(progress.found, Some(2));
    assert_eq!(
        serde_json::to_value(&progress).unwrap()["names"],
        json!({
            "found": [
                { "name": "Finance", "kind": "label" },
                { "name": "engineering", "kind": "channel" },
            ],
            "left": [{ "name": "Jordan", "kind": "person", "matches": 2 }],
        })
    );

    progress.reach(DraftMilestone::Checked(CheckSummary::of(
        &check(false, Vec::new()),
        1,
    )));
    assert_eq!(progress.stage, DraftStage::Checked);
    progress.reach(DraftMilestone::Fixing);
    assert_eq!(progress.stage, DraftStage::Fixing);
    // The failed check stays to show while the model fixes it.
    assert_eq!(progress.check.as_ref().map(|check| check.ok), Some(false));

    assert_eq!(
        serde_json::to_value(&progress).unwrap()["stage"],
        json!("fixing")
    );
}
