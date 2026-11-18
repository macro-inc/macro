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
fn null_text_mode_imports_as_absent_mode_on_both_import_paths() -> Result<(), Error> {
    // Source TextNode.updateFromJSON (Lexical 0.45.0 dist sha256 449d061d) calls
    // setMode(serializedNode.mode); for null that stores TEXT_MODE_TO_TYPE[null],
    // undefined, so exportJSON omits mode, as for an omitted key. A Source client's
    // Loro writer stores omitted fields as null, so this reaches native loads.
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    // The general import path (update_from_json, also used for remote fields).
    editor.update(|tx| {
        let text = tx.create_text("old")?;
        let imported = serde_json::json!({"type":"text","version":1,"text":"hi","mode":null});
        tx.update_from_json(text, imported.as_object().expect("object"))?;
        assert!(!tx.export_json(text)?.contains_key("mode"));
        assert!(!tx.is_simple_text(text));
        Ok(())
    })?;
    // The parse path every state load takes.
    let raw: SerializedEditorState = serde_json::from_str(
        r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"hi","mode":null}]}]}}"#,
    )?;
    let state = editor.parse_editor_state(&raw)?;
    assert_eq!(
        serde_json::Value::Object(
            state.to_json()?.root["children"][0]["children"][0]
                .as_object()
                .cloned()
                .expect("text")
        ),
        serde_json::json!({"text":"hi","type":"text","version":1})
    );
    Ok(())
}

#[test]
fn unknown_text_modes_import_as_absent_mode_on_both_import_paths() -> Result<(), Error> {
    // Source setMode(serializedNode.mode) stores TEXT_MODE_TO_TYPE[mode], which is
    // undefined for any value but "normal", "token" and "segmented", exactly as for null.
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    for mode in [serde_json::json!("unknown"), serde_json::json!(5)] {
        editor.update(|tx| {
            let text = tx.create_text("old")?;
            let imported = serde_json::json!({"type":"text","version":1,"text":"hi","mode":mode});
            tx.update_from_json(text, imported.as_object().expect("object"))?;
            assert!(!tx.export_json(text)?.contains_key("mode"));
            assert!(!tx.is_simple_text(text));
            Ok(())
        })?;
        let text = serde_json::json!({"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"hi","mode":mode}]}]}}).to_string();
        let state = editor.parse_editor_state_str(&text)?;
        assert_eq!(
            serde_json::Value::Object(
                state.to_json()?.root["children"][0]["children"][0]
                    .as_object()
                    .cloned()
                    .expect("text")
            ),
            serde_json::json!({"text":"hi","type":"text","version":1})
        );
    }
    Ok(())
}

#[test]
fn null_mode_text_is_not_simple_for_normalization_until_mode_is_set() -> Result<(), Error> {
    // Source $normalizeTextNode merges and removes only isSimpleText nodes
    // (__mode === 0). Observed on Source (scratch probe): a null-mode text beside a
    // normal one stays separate and an empty null-mode text stays, through a
    // normalizing update; after setMode('normal') the mode exports and they merge.
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    let ((null_mode, empty_null_mode, normal), _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        let null_mode = tx.create_text("old")?;
        let empty_null_mode = tx.create_text("old")?;
        let normal = tx.create_text("b")?;
        tx.append(
            paragraph,
            &[null_mode.key(), empty_null_mode.key(), normal.key()],
        )?;
        let a = serde_json::json!({"type":"text","version":1,"text":"a","mode":null,"format":0,"detail":0,"style":""});
        tx.update_from_json(null_mode, a.as_object().expect("object"))?;
        let empty = serde_json::json!({"type":"text","version":1,"text":"","mode":null,"format":0,"detail":0,"style":""});
        tx.update_from_json(empty_null_mode, empty.as_object().expect("object"))?;
        Ok((null_mode.key(), empty_null_mode.key(), normal.key()))
    })?;
    editor.update(|tx| {
        for key in [null_mode, empty_null_mode, normal] {
            tx.mark_dirty(key)?;
        }
        Ok(())
    })?;
    let paragraph = |editor: &Editor| -> Result<serde_json::Value, Error> {
        Ok(editor.state().to_json()?.root["children"][0]["children"].clone())
    };
    assert_eq!(
        paragraph(&editor)?,
        serde_json::json!([
            {"detail":0,"format":0,"style":"","text":"a","type":"text","version":1},
            {"detail":0,"format":0,"style":"","text":"","type":"text","version":1},
            {"detail":0,"format":0,"mode":"normal","style":"","text":"b","type":"text","version":1}
        ])
    );
    editor.update(|tx| {
        tx.text(null_mode)?.set_mode(TextMode::Normal)?;
        tx.text(empty_null_mode)?.set_mode(TextMode::Normal)?;
        Ok(())
    })?;
    assert_eq!(
        paragraph(&editor)?,
        serde_json::json!([
            {"detail":0,"format":0,"mode":"normal","style":"","text":"ab","type":"text","version":1}
        ])
    );
    Ok(())
}

#[test]
fn split_text_keeps_imported_absent_format_style_detail_on_new_parts() -> Result<(), Error> {
    // Source TextNode.splitText (Lexical 0.45.0 dist sha256 449d061d, L7044) copies
    // __format/__style/__detail raw onto each new part (L7072-7074, L7108-7110), so
    // fields the original imported as absent stay absent; mode comes from
    // $createTextNode ('normal').
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        let text = tx.create_text("old")?;
        tx.append(paragraph, &[text.key()])?;
        let imported = serde_json::json!({"type":"text","version":1,"text":"Before. After."});
        tx.update_from_json(text, imported.as_object().expect("object"))?;
        let parts = tx.text(text)?.split_text(&[Utf16Offset(8)])?;
        assert_eq!(parts.len(), 2);
        assert_eq!(
            serde_json::Value::Object(tx.export_json(parts[0])?),
            serde_json::json!({"text":"Before. ","type":"text","version":1})
        );
        assert_eq!(
            serde_json::Value::Object(tx.export_json(parts[1])?),
            serde_json::json!({"mode":"normal","text":"After.","type":"text","version":1})
        );
        // An explicit write after the split exports that field, as Source's setters do.
        tx.text(parts[1])?.set_format(TextFormat::BOLD)?;
        assert_eq!(
            serde_json::Value::Object(tx.export_json(parts[1])?),
            serde_json::json!({"format":1,"mode":"normal","text":"After.","type":"text","version":1})
        );
        Ok(())
    })?;
    Ok(())
}

#[test]
fn split_text_of_segmented_imported_text_replaces_the_first_part_too() -> Result<(), Error> {
    // Source's segmented branch (L7090-7097): the FIRST part is also a new
    // $createTextNode node with raw format/style/detail and mode 'normal'.
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        let text = tx.create_text("old")?;
        tx.append(paragraph, &[text.key()])?;
        let imported = serde_json::json!({"type":"text","version":1,"text":"Before. After.","mode":"segmented"});
        tx.update_from_json(text, imported.as_object().expect("object"))?;
        let parts = tx.text(text)?.split_text(&[Utf16Offset(8)])?;
        assert_eq!(parts.len(), 2);
        assert_ne!(parts[0], text.key());
        assert_eq!(
            serde_json::Value::Object(tx.export_json(parts[0])?),
            serde_json::json!({"mode":"normal","text":"Before. ","type":"text","version":1})
        );
        assert_eq!(
            serde_json::Value::Object(tx.export_json(parts[1])?),
            serde_json::json!({"mode":"normal","text":"After.","type":"text","version":1})
        );
        Ok(())
    })?;
    Ok(())
}

#[test]
fn split_text_of_created_text_exports_every_field_on_new_parts() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("valid");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        let text = tx.create_text("Before. After.")?;
        tx.append(paragraph, &[text.key()])?;
        let parts = tx.text(text)?.split_text(&[Utf16Offset(8)])?;
        assert_eq!(
            serde_json::Value::Object(tx.export_json(parts[1])?),
            serde_json::json!({"detail":0,"format":0,"mode":"normal","style":"","text":"After.","type":"text","version":1})
        );
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
            cached_direction: None,
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

mod child_list_work;

mod null_fields;
#[test]
fn appending_sibling_leaves_unchanged_prefix_records_clean() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let ((first, last), _) = editor.update(|tx| {
        let first = tx.create(Paragraph::default())?;
        let last = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[first.key(), last.key()])?;
        Ok((first.key(), last.key()))
    })?;
    let (_, commit) = editor.update(|tx| {
        let next = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[next.key()])
    })?;
    assert!(!commit.changes.dirty_elements.contains_key(&first));
    assert!(!commit.changes.mutations.contains_key(&first));
    assert!(commit.changes.dirty_elements.contains_key(&last));
    Ok(())
}

#[test]
fn merging_text_resolves_parent_element_selection_points() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let ((p, first, last), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let first = tx.create_text("a")?;
        let last = tx.create_text("b")?;
        tx.text(last)?.set_format(TextFormat::BOLD)?;
        tx.append(p, &[first.key(), last.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::element(p, ChildIndex(1)),
            Point::element(p, ChildIndex(2)),
        ))))?;
        Ok((p.key(), first.key(), last.key()))
    })?;
    editor.update(|tx| tx.text(last)?.set_format(TextFormat::empty()).map(|_| ()))?;
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .unwrap();
    assert_eq!(range.anchor, Point::text(first, Utf16Offset(2)));
    assert_eq!(range.focus, range.anchor);
    assert_eq!(editor.state().text_content(p), "ab");
    Ok(())
}

#[cfg(feature = "foreign-nodes")]
#[test]
fn conformance_peer_shares_registry_and_keys_but_owns_its_snapshot() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut peer = editor.create_conformance_peer(EditorMode::ViewAttached)?;
    assert!(peer.state().is_empty_state());
    let (first, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(p.key())
    })?;
    peer.set_editor_state(editor.state().clone(), TagSet::default())?;
    let (second, _) = peer.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(p.key())
    })?;
    assert_ne!(first, second);
    assert_eq!(editor.state().view().children_size(NodeKey::ROOT), 1);
    assert_eq!(peer.state().view().children_size(NodeKey::ROOT), 2);
    Ok(())
}

mod context_factory;
#[test]
fn identical_text_splice_still_publishes_updated_leaf() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("registry");
    let ((paragraph, text), _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("abc")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok((paragraph, text))
    })?;
    let (_, commit) = editor.update(|tx| {
        tx.text(text)?
            .splice_text(Utf16Offset(2)..Utf16Offset(3), "c", false)?;
        Ok(())
    })?;
    assert_eq!(editor.state().text_content(text).as_ref(), "abc");
    assert!(commit.changes.dirty_leaves.contains(&text.key()));
    assert_eq!(
        commit.changes.dirty_elements.get(&paragraph.key()),
        Some(&DirtyIntent::AncestorOfDirty)
    );
    assert_eq!(
        commit.changes.mutations.get(&text.key()),
        Some(&Mutation::Updated)
    );
    Ok(())
}

mod recorder_regressions;

#[test]
fn no_op_commit_preserves_the_published_selection_direction_memo() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("registry");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("abc")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_end(text)
    })?;
    let Some(Selection::Range(range)) = &mut editor.state.selection else {
        panic!("range selection");
    };
    range.cached_direction = Some((range.anchor, range.focus, false));
    let commit = editor.transaction().commit()?;
    assert!(commit.is_noop());
    let Some(Selection::Range(range)) = editor.state().selection() else {
        panic!("published range selection");
    };
    assert_eq!(range.cached_is_backward(), Some(false));
    Ok(())
}
