use super::*;
use crate::{
    EditorType, NodeClock, NodeRandom,
    node_ids::NodeIdPlugin,
    nodes::{CommentNode, InlineSearchNode},
    peer::{PeerIdPlugin, PeerIdState},
    surface,
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

const ORACLE: &str = include_str!("source-oracle.json");
fn point(view: StateRef<'_>, value: &Value) -> Result<Point, Error> {
    let mut key = NodeKey::ROOT;
    for index in value["path"].as_array().expect("Source point path") {
        key = *view
            .children_keys(key)?
            .get(index.as_u64().expect("path index") as usize)
            .ok_or(Error::Invariant("Source point path absent"))?;
    }
    let offset =
        Utf16Offset(u32::try_from(value["offset"].as_u64().expect("offset")).expect("offset u32"));
    match value["type"].as_str() {
        Some("text") => Ok(Point::text(key, offset)),
        Some("element") => Ok(Point::element(key, ChildIndex(offset.0))),
        _ => Err(Error::Invariant("Source point kind")),
    }
}
fn select(editor: &mut Editor, source: &Value) -> Result<(), Error> {
    editor.update(|tx| {
        if source["kind"] == "none" {
            return tx.set_selection(None);
        }
        assert_eq!(source["kind"], "range");
        assert_eq!(source["format"], 0);
        assert_eq!(source["style"], "");
        let mut range = RangeSelection::collapsed(point(tx.view(), &source["anchor"])?);
        range.focus = point(tx.view(), &source["focus"])?;
        tx.set_selection(Some(Selection::Range(range)))
    })?;
    Ok(())
}
fn selection(state: &EditorState) -> Result<Value, Error> {
    let Some(range) = state.selection().and_then(Selection::as_range) else {
        return Ok(json!({"kind":"none"}));
    };
    fn export(view: StateRef<'_>, point: Point) -> Result<Value, Error> {
        let mut key = point.key();
        let mut path = vec![];
        while key != NodeKey::ROOT {
            path.push(
                view.index_within_parent(key)
                    .ok_or(Error::Invariant("selection index"))?
                    .0,
            );
            key = view.parent_or_err(key)?;
        }
        path.reverse();
        Ok(
            json!({"path":path,"offset":point.offset(),"type":match point.point_type(){PointType::Text=>"text",PointType::Element=>"element"}}),
        )
    }
    Ok(
        json!({"kind":"range","anchor":export(state.view(),range.anchor)?,"focus":export(state.view(),range.focus)?,"format":range.format.bits(),"style":range.style.to_string()}),
    )
}
fn node_ids(node: &Value, ids: &mut BTreeSet<String>) {
    let id = node["$"]["id"].as_str().expect("actual durable ID");
    assert_eq!(id.len(), 8);
    assert!(
        id.bytes()
            .all(|byte| crate::node_ids::NANOID_ALPHABET.contains(&byte))
    );
    assert!(ids.insert(id.to_owned()), "duplicate durable ID");
    if let Some(children) = node["children"].as_array() {
        for child in children {
            node_ids(child, ids);
        }
    }
}
// Source controls install the real wrapper/rich-text/ID/peer cohort, not all
// registerMarkdownEditing plugins. This fixture matches that cohort; production
// session wiring is exercised separately below the real session admission path.
// Compare every field without stripping. Existing IDs must remain on the same
// Source-kept node; only fresh IDs use a bijective value correspondence.
fn compare_node(
    source: &Value,
    native: &Value,
    originals: &BTreeSet<String>,
    pairs: &mut BTreeMap<String, String>,
) {
    let a = source.as_object().expect("Source node");
    let b = native.as_object().expect("native node");
    assert_eq!(
        a.keys().collect::<BTreeSet<_>>(),
        b.keys().collect::<BTreeSet<_>>()
    );
    for (key, value) in a {
        if key == "children" {
            let children = value.as_array().expect("children");
            let actual = b[key].as_array().expect("native children");
            assert_eq!(children.len(), actual.len());
            for (source, native) in children.iter().zip(actual) {
                compare_node(source, native, originals, pairs);
            }
        } else if key == "$" {
            let states = value.as_object().expect("Source state");
            let actual = b[key].as_object().expect("native state");
            assert_eq!(
                states.keys().collect::<BTreeSet<_>>(),
                actual.keys().collect::<BTreeSet<_>>()
            );
            for (name, value) in states {
                if name != "id" {
                    assert_eq!(value, &actual[name]);
                    continue;
                }
                let id = value.as_str().expect("Source ID");
                let native = actual[name].as_str().expect("native ID");
                if originals.contains(id) {
                    assert_eq!(id, native);
                } else if let Some(previous) = pairs.get(id) {
                    assert_eq!(previous, native);
                } else {
                    assert!(!originals.contains(native));
                    assert!(!pairs.values().any(|value| value == native));
                    pairs.insert(id.to_owned(), native.to_owned());
                }
            }
        } else {
            assert_eq!(value, &b[key], "non-ID field {key}");
        }
    }
}
fn assert_model(
    state: &EditorState,
    expected: &Value,
    originals: &BTreeSet<String>,
    pairs: &mut BTreeMap<String, String>,
) -> Result<(), Error> {
    let actual = Value::Object(state.view().export_node(NodeKey::ROOT)?);
    let mut a = BTreeSet::new();
    let mut b = BTreeSet::new();
    node_ids(&expected["json"]["root"], &mut a);
    node_ids(&actual, &mut b);
    compare_node(&expected["json"]["root"], &actual, originals, pairs);
    assert_eq!(selection(state)?, expected["selection"]);
    Ok(())
}
fn editor(
    source: &Value,
    rng_calls: Arc<AtomicUsize>,
    clock_calls: Arc<AtomicUsize>,
) -> Result<Editor, Error> {
    let await_id = source["pending"]["awaits"][0]["json"]["awaitId"]
        .as_str()
        .expect("Source Await ID");
    let entropy = await_id
        .bytes()
        .rev()
        .map(|byte| {
            u8::try_from(
                crate::node_ids::NANOID_ALPHABET
                    .iter()
                    .position(|value| *value == byte)
                    .expect("Source alphabet"),
            )
            .expect("alphabet index")
        })
        .collect::<Vec<_>>();
    let time = source["mentionConstructed"][0]["createdAt"]
        .as_u64()
        .expect("Source constructor time");
    let peer = source["pending"]["awaits"][0]["json"]["$"]["peerId"]
        .as_str()
        .expect("Source peer")
        .to_owned();
    let builder = register(crate::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    ))
    .extension_state(NodeClock(Arc::new(move || {
        clock_calls.fetch_add(1, Ordering::Relaxed);
        time
    })))
    .extension_state(NodeRandom(Arc::new(move |length| {
        assert_eq!(length, 21);
        rng_calls.fetch_add(1, Ordering::Relaxed);
        entropy.clone()
    })));
    let builder = PeerIdPlugin::register(
        builder,
        &[InlineSearchNode::TYPE, CommentNode::TYPE, AwaitNode::TYPE],
        PeerIdState {
            peer_id: Some(peer),
        },
    );
    let builder = NodeIdPlugin::register(
        builder,
        &[
            "root",
            "paragraph",
            "text",
            "await",
            "document-mention",
            "document-card",
            "list",
            "listitem",
            "table",
            "tablerow",
            "tablecell",
        ],
        Some(8),
        [4; 32],
    );
    Ok(builder
        .initial_state(serde_json::from_value(
            source["initialized"]["json"].clone(),
        )?)
        .build()
        .expect("Source-bound editor"))
}
fn input(state: &EditorState, name: &str, value: Value) -> Result<lexical_model::Input, Error> {
    let command =
        surface::decode_command(name, &value.to_string(), state.max_key().generation(), None)?
            .ok_or(Error::Invariant("Database command absent"))?;
    Ok(lexical_model::Input::Command {
        command,
        selection: ViewSelection::KeepModel,
    })
}

#[test]
fn actual_source_full_models_ids_and_carets_match_through_keyed_database_completion()
-> Result<(), Error> {
    let oracle: Value = serde_json::from_str(ORACLE)?;
    for label in [
        "middle",
        "start",
        "end",
        "trailing-sibling",
        "bullet-list",
        "table-cell-shadow",
        "selection-null",
        "selection-expanded",
        "unfocused-completion",
    ] {
        let source = &oracle["cases"][label];
        let rng_calls = Arc::new(AtomicUsize::new(0));
        let clock_calls = Arc::new(AtomicUsize::new(0));
        let mut editor = editor(source, rng_calls.clone(), clock_calls.clone())?;
        select(&mut editor, &source["before"]["selection"])?;
        let mut originals = BTreeSet::new();
        node_ids(&source["initialized"]["json"]["root"], &mut originals);
        let mut pairs = BTreeMap::new();
        assert_model(editor.state(), &source["before"], &originals, &mut pairs)?;
        let mut core = EditorCore::new(
            editor,
            CoreConfig {
                history: None,
                editable: true,
                diff: DiffOptions::default(),
                track_text_content: false,
            },
        );
        let start = input(core.state(), START.name(), json!({}))?;
        let mut capture = DatabaseCommitCapture::new(&start);
        let mut main = MainCommitOutcome::NotPublished;
        core.apply_with_main_commit_observation(
            start,
            HistoryTime(1),
            MainCommitObservation::with_receipts(&mut main, &mut capture),
        )
        .map_err(|error| error.error)?;
        let result = capture.into_result().expect("own main start result");
        assert_eq!(
            main,
            MainCommitOutcome::Published {
                commit_id: result.commit_id,
                handled: Handled::Yes
            }
        );
        let DatabaseCommandResult::Started { key, await_id } = result.result else {
            panic!("missing actual inserted key");
        };
        assert_eq!(
            await_id,
            source["pending"]["awaits"][0]["json"]["awaitId"]
                .as_str()
                .expect("Source Await ID")
        );
        assert_eq!(rng_calls.load(Ordering::Relaxed), 1);
        assert_eq!(clock_calls.load(Ordering::Relaxed), 0);
        if label == "unfocused-completion" {
            // Same actual Source current-caret change while its create was pending.
            let point = point(
                core.state().view(),
                &source["pending"]["selection"]["anchor"],
            )?;
            core.apply(
                lexical_model::Input::SelectionFromView {
                    selection: ViewSelection::Range {
                        anchor: point,
                        focus: point,
                        resolution_dirty: false,
                    },
                    change: None,
                },
                HistoryTime(2),
            )
            .map_err(|error| error.error)?;
        }
        assert_model(core.state(), &source["pending"], &originals, &mut pairs)?;
        let mut payload = json!({"key":key.index(),"documentId":"source-model-database"});
        if label != "selection-null" && label != "selection-expanded" {
            payload["mentionUuid"] = json!("source-model-mention");
        }
        let complete = input(core.state(), COMPLETE.name(), payload)?;
        let mut capture = DatabaseCommitCapture::new(&complete);
        core.apply_with_main_commit_observation(
            complete,
            HistoryTime(3),
            MainCommitObservation::with_receipts(&mut main, &mut capture),
        )
        .map_err(|error| error.error)?;
        let result = capture.into_result().expect("own completion result");
        assert_eq!(result.result, DatabaseCommandResult::Inserted);
        assert_eq!(
            main,
            MainCommitOutcome::Published {
                commit_id: result.commit_id,
                handled: Handled::Yes
            }
        );
        assert_eq!(clock_calls.load(Ordering::Relaxed), 1);
        assert_eq!(rng_calls.load(Ordering::Relaxed), 1);
        assert_model(core.state(), &source["after"], &originals, &mut pairs)?;
    }
    Ok(())
}

#[test]
fn all_business_payloads_are_closed_and_uuid_null_is_not_absence() {
    for name in [
        START.name(),
        COMPLETE.name(),
        REMOVE_AWAIT.name(),
        REMOVE_ANY.name(),
    ] {
        for bad in ["null", "[]", "3", r#"{"unexpected":true}"#] {
            assert!(decode(name, bad, 0).is_err(), "{name}: {bad}");
        }
    }
    assert!(
        decode(START.name(), "{}", 0)
            .expect("closed start")
            .is_some()
    );
    assert!(
        decode(
            COMPLETE.name(),
            r#"{"key":1,"documentId":"synthetic","mentionUuid":null}"#,
            0
        )
        .is_err()
    );
    assert!(
        decode(COMPLETE.name(), r#"{"key":1,"documentId":"synthetic"}"#, 0)
            .expect("absent UUID")
            .is_some()
    );
}

#[test]
fn zero_dirty_not_await_and_absent_are_published_without_constructors_or_effects()
-> Result<(), Error> {
    let oracle: Value = serde_json::from_str(ORACLE)?;
    let source = &oracle["cases"]["end"];
    for name in [COMPLETE.name(), REMOVE_AWAIT.name(), REMOVE_ANY.name()] {
        let rng = Arc::new(AtomicUsize::new(0));
        let clock = Arc::new(AtomicUsize::new(0));
        let mut editor = editor(source, rng.clone(), clock.clone())?;
        select(&mut editor, &source["before"]["selection"])?;
        let before = Value::Object(editor.state().view().export_node(NodeKey::ROOT)?);
        let mut core = EditorCore::new(
            editor,
            CoreConfig {
                history: Some(HistoryConfig::default()),
                editable: true,
                diff: DiffOptions::default(),
                track_text_content: false,
            },
        );
        let _ = core.take_initial_output();
        let payload = if name == COMPLETE.name() {
            json!({"key":u32::MAX,"documentId":"synthetic"})
        } else {
            json!({"key":u32::MAX})
        };
        let command = input(core.state(), name, payload)?;
        let mut capture = DatabaseCommitCapture::new(&command);
        let mut main = MainCommitOutcome::NotPublished;
        let output = core
            .apply_with_main_commit_observation(
                command,
                HistoryTime(1),
                MainCommitObservation::with_receipts(&mut main, &mut capture),
            )
            .map_err(|error| error.error)?;
        let result = capture.into_result().expect("zero-dirty own receipt");
        let expected = if name == COMPLETE.name() {
            DatabaseCommandResult::NotAwait
        } else {
            DatabaseCommandResult::Absent
        };
        assert_eq!(result.result, expected);
        assert_eq!(
            main,
            MainCommitOutcome::Published {
                commit_id: result.commit_id,
                handled: Handled::Yes
            }
        );
        assert!(output.commits.is_empty());
        assert!(output.diff.ops.is_empty());
        assert!(output.effects.is_empty());
        assert_eq!(
            Value::Object(core.state().view().export_node(NodeKey::ROOT)?),
            before
        );
        assert_eq!(rng.load(Ordering::Relaxed), 0);
        assert_eq!(clock.load(Ordering::Relaxed), 0);
        assert_eq!(core.history().expect("history").undo_depth(), 0);
    }
    Ok(())
}

struct Intercept(u8);
impl Plugin for Intercept {
    fn name(&self) -> &'static str {
        "database-receipt-adversary"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[CommandRegistration {
            command: CommandKind::Extension(&START),
            priority: CommandPriority::High,
            placement: Placement::Before,
        }];
        COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        if self.0 == 5 {
            if tx
                .view()
                .descendants(NodeKey::ROOT)
                .any(|(key, _)| tx.get::<AwaitNode>(key).is_some())
            {
                return Err(Error::Invariant("second start attempt fails"));
            }
            return Ok(Handled::No);
        }
        if self.0 == 0 {
            return Ok(Handled::Yes);
        }
        let pending = create_await_node(tx, None, Some("Creating database…".into()), true)?;
        tx.insert_nodes_at_selection(&[pending.key()])?;
        let await_id = tx
            .get_or_err::<AwaitNode>(pending)?
            .await_id
            .as_deref()
            .expect("actual id")
            .to_owned();
        let receipt = Started {
            key: pending.key(),
            await_id: if self.0 == 3 {
                "wrong-id".into()
            } else {
                await_id
            },
        };
        tx.emit_receipt(&STARTED, receipt.clone());
        if self.0 == 1 {
            tx.emit_receipt(&STARTED, receipt);
        }
        if self.0 == 2 {
            let other = create_await_node(tx, None, Some("unrelated".into()), true)?;
            let parent = tx.parent_or_err(pending)?;
            tx.append(parent, &[other.key()])?;
        }
        if self.0 == 4 {
            return Err(Error::Invariant("rollback after receipt"));
        }
        Ok(Handled::Yes)
    }
}
#[test]
fn consumed_duplicate_mismatched_multiple_await_and_rollback_do_not_invent_authority()
-> Result<(), Error> {
    for mode in 0..5 {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .extension_state(NodeRandom(Arc::new(|length| vec![0; length])))
                .plugin(Intercept(mode))
                .build()
                .expect("test surface");
        editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_start(p)
        })?;
        let mut core = EditorCore::new(
            editor,
            CoreConfig {
                history: None,
                editable: true,
                diff: DiffOptions::default(),
                track_text_content: false,
            },
        );
        let command = input(core.state(), START.name(), json!({}))?;
        let mut capture = DatabaseCommitCapture::new(&command);
        let mut main = MainCommitOutcome::NotPublished;
        let result = core.apply_with_main_commit_observation(
            command,
            HistoryTime(1),
            MainCommitObservation::with_receipts(&mut main, &mut capture),
        );
        if mode == 4 {
            assert!(result.is_err());
            assert_eq!(main, MainCommitOutcome::NotPublished);
            assert!(capture.into_result().is_none());
            continue;
        }
        result.map_err(|error| error.error)?;
        let result = capture.into_result().expect("actual main");
        let expected = match mode {
            0 => DatabaseCommandResult::None,
            1 => DatabaseCommandResult::Invalid(DatabaseCaptureFailure::ReceiptMultiplicity),
            2 => DatabaseCommandResult::Invalid(DatabaseCaptureFailure::MutationMismatch),
            3 => DatabaseCommandResult::Invalid(DatabaseCaptureFailure::AwaitIdentity),
            _ => unreachable!(),
        };
        assert_eq!(result.result, expected);
        assert_eq!(
            main,
            MainCommitOutcome::Published {
                commit_id: result.commit_id,
                handled: Handled::Yes
            }
        );
    }
    Ok(())
}

#[derive(Clone)]
struct FailCompletion(Arc<std::sync::atomic::AtomicBool>);
fn fail_after_conversion(tx: &mut Transaction<'_>, _: Id<Paragraph>) -> Result<(), Error> {
    if tx.extension::<FailCompletion>()?.0.load(Ordering::Relaxed)
        && tx
            .view()
            .descendants(NodeKey::ROOT)
            .any(|(key, _)| tx.get::<DocumentCardNode>(key).is_some())
    {
        return Err(Error::Invariant("injected after card before publication"));
    }
    Ok(())
}
#[test]
fn ruled_post_insert_fault_is_atomic_and_allows_admitted_await_cleanup() -> Result<(), Error> {
    let oracle: Value = serde_json::from_str(ORACLE)?;
    let source = &oracle["cases"]["trailing"];
    let final_snapshot = source["trace"]
        .as_array()
        .expect("Source trace")
        .iter()
        .find(|x| x["event"] == "after-controlled-model-fault")
        .expect("Source final");
    assert_eq!(
        final_snapshot["data"]["awaits"]
            .as_array()
            .expect("Source Await")
            .len(),
        1
    );
    assert_eq!(
        source["trace"]
            .as_array()
            .expect("trace")
            .iter()
            .filter(|x| x["event"] == "untrack")
            .count(),
        0
    );
    let flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .extension_state(NodeRandom(Arc::new(|length| vec![0; length])))
            .extension_state(NodeClock(Arc::new(|| 1234)))
            .extension_state(FailCompletion(flag.clone()))
            .transform::<Paragraph>(fail_after_conversion)
            .build()
            .expect("native fault surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("Before. After.")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(text)
    })?;
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let start = input(core.state(), START.name(), json!({}))?;
    let mut capture = DatabaseCommitCapture::new(&start);
    let mut main = MainCommitOutcome::NotPublished;
    core.apply_with_main_commit_observation(
        start,
        HistoryTime(1),
        MainCommitObservation::with_receipts(&mut main, &mut capture),
    )
    .map_err(|error| error.error)?;
    let DatabaseCommandResult::Started { key, .. } = capture.into_result().expect("start").result
    else {
        panic!("no key")
    };
    let before = Value::Object(core.state().view().export_node(NodeKey::ROOT)?);
    flag.store(true, Ordering::Relaxed);
    let complete = input(
        core.state(),
        COMPLETE.name(),
        json!({"key":key.index(),"documentId":"source-model-database","mentionUuid":"source-model-mention"}),
    )?;
    let mut capture = DatabaseCommitCapture::new(&complete);
    assert!(
        core.apply_with_main_commit_observation(
            complete,
            HistoryTime(2),
            MainCommitObservation::with_receipts(&mut main, &mut capture)
        )
        .is_err()
    );
    assert_eq!(main, MainCommitOutcome::NotPublished);
    assert!(capture.into_result().is_none());
    assert_eq!(
        Value::Object(core.state().view().export_node(NodeKey::ROOT)?),
        before
    );
    flag.store(false, Ordering::Relaxed);
    let remove = input(
        core.state(),
        REMOVE_AWAIT.name(),
        json!({"key":key.index()}),
    )?;
    let mut capture = DatabaseCommitCapture::new(&remove);
    core.apply_with_main_commit_observation(
        remove,
        HistoryTime(3),
        MainCommitObservation::with_receipts(&mut main, &mut capture),
    )
    .map_err(|error| error.error)?;
    assert_eq!(
        capture.into_result().expect("removal").result,
        DatabaseCommandResult::Removed
    );
    assert!(core.state().view().get::<AwaitNode>(key).is_none());
    // C-DATABASE-POST-INSERT-FAULT-ORPHAN-01. Rust proves atomic model/removal;
    // actual controller untrack==1 still requires its matched Port/service-boundary control.
    Ok(())
}

#[test]
fn id_comparison_rejects_swapped_duplicate_missing_and_wrong_split_half() {
    let source = json!({"type":"root","$":{"id":"root0000"},"children":[{"type":"paragraph","$":{"id":"para0000"},"children":[{"type":"text","text":"before","$":{"id":"left0000"}},{"type":"text","text":"after","$":{"id":"fresh000"}}]}]});
    let originals = BTreeSet::from(["root0000".into(), "para0000".into(), "left0000".into()]);
    for mode in 0..5 {
        let mut native = source.clone();
        match mode {
            0 => {
                native["children"][0]["children"][0]["$"]["id"] = json!("fresh000");
                native["children"][0]["children"][1]["$"]["id"] = json!("left0000");
            }
            1 => native["children"][0]["children"][1]["$"]["id"] = json!("left0000"),
            2 => {
                native["children"][0]["children"][0]["$"]
                    .as_object_mut()
                    .expect("state")
                    .remove("id");
            }
            3 => native["children"][0]["children"][1]["text"] = json!("changed"),
            _ => native["children"][0]["children"][0]["$"]["id"] = json!("other000"),
        }
        assert!(
            std::panic::catch_unwind(|| {
                let mut ids = BTreeSet::new();
                node_ids(&native, &mut ids);
                compare_node(&source, &native, &originals, &mut BTreeMap::new());
            })
            .is_err()
        );
    }
    let before = source.clone();
    let mut pairs = BTreeMap::new();
    compare_node(&source, &source, &originals, &mut pairs);
    compare_node(&source, &source, &originals, &mut pairs);
    assert_eq!(source, before);
}

#[test]
fn target_query_is_pure_closed_and_loud_on_stale_generation() -> Result<(), Error> {
    let oracle: Value = serde_json::from_str(ORACLE)?;
    let rng = Arc::new(AtomicUsize::new(0));
    let clock = Arc::new(AtomicUsize::new(0));
    let editor = editor(&oracle["cases"]["end"], rng.clone(), clock.clone())?;
    let state = editor.state();
    let generation = state.max_key().generation();
    let before = state.to_json()?;
    assert_eq!(
        query(
            "group-b.database-target",
            &json!({"key":u32::MAX}),
            generation,
            state
        )?,
        Some(json!({"present":false,"isAwait":false}))
    );
    assert!(
        query(
            "group-b.database-target",
            &json!({"key":1,"extra":true}),
            generation,
            state
        )
        .is_err()
    );
    assert!(
        query(
            "group-b.database-target",
            &json!({"key":1}),
            generation + 1,
            state
        )
        .is_err()
    );
    assert!(query("group-b.database-target", &json!([1]), generation, state).is_err());
    assert_eq!(state.to_json()?, before);
    assert_eq!(rng.load(Ordering::Relaxed), 0);
    assert_eq!(clock.load(Ordering::Relaxed), 0);
    Ok(())
}

#[test]
fn private_stale_guards_are_unhandled_with_no_constructor_or_mutation() -> Result<(), Error> {
    let oracle: Value = serde_json::from_str(ORACLE)?;
    for name in [
        START.name(),
        COMPLETE.name(),
        REMOVE_AWAIT.name(),
        REMOVE_ANY.name(),
    ] {
        let rng = Arc::new(AtomicUsize::new(0));
        let clock = Arc::new(AtomicUsize::new(0));
        let mut editor = editor(&oracle["cases"]["end"], rng.clone(), clock.clone())?;
        let before = editor.state().to_json()?;
        let payload = if name == START.name() {
            json!({})
        } else if name == COMPLETE.name() {
            json!({"key":1,"documentId":"synthetic-database"})
        } else {
            json!({"key":1})
        };
        let command = decode(
            name,
            &payload.to_string(),
            editor.state().max_key().generation() + 1,
        )?
        .expect("closed stale input");
        let (handled, commit) = editor.dispatch(&command)?;
        assert_eq!(handled, Handled::No);
        assert!(commit.is_noop());
        assert_eq!(editor.state().to_json()?, before);
        assert_eq!(rng.load(Ordering::Relaxed), 0);
        assert_eq!(clock.load(Ordering::Relaxed), 0);
    }
    // The external WASM generation error remains separate and unchanged.
    Ok(())
}

#[test]
fn await_only_cleanup_protects_other_nodes_but_any_cleanup_removes_them() -> Result<(), Error> {
    let oracle: Value = serde_json::from_str(ORACLE)?;
    let editor = editor(
        &oracle["cases"]["end"],
        Arc::new(AtomicUsize::new(0)),
        Arc::new(AtomicUsize::new(0)),
    )?;
    let text = editor
        .state()
        .view()
        .all_text_nodes(NodeKey::ROOT)
        .next()
        .expect("text");
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    for (name, expected) in [
        (REMOVE_AWAIT.name(), DatabaseCommandResult::Absent),
        (REMOVE_ANY.name(), DatabaseCommandResult::Removed),
    ] {
        let command = input(core.state(), name, json!({"key":text.index()}))?;
        let mut capture = DatabaseCommitCapture::new(&command);
        let mut main = MainCommitOutcome::NotPublished;
        core.apply_with_main_commit_observation(
            command,
            HistoryTime(1),
            MainCommitObservation::with_receipts(&mut main, &mut capture),
        )
        .map_err(|error| error.error)?;
        assert_eq!(
            capture.into_result().expect("cleanup fact").result,
            expected
        );
        assert_eq!(
            core.state().view().node(text).is_some(),
            name == REMOVE_AWAIT.name()
        );
    }
    Ok(())
}

#[test]
fn empty_root_fallback_returns_actual_new_key_instead_of_predicting_its_generation()
-> Result<(), Error> {
    let editor = register(crate::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    ))
    .extension_state(NodeRandom(Arc::new(|length| vec![0; length])))
    .build()
    .expect("empty surface");
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let command = input(core.state(), START.name(), json!({}))?;
    let mut capture = DatabaseCommitCapture::new(&command);
    let mut main = MainCommitOutcome::NotPublished;
    core.apply_with_main_commit_observation(
        command,
        HistoryTime(1),
        MainCommitObservation::with_receipts(&mut main, &mut capture),
    )
    .map_err(|error| error.error)?;
    let result = capture.into_result().expect("own empty-root result");
    let DatabaseCommandResult::Started { key, await_id } = result.result else {
        panic!("actual key");
    };
    assert_eq!(
        core.state()
            .view()
            .get_or_err::<AwaitNode>(key)?
            .await_id
            .as_deref(),
        Some(await_id.as_str())
    );
    assert_eq!(
        main,
        MainCommitOutcome::Published {
            commit_id: result.commit_id,
            handled: Handled::Yes
        }
    );
    Ok(())
}

// Native HARDENING, not Source parity: Source JSON.parse is last-wins. The
// closed raw command contract additionally rejects duplicate known fields.
#[test]
fn hardening_rejects_duplicate_known_command_fields_before_any_dispatch() {
    for (name, payload) in [
        (START.name(), r#"{"unexpected":1,"unexpected":2}"#),
        (
            COMPLETE.name(),
            r#"{"key":1,"key":2,"documentId":"synthetic"}"#,
        ),
        (
            COMPLETE.name(),
            r#"{"key":1,"documentId":"first","documentId":"second"}"#,
        ),
        (
            COMPLETE.name(),
            r#"{"key":1,"documentId":"synthetic","mentionUuid":"first","mentionUuid":"second"}"#,
        ),
        (REMOVE_AWAIT.name(), r#"{"key":1,"key":2}"#),
        (REMOVE_ANY.name(), r#"{"key":1,"key":2}"#),
    ] {
        assert!(decode(name, payload, 0).is_err(), "{name}: {payload}");
    }
    // Start has no known fields: duplicate unknown fields remain forbidden.
    // Target-query data is already Value at this API; upstream duplicate-key
    // hardening belongs to the raw query boundary, C-DECODER-DUPLICATE-KEYS-01.
}

#[test]
fn reused_capture_clears_prior_published_result_before_a_failed_attempt() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .extension_state(NodeRandom(Arc::new(|length| vec![0; length])))
            .plugin(Intercept(5))
            .build()
            .expect("capture lifetime fixture");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_start(paragraph)
    })?;
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let first = input(core.state(), START.name(), json!({}))?;
    let mut capture = DatabaseCommitCapture::new(&first);
    let mut main = MainCommitOutcome::NotPublished;
    core.apply_with_main_commit_observation(
        first,
        HistoryTime(1),
        MainCommitObservation::with_receipts(&mut main, &mut capture),
    )
    .map_err(|error| error.error)?;
    let prior = capture.result.as_ref().expect("published start");
    assert!(matches!(
        prior.result,
        DatabaseCommandResult::Started { .. }
    ));
    assert_eq!(
        main,
        MainCommitOutcome::Published {
            commit_id: prior.commit_id,
            handled: Handled::Yes
        }
    );
    let before = core.state().to_json()?;
    let second = input(core.state(), START.name(), json!({}))?;
    let result = core.apply_with_main_commit_observation(
        second,
        HistoryTime(2),
        MainCommitObservation::with_receipts(&mut main, &mut capture),
    );
    assert!(result.is_err());
    assert_eq!(main, MainCommitOutcome::NotPublished);
    assert!(
        capture.into_result().is_none(),
        "an earlier published key must not survive failure"
    );
    assert_eq!(core.state().to_json()?, before);
    Ok(())
}
