use super::{NotificationAction, NotificationState};

const STATES: [NotificationState; 3] = [
    NotificationState::Unseen,
    NotificationState::Seen,
    NotificationState::Done,
];
const ACTIONS: [NotificationAction; 3] = [
    NotificationAction::MarkSeen,
    NotificationAction::MarkDone,
    NotificationAction::Reopen,
];

#[test]
fn every_transition_matches_the_lifecycle() {
    use NotificationAction::{MarkDone, MarkSeen, Reopen};
    use NotificationState::{Done, Seen, Unseen};

    for (before, action, after) in [
        (Unseen, MarkSeen, Seen),
        (Seen, MarkSeen, Seen),
        (Done, MarkSeen, Done),
        (Unseen, MarkDone, Done),
        (Seen, MarkDone, Done),
        (Done, MarkDone, Done),
        (Unseen, Reopen, Unseen),
        (Seen, Reopen, Seen),
        (Done, Reopen, Seen),
    ] {
        assert_eq!(before.apply(action), after, "{before:?} + {action:?}");
    }
}

#[test]
fn every_action_is_idempotent() {
    for state in STATES {
        for action in ACTIONS {
            let next = state.apply(action);
            assert_eq!(next.apply(action), next);
        }
    }
}

#[test]
fn mark_seen_and_mark_done_commute() {
    for state in STATES {
        assert_eq!(
            state
                .apply(NotificationAction::MarkSeen)
                .apply(NotificationAction::MarkDone),
            state
                .apply(NotificationAction::MarkDone)
                .apply(NotificationAction::MarkSeen),
        );
    }
}

#[test]
fn serializes_as_lowercase_state_names() {
    for (state, json) in STATES
        .into_iter()
        .zip(["\"unseen\"", "\"seen\"", "\"done\""])
    {
        assert_eq!(state.as_str().parse::<NotificationState>().unwrap(), state);
        assert_eq!(state.to_string(), state.as_str());
        assert_eq!(serde_json::to_string(&state).unwrap(), json);
        assert_eq!(
            serde_json::from_str::<NotificationState>(json).unwrap(),
            state
        );
    }
}

#[test]
fn rejects_invalid_wire_states() {
    for invalid in ["", "active", "Seen", "not_done", "unseen,seen"] {
        assert!(invalid.parse::<NotificationState>().is_err());
    }
    for json in [
        "null",
        "true",
        "\"active\"",
        "\"Seen\"",
        "{\"seen\":false,\"done\":true}",
    ] {
        assert!(serde_json::from_str::<NotificationState>(json).is_err());
    }
}

#[test]
fn active_states_exclude_done_and_creation_defaults_to_unseen() {
    assert_eq!(NotificationState::default(), NotificationState::Unseen);
    assert_eq!(
        NotificationState::ACTIVE,
        [NotificationState::Unseen, NotificationState::Seen],
    );
}

#[test]
fn reopening_does_not_clear_push_notifications() {
    assert!(NotificationAction::MarkSeen.should_clear_push_notifications());
    assert!(NotificationAction::MarkDone.should_clear_push_notifications());
    assert!(!NotificationAction::Reopen.should_clear_push_notifications());
}
