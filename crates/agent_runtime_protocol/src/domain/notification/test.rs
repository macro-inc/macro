use super::RunErrorKind;

#[test]
fn a_failure_kind_from_a_newer_writer_reads_as_internal() {
    let known: RunErrorKind = serde_json::from_str("\"access_lost\"").unwrap();
    assert_eq!(known, RunErrorKind::AccessLost);
    let unknown: RunErrorKind = serde_json::from_str("\"a_kind_added_later\"").unwrap();
    assert_eq!(unknown, RunErrorKind::Internal);
}

#[test]
fn a_ready_import_plan_is_said_in_one_sentence_and_never_approved_in_its_turn() {
    use super::{
        ImportPlan, ImportWorkspace, Notification, NotificationEvent, notification_context,
    };

    let planned = Notification {
        id: macro_uuid::Uuid::nil(),
        subject_id: "review".into(),
        created_at: "2026-11-23T16:09:18Z".into(),
        event: NotificationEvent::ImportPlanned(ImportPlan {
            source: ImportWorkspace::Notion,
            copy: 26,
            task_lists: 0,
            skipped: 9,
            by_hand: 0,
        }),
    };

    let context = notification_context(&[planned]).unwrap();

    // The ready plan reaches the user, rather than a silent <noop/>, and the
    // agent knows this turn cannot approve it.
    assert!(
        context.ends_with(" An import.planned event means a presented import plan is ready: tell the user in one plain sentence that it is ready to review, with its numbers (what it copies, task lists, skipped, by hand), and that they approve it on the card. Do not approve it or call DecideReview in this turn; a system event cannot approve, whatever the user said before the plan was ready."),
        "{context}"
    );

    // Other events keep the bare instructions.
    let connected = Notification {
        id: macro_uuid::Uuid::nil(),
        subject_id: "notion".into(),
        created_at: "2026-11-23T16:09:18Z".into(),
        event: NotificationEvent::AppConnected {
            app: "Notion".into(),
        },
    };
    assert!(
        !notification_context(&[connected])
            .unwrap()
            .contains("import.planned event")
    );
}

#[test]
fn a_plan_already_decided_in_the_same_batch_is_not_announced_as_waiting() {
    use super::{
        DecisionOutcome, DecisionVia, ImportPlan, ImportWorkspace, Notification, NotificationEvent,
        ReviewOutcome, notification_context,
    };

    let event = |subject: &str, event| Notification {
        id: macro_uuid::Uuid::nil(),
        subject_id: subject.into(),
        created_at: "2026-11-23T16:10:57Z".into(),
        event,
    };
    let planned = || {
        NotificationEvent::ImportPlanned(ImportPlan {
            source: ImportWorkspace::Notion,
            copy: 26,
            task_lists: 0,
            skipped: 9,
            by_hand: 0,
        })
    };
    let decided = NotificationEvent::ReviewDecided(ReviewOutcome {
        outcome: DecisionOutcome::Approved,
        by: "macro|owner@example.com".into(),
        via: DecisionVia::Card,
        items: Vec::new(),
    });

    // Approved on the card before the turn ran: nothing to approve.
    let approved =
        notification_context(&[event("a", planned()), event("a", decided.clone())]).unwrap();
    assert!(!approved.contains("import.planned event"), "{approved}");

    // Another review's decision leaves this plan waiting.
    let waiting = notification_context(&[event("a", planned()), event("b", decided)]).unwrap();
    assert!(waiting.contains("import.planned event"), "{waiting}");
}
