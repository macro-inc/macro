use crate::manager::{ConnManager, ManagerEffect, ManagerInput};
use crate::model::{Capabilities, ClientFrame, ConnId, DocId, Effect};
use crate::replica::mock::MockReplica;

/// Bring one (conn, doc) to Ready, discarding setup effects.
fn attach_ready(manager: &mut ConnManager<MockReplica>, conn: ConnId, id: &str) {
    manager.handle(ManagerInput::Attach {
        conn,
        doc: DocId(id.to_string()),
        capabilities: Capabilities {
            can_edit: true,
            user_id: None,
        },
    });
    manager.handle(ManagerInput::Loaded {
        doc: DocId(id.to_string()),
        snapshot: Some(b"base".to_vec()),
        snapshot_seq: 0,
        ops: Vec::new(),
    });
}

/// Detach the conn and fire the resulting idle timer, evicting the machine.
fn evict(manager: &mut ConnManager<MockReplica>, conn: ConnId, id: &str) {
    let actions = manager
        .handle(ManagerInput::Detach {
            conn,
            doc: DocId(id.to_string()),
        })
        .actions;
    let idle = actions
        .iter()
        .find_map(|action| match &action.effect {
            Effect::ScheduleTimer { token, .. } => Some(*token),
            _ => None,
        })
        .expect("idle timer");
    manager.handle(ManagerInput::TimerFired { token: idle });
}

#[test]
fn eviction_drops_stale_tokens_and_late_inputs_route_nowhere() {
    let mut manager = ConnManager::<MockReplica>::new();
    attach_ready(&mut manager, ConnId(1), "doc-a");

    let actions = manager
        .handle(ManagerInput::Detach {
            conn: ConnId(1),
            doc: DocId("doc-a".to_string()),
        })
        .actions;
    let idle = actions
        .iter()
        .find_map(|action| match &action.effect {
            Effect::ScheduleTimer { token, .. } => Some(*token),
            _ => None,
        })
        .expect("idle timer");
    manager.handle(ManagerInput::TimerFired { token: idle });
    assert_eq!(manager.resident_docs(), 0);

    // A duplicate fire and a frame for the evicted doc are both harmless.
    let outcome = manager.handle(ManagerInput::TimerFired { token: idle });
    assert!(outcome.actions.is_empty());
    assert!(outcome.reason.contains("stale"));
    assert!(
        manager
            .handle(ManagerInput::Frame {
                conn: ConnId(1),
                doc: DocId("doc-a".to_string()),
                frame: ClientFrame::RequestSnapshot,
            })
            .actions
            .is_empty()
    );
}

#[test]
fn reattach_after_eviction_reloads_from_the_store() {
    let mut manager = ConnManager::<MockReplica>::new();
    attach_ready(&mut manager, ConnId(1), "doc-a");
    evict(&mut manager, ConnId(1), "doc-a");
    assert_eq!(manager.resident_docs(), 0);

    let actions = manager
        .handle(ManagerInput::Attach {
            conn: ConnId(2),
            doc: DocId("doc-a".to_string()),
            capabilities: Capabilities {
                can_edit: true,
                user_id: None,
            },
        })
        .actions;
    assert_eq!(
        actions,
        vec![ManagerEffect {
            doc: DocId("doc-a".to_string()),
            effect: Effect::Load
        }]
    );
}
