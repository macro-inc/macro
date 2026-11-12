use super::*;
use std::sync::{Arc, atomic::AtomicI64};

#[test]
fn facts_input_delivers_real_plan_without_model_or_crdt_publication() {
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
    session.handle(time(2),SessionInput::Editor(Input::SetState {state:serde_json::from_value(json!({"root":{"type":"root","children":[{"type":"list","listType":"check","tag":"ul","start":1,"children":[{"type":"listitem","value":1,"checked":false,"children":[{"type":"text","text":"Work"}]}]}]}})).unwrap(),tags:TagSet::default()}));
    let state = session.surface().state().clone();
    let version = session.version();
    let generation = state.max_key().generation();
    let mut payload: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../lexical/macro_document_model/src/plugins_group_b/checklist_query/request-example.json"
    )))
    .unwrap();
    payload.as_object_mut().unwrap().remove("listKey");
    payload["factsVersion"] = json!("1");
    let command = macro_document_model::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
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
    let updates: Vec<_> = output
        .view
        .iter()
        .filter_map(|effect| {
            if let ViewEffect::ChecklistPlans(updates) = effect {
                Some(serde_json::to_value(updates).unwrap())
            } else {
                None
            }
        })
        .collect();
    assert_eq!(
        updates.len(),
        1,
        "actual facts input must configure the producer"
    );
    assert_eq!(updates[0]["kind"], "delta");
    assert_eq!(updates[0]["factsVersion"], "1");
    assert_eq!(updates[0]["sequence"], "1");
    assert_eq!(updates[0]["reset"], true);
    assert_eq!(updates[0]["lists"][0]["result"]["kind"], "planned");
    assert_eq!(updates[0]["lists"][0]["result"]["progress"]["total"], 1);
    assert!(output.io.is_empty());
    assert_eq!(session.version(), version);
    let receipts = session.last_output().checklist_deliveries();
    session.acknowledge_application_output(&receipts);
    assert!(session.surface().state().same_snapshot(&state));
    // Re-delivery does not create another publication or presentation sequence.
    let duplicate = macro_document_model::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
        generation,
        None,
    )
    .unwrap()
    .unwrap();
    let duplicate_output = session.handle(
        time(4),
        SessionInput::Editor(Input::Command {
            command: duplicate,
            selection: ViewSelection::KeepModel,
        }),
    );
    assert!(
        !duplicate_output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::ChecklistPlans(_)))
    );
    payload["names"] = json!({"unreferenced":"Changed"});
    let conflict = macro_document_model::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
        generation,
        None,
    )
    .unwrap()
    .unwrap();
    let conflict_output = session.handle(
        time(5),
        SessionInput::Editor(Input::Command {
            command: conflict,
            selection: ViewSelection::KeepModel,
        }),
    );
    assert!(
        conflict_output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    assert!(
        !conflict_output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::ChecklistPlans(_)))
    );
    let access_output = session.handle(
        time(6),
        SessionInput::Sync(SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: false,
            can_comment: false,
        })),
    );
    let access_updates: Vec<_> = access_output
        .view
        .iter()
        .filter_map(|effect| {
            if let ViewEffect::ChecklistPlans(updates) = effect {
                Some(serde_json::to_value(updates).unwrap())
            } else {
                None
            }
        })
        .collect();
    assert_eq!(access_updates.len(), 1);
    assert_eq!(access_updates[0]["sequence"], "2");
    assert_eq!(access_updates[0]["factsVersion"], "1");
    assert_eq!(access_updates[0]["lists"], json!([]));
    assert!(access_output.io.is_empty());
    let receipts = session.last_output().checklist_deliveries();
    session.acknowledge_application_output(&receipts);
    assert_eq!(session.effective_access(), Access::Read);
    payload["factsVersion"] = json!("2");
    let readonly = macro_document_model::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
        generation,
        None,
    )
    .unwrap()
    .unwrap();
    let readonly_output = session.handle(
        time(7),
        SessionInput::Editor(Input::Command {
            command: readonly,
            selection: ViewSelection::KeepModel,
        }),
    );
    let readonly_updates: Vec<_> = readonly_output
        .view
        .iter()
        .filter_map(|effect| {
            if let ViewEffect::ChecklistPlans(updates) = effect {
                Some(serde_json::to_value(updates).unwrap())
            } else {
                None
            }
        })
        .collect();
    assert_eq!(readonly_updates.len(), 1);
    assert_eq!(readonly_updates[0]["sequence"], "3");
    assert_eq!(readonly_updates[0]["factsVersion"], "2");
    assert_eq!(readonly_updates[0]["lists"], json!([]));
    assert!(readonly_output.io.is_empty());
    let receipts = session.last_output().checklist_deliveries();
    session.acknowledge_application_output(&receipts);
    assert_eq!(session.version(), version);
    assert!(session.surface().state().same_snapshot(&state));
    let denied = session.handle(
        time(8),
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("blocked".into()),
            selection: ViewSelection::KeepModel,
        }),
    );
    assert!(
        denied
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(SessionError::ReadOnly)))
    );
    payload["factsVersion"] = json!("3");
    let batch_command = macro_document_model::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
        generation,
        None,
    )
    .unwrap()
    .unwrap();
    let batch = session.handle(
        time(9),
        SessionInput::Editor(Input::Batch(vec![
            Input::Command {
                command: Command::InsertText("must not run".into()),
                selection: ViewSelection::KeepModel,
            },
            Input::Command {
                command: batch_command,
                selection: ViewSelection::KeepModel,
            },
        ])),
    );
    assert!(batch.view.iter().any(|effect| matches!(
        effect,
        ViewEffect::Error(SessionError::Model(Error::InputNotBatchable))
    )));
    let stale_command = macro_document_model::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
        generation + 1,
        None,
    )
    .unwrap()
    .unwrap();
    let stale = session.handle(
        time(10),
        SessionInput::Editor(Input::Command {
            command: stale_command,
            selection: ViewSelection::KeepModel,
        }),
    );
    assert!(
        stale
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    let selected_command = macro_document_model::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
        generation,
        None,
    )
    .unwrap()
    .unwrap();
    let selected = session.handle(
        time(11),
        SessionInput::Editor(Input::Command {
            command: selected_command,
            selection: ViewSelection::None,
        }),
    );
    assert!(
        selected
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    let valid = macro_document_model::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
        generation,
        None,
    )
    .unwrap()
    .unwrap();
    let valid_output = session.handle(
        time(12),
        SessionInput::Editor(Input::Command {
            command: valid,
            selection: ViewSelection::KeepModel,
        }),
    );
    let valid_updates: Vec<_> = valid_output
        .view
        .iter()
        .filter_map(|effect| {
            if let ViewEffect::ChecklistPlans(updates) = effect {
                Some(serde_json::to_value(updates).unwrap())
            } else {
                None
            }
        })
        .collect();
    assert_eq!(valid_updates[0]["sequence"], "4");
    assert_eq!(valid_updates[0]["factsVersion"], "3");
    assert_eq!(session.version(), version);
    assert!(session.surface().state().same_snapshot(&state));
}
