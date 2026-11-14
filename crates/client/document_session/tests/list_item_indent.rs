#![cfg(feature = "application")]

use document_session::register_editor_commands;
use lexical_loro::{FIXUP_ORIGIN, LoroProjection, fork_doc, new_doc};
use lexical_model::*;
use lexical_rich_nodes::list::ListItemNode;
use macro_document_model::{EditorType, surface, sync::MACRO_SYNC_POLICY};
use serde_json::{Value, json};
use std::{collections::BTreeMap, error::Error as StdError};

#[path = "list_item_indent/fixtures.rs"]
mod fixtures;

type TestResult<T = ()> = std::result::Result<T, Box<dyn StdError>>;

fn application_builder() -> EditorBuilder {
    register_editor_commands(surface::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    ))
}

fn application_diff_options() -> DiffOptions {
    // Obtain the session's real selector (including selected_state), never duplicate it here.
    document_session::application_editor_config(
        document_session::EditorConfig::default(),
        std::sync::Arc::new(std::sync::atomic::AtomicI64::new(0)),
        EditorType::MarkdownSync,
    )
    .diff
}

fn cold_diff(state: &EditorState) -> TestResult<Diff> {
    // EXACT EditorSurface::view_diff recipe, document_session/src/editor.rs:385-391.
    // This creates a complete VIEW patch only; it is not a publication/commit receipt.
    let mut empty = application_builder().build()?;
    let (_, mut commit) = empty.update(|_| Ok(()))?;
    commit.next = state.clone();
    commit.full_reconcile = true;
    Ok(commit.diff(&application_diff_options())?)
}

fn core(initial: Option<SerializedEditorState>) -> (EditorCore, Option<Output>) {
    let builder = application_builder();
    // Same real builder entry used by DocumentSession editor.open, never CoreSetState.
    let builder = if let Some(state) = initial {
        builder.initial_state(state)
    } else {
        builder
    };
    let editor = builder.build().expect("actual application editor");
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: application_diff_options(),
            track_text_content: false,
        },
    );
    let initial_output = core.take_initial_output();
    (core, initial_output)
}

fn projection_fields(diff: &Diff, projected: &mut BTreeMap<NodeKey, u32>) {
    for operation in &diff.ops {
        match operation {
            DiffOp::CreateElement { key, base, .. } => {
                projected.insert(*key, base.indent);
            }
            DiffOp::ElementProps { key, props } => {
                projected.insert(*key, props.indent);
            }
            DiffOp::Remove { key, .. } => {
                projected.remove(key);
            }
            _ => {}
        }
    }
}

fn facts(state: &EditorState, projected: &BTreeMap<NodeKey, u32>) -> TestResult<Vec<Value>> {
    let view = state.view();
    view.descendants(NodeKey::ROOT)
        .filter_map(|(key, _)| view.element(key).map(|_| key))
        .map(|key| {
            let data = view.element_data(key)?;
            // Node-level parity includes the complete subtree, never the shallow export_json.
            let exported = view.export_node(key)?;
            Ok(json!({
                "key": key.index(), "generation": key.generation(),
                "type": view.type_name(key)?, "text": view.text_content(key),
                "raw": data.indent, "virtual": view.indent(key),
                "projected": projected.get(&key), "exported": exported,
                "listItem": view.is::<ListItemNode>(key), "style": data.style.as_ref(),
            }))
        })
        .collect()
}

fn source_node<'a>(node: &'a Value, id: &str) -> Option<&'a Value> {
    if node
        .get("$")
        .and_then(|state| state.get("id"))
        .and_then(Value::as_str)
        == Some(id)
    {
        return Some(node);
    }
    node.get("children")
        .and_then(Value::as_array)?
        .iter()
        .find_map(|child| source_node(child, id))
}

fn assert_node_exports(source: &Value, rows: &[Value]) -> TestResult {
    for row in rows {
        let id = row["exported"]["$"]["id"]
            .as_str()
            .ok_or("actual native node ID absent")?;
        let expected =
            source_node(&source["root"], id).ok_or("Source node with SAME durable ID absent")?;
        assert_eq!(
            &row["exported"], expected,
            "exact Source subtree, original IDs preserved"
        );
    }
    Ok(())
}

#[test]
fn source_generated_stored_load_keeps_raw_and_projected_indent_separate_from_list_depth()
-> TestResult {
    let mut bad = Vec::new();
    for fixture in fixtures::STORED {
        let source: Value = serde_json::from_slice(fixture.state)?;
        let state: SerializedEditorState = serde_json::from_slice(fixture.state)?;
        let (receiver, hook_initial) = core(Some(state));
        // Build-time hook output is OPTIONAL, not the complete Initialize projection.
        drop(hook_initial);
        let mut projected = BTreeMap::new();
        projection_fields(&cold_diff(receiver.state())?, &mut projected);
        let rows = facts(receiver.state(), &projected)?;
        assert_node_exports(&source, &rows)?;
        assert!(
            rows.iter()
                .any(|row| row["listItem"] == true && row["virtual"] == 1),
            "Source input must actually contain a nested item"
        );
        for row in rows.iter().filter(|row| row["listItem"] == true) {
            assert_eq!(row["raw"], 0, "stored import raw field: {row}");
            if row["projected"] != row["raw"] {
                bad.push(json!({"kind": fixture.name, "row": row}));
            }
            assert_eq!(row["exported"]["indent"], row["virtual"]);
        }
    }
    assert!(
        bad.is_empty(),
        "DOM projection must use Source raw indent, not list depth: {bad:#?}"
    );
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReceiverStart {
    Empty,
    StoredNested,
}

fn remote_controls(diagnostic: bool, start: ReceiverStart) -> TestResult {
    let mut bad_raw = Vec::new();
    let mut bad_projection = Vec::new();
    for fixture in fixtures::REMOTE {
        assert_eq!(fixture.phases[0].name, "initial-nested");
        // Separate causal arm: reopen from actual Source nested JSON and the corresponding
        // original Loro packets. No raw-field writes or baseline normalization.
        let initial_bytes = if start == ReceiverStart::StoredNested {
            fixture.phases[0].expected
        } else {
            fixture.initial
        };
        let source_rows: Vec<Value> = fixture
            .source_rows
            .lines()
            .map(serde_json::from_str)
            .collect::<Result<_, _>>()?;
        let seed = new_doc(101)?;
        seed.import(fixture.snapshot)?;
        if start == ReceiverStart::StoredNested {
            for batch in fixture.phases[0].batches {
                for packet in *batch {
                    seed.import(packet)?;
                }
            }
        }
        let doc = fork_doc(&seed, 102)?;
        // EXACT production load sequence: reconstruct_initial_state -> builder.initial_state
        // -> complete cold view diff -> strict attach. No metadata filter, SetState or pipeline.
        let initial = lexical_loro::reconstruct_initial_state(&doc, &MACRO_SYNC_POLICY)?;
        assert!(
            !initial.has_transparent_wrappers,
            "Source list fixture has no draft wrappers"
        );
        let (mut receiver, hook_initial) = core(Some(initial.state));
        drop(hook_initial);
        let mut projected = BTreeMap::new();
        projection_fields(&cold_diff(receiver.state())?, &mut projected);
        if start == ReceiverStart::StoredNested {
            let rows = facts(receiver.state(), &projected)?;
            assert_node_exports(&serde_json::from_slice(initial_bytes)?, &rows)?;
            assert!(
                rows.iter()
                    .any(|row| row["listItem"] == true && row["raw"] == 0 && row["virtual"] == 1),
                "stored Source nested precondition must have raw0/getter1 BEFORE remote Update"
            );
        }
        let mut projection = LoroProjection::attach(&doc, receiver.state(), &MACRO_SYNC_POLICY)?;
        for (index, phase) in fixture.phases.iter().enumerate() {
            if start == ReceiverStart::StoredNested && index == 0 {
                continue;
            }
            let observed_source = source_rows
                .iter()
                .find(|row| row["phase"] == phase.name)
                .ok_or("actual Source phase absent")?;
            let source: Value = serde_json::from_slice(phase.expected)?;
            assert_eq!(observed_source["sourceJSON"], source);
            assert!(
                !phase.batches.is_empty(),
                "Source phase must produce actual wire updates"
            );
            let mut ordered_phase = Vec::new();
            for (batch_index, batch) in phase.batches.iter().enumerate() {
                for (packet, bytes) in batch.iter().enumerate() {
                    let before = facts(receiver.state(), &projected)?;
                    let (_, remote) = projection.remote(&doc, receiver.state(), bytes)?;
                    let ordered = remote.changes.clone();
                    ordered_phase.extend(ordered.clone());
                    let applied = receiver.apply(
                        Input::ApplyRemote {
                            changes: ordered.clone(),
                            options: UpdateOptions {
                                skip_transforms: false,
                                tags: TagSet::from_tags([
                                    UpdateTag::Collaboration,
                                    UpdateTag::Custom("from-loro".into()),
                                ]),
                            },
                        },
                        HistoryTime(index as u64 + 1),
                    )?;
                    projection_fields(&applied.diff, &mut projected);
                    let after_apply = facts(receiver.state(), &projected)?;
                    let created: Vec<_> = applied
                        .effects
                        .iter()
                        .flat_map(|effect| match effect {
                            Effect::RemoteNodesCreated(pairs) => pairs.clone(),
                            _ => Vec::new(),
                        })
                        .collect();
                    projection.bind_created(remote, &created)?;
                    projection.local_commit(
                        &doc,
                        &applied.commits,
                        FIXUP_ORIGIN,
                        index as i64 + 1,
                    )?;
                    if diagnostic {
                        // Explicit ignored diagnostic only: stdout is captured by the caller, no env/file I/O.
                        println!(
                            "{}",
                            json!({"receiverStart": format!("{start:?}"), "kind": fixture.name, "phase": phase.name,
                            "batch": batch_index, "packet": packet, "before": before,
                            "orderedRemoteChanges": format!("{ordered:#?}"), "afterApply": after_apply,
                            "afterFixup": facts(receiver.state(), &projected)?})
                        );
                    }
                    assert!(
                        projection
                            .remote(&doc, receiver.state(), bytes)?
                            .1
                            .changes
                            .is_empty(),
                        "actual duplicate redelivery"
                    );
                }
            }
            let rows = facts(receiver.state(), &projected)?;
            assert_node_exports(&source, &rows)?;
            if phase.name.starts_with("paragraph") || phase.name.starts_with("heading") {
                let expected = phase
                    .name
                    .chars()
                    .last()
                    .and_then(|n| n.to_digit(10))
                    .expect("literal phase indent");
                let block = rows.first().expect("real remote generic block");
                assert_eq!(
                    block["raw"], expected,
                    "generic remote raw stays functional"
                );
                assert_eq!(block["projected"], expected);
            } else {
                let observed = observed_source["source"]
                    .as_array()
                    .ok_or("actual Source raw rows absent")?;
                assert!(!observed.is_empty());
                // This raw-0/getter-depth fact is OBSERVED in the two-peer Source receipt, not inferred.
                for row in observed {
                    assert_eq!(row["raw"], 0);
                    assert_eq!(row["exported"]["indent"], row["virtual"]);
                }
                let list_rows: Vec<_> = rows.iter().filter(|row| row["listItem"] == true).collect();
                assert_eq!(list_rows.len(), observed.len());
                for row in list_rows {
                    let id = row["exported"]["$"]["id"]
                        .as_str()
                        .ok_or("actual list ID absent")?;
                    let expected = observed
                        .iter()
                        .find(|value| value["exported"]["$"]["id"] == id)
                        .ok_or("Source list ID absent")?;
                    assert_eq!(row["virtual"], expected["virtual"]);
                    if row["raw"] != expected["raw"] {
                        bad_raw.push(json!({"kind": fixture.name, "phase": phase.name, "row": row, "source": expected, "ordered": format!("{ordered_phase:#?}")}));
                    }
                    if row["projected"] != expected["raw"] {
                        bad_projection
                            .push(json!({"kind": fixture.name, "phase": phase.name, "row": row}));
                    }
                }
            }
        }
    }
    assert!(
        bad_raw.is_empty(),
        "remote must not store exported depth in raw indent: {bad_raw:#?}"
    );
    assert!(
        bad_projection.is_empty(),
        "remote DOM projection must use raw indent: {bad_projection:#?}"
    );
    Ok(())
}

#[test]
fn source_two_peer_remote_create_and_updates_preserve_raw_and_virtual_indent() -> TestResult {
    remote_controls(false, ReceiverStart::Empty)
}

#[test]
#[ignore = "explicit per-packet raw/virtual/projected and ordered remote diagnostic; no CI file I/O"]
fn diagnose_source_two_peer_remote_indent_phases() -> TestResult {
    remote_controls(true, ReceiverStart::Empty)
}

#[test]
fn source_nested_reopen_then_remote_updates_do_not_copy_virtual_depth_into_raw_indent() -> TestResult
{
    remote_controls(false, ReceiverStart::StoredNested)
}

#[test]
#[ignore = "explicit cold-nested raw0/getter1 then remote Update diagnostic; no CI file I/O"]
fn diagnose_source_nested_reopen_then_remote_indent_updates() -> TestResult {
    remote_controls(true, ReceiverStart::StoredNested)
}

#[test]
fn actual_list_commands_and_generic_raw_element_updates_preserve_projection() -> TestResult {
    // Local replace/pipeline command setup, NOT an app load. Real app-load controls above
    // use builder.initial_state; this case intentionally tests commands after a local replace.
    let state: SerializedEditorState = serde_json::from_slice(fixtures::STORED[0].state)?;
    let (mut receiver, empty_initial) = core(None);
    drop(empty_initial);
    let initial = receiver.apply(
        Input::SetState {
            state,
            tags: TagSet::default(),
        },
        HistoryTime(0),
    )?;
    let mut projected = BTreeMap::new();
    projection_fields(&initial.diff, &mut projected);
    let text = receiver
        .state()
        .view()
        .descendants(NodeKey::ROOT)
        .map(|(key, _)| key)
        .find(|key| {
            receiver
                .state()
                .view()
                .text_data(*key)
                .is_ok_and(|data| data.text.as_str() == "b")
        })
        .expect("same Source b leaf");
    let mut bad = Vec::new();
    for (index, command) in [Command::OutdentContent, Command::IndentContent]
        .into_iter()
        .enumerate()
    {
        let point = Point::text(text, Utf16Offset(1));
        let result = receiver.apply(
            Input::Command {
                command,
                selection: ViewSelection::Range {
                    anchor: point,
                    focus: point,
                    resolution_dirty: false,
                },
            },
            HistoryTime(index as u64 + 1),
        )?;
        assert_eq!(result.handled, Handled::Yes);
        projection_fields(&result.diff, &mut projected);
        for row in facts(receiver.state(), &projected)?
            .iter()
            .filter(|row| row["listItem"] == true)
        {
            assert_eq!(row["raw"], 0);
            if row["projected"] != 0 {
                bad.push(row.clone());
            }
        }
    }
    let mut editor = register_editor_commands(surface::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    ))
    .build()
    .expect("actual generic application editor");
    let (paragraph, created) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(paragraph)
    })?;
    let mut generic = BTreeMap::new();
    projection_fields(&created.diff(&application_diff_options())?, &mut generic);
    for indent in [1, 3, 0] {
        let (_, commit) = editor.update(|tx| tx.set_indent(paragraph, indent))?;
        projection_fields(&commit.diff(&application_diff_options())?, &mut generic);
        assert_eq!(
            editor.state().view().element_data(paragraph)?.indent,
            indent
        );
        assert_eq!(generic.get(&paragraph.key()), Some(&indent));
    }
    assert!(
        bad.is_empty(),
        "actual nesting commands must project raw list indent: {bad:#?}"
    );
    Ok(())
}

#[test]
fn authored_element_css_projection_matches_observed_source_create_and_reused_update() -> TestResult
{
    let observations: Vec<Value> =
        include_str!("corpus/list-item-indent/authored-style-observations.jsonl")
            .lines()
            .map(serde_json::from_str)
            .collect::<Result<_, _>>()?;
    assert_eq!(observations.len(), 4);
    let input: Value = serde_json::from_slice(fixtures::STORED[0].state)?;
    let node: SerializedNode = serde_json::from_value(input["root"]["children"][0].clone())?;
    let mut bad = Vec::new();
    for pair in observations.chunks_exact(2) {
        assert_eq!(pair[0]["name"], "authored-source-create");
        assert_eq!(pair[1]["name"], "authored-source-reused-update");
        let style = pair[0]["facts"]["style"]
            .as_str()
            .ok_or("actual Source style absent")?;
        let mut editor = register_editor_commands(surface::preset_builder_with_mode(
            EditorType::MarkdownSync,
            EditorMode::ViewAttached,
        ))
        .build()
        .expect("actual application style editor");
        let (item, created) = editor.update(|tx| {
            let list = tx.import_node(&node)?;
            tx.append(NodeKey::ROOT, &[list])?;
            let text = tx
                .view()
                .descendants(NodeKey::ROOT)
                .map(|(key, _)| key)
                .find(|key| {
                    tx.view()
                        .text_data(*key)
                        .is_ok_and(|data| data.text.as_str() == "b")
                })
                .ok_or(Error::Invariant("actual b leaf absent"))?;
            tx.parent_or_err(text)
        })?;
        let mut projected = BTreeMap::new();
        projection_fields(&created.diff(&application_diff_options())?, &mut projected);
        let mut projected_style = None;
        for (index, source) in pair.iter().enumerate() {
            let rows = source["facts"]["rows"]
                .as_array()
                .ok_or("Source style rows absent")?;
            let expected = rows
                .iter()
                .find(|row| row["leaf"] == true && row["text"] == "b")
                .ok_or("Source b style row absent")?;
            let depth = expected["virtual"].as_u64().ok_or("Source depth absent")?;
            let (_, commit) = editor.update(|tx| {
                if index == 0 {
                    tx.element(item)?.set_style(style)?;
                }
                tx.set_indent(
                    item,
                    u32::try_from(depth)
                        .map_err(|_| Error::Invariant("Source depth outside u32"))?,
                )
            })?;
            let diff = commit.diff(&application_diff_options())?;
            projection_fields(&diff, &mut projected);
            for op in &diff.ops {
                match op {
                    DiffOp::CreateElement { key, base, .. } if *key == item => {
                        projected_style = Some(base.style.clone())
                    }
                    DiffOp::ElementProps { key, props } if *key == item => {
                        projected_style = Some(props.style.clone())
                    }
                    _ => {}
                }
            }
            let data = editor.state().view().element_data(item)?;
            assert_eq!(
                data.indent,
                u32::try_from(expected["raw"].as_u64().expect("observed Source raw"))?
            );
            assert_eq!(
                data.style.as_ref(),
                expected["rawStyle"]
                    .as_str()
                    .expect("observed Source raw style")
            );
            assert_eq!(projected_style.as_deref(), expected["rawStyle"].as_str());
            if projected.get(&item).copied() != Some(data.indent) {
                bad.push(json!({"source": expected, "nativeRaw": data.indent, "nativeProjected": projected.get(&item), "style": data.style.as_ref()}));
            }
        }
    }
    assert!(
        bad.is_empty(),
        "authored CSS stays independent from DOM's raw-indent projection: {bad:#?}"
    );
    Ok(())
}
