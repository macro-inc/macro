use crate::machine::DocMachine;
use crate::model::{Capabilities, ClientFrame, ConnId, Effect, Input, Lifecycle};
use crate::replica::mock::MockReplica;
use macro_user_id::user_id::MacroUserIdStr;

const C1: ConnId = ConnId(1);
const C2: ConnId = ConnId(2);

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
fn last_leave_arms_idle_and_clean_idle_evicts() {
    let mut machine = ready_machine();
    let outcome = machine.handle(Input::PeerDetached { conn: C1 });
    assert_eq!(outcome.lifecycle, Some(Lifecycle::LastLeave));
    let actions = outcome.actions;
    let idle = actions
        .iter()
        .find_map(|action| match action {
            Effect::ScheduleTimer { token, .. } => Some(*token),
            _ => None,
        })
        .expect("idle timer");

    let actions = machine.handle(Input::TimerFired { token: idle }).actions;
    assert_eq!(actions, vec![Effect::Evict]);
}

#[test]
fn dirty_idle_compacts_first_and_evicts_on_the_next_tick() {
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
    let token = actions
        .iter()
        .find_map(|action| match action {
            Effect::PersistOps { token, .. } => Some(*token),
            _ => None,
        })
        .unwrap();
    machine.handle(Input::OpsPersisted {
        token,
        through_seq: 1,
    });

    let actions = machine.handle(Input::PeerDetached { conn: C1 }).actions;
    let idle = actions
        .iter()
        .find_map(|action| match action {
            Effect::ScheduleTimer { token, .. } => Some(*token),
            _ => None,
        })
        .expect("idle timer");

    // Dirty at idle: compact instead of evicting, re-arm.
    let actions = machine.handle(Input::TimerFired { token: idle }).actions;
    assert!(
        actions
            .iter()
            .any(|action| matches!(action, Effect::PersistSnapshot { .. }))
    );
    assert!(!actions.iter().any(|action| matches!(action, Effect::Evict)));
    let snapshot_token = actions
        .iter()
        .find_map(|action| match action {
            Effect::PersistSnapshot { token, .. } => Some(*token),
            _ => None,
        })
        .unwrap();
    let idle = actions
        .iter()
        .find_map(|action| match action {
            Effect::ScheduleTimer { token, .. } => Some(*token),
            _ => None,
        })
        .expect("re-armed idle timer");

    machine.handle(Input::SnapshotPersisted {
        token: snapshot_token,
    });
    let actions = machine.handle(Input::TimerFired { token: idle }).actions;
    assert_eq!(actions, vec![Effect::Evict]);
}

#[test]
fn reattach_before_idle_fires_cancels_eviction() {
    let mut machine = ready_machine();
    let actions = machine.handle(Input::PeerDetached { conn: C1 }).actions;
    let idle = actions
        .iter()
        .find_map(|action| match action {
            Effect::ScheduleTimer { token, .. } => Some(*token),
            _ => None,
        })
        .expect("idle timer");

    machine.handle(Input::PeerAttached {
        conn: C2,
        capabilities: Capabilities {
            can_edit: false,
            user_id: None,
        },
    });
    // The stale idle fire is ignored: the token was cancelled on attach.
    let outcome = machine.handle(Input::TimerFired { token: idle });
    assert!(outcome.actions.is_empty());
    assert_eq!(outcome.lifecycle, None);
}
