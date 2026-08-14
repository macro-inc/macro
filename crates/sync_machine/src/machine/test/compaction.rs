use crate::machine::DocMachine;
use crate::model::{Capabilities, ClientFrame, ConnId, Effect, Input, Lifecycle};
use crate::replica::mock::MockReplica;
use macro_user_id::user_id::MacroUserIdStr;

const C1: ConnId = ConnId(1);

/// A machine with C1 attached (edit capabilities) and loaded from `b"base"`.
fn ready_machine() -> DocMachine<MockReplica> {
    let mut machine = DocMachine::new();
    machine.handle(Input::PeerAttached {
        conn: C1,
        capabilities: Capabilities {
            can_edit: true,
            user_id: Some(MacroUserIdStr::try_from("macro|user-1@test.com".to_string()).unwrap()),
        },
    });
    machine.handle(Input::Loaded {
        snapshot: Some(b"base".to_vec()),
        snapshot_seq: 0,
        ops: Vec::new(),
    });
    machine
}

#[test]
fn compaction_debounce_persists_a_snapshot_then_reports_edited() {
    let mut machine = ready_machine();
    let actions = machine
        .handle(Input::Frame {
            conn: C1,
            frame: ClientFrame::Update {
                updates: vec![b"a".to_vec()],
                id: "op-1".into(),
            },
        })
        .actions;
    let debounce = actions
        .iter()
        .find_map(|action| match action {
            Effect::ScheduleTimer { token, .. } => Some(*token),
            _ => None,
        })
        .expect("debounce timer");

    let actions = machine
        .handle(Input::TimerFired { token: debounce })
        .actions;
    assert!(matches!(
        actions[..],
        [Effect::PersistSnapshot { through_seq: 1, .. }]
    ));
    let token = actions
        .iter()
        .find_map(|action| match action {
            Effect::PersistSnapshot { token, .. } => Some(*token),
            _ => None,
        })
        .unwrap();

    let outcome = machine.handle(Input::SnapshotPersisted { token });
    assert!(outcome.actions.is_empty());
    assert_eq!(outcome.lifecycle, Some(Lifecycle::Edited));
}

#[test]
fn a_second_compaction_does_not_start_while_one_is_in_flight() {
    let mut machine = ready_machine();
    let actions = machine
        .handle(Input::Frame {
            conn: C1,
            frame: ClientFrame::Update {
                updates: vec![b"a".to_vec()],
                id: "op-1".into(),
            },
        })
        .actions;
    let debounce = actions
        .iter()
        .find_map(|action| match action {
            Effect::ScheduleTimer { token, .. } => Some(*token),
            _ => None,
        })
        .unwrap();
    let actions = machine
        .handle(Input::TimerFired { token: debounce })
        .actions;
    assert!(matches!(actions[..], [Effect::PersistSnapshot { .. }]));

    // More edits arrive; the debounce re-arms, fires — but the snapshot
    // persist is still in flight, so no second PersistSnapshot is emitted.
    let actions = machine
        .handle(Input::Frame {
            conn: C1,
            frame: ClientFrame::Update {
                updates: vec![b"b".to_vec()],
                id: "op-2".into(),
            },
        })
        .actions;
    let debounce = actions
        .iter()
        .find_map(|action| match action {
            Effect::ScheduleTimer { token, .. } => Some(*token),
            _ => None,
        })
        .unwrap();
    let actions = machine
        .handle(Input::TimerFired { token: debounce })
        .actions;
    assert!(
        !actions
            .iter()
            .any(|action| matches!(action, Effect::PersistSnapshot { .. }))
    );
}
