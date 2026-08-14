use crate::manager::{ConnManager, ManagerInput};
use crate::model::{Capabilities, ClientFrame, ConnId, DocId, Effect, ServerFrame};
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

#[test]
fn manager_scoped_timer_tokens_route_back_to_their_document() {
    let mut manager = ConnManager::<MockReplica>::new();
    attach_ready(&mut manager, ConnId(1), "doc-a");
    attach_ready(&mut manager, ConnId(2), "doc-b");

    // Detach both; each doc arms an idle timer under a manager-scoped token.
    let actions = manager
        .handle(ManagerInput::Detach {
            conn: ConnId(1),
            doc: DocId("doc-a".to_string()),
        })
        .actions;
    let timer_a = actions
        .iter()
        .find_map(|action| match (&action.doc, &action.effect) {
            (doc, Effect::ScheduleTimer { token, .. }) if doc.as_str() == "doc-a" => Some(*token),
            _ => None,
        })
        .expect("doc-a idle timer");
    let actions = manager
        .handle(ManagerInput::Detach {
            conn: ConnId(2),
            doc: DocId("doc-b".to_string()),
        })
        .actions;
    let timer_b = actions
        .iter()
        .find_map(|action| match (&action.doc, &action.effect) {
            (doc, Effect::ScheduleTimer { token, .. }) if doc.as_str() == "doc-b" => Some(*token),
            _ => None,
        })
        .expect("doc-b idle timer");
    assert_ne!(timer_a, timer_b);

    // Firing doc-b's token evicts only doc-b (Evict is consumed by the
    // manager, so the effect list is empty).
    let actions = manager
        .handle(ManagerInput::TimerFired { token: timer_b })
        .actions;
    assert!(actions.is_empty());
    assert_eq!(manager.resident_docs(), 1);

    let actions = manager
        .handle(ManagerInput::TimerFired { token: timer_a })
        .actions;
    assert!(actions.is_empty());
    assert_eq!(manager.resident_docs(), 0);
}

#[test]
fn persist_completions_route_through_manager_scoped_tokens() {
    let mut manager = ConnManager::<MockReplica>::new();
    attach_ready(&mut manager, ConnId(1), "doc-a");

    let actions = manager
        .handle(ManagerInput::Frame {
            conn: ConnId(1),
            doc: DocId("doc-a".to_string()),
            frame: ClientFrame::Update {
                updates: vec![b"x".to_vec()],
                id: "op-1".into(),
            },
        })
        .actions;
    let persist = actions
        .iter()
        .find_map(|action| match &action.effect {
            Effect::PersistOps { token, .. } => Some(*token),
            _ => None,
        })
        .expect("persist ops");

    let actions = manager
        .handle(ManagerInput::OpsPersisted {
            doc: DocId("doc-a".to_string()),
            token: persist,
            through_seq: 1,
        })
        .actions;
    assert!(actions.iter().any(|action| matches!(
        &action.effect,
        Effect::Send {
            frame: ServerFrame::Ack { id },
            ..
        } if id == "op-1"
    )));

    // A duplicate completion is stale and ignored.
    let outcome = manager.handle(ManagerInput::OpsPersisted {
        doc: DocId("doc-a".to_string()),
        token: persist,
        through_seq: 1,
    });
    assert!(outcome.actions.is_empty());
    assert!(outcome.reason.contains("stale"));
}
