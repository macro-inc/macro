use crate::machine::DocMachine;
use crate::model::{Capabilities, ClientFrame, CloseReason, ConnId, Effect, Input, ServerFrame};
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
fn update_order_is_apply_persist_ack_broadcast() {
    let mut machine = ready_machine();
    machine.handle(Input::Frame {
        conn: C1,
        frame: ClientFrame::RegisterPeer { peer_id: 7 },
    });

    let actions = machine
        .handle(Input::Frame {
            conn: C1,
            frame: ClientFrame::Update {
                updates: vec![b"edit".to_vec()],
                id: "op-1".into(),
            },
        })
        .actions;

    assert!(matches!(
        actions[0],
        Effect::PersistOps { through_seq: 1, .. }
    ));
    assert!(actions.iter().any(|action| matches!(
        action,
        Effect::RecordBlame { events } if events.len() == 1 && events[0].peer_id == 7
    )));
    assert!(
        actions
            .iter()
            .any(|action| matches!(action, Effect::ScheduleTimer { .. }))
    );
    // Nothing is durable yet: no ack AND no broadcast — peers must never see
    // an op a crash could still erase from the log.
    assert!(!actions.iter().any(|action| matches!(
        action,
        Effect::Send {
            frame: ServerFrame::Ack { .. },
            ..
        } | Effect::Broadcast { .. }
    )));

    // Durability releases the ack first, then the broadcast, in that order.
    let token = actions
        .iter()
        .find_map(|action| match action {
            Effect::PersistOps { token, .. } => Some(*token),
            _ => None,
        })
        .unwrap();
    let actions = machine
        .handle(Input::OpsPersisted {
            token,
            through_seq: 1,
        })
        .actions;
    let ack_at = actions
        .iter()
        .position(|action| {
            matches!(
                action,
                Effect::Send {
                    frame: ServerFrame::Ack { .. },
                    ..
                }
            )
        })
        .expect("ack after durability");
    let broadcast_at = actions
        .iter()
        .position(|action| {
            matches!(
                action,
                Effect::Broadcast {
                    except: ConnId(1),
                    frame: ServerFrame::Update { .. }
                }
            )
        })
        .expect("broadcast after durability");
    assert!(ack_at < broadcast_at);
}

#[test]
fn acks_release_only_after_ops_persisted() {
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

    // A second batch while the first persist is in flight: no new PersistOps
    // (single in-flight), no acks.
    let actions = machine
        .handle(Input::Frame {
            conn: C1,
            frame: ClientFrame::Update {
                updates: vec![b"b".to_vec()],
                id: "op-2".into(),
            },
        })
        .actions;
    assert!(
        !actions
            .iter()
            .any(|action| matches!(action, Effect::PersistOps { .. }))
    );

    // First completion: acks op-1 (seq 1) and emits the follow-up persist
    // for seq 2.
    let actions = machine
        .handle(Input::OpsPersisted {
            token,
            through_seq: 1,
        })
        .actions;
    let acks: Vec<_> = actions
        .iter()
        .filter_map(|action| match action {
            Effect::Send {
                frame: ServerFrame::Ack { id },
                ..
            } => Some(id.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(acks, vec!["op-1".to_string()]);
    let token = actions
        .iter()
        .find_map(|action| match action {
            Effect::PersistOps { token, .. } => Some(*token),
            _ => None,
        })
        .unwrap();

    let actions = machine
        .handle(Input::OpsPersisted {
            token,
            through_seq: 2,
        })
        .actions;
    let acks: Vec<_> = actions
        .iter()
        .filter_map(|action| match action {
            Effect::Send {
                frame: ServerFrame::Ack { id },
                ..
            } => Some(id.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(acks, vec!["op-2".to_string()]);
}

#[test]
fn viewer_updates_are_dropped_silently() {
    let mut machine = ready_machine();
    machine.handle(Input::PeerAttached {
        conn: C2,
        capabilities: Capabilities {
            can_edit: false,
            user_id: None,
        },
    });
    let actions = machine
        .handle(Input::Frame {
            conn: C2,
            frame: ClientFrame::Update {
                updates: vec![b"sneaky".to_vec()],
                id: "op-x".into(),
            },
        })
        .actions;
    assert!(actions.is_empty());
    assert_eq!(machine.replica().unwrap().applied, Vec::<Vec<u8>>::new());
}

#[test]
fn poison_update_closes_the_sender_and_never_reaches_the_log() {
    let mut machine = ready_machine();
    let actions = machine
        .handle(Input::Frame {
            conn: C1,
            frame: ClientFrame::Update {
                updates: vec![b"fine".to_vec(), b"__poison__".to_vec(), b"after".to_vec()],
                id: "op-1".into(),
            },
        })
        .actions;
    // The good op before the poison stands (it's already in the replica);
    // the poison and everything after are dropped; the sender is closed.
    assert_eq!(machine.replica().unwrap().applied, vec![b"fine".to_vec()]);
    assert!(actions.iter().any(|action| matches!(
        action,
        Effect::Close {
            conn: ConnId(1),
            reason: CloseReason::Protocol
        }
    )));
    let persisted: Vec<_> = actions
        .iter()
        .filter_map(|action| match action {
            Effect::PersistOps { ops, .. } => Some(ops.clone()),
            _ => None,
        })
        .flatten()
        .collect();
    assert_eq!(persisted, vec![(1, b"fine".to_vec())]);
}

#[test]
fn persist_failure_schedules_retry_and_retry_resends_the_tail() {
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

    let actions = machine.handle(Input::PersistFailed { token }).actions;
    let retry = actions
        .iter()
        .find_map(|action| match action {
            Effect::ScheduleTimer { token, .. } => Some(*token),
            _ => None,
        })
        .expect("retry timer");

    let actions = machine.handle(Input::TimerFired { token: retry }).actions;
    let token = actions
        .iter()
        .find_map(|action| match action {
            Effect::PersistOps { token, .. } => Some(*token),
            _ => None,
        })
        .expect("retried persist");
    let actions = machine
        .handle(Input::OpsPersisted {
            token,
            through_seq: 1,
        })
        .actions;
    // The ack survives the failed attempt and flows after the retry.
    assert!(actions.iter().any(|action| matches!(
        action,
        Effect::Send {
            frame: ServerFrame::Ack { id },
            ..
        } if id == "op-1"
    )));
}

#[test]
fn frames_from_unattached_conns_are_closed() {
    let mut machine = ready_machine();
    let actions = machine
        .handle(Input::Frame {
            conn: ConnId(99),
            frame: ClientFrame::RequestSnapshot,
        })
        .actions;
    assert_eq!(
        actions,
        vec![Effect::Close {
            conn: ConnId(99),
            reason: CloseReason::NotAttached
        }]
    );
}
