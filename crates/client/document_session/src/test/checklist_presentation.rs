use super::*;
use std::sync::{Arc, atomic::AtomicI64};

fn fixture() -> DocumentSession<EditorSurface> {
    let editor = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(1_000_000)),
        macro_document_model::EditorType::MarkdownSync,
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
    .unwrap();
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    session.handle(
        time(1),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        }),
    );
    let output = session.handle(
        time(2),
        SessionInput::Editor(Input::SetState {
            state: serde_json::from_value(json!({"root": {
                "type": "root", "children": [{
                    "type": "task-list", "listType": "check", "tag": "ul", "start": 1,
                    "$": {"taskListView": {"filters": {
                        "status": ["done"], "priority": [], "assignees": [], "due": []
                    }}},
                    "children": [{"type": "listitem", "value": 1, "checked": false,
                        "children": [{"type": "text", "text": "Work"}]}]
                }]
            }}))
            .unwrap(),
            tags: TagSet::default(),
        }),
    );
    assert!(
        !output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    let generation = session.surface().state().max_key().generation();
    let mut facts: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../lexical/macro_document_model/src/plugins_group_b/checklist_query/request-example.json"
    )))
    .unwrap();
    facts.as_object_mut().unwrap().remove("listKey");
    facts["factsVersion"] = json!("1");
    let command = macro_document_model::surface::decode_command(
        "group-b.set-checklist-facts",
        &facts.to_string(),
        generation,
        None,
    )
    .unwrap()
    .unwrap();
    let output = session.handle(
        time(3),
        SessionInput::Editor(Input::Command {
            command,
            selection: ViewSelection::KeepModel,
        }),
    );
    let plans = deliveries(output);
    assert_eq!(plans.len(), 1);
    assert_eq!(
        plans[0]["lists"][0]["result"]["settings"]["filters"]["status"],
        json!(["done"])
    );
    assert_eq!(plans[0]["lists"][0]["result"]["rows"][0]["dimmed"], true);
    acknowledge(&mut session);
    session
}

fn deliveries(output: &SessionOutput) -> Vec<serde_json::Value> {
    output
        .view
        .iter()
        .filter_map(|effect| match effect {
            ViewEffect::ChecklistPlans(updates) => Some(serde_json::to_value(updates).unwrap()),
            _ => None,
        })
        .collect()
}

fn acknowledge(session: &mut DocumentSession<EditorSurface>) {
    let receipts = session.last_output().checklist_deliveries();
    session.acknowledge_application_output(&receipts);
}

fn access(session: &mut DocumentSession<EditorSurface>, value: Access, clock: u64) -> String {
    let output = session.handle(
        time(clock),
        SessionInput::Sync(SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: value == Access::Edit,
            can_comment: value == Access::CommentOnly,
        })),
    );
    assert!(
        !output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    let updates = deliveries(output);
    assert_eq!(
        updates.len(),
        1,
        "every actual access change must invalidate even an equal plan"
    );
    let sequence = updates[0]["sequence"].as_str().unwrap().to_owned();
    assert_eq!(session.effective_access(), value);
    acknowledge(session);
    sequence
}

fn intent(session: &DocumentSession<EditorSurface>, sequence: &str, status: &[&str]) -> Input {
    let state = session.surface().state();
    let key = state.view().children(NodeKey::ROOT).next().unwrap();
    let command = macro_document_model::surface::decode_command(
        "group-b.checklist-settings-intent",
        &json!({"key": key.index(), "observedSequence": sequence, "settings": {
            "filters": {"status": status, "priority": [], "assignees": [], "due": []}
        }})
        .to_string(),
        state.max_key().generation(),
        None,
    )
    .unwrap()
    .expect("closed checklist presentation intent must decode");
    Input::Command {
        command,
        selection: ViewSelection::KeepModel,
    }
}

#[test]
fn read_and_comment_filter_only_presentation_without_main_publication() {
    for value in [Access::Read, Access::CommentOnly] {
        let mut session = fixture();
        let sequence = access(&mut session, value, 4);
        let before = session.surface().state().clone();
        let canonical = serde_json::to_value(before.to_json().unwrap()).unwrap();
        let version = session.version();
        let history = session.surface().history();
        let input = intent(&session, &sequence, &["not-started"]);
        let mut outcome = MainCommitOutcome::NotPublished;
        let output = session.handle_editor_with_main_commit(time(5), input, &mut outcome);
        assert!(
            !output
                .view
                .iter()
                .any(|effect| matches!(effect, ViewEffect::Error(_)))
        );
        assert!(
            output.io.is_empty(),
            "local presentation creates no WAL or transport work"
        );
        let updates = deliveries(output);
        assert_eq!(updates.len(), 1);
        assert_eq!(
            updates[0]["lists"][0]["changes"]["settings"]["filters"]["status"],
            json!(["not-started"])
        );
        assert_eq!(
            updates[0]["lists"][0]["changes"]["rows"][0]["dimmed"],
            false
        );
        assert_eq!(outcome, MainCommitOutcome::NotPublished);
        assert!(session.surface().state().same_snapshot(&before));
        assert_eq!(
            serde_json::to_value(session.surface().state().to_json().unwrap()).unwrap(),
            canonical
        );
        assert_eq!(session.version(), version);
        assert_eq!(session.surface().history(), history);
        acknowledge(&mut session);
    }
}

#[test]
fn access_upgrade_rejects_queued_reader_patch_even_when_plan_was_identical() {
    for local in ["done", "not-started"] {
        let mut session = fixture();
        let sequence = access(&mut session, Access::Read, 4);
        let input = intent(&session, &sequence, &[local]);
        session.handle(time(5), SessionInput::Editor(input));
        let updates = deliveries(session.last_output());
        assert_eq!(updates.len(), 1);
        let local_sequence = updates[0]["sequence"].as_str().unwrap().to_owned();
        acknowledge(&mut session);
        let queued = intent(&session, &local_sequence, &["in-progress"]);
        let next_sequence = access(&mut session, Access::Edit, 6);
        assert_ne!(local_sequence, next_sequence);
        let before = session.surface().state().clone();
        let version = session.version();
        let mut outcome = MainCommitOutcome::NotPublished;
        let output = session.handle_editor_with_main_commit(time(7), queued, &mut outcome);
        assert!(
            !output
                .view
                .iter()
                .any(|effect| matches!(effect, ViewEffect::Error(_)))
        );
        assert!(output.io.is_empty());
        assert!(deliveries(output).is_empty());
        assert_eq!(outcome, MainCommitOutcome::NotPublished);
        assert!(session.surface().state().same_snapshot(&before));
        assert_eq!(session.version(), version);
    }
}

#[test]
fn equal_access_refresh_preserves_local_choice_and_observed_sequence() {
    let mut session = fixture();
    let sequence = access(&mut session, Access::CommentOnly, 4);
    let local = intent(&session, &sequence, &["not-started"]);
    session.handle(time(5), SessionInput::Editor(local));
    let updates = deliveries(session.last_output());
    let sequence = updates[0]["sequence"].as_str().unwrap().to_owned();
    acknowledge(&mut session);
    let output = session.handle(
        time(6),
        SessionInput::Sync(SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: false,
            can_comment: true,
        })),
    );
    assert!(
        deliveries(output).is_empty(),
        "equal access is not invalidation"
    );
    let clear = intent(&session, &sequence, &[]);
    let before = session.surface().state().clone();
    let mut outcome = MainCommitOutcome::NotPublished;
    let output = session.handle_editor_with_main_commit(time(7), clear, &mut outcome);
    assert!(
        !output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    let updates = deliveries(output);
    assert_eq!(
        updates[0]["lists"][0]["changes"]["settings"]["filters"]["status"],
        json!([])
    );
    assert_eq!(outcome, MainCommitOutcome::NotPublished);
    assert!(session.surface().state().same_snapshot(&before));
}

#[test]
fn edit_settings_use_existing_real_writer_and_publish() {
    let mut session = fixture();
    let input = intent(&session, "1", &["in-progress"]);
    let version = session.version();
    let mut outcome = MainCommitOutcome::NotPublished;
    let output = session.handle_editor_with_main_commit(time(4), input, &mut outcome);
    assert!(
        !output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    assert!(matches!(
        outcome,
        MainCommitOutcome::Published {
            handled: Handled::Yes,
            ..
        }
    ));
    assert_ne!(
        session.version(),
        version,
        "actual existing writer projects real CRDT operations"
    );
    let model = serde_json::to_value(session.surface().state().to_json().unwrap()).unwrap();
    assert_eq!(
        model["root"]["children"][0]["$"]["taskListView"]["filters"]["status"],
        json!(["in-progress"])
    );
}

#[test]
fn nested_and_non_keep_intents_refuse_before_model_mutation() {
    let mut session = fixture();
    let before = session.surface().state().clone();
    let version = session.version();
    let input = intent(&session, "1", &["not-started"]);
    let mut outcome = MainCommitOutcome::NotPublished;
    let output = session.handle_editor_with_main_commit(
        time(4),
        Input::Batch(vec![
            Input::Command {
                command: Command::ClearEditor,
                selection: ViewSelection::KeepModel,
            },
            input,
        ]),
        &mut outcome,
    );
    assert!(output.view.iter().any(|effect| matches!(
        effect,
        ViewEffect::Error(SessionError::Model(Error::InputNotBatchable))
    )));
    assert_eq!(outcome, MainCommitOutcome::NotPublished);
    assert!(session.surface().state().same_snapshot(&before));
    assert_eq!(session.version(), version);

    let Input::Command { command, .. } = intent(&session, "1", &[]) else {
        panic!("command");
    };
    let output = session.handle_editor_with_main_commit(
        time(5),
        Input::Command {
            command,
            selection: ViewSelection::None,
        },
        &mut outcome,
    );
    assert!(
        output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    assert_eq!(outcome, MainCommitOutcome::NotPublished);
    assert!(session.surface().state().same_snapshot(&before));
    assert_eq!(session.version(), version);
}
