use crate::manager::{ConnManager, ManagerEffect, ManagerInput};
use crate::model::{Capabilities, ClientFrame, ConnId, DocId, Effect, Lifecycle, ServerFrame};
use crate::replica::mock::MockReplica;
use macro_user_id::user_id::MacroUserIdStr;

/// Bring one (conn, doc) to Ready, discarding setup effects.
fn attach_ready(manager: &mut ConnManager<MockReplica>, conn: ConnId, id: &str) {
    manager.handle(ManagerInput::Attach {
        conn,
        doc: DocId(id.to_string()),
        capabilities: Capabilities {
            can_edit: true,
            user_id: Some(MacroUserIdStr::try_from("macro|user-1@test.com".to_string()).unwrap()),
        },
    });
    manager.handle(ManagerInput::Loaded {
        doc: DocId(id.to_string()),
        snapshot: Some(b"base".to_vec()),
        snapshot_seq: 0,
        ops: Vec::new(),
    });
}

#[test]
fn attach_creates_the_machine_and_lifts_load_with_the_doc_stamped() {
    let mut manager = ConnManager::<MockReplica>::new();
    let actions = manager
        .handle(ManagerInput::Attach {
            conn: ConnId(1),
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
    assert_eq!(manager.resident_docs(), 1);
}

#[test]
fn frames_route_to_the_right_document() {
    let mut manager = ConnManager::<MockReplica>::new();
    attach_ready(&mut manager, ConnId(1), "doc-a");
    attach_ready(&mut manager, ConnId(1), "doc-b");

    let actions = manager
        .handle(ManagerInput::Frame {
            conn: ConnId(1),
            doc: DocId("doc-b".to_string()),
            frame: ClientFrame::RequestSnapshot,
        })
        .actions;
    assert_eq!(actions.len(), 1);
    assert_eq!(actions[0].doc, DocId("doc-b".to_string()));
    assert!(matches!(
        actions[0].effect,
        Effect::Send {
            frame: ServerFrame::Snapshot { .. },
            ..
        }
    ));
}

#[test]
fn per_doc_detaches_reach_their_documents() {
    // Socket-death fan-out is the edge's job (the router already tears down
    // each route); the manager just sees one Detach per (conn, doc).
    let mut manager = ConnManager::<MockReplica>::new();
    attach_ready(&mut manager, ConnId(1), "doc-a");
    attach_ready(&mut manager, ConnId(2), "doc-b");

    let mut last_leaves = Vec::new();
    let outcome = manager.handle(ManagerInput::Detach {
        conn: ConnId(1),
        doc: DocId("doc-a".to_string()),
    });
    last_leaves.extend(outcome.lifecycle);
    let outcome = manager.handle(ManagerInput::Detach {
        conn: ConnId(2),
        doc: DocId("doc-b".to_string()),
    });
    last_leaves.extend(outcome.lifecycle);
    assert_eq!(
        last_leaves,
        vec![
            (DocId("doc-a".to_string()), Lifecycle::LastLeave),
            (DocId("doc-b".to_string()), Lifecycle::LastLeave),
        ]
    );
}

/// Late inputs for evicted documents route nowhere (regression guard for the
/// `drive` early-return on a missing machine).
#[test]
fn frames_for_unknown_documents_are_ignored() {
    let mut manager = ConnManager::<MockReplica>::new();
    assert!(
        manager
            .handle(ManagerInput::Frame {
                conn: ConnId(1),
                doc: DocId("never-seen".to_string()),
                frame: ClientFrame::RequestSnapshot,
            })
            .actions
            .is_empty()
    );
}
