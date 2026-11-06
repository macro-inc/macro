use crate::machine::DocMachine;
use crate::model::{Capabilities, CloseReason, ConnId, Effect, Input, Lifecycle, ServerFrame};
use crate::replica::mock::MockReplica;
use macro_user_id::user_id::MacroUserIdStr;

const C1: ConnId = ConnId(1);
const C2: ConnId = ConnId(2);

#[test]
fn first_attach_emits_load_and_defers_initial_sync() {
    let mut machine = DocMachine::<MockReplica>::new();
    let actions = machine
        .handle(Input::PeerAttached {
            conn: C1,
            capabilities: Capabilities {
                can_edit: true,
                user_id: None,
            },
        })
        .actions;
    assert_eq!(actions, vec![Effect::Load]);
}

#[test]
fn frames_during_loading_queue_and_replay_in_order_after_loaded() {
    let mut machine = DocMachine::<MockReplica>::new();
    machine.handle(Input::PeerAttached {
        conn: C1,
        capabilities: Capabilities {
            can_edit: true,
            user_id: None,
        },
    });
    let actions = machine
        .handle(Input::Frame {
            conn: C1,
            frame: crate::model::ClientFrame::Update {
                updates: vec![b"early-1".to_vec()],
                id: "op-1".into(),
            },
        })
        .actions;
    assert!(actions.is_empty());
    let actions = machine
        .handle(Input::Frame {
            conn: C1,
            frame: crate::model::ClientFrame::Update {
                updates: vec![b"early-2".to_vec()],
                id: "op-2".into(),
            },
        })
        .actions;
    assert!(actions.is_empty());

    let outcome = machine.handle(Input::Loaded {
        snapshot: Some(b"base".to_vec()),
        snapshot_seq: 0,
        ops: Vec::new(),
    });

    // Initial sync first, then the replayed updates' effects; the join is
    // reported on the outcome, not as an action.
    assert_eq!(outcome.lifecycle, Some(Lifecycle::FirstJoin));
    let actions = outcome.actions;
    assert!(matches!(
        actions[0],
        Effect::Send {
            conn: ConnId(1),
            frame: ServerFrame::InitialSync { .. }
        }
    ));
    // Both queued updates were applied, in order.
    assert_eq!(
        machine.replica().unwrap().applied,
        vec![b"early-1".to_vec(), b"early-2".to_vec()],
    );
    // And persisted: one in-flight request for seq 1, the second queued
    // behind it (single in-flight ops persist).
    let persists: Vec<_> = actions
        .iter()
        .filter(|action| matches!(action, Effect::PersistOps { .. }))
        .collect();
    assert_eq!(persists.len(), 1);
}

#[test]
fn loaded_none_creates_an_empty_document() {
    // Matches the deployed DO (`create-default-state`): subscribing to a
    // never-persisted document materializes an empty one.
    let mut machine = DocMachine::<MockReplica>::new();
    machine.handle(Input::PeerAttached {
        conn: C1,
        capabilities: Capabilities {
            can_edit: true,
            user_id: None,
        },
    });
    let actions = machine
        .handle(Input::Loaded {
            snapshot: None,
            snapshot_seq: 0,
            ops: Vec::new(),
        })
        .actions;
    assert!(matches!(
        actions[0],
        Effect::Send {
            frame: ServerFrame::InitialSync { .. },
            ..
        }
    ));
    assert!(machine.replica().unwrap().loaded_from.is_none());
}

#[test]
fn load_failed_breaks_the_machine_and_closes_everyone() {
    let mut machine = DocMachine::<MockReplica>::new();
    machine.handle(Input::PeerAttached {
        conn: C1,
        capabilities: Capabilities {
            can_edit: true,
            user_id: None,
        },
    });
    machine.handle(Input::PeerAttached {
        conn: C2,
        capabilities: Capabilities {
            can_edit: false,
            user_id: None,
        },
    });
    let actions = machine
        .handle(Input::LoadFailed {
            error: "store down".into(),
        })
        .actions;
    assert_eq!(
        actions,
        vec![
            Effect::Close {
                conn: C1,
                reason: CloseReason::LoadFailed
            },
            Effect::Close {
                conn: C2,
                reason: CloseReason::LoadFailed
            },
        ]
    );
    // Later attaches are refused outright.
    let actions = machine
        .handle(Input::PeerAttached {
            conn: C1,
            capabilities: Capabilities {
                can_edit: true,
                user_id: None,
            },
        })
        .actions;
    assert_eq!(
        actions,
        vec![Effect::Close {
            conn: C1,
            reason: CloseReason::LoadFailed
        }]
    );
}

#[test]
fn stale_loaded_after_ready_is_ignored() {
    let mut machine = DocMachine::<MockReplica>::new();
    machine.handle(Input::PeerAttached {
        conn: C1,
        capabilities: Capabilities {
            can_edit: true,
            user_id: None,
        },
    });
    machine.handle(Input::Loaded {
        snapshot: Some(b"base".to_vec()),
        snapshot_seq: 0,
        ops: Vec::new(),
    });
    let outcome = machine.handle(Input::Loaded {
        snapshot: Some(b"other".to_vec()),
        snapshot_seq: 0,
        ops: Vec::new(),
    });
    assert!(outcome.actions.is_empty());
    assert!(outcome.reason.contains("stale"));
    assert_eq!(
        machine.replica().unwrap().loaded_from,
        Some(b"base".to_vec())
    );
}

#[test]
fn attach_when_ready_gets_immediate_initial_sync() {
    let mut machine = DocMachine::<MockReplica>::new();
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
    let outcome = machine.handle(Input::PeerAttached {
        conn: C2,
        capabilities: Capabilities {
            can_edit: false,
            user_id: None,
        },
    });
    // Second peer: no FirstJoin.
    assert_eq!(outcome.lifecycle, None);
    let actions = outcome.actions;
    assert_eq!(actions.len(), 1);
    assert!(matches!(
        actions[0],
        Effect::Send {
            conn: ConnId(2),
            frame: ServerFrame::InitialSync { .. }
        }
    ));
}

#[test]
fn loaded_tail_replays_without_repersisting_and_resumes_numbering() {
    let mut machine = DocMachine::<MockReplica>::new();
    machine.handle(Input::PeerAttached {
        conn: C1,
        capabilities: Capabilities {
            can_edit: true,
            user_id: None,
        },
    });
    let actions = machine
        .handle(Input::Loaded {
            snapshot: Some(b"base".to_vec()),
            snapshot_seq: 4,
            ops: vec![(5, b"tail-5".to_vec()), (6, b"tail-6".to_vec())],
        })
        .actions;
    // The tail is applied to the replica...
    assert_eq!(
        machine.replica().unwrap().applied,
        vec![b"tail-5".to_vec(), b"tail-6".to_vec()],
    );
    // ...but never re-persisted, re-blamed, or re-broadcast.
    assert!(!actions.iter().any(|action| matches!(
        action,
        Effect::PersistOps { .. } | Effect::RecordBlame { .. } | Effect::Broadcast { .. }
    )));

    // New edits resume numbering after the tail.
    let actions = machine
        .handle(Input::Frame {
            conn: C1,
            frame: crate::model::ClientFrame::Update {
                updates: vec![b"new".to_vec()],
                id: "op-7".into(),
            },
        })
        .actions;
    assert!(actions.iter().any(|action| matches!(
        action,
        Effect::PersistOps { through_seq: 7, ops, .. } if ops == &vec![(7, b"new".to_vec())]
    )));
}
