use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
struct Inline {
    label: String,
}
impl NodeType for Inline {
    const TYPE: &'static str = "inline";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for Inline {
    element_node_base!();
    fn is_inline(&self, _node: ElementView<'_>) -> bool {
        true
    }
}
#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
struct Derived {
    parent: Inline,
}
impl NodeType for Derived {
    const TYPE: &'static str = "derived";
    const HAS_LANGUAGE_FIELD: bool = true;
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for Derived {
    type Parent = Inline;
    fn as_parent(&self) -> &Inline {
        &self.parent
    }
    fn as_parent_mut(&mut self) -> Option<&mut Inline> {
        Some(&mut self.parent)
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct NoProbe {}
impl NodeType for NoProbe {
    const TYPE: &'static str = "no-probe";
    type Kind = ElementKind;
}
impl ElementNode for NoProbe {
    element_node_base!();
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Dynamic {
    inline: bool,
}
impl NodeType for Dynamic {
    const TYPE: &'static str = "dynamic";
    const FLAGS_PER_INSTANCE: bool = true;
    type Kind = ElementKind;
}
impl ElementNode for Dynamic {
    element_node_base!();
    fn is_inline(&self, _node: ElementView<'_>) -> bool {
        self.inline
    }
}
trait Label {
    fn label(&self) -> &str;
}
impl Label for Inline {
    fn label(&self) -> &str {
        &self.label
    }
}

#[test]
fn registry_flags_ancestry_and_mutable_projection() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Inline>()
        .node::<Derived>()
        .node::<Dynamic>()
        .node_trait::<Inline, dyn Label>(|node| node)
        .build()
        .expect("valid registry");
    assert_eq!(
        editor
            .registry()
            .types()
            .map(|node| node.type_name)
            .take(6)
            .collect::<Vec<_>>(),
        [
            "root",
            "text",
            "linebreak",
            "tab",
            "paragraph",
            "artificial"
        ]
    );
    let derived = editor.registry().get("derived").expect("derived");
    assert_eq!(derived.flags.map(|flags| flags.is_inline), Some(true));
    assert!(derived.has_language_field);
    assert!(
        editor
            .registry()
            .get("dynamic")
            .expect("dynamic")
            .flags
            .is_none()
    );
    let (key, _) = editor.update(|tx| {
        let key = tx.create(Derived::default())?;
        assert!(tx.is::<Inline>(key));
        assert!(tx.is::<Derived>(key));
        assert!(!tx.is::<ElementBase>(key));
        tx.get_mut::<Inline>(key)?.label = "inherited".into();
        tx.append(NodeKey::ROOT, &[key.key()])?;
        Ok(key)
    })?;
    assert_eq!(
        editor.state().get_dyn::<dyn Label>(key).map(Label::label),
        Some("inherited")
    );
    assert!(editor.state().is_inline(key));
    Ok(())
}

#[test]
fn registry_rejects_invalid_registration() {
    assert!(matches!(
        Editor::builder(EditorMode::Headless)
            .node::<NoProbe>()
            .build(),
        Err(BuildError::NoFlagProbe { .. })
    ));
    assert!(matches!(
        Editor::builder(EditorMode::Headless).node::<Text>().build(),
        Err(BuildError::DuplicateNodeType { .. })
    ));
    assert!(matches!(
        Editor::builder(EditorMode::Headless)
            .node::<ElementBase>()
            .build(),
        Err(BuildError::BaseMarkerRegistered { .. })
    ));
    assert!(matches!(
        Editor::builder(EditorMode::Headless)
            .replace::<Text, Paragraph>(|_| Paragraph::default())
            .build(),
        Err(BuildError::ReplacementNotSubtype { .. })
    ));
}

#[test]
fn rollback_snapshot_sharing_and_key_burning() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid registry");
    let burned;
    {
        let mut tx = editor.transaction();
        burned = tx.create_text("discard")?.key();
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    }
    assert_eq!(editor.state().node_count(), 1);
    let ((paragraph, text), _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("before😀")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok((paragraph, text))
    })?;
    assert!(text.key() > burned);
    let before = editor.state().clone();
    assert_eq!(before.root_text_content().as_ref(), "before😀");
    editor.update(|tx| {
        assert!(!tx.is_writable(text));
        tx.text(text)?.set_text_content("after")?;
        assert!(tx.is_writable(text));
        assert!(!tx.is_writable(paragraph));
        assert!(tx.is_dirty_element(paragraph));
        assert!(tx.is_dirty_leaf(text));
        Ok(())
    })?;
    assert_eq!(before.root_text_content().as_ref(), "before😀");
    assert_eq!(before.text_content(text), "before😀");
    assert_eq!(editor.state().root_text_content().as_ref(), "after");
    assert!(!before.same_snapshot(editor.state()));
    Ok(())
}

#[test]
fn tree_operations_preserve_links_and_order() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid registry");
    let result = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let a = tx.create_text("a")?;
        let b = tx.create_text("b")?;
        let c = tx.create_text("c")?;
        let detached = tx.create_text("detached")?;
        tx.remove(detached, false)?;
        assert!(!tx.is_attached(detached));
        tx.append(paragraph, &[a.key(), b.key(), c.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.insert_before(a, c.key(), true)?;
        assert_eq!(tx.children_keys(paragraph)?, [c.key(), a.key(), b.key()]);
        tx.insert_after(b, c.key(), true)?;
        assert_eq!(tx.children_keys(paragraph)?, [a.key(), b.key(), c.key()]);
        let copy = tx.copy_node(a, false)?;
        tx.replace(b, copy, false)?;
        assert_eq!(tx.text_content(paragraph), "aac");
        tx.remove_from_parent(copy)?;
        assert_eq!(tx.children_keys(paragraph)?, [a.key(), c.key()]);
        tx.splice(paragraph, ChildIndex(1), 1, &[b.key()])?;
        tx.insert_range_after(b, c, Some(copy))?;
        Ok(())
    });
    assert!(matches!(result, Err(Error::InsertRangeAfterOrder)));
    assert!(editor.state().is_empty_state());
    editor.update(|tx| {
        let left = tx.create(Paragraph::default())?;
        let right = tx.create(Paragraph::default())?;
        let a = tx.create_text("a")?;
        let b = tx.create_text("b")?;
        let c = tx.create_text("c")?;
        tx.append(left, &[a.key(), b.key(), c.key()])?;
        tx.append(NodeKey::ROOT, &[left.key(), right.key()])?;
        tx.append(right, &[b.key()])?;
        assert_eq!(tx.children_keys(left)?, [a.key(), c.key()]);
        tx.insert_range_after(b, a, Some(c.key()))?;
        assert_eq!(tx.children_keys(right)?, [b.key(), a.key(), c.key()]);
        assert!(tx.children_keys(left)?.is_empty());
        let (_, split) = tx.split_node(right, ChildIndex(1))?;
        assert_eq!(tx.text_content(right), "b");
        assert_eq!(tx.text_content(split), "ac");
        tx.set_indent(right, 3)?;
        assert_eq!(tx.indent(right), 3);
        let next = tx
            .insert_new_after(right, SelectionSlot::Active, true)?
            .expect("paragraph insertion");
        tx.clear(split)?;
        assert!(tx.is_empty(split));
        assert!(tx.collapse_at_start(next, SelectionSlot::Active)?);
        let wrapper = tx.create_parent_element(a)?;
        tx.append(wrapper, &[a.key()])?;
        tx.replace(left, wrapper, true)?;
        tx.select_start(wrapper)?;
        tx.select_end(wrapper)?;
        tx.select_previous(wrapper, None, None)?;
        tx.select_next(wrapper, None, None)?;
        for parent in [NodeKey::ROOT, wrapper, right.key(), split] {
            let children = tx.children_keys(parent)?;
            assert_eq!(tx.children_size(parent) as usize, children.len());
            for (i, key) in children.iter().enumerate() {
                assert_eq!(tx.parent(*key), Some(parent));
                assert_eq!(
                    tx.prev_sibling(*key),
                    i.checked_sub(1).and_then(|i| children.get(i)).copied()
                );
                assert_eq!(tx.next_sibling(*key), children.get(i + 1).copied());
            }
        }
        Ok(())
    })?;
    Ok(())
}

static NOTE: StateKey<String> = StateKey::new("note", |raw| {
    raw.and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_owned()
})
.reset_on_copy();
static COLLISION: StateKey<String> = StateKey::new("note", |_| String::new());
#[test]
fn state_default_omission_copy_reset_and_collision() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid registry");
    editor.update(|tx| {
        let text = tx.create_text("text")?;
        tx.set_state(text, &NOTE, "value".to_owned())?;
        assert_eq!(
            tx.export_json(text)?.get("$").and_then(|v| v.get("note")),
            Some(&serde_json::json!("value"))
        );
        assert!(matches!(
            tx.get_state(text, &COLLISION),
            Err(Error::StateKeyCollision { .. })
        ));
        let copy = tx.copy_node(text, false)?;
        assert_eq!(tx.get_state(copy, &NOTE)?, "");
        assert!(!tx.export_json(copy)?.contains_key("$"));
        tx.set_state(text, &NOTE, String::new())?;
        assert!(!tx.export_json(text)?.contains_key("$"));
        Ok(())
    })?;
    Ok(())
}

#[test]
fn text_edits_split_merge_and_tab_guards() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid registry");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("a😀b")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.text(text)?
            .set_format(TextFormat::BOLD)?
            .set_style("color: red")?;
        let parts = tx
            .text(text)?
            .split_text(&[Utf16Offset(3), Utf16Offset(1), Utf16Offset(1)])?;
        assert_eq!(
            parts
                .iter()
                .map(|key| tx.text_content(*key).into_owned())
                .collect::<Vec<_>>(),
            ["a", "😀", "b"]
        );
        tx.text(parts[0])?.merge_with_sibling(parts[1])?;
        assert_eq!(tx.text_content(parts[0]), "a😀");
        tx.text(parts[0])?
            .splice_text(Utf16Offset(1)..Utf16Offset(3), "z", true)?;
        assert_eq!(tx.text_content(paragraph), "azb");
        let tab = tx.create(Tab::default())?;
        assert_eq!(tx.text_content(tab), "\t");
        assert!(tx.view().text(tab).expect("tab text").is_unmergeable());
        assert!(matches!(
            tx.text(tab)?.set_text_content("bad"),
            Err(Error::TabSetTextContent)
        ));
        assert!(matches!(
            tx.text(tab)?.set_detail(TextDetail::empty()),
            Err(Error::TabSetDetail)
        ));
        Ok(())
    })?;
    Ok(())
}

#[test]
fn snapshots_are_send_and_sync() {
    fn check<Interface: Send + Sync>() {}
    check::<EditorState>();
    check::<Editor>();
    check::<Registry>();
}

#[test]
fn splice_relocates_descendant_selection_but_keeps_moved_nodes() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Inline>()
        .build()
        .expect("valid");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let inline = tx.create(Inline::default())?;
        let text = tx.create_text("selected")?;
        let tail = tx.create_text("tail")?;
        tx.append(inline, &[text.key()])?;
        tx.append(paragraph, &[inline.key(), tail.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.text(text)?
            .select(Some(Utf16Offset(1)), Some(Utf16Offset(3)))?;
        let detached = tx.detach_selection(tx.selection().cloned().expect("selection"));
        tx.splice(paragraph, ChildIndex(0), 1, &[inline.key()])?;
        assert_eq!(
            tx.try_range_at(SelectionSlot::Active)
                .expect("range")
                .anchor
                .key(),
            text.key()
        );
        tx.splice(paragraph, ChildIndex(0), 1, &[])?;
        assert_ne!(
            tx.try_range_at(SelectionSlot::Active)
                .expect("range")
                .anchor
                .key(),
            text.key()
        );
        assert_eq!(
            tx.try_range_at(detached)
                .expect("detached range")
                .anchor
                .key(),
            text.key()
        );
        Ok(())
    })?;
    Ok(())
}

#[test]
fn nested_split_returns_root_children_and_moves_end_boundary() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Inline>()
        .build()
        .expect("valid");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let inline = tx.create(Inline::default())?;
        let text = tx.create_text("text")?;
        let tail = tx.create_text("tail")?;
        tx.append(inline, &[text.key()])?;
        tx.append(paragraph, &[inline.key(), tail.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        let (left, right) = tx.split_node(inline, ChildIndex(1))?;
        assert_eq!(left, Some(paragraph.key()));
        assert_eq!(tx.parent(right), Some(NodeKey::ROOT));
        assert!(tx.children_keys(paragraph)?.is_empty());
        assert_eq!(tx.children_keys(right)?, [inline.key(), tail.key()]);
        assert_eq!(tx.text_content(right), "texttail");
        Ok(())
    })?;
    Ok(())
}

#[test]
fn import_runs_tab_hooks_and_tracks_absent_fields() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    editor.update(|tx| {
        let text=tx.create_text("old")?;
        let empty=serde_json::json!({"type":"text","version":1});
        tx.update_from_json(text,empty.as_object().expect("object"))?;
        assert!(!tx.is_simple_text(text));
        assert!(!tx.export_json(text)?.contains_key("mode"));
        tx.text(text)?.set_mode(TextMode::Normal)?;
        assert!(tx.is_simple_text(text));
        assert_eq!(tx.export_json(text)?.get("mode"),Some(&serde_json::json!("normal")));
        let tab=tx.create(Tab::default())?;
        let invalid=serde_json::json!({"type":"tab","text":"bad","format":0,"detail":2,"mode":"normal","style":""});
        assert!(matches!(tx.update_from_json(tab,invalid.as_object().expect("object")),Err(Error::TabSetTextContent)));
        tx.apply_remote_fields(tab,invalid.as_object().expect("object"))?;
        assert_eq!(tx.text_content(tab),"bad");
        Ok(())
    })?;
    Ok(())
}

#[test]
fn raw_text_and_paragraph_export_match_upstream() -> Result<(), Error> {
    assert_eq!(
        tokenize_raw_text("a\r\nb\tc\rd\n").collect::<Vec<_>>(),
        [
            RawTextToken::Text("a"),
            RawTextToken::LineBreak,
            RawTextToken::Text("b"),
            RawTextToken::Tab,
            RawTextToken::Text("c\rd"),
            RawTextToken::LineBreak
        ]
    );
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        let nodes = tx.nodes_from_raw_text("a\t\nb")?;
        tx.append(paragraph, &nodes)?;
        tx.text(nodes[0])?
            .set_format(TextFormat::ITALIC)?
            .set_style("color: red")?;
        let json = tx.export_json(paragraph)?;
        assert_eq!(json.get("textFormat"), Some(&serde_json::json!(2)));
        assert_eq!(
            json.get("textStyle"),
            Some(&serde_json::json!("color: red"))
        );
        let tab = nodes[1];
        tx.text(tab)?
            .splice_text(Utf16Offset(99)..Utf16Offset(99), "", false)?;
        assert!(matches!(
            tx.text(tab)?
                .splice_text(Utf16Offset(0)..Utf16Offset(1), "", false),
            Err(Error::TabSpliceText)
        ));
        Ok(())
    })?;
    assert!(matches!(
        editor.reset_key_counter(),
        Err(Error::KeyResetWithNodes)
    ));
    Ok(())
}

#[test]
fn node_state_defaults_identity_and_unknown_values() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    let ((left,right),_)=editor.update(|tx| {
        let left=tx.create_text("left")?;let right=tx.create_text("right")?;
        tx.set_state(left,&NOTE,String::new())?;
        assert!(NodeState::equivalent(tx.node(left).and_then(NodeRef::node_state),None));
        let json=serde_json::json!({"$":{"note":"value","object":{"x":1}},"type":"text","text":"text","mode":"normal"});
        tx.update_from_json(left,json.as_object().expect("object"))?;
        tx.update_from_json(right,json.as_object().expect("object"))?;
        assert!(!NodeState::equivalent(tx.node(left).and_then(NodeRef::node_state),tx.node(right).and_then(NodeRef::node_state)));
        tx.set_state(left,&NOTE,"value".to_owned())?;
        let json=serde_json::json!({"$":{"note":"value"},"type":"text","text":"text","mode":"normal"});
        tx.update_from_json(right,json.as_object().expect("object"))?;
        let json=serde_json::json!({"type":"text","text":"text","mode":"normal"});
        tx.update_from_json(left,json.as_object().expect("object"))?;
        assert!(tx.node(left).and_then(NodeRef::node_state).is_some());
        assert_eq!(tx.get_state(left,&NOTE)?,"");
        let p = tx.create(Paragraph::default())?;
        tx.append(p, &[left.key(), right.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((left,right))
    })?;
    let before = editor.state().clone();
    editor.update(|tx| {
        tx.set_state(left, &NOTE, "new".to_owned())?;
        assert_eq!(
            tx.state_change(before.view(), left, &NOTE)?,
            Some(("new".to_owned(), String::new()))
        );
        assert!(!tx.is_dirty_leaf(right));
        tx.update_state(right, &NOTE, Clone::clone)?;
        assert!(!tx.is_dirty_leaf(right));
        Ok(())
    })?;
    Ok(())
}

static ARRAY: StateKey<std::sync::Arc<[String]>> = StateKey::new("array", |raw| {
    raw.and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>()
                .into()
        })
        .unwrap_or_else(|| Vec::new().into())
});
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Stateful {}
impl NodeType for Stateful {
    const TYPE: &'static str = "stateful";
    type Kind = ElementKind;
    const REQUIRED_STATE: &'static [RequiredState] =
        &[RequiredState::nested(&ARRAY), RequiredState::flat(&NOTE)];
    impl_default_node!();
}
impl ElementNode for Stateful {
    element_node_base!();
}
#[test]
fn imported_missing_object_defaults_keep_identity() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Stateful>()
        .build()
        .expect("valid");
    editor.update(|tx| {
        let node = tx.create(Stateful::default())?;
        let json = serde_json::json!({"type":"stateful","$":{},"note":"flat"});
        tx.update_from_json(node, json.as_object().expect("object"))?;
        assert!(std::sync::Arc::ptr_eq(
            &tx.get_state(node, &ARRAY)?,
            ARRAY.default_value()
        ));
        assert_eq!(
            tx.export_json(node)?.get("note"),
            Some(&serde_json::json!("flat"))
        );
        assert!(!tx.export_json(node)?.contains_key("$"));
        let json = serde_json::json!({"type":"stateful","$":{"array":[]}});
        tx.update_from_json(node, json.as_object().expect("object"))?;
        assert!(!std::sync::Arc::ptr_eq(
            &tx.get_state(node, &ARRAY)?,
            ARRAY.default_value()
        ));
        assert_eq!(
            tx.export_json(node)?
                .get("$")
                .and_then(|state| state.get("array")),
            Some(&serde_json::json!([]))
        );
        Ok(())
    })?;
    Ok(())
}

#[test]
fn selection_reads_match_text_and_element_boundaries() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    editor.update(|tx| {
        let empty = tx.create(Paragraph::default())?;
        let first = tx.create(Paragraph::default())?;
        let second = tx.create(Paragraph::default())?;
        let a = tx.create_text("a😀b")?;
        let b = tx.create_text("second")?;
        tx.append(first, &[a.key()])?;
        tx.append(second, &[b.key()])?;
        tx.append(NodeKey::ROOT, &[first.key(), second.key()])?;
        let selection = Selection::Range(RangeSelection {
            dirty: false,
            anchor: Point::text(a, Utf16Offset(1)),
            focus: Point::text(b, Utf16Offset(3)),
            format: TextFormat::empty(),
            style: Default::default(),
        });
        tx.set_selection(Some(selection.clone()))?;
        assert_eq!(
            tx.character_offsets(&selection)?,
            (Utf16Offset(1), Utf16Offset(3))
        );
        assert_eq!(tx.selection_text_content()?, "😀b\nsec");
        assert!(tx.is_selected(a, None));
        assert!(tx.is_selected(second, None));
        tx.element(first)?
            .select(Some(ChildIndex(0)), Some(ChildIndex(1)))?;
        assert_eq!(tx.selection_text_content()?, "a😀b");
        tx.text(a)?
            .select(Some(Utf16Offset(1)), Some(Utf16Offset(3)))?;
        assert_eq!(tx.selection_text_content()?, "😀");
        tx.text(a)?
            .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
        assert_eq!(tx.selection_text_content()?, "");
        assert!(tx.is_selected(a, None));
        tx.append(NodeKey::ROOT, &[empty.key()])?;
        tx.element(NodeKey::ROOT)?
            .select(Some(ChildIndex(2)), Some(ChildIndex(3)))?;
        assert!(tx.is_selected(empty, None));
        assert_eq!(tx.selection_text_content()?, "");
        Ok(())
    })?;
    Ok(())
}

mod reads;

mod values;

mod nodes;

mod editing;

mod state;

mod proptest;

mod performance;
