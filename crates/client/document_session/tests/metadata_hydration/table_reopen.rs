//! Reopen parity against the v11 Source recorder's actual local update stream.
use super::*;
use loro_internal::ToJson;
use serde_json::Value;
use std::sync::Mutex;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packages/lexical-conformance/fixtures/table-reopen-v11"
);

fn fixture(name: &str) -> Result<Value, Box<dyn std::error::Error>> {
    Ok(serde_json::from_slice(&std::fs::read(format!(
        "{FIXTURE}/{name}/source.json"
    ))?)?)
}

// Resolve compressed container peers, retaining the actual container, op and value.
fn operations(update: &Value) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let peers = update["peers"].as_array().ok_or("peer list")?;
    let mut result = Vec::new();
    for change in update["changes"].as_array().ok_or("change list")? {
        for op in change["ops"].as_array().ok_or("op list")? {
            let cid = op["container"].as_str().ok_or("container id")?;
            let (prefix, suffix) = cid.rsplit_once('@').ok_or("compressed container")?;
            let (peer, kind) = suffix.split_once(':').ok_or("container kind")?;
            let peer = peers
                .get(peer.parse::<usize>()?)
                .and_then(Value::as_str)
                .ok_or("peer id")?;
            result.push(json!({"container":format!("{prefix}@{peer}:{kind}"),
                "content":op["content"]}));
        }
    }
    Ok(result)
}

fn compare(
    name: &str,
    access: Access,
    search_text: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let recorded = fixture(name)?;
    let snapshot = std::fs::read(format!("{FIXTURE}/{name}/received.loro"))?;
    let doc = lexical_loro::new_doc(50)?;
    doc.import(&snapshot)?;
    let captured = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
    let updates = captured.clone();
    let subscription = doc.subscribe_local_update(Box::new(move |bytes| {
        updates
            .lock()
            .expect("local update capture")
            .push(bytes.clone());
        true
    }));
    let events = Arc::new(Mutex::new(Vec::new()));
    let origins = events.clone();
    // Pre-commit observes origins even when a known projection suppresses full
    // root diffs and checkpoints undo directly.
    let event_subscription = doc.subscribe_pre_commit(Box::new(move |event| {
        origins
            .lock()
            .expect("local origin capture")
            .push(event.origin.clone());
        true
    }));
    let mut config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    config.policy = if search_text {
        &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY
    } else {
        &macro_document_model::sync::MACRO_SYNC_POLICY
    };
    let now = Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    };
    let mut surface =
        <EditorSurface as Surface>::construct(SurfaceConfig::Editor(config), 50, now)?;
    let mut view = Vec::new();
    Surface::init(&mut surface, &doc, now, access, &mut view)?;
    assert_eq!(
        view.iter()
            .filter(|effect| matches!(effect, document_session::ViewEffect::Initialize(_)))
            .count(),
        1
    );
    assert!(
        !view
            .iter()
            .any(|effect| matches!(effect, document_session::ViewEffect::Diff(_)))
    );
    drop(subscription);
    drop(event_subscription);
    let source_updates = recorded["updates"].as_array().ok_or("Source update list")?;
    let expected = source_updates
        .iter()
        .map(operations)
        .collect::<Result<Vec<_>, _>>()?;
    let replay = lexical_loro::new_doc(81)?;
    replay.import(&snapshot)?;
    let mut observed = Vec::new();
    let mut intermediate = Vec::new();
    for bytes in captured.lock().map_err(|_| "update lock")?.iter() {
        let before = replay.oplog_vv();
        replay.import(bytes)?;
        observed.push(operations(&serde_json::to_value(
            replay.export_json_updates(&before, &replay.oplog_vv())?,
        )?)?);
        intermediate
            .push(replay.get_deep_value().to_json_value()["root"]["$"]["documentMetadata"].clone());
    }
    assert_eq!(observed, expected, "{name}: actual local updates");
    assert_eq!(recorded["searchTextEnabled"], json!(search_text));
    let source_replay = lexical_loro::new_doc(82)?;
    source_replay.import(&snapshot)?;
    let mut expected_intermediate = Vec::new();
    for (index, expected_ops) in expected.iter().enumerate() {
        let before = source_replay.oplog_vv();
        source_replay.import(&std::fs::read(format!(
            "{FIXTURE}/{name}/update-{index}.loro"
        ))?)?;
        assert_eq!(
            &operations(&serde_json::to_value(
                source_replay.export_json_updates(&before, &source_replay.oplog_vv())?
            )?)?,
            expected_ops,
            "{name}: Source JSON matches its raw update {index}"
        );
        expected_intermediate.push(
            source_replay.get_deep_value().to_json_value()["root"]["$"]["documentMetadata"].clone(),
        );
    }
    assert_eq!(
        source_replay.get_deep_value().to_json_value(),
        recorded["stored"],
        "{name}: Source raw updates replay to its stored tree"
    );
    assert_eq!(
        intermediate, expected_intermediate,
        "{name}: partial delivery"
    );
    assert_eq!(
        doc.get_deep_value().to_json_value(),
        recorded["stored"],
        "{name}: stored tree"
    );
    let events = events.lock().map_err(|_| "event lock")?;
    assert_eq!(events.len(), expected.len());
    assert!(
        events
            .iter()
            .all(|origin| origin == lexical_loro::LOCAL_ORIGIN)
    );
    if access == Access::Edit {
        assert_eq!(
            surface.history().can_undo,
            recorded["undoManager"]["canUndo"]
                .as_bool()
                .ok_or("undo fact")?
        );
        assert_eq!(
            surface.history().can_redo,
            recorded["undoManager"]["canRedo"]
                .as_bool()
                .ok_or("redo fact")?
        );
    }
    if access == Access::Edit && !expected.is_empty() {
        local_input(
            &mut surface,
            &doc,
            lexical_model::Input::Command {
                command: lexical_model::Command::Undo,
                selection: lexical_model::ViewSelection::KeepModel,
            },
            1000,
        )?;
        assert!(
            !surface.history().can_undo,
            "{name}: reopen is one undo item"
        );
        assert!(surface.history().can_redo);
        assert_eq!(
            doc.get_deep_value().to_json_value()["root"]["$"]["documentMetadata"],
            recorded["received"]["root"]["$"]["documentMetadata"],
            "{name}: undo restores metadata"
        );
    }
    Ok(())
}

fn compare_profile(profile: &str, search_text: bool) -> Result<(), Box<dyn std::error::Error>> {
    for (name, access) in [
        ("edit", Access::Edit),
        ("tags-null", Access::Edit),
        ("current", Access::Edit),
        ("current-null", Access::Edit),
        ("missing-search", Access::Edit),
        ("read", Access::Read),
        ("comment", Access::CommentOnly),
    ] {
        compare(&format!("{profile}/{name}"), access, search_text)?;
    }
    Ok(())
}

#[test]
fn recorded_keyless_table_reopen_without_search_text_matches_each_source_update()
-> Result<(), Box<dyn std::error::Error>> {
    compare_profile("search-off", false)
}

#[test]
fn recorded_keyless_table_reopen_with_search_text_matches_each_source_update()
-> Result<(), Box<dyn std::error::Error>> {
    compare_profile("search-on", true)
}
