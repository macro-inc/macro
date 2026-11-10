//! S4 §4. Generated scripts supplement the explicit upstream behavior tests.
use super::{Inline, performance::Opaque};
use crate::*;
use proptest::prelude::*;
use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;
static COUNT: StateKey<u32> = StateKey::new("count", |v| {
    v.and_then(serde_json::Value::as_u64).unwrap_or(0) as u32
});

#[derive(Clone, Debug)]
enum Tree {
    Text(String, u8, bool, u8, u8),
    Decorator,
    Break,
    Tab,
    Element(Vec<Tree>),
}

fn arb_state() -> impl Strategy<Value = Vec<Tree>> {
    let leaf = prop_oneof![
        ("[a-z😀é]{0,12}", 0u8..4, any::<bool>(), 0u8..3, 0u8..3)
            .prop_map(|(s, f, style, mode, state)| Tree::Text(s, f, style, mode, state)),
        Just(Tree::Break),
        Just(Tree::Tab),
    ];
    // Paragraph contents are inline. Block decorators belong directly under root;
    // arbitrary nested paragraphs can have no leaf-block ancestor for insertion,
    // which upstream rejects too (see the literal malformed-tree regression).
    let inline = leaf.prop_recursive(3, 48, 6, |inner| {
        prop::collection::vec(inner, 0..6).prop_map(Tree::Element)
    });
    prop::collection::vec(prop_oneof![inline, Just(Tree::Decorator)], 1..6)
}

fn arb_command() -> impl Strategy<Value = Command> {
    prop_oneof![
        "[a-z😀é]{0,8}".prop_map(Command::InsertText),
        Just(Command::InsertParagraph),
        any::<bool>().prop_map(|select_start| Command::InsertLineBreak { select_start }),
        Just(Command::InsertTab),
        Just(Command::FormatText(TextFormatType::Bold)),
        Just(Command::FormatText(TextFormatType::Italic)),
        Just(Command::DeleteCharacter {
            direction: EditDirection::Backward,
            target: ModifyTarget::NoView
        }),
        Just(Command::DeleteCharacter {
            direction: EditDirection::Forward,
            target: ModifyTarget::NoView
        }),
        Just(Command::SelectAll(None)),
        Just(Command::RemoveText),
    ]
}

fn append_tree(tx: &mut Transaction<'_>, parent: NodeKey, tree: &Tree) -> Result<(), Error> {
    let key = match tree {
        Tree::Text(text, format, styled, mode, state) => {
            let key = tx.create_text(text)?.key();
            let mut node = tx.text(key)?;
            node.set_format(TextFormat::from_bits_retain(u32::from(*format)))?;
            node.set_style(if *styled { "color:red" } else { "" })?;
            node.set_mode(match mode {
                1 => TextMode::Token,
                2 => TextMode::Segmented,
                _ => TextMode::Normal,
            })?;
            tx.set_state(key, &COUNT, u32::from(*state))?;
            key
        }
        Tree::Decorator => tx.create(Opaque {})?.key(),
        Tree::Break => tx.create(LineBreak::default())?.key(),
        Tree::Tab => tx.create(Tab::default())?.key(),
        Tree::Element(children) => {
            let key = tx.create(Inline::default())?.key();
            for child in children {
                append_tree(tx, key, child)?;
            }
            key
        }
    };
    tx.append(parent, &[key])
}

fn apply(tx: &mut Transaction<'_>, command: &Command) -> Result<(), Error> {
    // These primitives require a range, just as the host command handlers do.
    // Deleting beside a block decorator can intentionally install NodeSelection.
    // Do not call a range-only primitive with that different selection variant.
    if matches!(
        command,
        Command::InsertParagraph
            | Command::FormatText(_)
            | Command::DeleteCharacter { .. }
            | Command::RemoveText
    ) && !matches!(tx.selection(), Some(Selection::Range(_)))
    {
        return Ok(());
    }
    match command {
        Command::InsertText(text) => tx.insert_text(text),
        Command::InsertParagraph => tx.insert_paragraph().map(|_| ()),
        Command::InsertLineBreak { select_start } => tx.insert_line_break(*select_start),
        Command::InsertTab => {
            let tab = tx.create(Tab::default())?;
            tx.insert_nodes(&[tab.key()])
        }
        Command::FormatText(format) => tx.format_text(*format, None),
        Command::DeleteCharacter { direction, target } => {
            tx.delete_character(*direction, target.clone())
        }
        Command::SelectAll(_) => tx.select_all(None),
        Command::RemoveText => tx.remove_text(),
        _ => unreachable!("generator only emits modeled selection commands"),
    }
}

fn check_state(state: &EditorState) {
    let view = state.view();
    let mut visited = HashSet::new();
    let mut stack = vec![NodeKey::ROOT];
    assert_eq!(view.parent(NodeKey::ROOT), None);
    while let Some(key) = stack.pop() {
        assert!(visited.insert(key), "cycle or duplicate child {key}");
        if let Some(element) = view.element(key) {
            // Use links directly, with a bounded walk, so cycles cannot hang the checker.
            let mut children = Vec::new();
            let mut current = element.first_child();
            let mut previous = None;
            while let Some(child) = current {
                assert!(children.len() < state.node_count());
                assert_eq!(view.parent(child), Some(key));
                assert_eq!(view.prev_sibling(child), previous);
                children.push(child);
                previous = Some(child);
                current = view.next_sibling(child);
            }
            assert_eq!(element.last_child(), previous);
            assert_eq!(element.children_size() as usize, children.len());
            stack.extend(children);
        }
        if let Some(text) = view.text(key) {
            assert_eq!(
                text.text.utf16_len().0 as usize,
                text.text.as_str().encode_utf16().count()
            );
            if text.mode == TextMode::Normal && view.is::<Text>(key) {
                assert!(!text.text.as_str().is_empty());
                if let Some(next_key) = view.next_sibling(key)
                    && let Some(next) = view.text(next_key)
                {
                    assert!(
                        text.is_unmergeable()
                            || next.is_unmergeable()
                            || next.mode != text.mode
                            || next.format != text.format
                            || next.style != text.style
                            || next.detail != text.detail
                            || !NodeState::equivalent(
                                state.nodes.get(&key).expect("text").state.as_deref(),
                                state.nodes.get(&next_key).expect("next").state.as_deref()
                            )
                    );
                }
            }
        }
    }
    assert_eq!(visited, state.nodes.keys().copied().collect());
    assert_eq!(
        state.opaque_text_count,
        state
            .nodes
            .values()
            .filter(|slot| matches!(slot.base, BaseData::Decorator))
            .count()
    );
    assert_eq!(
        state.root_text_content().as_ref(),
        view.text_content(NodeKey::ROOT)
    );
    if let Some(Selection::Range(range)) = state.selection() {
        for point in [range.anchor, range.focus] {
            assert!(visited.contains(&point.key()));
            match point {
                Point::Element { key, offset } => assert!(offset.0 <= view.children_size(key)),
                Point::Text { key, offset } => {
                    let text = view.text_data(key).expect("text point").text.as_str();
                    let mut offsets = vec![0];
                    let mut sum = 0;
                    for ch in text.chars() {
                        sum += ch.len_utf16() as u32;
                        offsets.push(sum);
                    }
                    assert!(offsets.contains(&offset.0));
                }
            }
        }
    }
    if let Some(Selection::Node(nodes)) = state.selection() {
        for key in nodes.keys() {
            assert!(visited.contains(&key));
        }
    }
}

// Compare tree shape, runtime payload, serializable base fields and generated
// NodeState directly, without using the JSON exporter as the structural oracle.
// Element cached typing defaults are excluded: S1 §8.6 deliberately leaves new
// nodes unsynced, and Paragraph export substitutes its direct text child's defaults.
fn structural_tree(state: &EditorState, key: NodeKey) -> serde_json::Value {
    let view = state.view();
    let slot = state.nodes.get(&key).expect("attached node");
    let base = match &slot.base {
        BaseData::Text(t) => {
            serde_json::json!(["text", t.text.as_str(), t.format, t.mode, t.detail, t.style])
        }
        BaseData::Element(e) => {
            serde_json::json!(["element", e.format, e.indent, e.direction, e.style])
        }
        BaseData::Decorator => serde_json::json!(["decorator"]),
        BaseData::LineBreak => serde_json::json!(["linebreak"]),
    };
    serde_json::json!({
        "type": state.registry.registered(slot.type_index).type_name,
        "base": base,
        "own": slot.data.to_json().expect("payload"),
        "count": view.get_state(key, &COUNT).expect("state"),
        "children": if view.is_element(key) {
            view.children(key).map(|child| structural_tree(state, child)).collect::<Vec<_>>()
        } else { vec![] },
    })
}

// Independent flat view: node JSON without children, plus ordered child keys.
// Applying operations never reads commit.next; comparison does a fresh map walk.
#[derive(Clone, Debug, PartialEq)]
struct ViewNode {
    props: SerializedNode,
    children: Vec<NodeKey>,
}
fn view_tree(state: &EditorState) -> BTreeMap<NodeKey, ViewNode> {
    state
        .nodes
        .keys()
        .map(|key| {
            let mut props = state.view().export_json(*key).expect("export");
            props.remove("children");
            props.remove("type");
            props.remove("version");
            props.insert(
                "typeIndex".into(),
                state.view().type_index(*key).expect("type").get().into(),
            );
            if let Some(element) = state.view().element(*key) {
                props.insert("textFormat".into(), element.text_format.bits().into());
                props.insert("textStyle".into(), element.text_style.to_string().into());
                props.insert("style".into(), element.style.to_string().into());
            }
            let children = if state.view().is_element(*key) {
                state.view().children_keys(*key).expect("children")
            } else {
                vec![]
            };
            (*key, ViewNode { props, children })
        })
        .collect()
}
fn patch(view: &mut BTreeMap<NodeKey, ViewNode>, diff: Diff) {
    for op in diff.ops {
        match op {
            DiffOp::SetDecoratorRevision { key, .. } => {
                assert!(
                    view.contains_key(&key),
                    "component metadata requires a live node"
                );
            }
            DiffOp::Remove { key, .. } => {
                assert!(view.remove(&key).is_some());
            }
            DiffOp::Children { parent, children } => {
                view.get_mut(&parent)
                    .expect("parent created first")
                    .children = children
            }
            DiffOp::Text { key, text } => {
                view.get_mut(&key)
                    .expect("text")
                    .props
                    .insert("text".into(), text.into());
            }
            DiffOp::CreateElement {
                key,
                type_index,
                base,
                mut props,
            } => {
                props.insert("typeIndex".into(), type_index.get().into());
                element_props(&mut props, base);
                assert!(
                    view.insert(
                        key,
                        ViewNode {
                            props,
                            children: vec![]
                        }
                    )
                    .is_none()
                );
            }
            DiffOp::CreateText {
                key,
                type_index,
                text,
                base,
                mut props,
            } => {
                props.insert("typeIndex".into(), type_index.get().into());
                props.insert("text".into(), text.into());
                text_props(&mut props, base);
                assert!(
                    view.insert(
                        key,
                        ViewNode {
                            props,
                            children: vec![]
                        }
                    )
                    .is_none()
                );
            }
            DiffOp::CreateDecorator {
                key,
                type_index,
                mut props,
            } => {
                props.insert("typeIndex".into(), type_index.get().into());
                assert!(
                    view.insert(
                        key,
                        ViewNode {
                            props,
                            children: vec![]
                        }
                    )
                    .is_none()
                );
            }
            DiffOp::CreateLineBreak { key, type_index } => {
                let mut props = SerializedNode::new();
                props.insert("typeIndex".into(), type_index.get().into());
                assert!(
                    view.insert(
                        key,
                        ViewNode {
                            props,
                            children: vec![]
                        }
                    )
                    .is_none()
                );
            }
            DiffOp::TextProps { key, props } => {
                text_props(&mut view.get_mut(&key).expect("text").props, props)
            }
            DiffOp::ElementProps { key, props } => {
                element_props(&mut view.get_mut(&key).expect("element").props, props)
            }
            DiffOp::NodeProps { key, props } => {
                view.get_mut(&key).expect("node").props.extend(props)
            }
            DiffOp::State { key, state } => {
                let props = &mut view.get_mut(&key).expect("node").props;
                props.remove("$");
                if let Some(state) = state {
                    props.extend(state);
                }
            }
        }
    }
}
fn text_props(node: &mut SerializedNode, props: TextProps) {
    node.insert("format".into(), props.format.bits().into());
    node.insert("style".into(), props.style.to_string().into());
    node.insert("detail".into(), props.detail.bits().into());
    node.insert(
        "mode".into(),
        serde_json::to_value(props.mode).expect("mode"),
    );
}
fn element_props(node: &mut SerializedNode, props: ElementProps) {
    node.insert(
        "format".into(),
        serde_json::to_value(props.format).expect("format"),
    );
    node.insert("indent".into(), props.indent.into());
    node.insert(
        "direction".into(),
        serde_json::to_value(props.direction).expect("direction"),
    );
    node.insert("textFormat".into(), props.text_format.bits().into());
    node.insert("style".into(), props.style.to_string().into());
    node.insert("textStyle".into(), props.text_style.to_string().into());
}

fn run_script(
    trees: &[Tree],
    commands: &[Command],
    attached: bool,
) -> Vec<(Vec<String>, SerializedEditorState)> {
    let mut trace = vec![];
    let mode = if attached {
        EditorMode::ViewAttached
    } else {
        EditorMode::Headless
    };
    let mut editor = Editor::builder(mode)
        .node::<Opaque>()
        .node::<Inline>()
        .build()
        .expect("registry");
    let (_, initial) = editor
        .update(|tx| {
            for tree in trees {
                if matches!(tree, Tree::Decorator) {
                    append_tree(tx, NodeKey::ROOT, tree)?;
                } else {
                    let p = tx.create(Paragraph::default())?;
                    tx.append(NodeKey::ROOT, &[p.key()])?;
                    append_tree(tx, p.key(), tree)?;
                }
            }
            tx.set_selection(Some(Selection::Range(RangeSelection::at_root())))
        })
        .expect("initial tree");
    let initial_json = editor.state().to_json().expect("export");
    let mut history = History::new(HistoryConfig::default(), HistoryTime(0));
    history.record(&initial, HistoryTime(0));
    let mut independent = view_tree(editor.state());
    let mut previous_boundary = initial_json.clone();
    check_state(editor.state());
    let mut initial_keys = editor
        .state()
        .nodes
        .keys()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    initial_keys.sort();
    trace.push((initial_keys, initial_json));
    for (index, command) in commands.iter().enumerate() {
        let previous = editor.state().clone();
        let json = previous.to_json().expect("export");
        {
            let mut tx = editor.transaction();
            let _ = apply(&mut tx, command);
        }
        assert!(editor.state().same_snapshot(&previous));
        assert_eq!(editor.state().selection(), previous.selection());
        let failed: Result<((), Commit), Error> = editor.update(|tx| {
            apply(tx, command)?;
            Err(Error::InfiniteTransforms)
        });
        assert!(failed.is_err());
        assert!(editor.state().same_snapshot(&previous));
        assert_eq!(editor.state().selection(), previous.selection());
        let mut result_tx = editor.transaction();
        let result = (|| {
            let tx = &mut result_tx;
            tx.add_tag(UpdateTag::HistoryPush);
            apply(tx, command)?;
            tx.flush()?;
            Ok::<_, Error>(tx.pending.clone())
        })();
        let before_caches = result.as_ref().ok().cloned();
        let result = match result {
            Ok(_) => result_tx.commit().map(|commit| ((), commit)),
            Err(e) => {
                drop(result_tx);
                Err(e)
            }
        };
        assert_eq!(previous.to_json().expect("old export"), json);
        let ((), commit) = result.expect("generated command with valid preconditions");
        check_state(editor.state());
        if attached {
            for key in commit
                .changes
                .dirty_elements
                .keys()
                .filter(|key| previous.nodes.contains_key(*key) && **key != NodeKey::ROOT)
            {
                if let Some((format, style)) =
                    commit.next.view().descendants(*key).find_map(|(child, _)| {
                        commit
                            .next
                            .view()
                            .text(child)
                            .map(|text| (text.format, text.style.clone()))
                    })
                {
                    let element = commit.next.view().element_data(*key).expect("element");
                    assert_eq!(element.text_format, format);
                    assert_eq!(element.text_style, style);
                }
            }
        }
        let exported = editor.state().to_json().expect("export");
        let imported = editor.parse_editor_state(&exported).expect("import");
        assert_eq!(imported.to_json().expect("re-export"), exported);
        assert_eq!(
            structural_tree(&imported, NodeKey::ROOT),
            structural_tree(editor.state(), NodeKey::ROOT)
        );
        patch(
            &mut independent,
            commit
                .diff(&DiffOptions {
                    include_state: true,
                })
                .expect("diff"),
        );
        assert_eq!(independent, view_tree(&commit.next));
        // S1 dirty-set mutation contract: clean GC descendants and cache-only
        // root writes are intentionally excluded from listener notifications.
        let mut expected_mutations = BTreeMap::new();
        for key in commit
            .changes
            .dirty_leaves
            .iter()
            .chain(commit.changes.dirty_elements.keys())
        {
            let expected = match (
                previous.nodes.get(key),
                before_caches
                    .as_ref()
                    .expect("pre-cache state")
                    .nodes
                    .get(key),
            ) {
                (None, Some(_)) => Some(Mutation::Created),
                (Some(_), None) => Some(Mutation::Destroyed),
                (Some(a), Some(b)) if !Arc::ptr_eq(a, b) => Some(Mutation::Updated),
                _ => None,
            };
            if let Some(mutation) = expected {
                expected_mutations.insert(*key, mutation);
            }
        }
        assert_eq!(
            commit
                .changes
                .mutations
                .iter()
                .map(|(key, mutation)| (*key, *mutation))
                .collect::<BTreeMap<_, _>>(),
            expected_mutations
        );
        let depth = history.undo_depth();
        history.record(&commit, HistoryTime(index as u64 + 1));
        if history.undo_depth() > depth {
            previous_boundary = json;
        }
        let mut keys = editor
            .state()
            .nodes
            .keys()
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        keys.sort();
        trace.push((keys, exported));
    }
    let current = editor.state().to_json().expect("export");
    if !attached
        && history
            .undo(&mut editor, HistoryTime(1000))
            .expect("undo")
            .is_some()
    {
        assert_eq!(editor.state().to_json().expect("undone"), previous_boundary);
        history
            .redo(&mut editor, HistoryTime(1001))
            .expect("redo")
            .expect("redo available");
        assert_eq!(editor.state().to_json().expect("redone"), current);
    }
    trace
}

fn always_dirty(tx: &mut Transaction<'_>, node: Id<Text>) -> Result<(), Error> {
    tx.mark_dirty(node)
}
proptest! {
    #[test]
    fn proptest_scripts_preserve_invariants(
        trees in arb_state(), commands in prop::collection::vec(arb_command(), 0..65), attached in any::<bool>()
    ) {
        assert_eq!(run_script(&trees, &commands, attached), run_script(&trees, &commands, attached));
    }
    #[test]
    fn proptest_nonterminating_transforms_roll_back(text in "[a-z😀é]{1,12}") {
        let mut editor = Editor::builder(EditorMode::Headless).transform::<Text>(always_dirty).build().expect("registry");
        let previous = editor.state().clone();
        let result = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text(&text)?;
            tx.append(p, &[t.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])
        });
        assert!(matches!(result, Err(Error::InfiniteTransforms)));
        assert!(previous.same_snapshot(editor.state()));
    }
}

#[test]
fn range_only_generated_commands_respect_decorator_node_selection() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Opaque>()
        .build()
        .expect("registry");
    let (decorator, _) = editor.update(|tx| {
        let d = tx.create(Opaque {})?;
        tx.append(NodeKey::ROOT, &[d.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::at_root())))?;
        Ok(d)
    })?;
    editor.update(|tx| {
        apply(tx, &Command::InsertParagraph)?;
        apply(
            tx,
            &Command::DeleteCharacter {
                direction: EditDirection::Forward,
                target: ModifyTarget::NoView,
            },
        )
    })?;
    let previous = editor.state().clone();
    check_state(&previous);
    let mut tx = editor.transaction();
    assert!(matches!(tx.selection(),Some(Selection::Node(s)) if s.has(decorator.key())));
    assert!(matches!(tx.remove_text(), Err(Error::NoRangeSelection)));
    apply(&mut tx, &Command::RemoveText)?;
    assert_eq!(tx.selection(), previous.selection());
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![decorator.key()]);
    assert!(tx.is_attached(decorator));
    apply(&mut tx, &Command::SelectAll(None))?;
    assert!(matches!(tx.selection(), Some(Selection::Range(_))));
    tx.commit()?;
    Ok(())
}

// Upstream insertText treats a selected Tab as atomic even in normal text mode.
#[test]
fn replacing_selected_tab_before_empty_inline_creates_plain_text() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Inline>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let tab = tx.create(Tab::default())?;
    let inline = tx.create(Inline::default())?;
    let empty = tx.create_text("")?;
    tx.text(empty)?.set_mode(TextMode::Token)?;
    tx.append(inline, &[empty.key()])?;
    tx.append(paragraph, &[tab.key(), inline.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.select_all(None)?;
    tx.insert_text("é")?;
    assert_eq!(tx.text_content(NodeKey::ROOT), "é");
    assert!(!tx.is_attached(tab));
    let Selection::Range(range) = tx.selection().expect("selection") else {
        panic!("range");
    };
    assert!(range.is_collapsed());
    assert!(!tx.is::<Tab>(range.anchor.key()));
    assert_eq!(range.anchor.offset(), 1);
    tx.commit()?;
    Ok(())
}

// Original 20542059 reproduction used nested Paragraphs, unlike valid generated Inline content.
#[test]
fn nested_paragraph_delete_script_keeps_a_root_insertion_boundary() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Opaque>()
        .build()
        .expect("registry");
    editor.update(|tx| {
        let outer = tx.create(Paragraph::default())?;
        let inner = tx.create(Paragraph::default())?;
        let empty = tx.create(Paragraph::default())?;
        let decorator = tx.create(Opaque {})?;
        tx.append(inner, &[decorator.key(), empty.key()])?;
        tx.append(outer, &[inner.key()])?;
        tx.append(NodeKey::ROOT, &[outer.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::at_root())))
    })?;
    editor.update(|tx| tx.delete_character(EditDirection::Forward, ModifyTarget::NoView))?;
    editor.update(|tx| tx.delete_character(EditDirection::Forward, ModifyTarget::NoView))?;
    let point = Point::element(NodeKey::ROOT, ChildIndex(0));
    assert_eq!(
        editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .map(|r| (r.anchor, r.focus)),
        Some((point, point))
    );
    editor.update(|tx| tx.insert_line_break(false))?;
    let view = editor.state().view();
    let children: Vec<_> = view.children(NodeKey::ROOT).collect();
    assert_eq!(children.len(), 2);
    let first = children[0];
    assert!(view.is::<Paragraph>(first));
    let line = view.first_child(first).expect("inserted linebreak");
    assert!(view.is::<LineBreak>(line));
    assert_eq!(view.children(first).count(), 1);
    assert!(
        !view
            .descendants(NodeKey::ROOT)
            .any(|(key, _)| view.is::<Opaque>(key))
    );
    Ok(())
}
