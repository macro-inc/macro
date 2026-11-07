use super::*;
#[test]
fn json_copy_slices_text_and_hoists_annotations_without_mutating_state() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<crate::mark::MarkNode>()
        .build()
        .unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?; let mark = crate::mark::create_mark_node(tx,vec!["id".into()])?; let text = tx.create_text("a😀z")?;
        tx.append(mark,&[text.key()])?;tx.append(p,&[mark])?;tx.append(NodeKey::ROOT,&[p.key()])?;
        let selection = Selection::Range(RangeSelection::new(Point::text(text,Utf16Offset(1)),Point::text(text,Utf16Offset(3))));
        let payload = generate_json_from_selected_nodes(tx.view(),"test",Some(&selection))?;
        assert_eq!(payload.namespace,"test");
        assert_eq!(payload.nodes,vec![serde_json::json!({"detail":0,"format":0,"mode":"normal","style":"","text":"😀","type":"text","version":1})]);
        assert_eq!(tx.text_content(text),"a😀z");
        let nodes = generate_nodes_from_serialized_nodes(tx,&payload.nodes)?;assert_ne!(nodes[0],p.key());
        Ok(())
    })?;
    Ok(())
}
#[test]
fn rich_import_prioritizes_namespace_and_tokenizes_plain_text() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_start(p)?;
        let entries = [
            ClipboardEntry {
                mime: MIME_LEXICAL,
                data: "{bad",
            },
            ClipboardEntry {
                mime: MIME_HTML,
                data: "a\tb\r\nc",
            },
            ClipboardEntry {
                mime: MIME_PLAIN,
                data: "a\tb\r\nc",
            },
        ];
        assert!(insert_data_transfer_for_rich_text(
            tx,
            "test",
            &entries,
            None,
            SelectionSlot::Active
        )?);
        assert_eq!(tx.text_content(NodeKey::ROOT), "a\tb\n\nc");
        assert_eq!(tx.children_size(NodeKey::ROOT), 2);
        assert!(tx.children_keys(p)?.iter().any(|key| tx.is::<Tab>(*key)));
        Ok(())
    })?;
    Ok(())
}

#[test]
fn unknown_internal_nodes_fall_back_and_null_export_keeps_plain_mime() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        assert_eq!(
            get_clipboard_data_from_selection(tx.view(), "test", None)?,
            indexmap::IndexMap::from([(MIME_PLAIN, String::new())])
        );
        let p = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_start(p)?;
        let entries = [
            ClipboardEntry {
                mime: MIME_LEXICAL,
                data: r#"{"namespace":"test","nodes":[{"type":"unknown","version":1}]}"#,
            },
            ClipboardEntry {
                mime: MIME_PLAIN,
                data: "fallback",
            },
        ];
        assert!(insert_data_transfer_for_rich_text(
            tx,
            "test",
            &entries,
            None,
            SelectionSlot::Active
        )?);
        assert_eq!(tx.text_content(p), "fallback");
        Ok(())
    })?;
    Ok(())
}
#[test]
fn insertion_typing_state_descends_into_preceding_inline_elements() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<crate::mark::MarkNode>()
        .build()
        .unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let mark = crate::mark::create_mark_node(tx, vec!["id".into()])?;
        let text = tx.create_text("bold")?;
        tx.text(text)?
            .set_format(TextFormat::BOLD)?
            .set_style("color: red;")?;
        tx.append(mark, &[text.key()])?;
        tx.append(p, &[mark])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        let point = Point::element(p, ChildIndex(1));
        tx.set_selection(Some(Selection::Range(RangeSelection::new(point, point))))?;
        insert_generated_nodes(tx, &[], SelectionSlot::Active)?;
        assert_eq!(tx.range_selection()?.format, TextFormat::BOLD);
        assert_eq!(tx.range_selection()?.style.as_ref(), "color: red;");
        Ok(())
    })?;
    Ok(())
}
#[test]
fn rich_drop_uses_the_supplied_target_namespace() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p=tx.create(Paragraph {})?;let text=tx.create_text("a")?;tx.append(p,&[text.key()])?;tx.append(NodeKey::ROOT,&[p.key()])?;tx.select_end(text)?;
        let entries=[ClipboardEntry{mime:MIME_LEXICAL,data:r#"{"namespace":"test","nodes":[{"detail":0,"format":1,"mode":"normal","style":"","text":"B","type":"text","version":1}]}"#},ClipboardEntry{mime:MIME_PLAIN,data:"wrong"}];
        let caret=TextPointCaret::new(tx.view(),text.key(),CaretDirection::Next,TextOffsetSpec::At(Utf16Offset(1)))?;
        assert_eq!(do_drop_in_namespace(tx,"test",caret.into(),false,true,&entries,None)?,DropOutcome::Handled);
        assert_eq!(tx.text_content(p),"aB");assert_eq!(tx.range_selection()?.format,TextFormat::BOLD);Ok(())
    })?;
    Ok(())
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct CloneAwareText {
    clones: u32,
}
impl NodeType for CloneAwareText {
    const TYPE: &'static str = "clone-aware-text";
    type Kind = TextKind;
    impl_default_node!();
    fn after_clone(&self) -> Option<Self> {
        Some(Self {
            clones: self.clones + 1,
        })
    }
}
impl TextNode for CloneAwareText {
    text_node_base!();
    fn adjust_export_json(
        &self,
        node: NodeView<'_>,
        json: &mut SerializedNode,
    ) -> Result<(), Error> {
        json.insert(
            "seenText".into(),
            Value::String(node.state.text_content(node.key).into_owned()),
        );
        Ok(())
    }
}
#[test]
fn sliced_copy_runs_clone_and_export_hooks_on_ephemeral_text() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<CloneAwareText>()
        .build()
        .unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let text = tx.create(CloneAwareText::default())?;
        tx.text(text)?.set_text_content("abcd")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        let range = Selection::Range(RangeSelection::new(
            Point::text(text, Utf16Offset(1)),
            Point::text(text, Utf16Offset(3)),
        ));
        let payload = generate_json_from_selected_nodes(tx.view(), "test", Some(&range))?;
        assert_eq!(payload.nodes[0]["text"], "bc");
        assert_eq!(payload.nodes[0]["seenText"], "bc");
        assert_eq!(payload.nodes[0]["clones"], 1);
        assert_eq!(tx.get_or_err::<CloneAwareText>(text)?.clones, 0);
        assert_eq!(tx.text_content(text), "abcd");
        Ok(())
    })?;
    Ok(())
}

#[cfg(feature = "html")]
#[test]
fn html_clipboard_uses_selected_slice_and_default_mime_order() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let text = tx.create_text("abcd")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        let selection = Selection::Range(RangeSelection::new(
            Point::text(text, Utf16Offset(1)),
            Point::text(text, Utf16Offset(3)),
        ));
        let data = get_clipboard_data_from_selection(tx.view(), "test", Some(&selection))?;
        assert_eq!(
            data.keys().copied().collect::<Vec<_>>(),
            vec![MIME_PLAIN, MIME_HTML, MIME_LEXICAL]
        );
        assert_eq!(
            data[MIME_HTML],
            "<span style=\"white-space:pre-wrap\">bc</span>"
        );
        let collapsed =
            Selection::Range(RangeSelection::collapsed(Point::text(text, Utf16Offset(1))));
        let data = get_clipboard_data_from_selection(tx.view(), "test", Some(&collapsed))?;
        assert_eq!(data[MIME_HTML], "");
        Ok(())
    })?;
    Ok(())
}
