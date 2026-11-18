use super::*;
use macro_document_model::{
    EditorType,
    nodes::AwaitNode,
    plugins_group_b::{DatabaseCommandResult, DatabaseMainCommitResult},
};
use std::sync::{Arc, atomic::AtomicI64};

fn fixture() -> DocumentSession<EditorSurface> {
    let editor = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(1234)),
        EditorType::MarkdownSync,
    );
    let mut session = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync: sync_config(Access::Edit, TransportKind::None),
            peer_ids: vec![20, 21, 22, 23],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(editor),
        },
        time(0),
    )
    .expect("session");
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    session.handle(
        time(1),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        }),
    );
    let output=session.handle(time(2),SessionInput::Editor(Input::SetState{state:serde_json::from_value(json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"Before. After.","format":0,"detail":0,"mode":"normal","style":""}]}]}})).expect("seed"),tags:TagSet::default()}));
    assert!(
        !output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    session
}
fn input(session: &DocumentSession<EditorSurface>, name: &str, value: serde_json::Value) -> Input {
    let command = macro_document_model::surface::decode_command(
        name,
        &value.to_string(),
        session.surface().state().max_key().generation(),
        None,
    )
    .expect("closed payload")
    .expect("Database command");
    Input::Command {
        command,
        selection: ViewSelection::KeepModel,
    }
}
fn start(session: &mut DocumentSession<EditorSurface>) -> NodeKey {
    let command = input(session, "group-b.database-create-start", json!({}));
    let mut main = MainCommitOutcome::NotPublished;
    let mut result = None;
    let output =
        session.handle_editor_with_database_commit(time(3), command, &mut main, &mut result);
    assert!(
        !output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    let result = result.expect("exact main result");
    assert_eq!(
        main,
        MainCommitOutcome::Published {
            commit_id: result.commit_id,
            handled: Handled::Yes
        }
    );
    let DatabaseCommandResult::Started { key, await_id } = result.result else {
        panic!("start authority");
    };
    assert_eq!(
        session
            .surface()
            .state()
            .view()
            .get_or_err::<AwaitNode>(key)
            .expect("actual Await")
            .await_id
            .as_deref(),
        Some(await_id.as_str())
    );
    key
}

#[test]
fn actual_session_observes_start_and_completion_beside_own_main_ids() {
    let mut session = fixture();
    let key = start(&mut session);
    let command = input(
        &session,
        "group-b.database-create-complete",
        json!({"key":key.index(),"documentId":"synthetic-database","mentionUuid":"synthetic-mention"}),
    );
    let mut main = MainCommitOutcome::NotPublished;
    let mut result = None;
    let output =
        session.handle_editor_with_database_commit(time(4), command, &mut main, &mut result);
    assert!(
        !output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    let result = result.expect("completion fact");
    assert_eq!(result.result, DatabaseCommandResult::Inserted);
    assert_eq!(
        main,
        MainCommitOutcome::Published {
            commit_id: result.commit_id,
            handled: Handled::Yes
        }
    );
    assert!(
        session
            .surface()
            .state()
            .view()
            .get::<AwaitNode>(key)
            .is_none()
    );
}

#[test]
fn read_revocation_denies_cleanup_and_completion_without_model_or_document_write() {
    let source:serde_json::Value=serde_json::from_str(include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/../lexical/macro_document_model/src/plugins_group_b/database_create_actions/source-oracle.json"))).expect("pinned Source run01");
    for (label, snapshot, untrack) in [
        ("create-readonly", "after-late-create", 0),
        ("track-readonly", "after-late-track", 1),
    ] {
        let trace = source["cases"][label]["trace"]
            .as_array()
            .expect("Source trace");
        let outcome = trace
            .iter()
            .find(|x| x["event"] == snapshot)
            .expect("Source local cleanup");
        assert_eq!(outcome["data"]["editable"], false);
        assert!(
            outcome["data"]["awaits"]
                .as_array()
                .expect("Source Await list")
                .is_empty()
        );
        assert_eq!(
            trace.iter().filter(|x| x["event"] == "untrack").count(),
            untrack
        );
    }

    for operation in [
        "group-b.database-create-complete",
        "group-b.database-remove-await",
        "group-b.database-remove-any",
    ] {
        let mut session = fixture();
        let key = start(&mut session);
        session.handle(
            time(4),
            SessionInput::Sync(SyncInput::Authorization(AuthorizationState {
                current: true,
                can_write: false,
                can_comment: false,
            })),
        );
        assert_eq!(session.effective_access(), Access::Read);
        let before = session.surface().state().to_json().expect("model");
        let vv = session.version();
        let payload = if operation == "group-b.database-create-complete" {
            json!({"key":key.index(),"documentId":"synthetic-database"})
        } else {
            json!({"key":key.index()})
        };
        let command = input(&session, operation, payload);
        let mut main = MainCommitOutcome::Published {
            commit_id: CommitId(99),
            handled: Handled::Yes,
        };
        let mut result = Some(DatabaseMainCommitResult {
            commit_id: CommitId(99),
            result: DatabaseCommandResult::Inserted,
        });
        let output =
            session.handle_editor_with_database_commit(time(5), command, &mut main, &mut result);
        assert!(
            output
                .view
                .iter()
                .any(|effect| matches!(effect, ViewEffect::Error(SessionError::ReadOnly)))
        );
        assert_eq!(main, MainCommitOutcome::NotPublished);
        assert!(result.is_none());
        assert_eq!(session.surface().state().to_json().expect("model"), before);
        assert_eq!(session.version(), vv);
        assert!(
            session
                .surface()
                .state()
                .view()
                .get::<AwaitNode>(key)
                .is_some()
        );
        // C-DATABASE-READONLY-LOCAL-CLEANUP-01: Source create-readonly and
        // track-readonly remove locally; native admission refuses that write.
        // Source track-readonly untrack1 remains a separate app IO obligation.
    }
}

#[test]
fn stopped_origin_cannot_mutate_or_reuse_an_earlier_database_result() {
    let source:serde_json::Value=serde_json::from_str(include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/../lexical/macro_document_model/src/plugins_group_b/database_create_actions/source-oracle.json"))).expect("pinned Source run01");
    for (label, snapshot) in [
        ("create-close", "after-late-create"),
        ("track-close", "after-late-track"),
    ] {
        let trace = source["cases"][label]["trace"]
            .as_array()
            .expect("Source trace");
        let final_state = trace
            .iter()
            .find(|x| x["event"] == snapshot)
            .expect("Source disconnected update");
        assert_eq!(final_state["data"]["rootConnected"], false);
        assert_eq!(
            final_state["data"]["json"]["root"]["children"][1]["type"],
            "document-card"
        );
        assert_eq!(trace.iter().filter(|x| x["event"] == "track").count(), 1);
    }

    let mut session = fixture();
    let key = start(&mut session);
    let command = input(
        &session,
        "group-b.database-create-complete",
        json!({"key":key.index(),"documentId":"synthetic-database"}),
    );
    session.handle(time(4), SessionInput::Sync(SyncInput::Stop(RequestId(91))));
    let before = session.surface().state().to_json().expect("model");
    let vv = session.version();
    let mut main = MainCommitOutcome::Published {
        commit_id: CommitId(99),
        handled: Handled::Yes,
    };
    let mut result = Some(DatabaseMainCommitResult {
        commit_id: CommitId(99),
        result: DatabaseCommandResult::Inserted,
    });
    let output =
        session.handle_editor_with_database_commit(time(5), command, &mut main, &mut result);
    assert!(
        output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(SessionError::NotReady)))
    );
    assert_eq!(main, MainCommitOutcome::NotPublished);
    assert!(result.is_none());
    assert_eq!(session.surface().state().to_json().expect("model"), before);
    assert_eq!(session.version(), vv);
    // C-DATABASE-RETIRED-LOCAL-WRITE-01. This is an actual native Sync Stop,
    // not a Source routed-close or browser durability acceptance claim.
}

#[test]
fn missing_target_has_published_zero_dirty_result_not_false_not_published() {
    let mut session = fixture();
    let command = input(
        &session,
        "group-b.database-create-complete",
        json!({"key":u32::MAX,"documentId":"synthetic-database"}),
    );
    let before = session.surface().state().to_json().expect("model");
    let vv = session.version();
    let history = session.surface().history();
    let mut main = MainCommitOutcome::NotPublished;
    let mut result = None;
    let output =
        session.handle_editor_with_database_commit(time(4), command, &mut main, &mut result);
    assert!(
        !output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    let result = result.expect("zero-dirty main fact");
    assert_eq!(result.result, DatabaseCommandResult::NotAwait);
    assert_eq!(
        main,
        MainCommitOutcome::Published {
            commit_id: result.commit_id,
            handled: Handled::Yes
        }
    );
    assert_eq!(session.surface().state().to_json().expect("model"), before);
    assert_eq!(session.version(), vv);
    assert_eq!(session.surface().history(), history);
}

#[test]
fn reused_capture_clears_earlier_publication_before_read_denied_session_admission() {
    let mut session = fixture();
    let first = input(&session, "group-b.database-create-start", json!({}));
    let mut capture = macro_document_model::plugins_group_b::DatabaseCommitCapture::new(&first);
    let mut main = MainCommitOutcome::NotPublished;
    let output =
        session.handle_editor_with_main_commit_receipts(time(3), first, &mut main, &mut capture);
    assert!(
        !output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    assert!(matches!(
        main,
        MainCommitOutcome::Published {
            handled: Handled::Yes,
            ..
        }
    ));
    assert_eq!(
        session
            .surface()
            .state()
            .view()
            .descendants(NodeKey::ROOT)
            .filter(|(key, _)| session.surface().state().view().is::<AwaitNode>(*key))
            .count(),
        1
    );
    session.handle(
        time(4),
        SessionInput::Sync(SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: false,
            can_comment: false,
        })),
    );
    assert_eq!(session.effective_access(), Access::Read);
    let before = session.surface().state().to_json().expect("model");
    let version = session.version();
    let second = input(&session, "group-b.database-create-start", json!({}));
    let output =
        session.handle_editor_with_main_commit_receipts(time(5), second, &mut main, &mut capture);
    assert!(
        output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(SessionError::ReadOnly)))
    );
    assert_eq!(main, MainCommitOutcome::NotPublished);
    assert!(
        capture.into_result().is_none(),
        "session admission must retire old result before Core runs"
    );
    assert_eq!(session.surface().state().to_json().expect("model"), before);
    assert_eq!(session.version(), version);
}
