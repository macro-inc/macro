use super::*;
#[test]
fn stored_highlights_round_trip_without_tokenizing_or_merging() -> Result<(), Error> {
    let mut editor = crate::code::register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    let json = r#"{"root":{"children":[{"children":[{"detail":1,"format":0,"mode":"normal","style":"color:red","text":"let","type":"code-highlight","version":1,"$":{"marker":3},"highlightType":"keyword"},{"detail":0,"format":0,"mode":"normal","style":"","text":"x","type":"code-highlight","version":1,"highlightType":"variable"}],"direction":null,"format":"","indent":0,"type":"code","version":1,"language":"rust"}],"direction":null,"format":"","indent":0,"type":"root","version":1}}"#;
    let state = editor.parse_editor_state_str(json)?;
    assert_eq!(
        to_js_json_string(&serde_json::to_value(state.to_json()?).unwrap()),
        json
    );
    editor.set_editor_state(state, TagSet::default())?;
    editor.update(|tx| {
        let code = tx.first_child(NodeKey::ROOT).unwrap();
        let first = tx.first_child(code).unwrap();
        assert!(is_code_highlight_node(tx, first));
        assert!(!tx.is_simple_text(first));
        tx.text(first)?.set_format(TextFormat::BOLD)?;
        assert_eq!(tx.text_data(first)?.format, TextFormat::empty());
        Ok(())
    })?;
    let code = editor.state().view().first_child(NodeKey::ROOT).unwrap();
    assert_eq!(editor.state().view().children_size(code), 2);
    Ok(())
}
#[test]
fn importing_highlight_forces_zero_format_and_orphans_become_plain_text() -> Result<(), Error> {
    let mut editor = crate::code::register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let highlight = tx.import_node(serde_json::json!({"type":"code-highlight","version":1,"text":"stored","format":3,"detail":0,"mode":"normal","style":"color:red","highlightType":"keyword"}).as_object().unwrap())?;
        assert_eq!(tx.text_data(highlight)?.format, TextFormat::empty());
        assert!(tx.is_parent_required(highlight));
        let wrapper = tx.create_parent_element(highlight)?;
        assert!(tx.is::<CodeNode>(wrapper));
        tx.append(paragraph, &[highlight])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(())
    })?;
    let view = editor.state().view();
    let plain = view.first_descendant(NodeKey::ROOT).unwrap();
    assert_eq!(view.type_name(plain)?, "text");
    assert_eq!(view.text_content(plain), "stored");
    assert_eq!(view.text_data(plain)?.style.as_ref(), "");
    Ok(())
}

#[test]
fn range_formatting_invokes_highlight_noop_but_updates_selection_format() -> Result<(), Error> {
    let mut actual = Vec::new();
    let mut expected = Vec::new();
    for mode in ["full", "partial", "first-element", "last-element"] {
        let mut editor = crate::code::register_code_nodes(Editor::builder(EditorMode::Headless))
            .build()
            .expect("builder");
        let ((code, first, last), _) = editor.update(|tx| {
            let code = tx.create(CodeNode::default())?.key();
            let first = tx.create(CodeHighlightNode::default())?.key();
            tx.text(first)?.set_text_content("abcd")?;
            tx.append(code, &[first])?;
            let mut last = first;
            if mode == "first-element" || mode == "last-element" {
                let middle = tx.create_text("b")?.key();
                tx.text(middle)?.set_format(TextFormat::ITALIC)?;
                last = tx.create(CodeHighlightNode::default())?.key();
                tx.text(last)?.set_text_content("cc")?;
                tx.append(code, &[middle, last])?;
            }
            tx.append(NodeKey::ROOT, &[code])?;
            Ok((code, first, last))
        })?;
        editor.update(|tx| {
            let anchor = match mode {
                "first-element" => Point::element(code, ChildIndex(0)),
                "partial" | "last-element" => Point::text(first, Utf16Offset(1)),
                _ => Point::text(first, Utf16Offset(0)),
            };
            let focus = match mode {
                "last-element" => Point::element(code, ChildIndex(3)),
                "first-element" => Point::text(last, Utf16Offset(1)),
                "partial" => Point::text(first, Utf16Offset(3)),
                _ => Point::text(first, Utf16Offset(4)),
            };
            tx.set_selection(Some(Selection::Range(RangeSelection::new(anchor, focus))))?;
            tx.format_text(TextFormatType::Bold, None)?;
            Ok(())
        })?;
        let state = editor.state();
        let view = state.view();
        let children: Vec<_> = view.children(code).collect();
        let fields: Vec<_> = children
            .iter()
            .map(|key| {
                let text = view.text(*key).expect("text child");
                format!(
                    "{}:{}:{}",
                    view.type_name(*key).expect("type"),
                    view.text_content(*key),
                    text.format.bits()
                )
            })
            .collect();
        let range = state
            .selection()
            .and_then(Selection::as_range)
            .expect("range");
        actual.push((
            fields,
            range.anchor.point_type(),
            view.index_within_parent(range.anchor.key()),
            range.anchor.offset(),
            range.focus.point_type(),
            view.index_within_parent(range.focus.key()),
            range.focus.offset(),
            range.format,
        ));
        let (fields, anchor, focus) = match mode {
            "full" => (vec!["code-highlight:abcd:0"], (0, 0), (0, 4)),
            "partial" => (
                vec!["code-highlight:a:0", "text:bc:1", "text:d:0"],
                (1, 0),
                (1, 2),
            ),
            "first-element" => (
                vec![
                    "code-highlight:abcd:0",
                    "text:b:3",
                    "code-highlight:c:0",
                    "text:c:0",
                ],
                (0, 0),
                (2, 1),
            ),
            "last-element" => (
                vec![
                    "code-highlight:a:0",
                    "text:bcd:1",
                    "text:b:3",
                    "code-highlight:cc:0",
                ],
                (1, 0),
                (3, 2),
            ),
            _ => unreachable!(),
        };
        expected.push((
            fields.into_iter().map(str::to_owned).collect::<Vec<_>>(),
            PointType::Text,
            Some(ChildIndex(anchor.0)),
            anchor.1,
            PointType::Text,
            Some(ChildIndex(focus.0)),
            focus.1,
            TextFormat::BOLD,
        ));
    }
    assert_eq!(actual, expected);
    Ok(())
}
