use super::*;
use crate::nodes::{CustomCodeNode, create_custom_code_node, set_custom_code};
use crate::{EditorType, surface};

#[test]
fn code_preview_commands_keep_the_node_and_delete_to_a_live_following_caret() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (code, _) = editor.update(|tx| {
        let code = create_custom_code_node(tx, Some("svg"))?;
        set_custom_code(tx, code, Some("svg"), "<svg/>")?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        tx.select_end(code)?;
        Ok(code)
    })?;
    let command = decode_command(
        "group-b.code",
        &format!(
            "{{\"action\":\"preview\",\"key\":{},\"enabled\":true}}",
            code.key().index()
        ),
        code.key().generation(),
        None,
    )?
    .expect("code command");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    assert!(
        editor
            .state()
            .view()
            .get::<CustomCodeNode>(code)
            .expect("code")
            .preview_enabled
    );
    let command = decode_command(
        "group-b.code",
        &format!(
            "{{\"action\":\"language\",\"key\":{},\"language\":\"rust\"}}",
            code.key().index()
        ),
        code.key().generation(),
        None,
    )?
    .expect("language command");
    editor.dispatch(&command)?;
    assert_eq!(
        editor
            .state()
            .view()
            .get::<CustomCodeNode>(code)
            .expect("code")
            .code
            .language(),
        Some("rust")
    );
    assert!(
        !editor
            .state()
            .view()
            .get::<CustomCodeNode>(code)
            .expect("code")
            .preview_enabled
    );
    let command = decode_command(
        "group-b.code",
        &format!("{{\"action\":\"delete\",\"key\":{}}}", code.key().index()),
        code.key().generation(),
        None,
    )?
    .expect("delete command");
    editor.dispatch(&command)?;
    let state = editor.state().view();
    let blocks = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(blocks.len(), 1);
    assert!(state.is::<Paragraph>(blocks[0]));
    assert_eq!(
        state.top_level_element(
            editor
                .state()
                .selection()
                .and_then(Selection::as_range)
                .expect("selection")
                .anchor
                .key()
        )?,
        Some(blocks[0])
    );
    Ok(())
}

#[test]
fn code_select_all_escalates_only_when_its_complete_text_is_already_selected() -> Result<(), Error>
{
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (code, _) = editor.update(|tx| {
        let code = create_custom_code_node(tx, Some("rust"))?;
        set_custom_code(tx, code, Some("rust"), "let n = 1;")?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        tx.select_start(code)?;
        Ok(code)
    })?;
    assert_eq!(editor.dispatch(&Command::SelectAll(None))?.0, Handled::Yes);
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.text_content(editor.state().view())?, "let n = 1;");
    assert_eq!(range.anchor.key(), code.key());
    assert_eq!(editor.dispatch(&Command::SelectAll(None))?.0, Handled::No);
    Ok(())
}

#[test]
fn tab_in_code_inserts_a_literal_tab_and_keeps_block_indentation_zero() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (code, _) = editor.update(|tx| {
        let code = create_custom_code_node(tx, Some("rust"))?;
        set_custom_code(tx, code, Some("rust"), "value")?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        tx.select_start(code)?;
        Ok(code)
    })?;
    editor.dispatch(&Command::Key {
        command: KeyCommand::Tab,
        event: Some(KeyEvent::default()),
    })?;
    assert_eq!(editor.state().view().text_content(code), "\tvalue");
    assert_eq!(editor.state().view().indent(code), 0);
    Ok(())
}

#[test]
fn code_edge_arrows_insert_a_caret_before_the_first_block_and_leave_middle_lines_native()
-> Result<(), Error> {
    use lexical_rich_nodes::code::CodeHighlightNode;
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (code, highlight) = editor
        .update(|tx| {
            let code = create_custom_code_node(tx, Some("rust"))?;
            let highlight = tx.create(CodeHighlightNode::default())?;
            tx.text(highlight)?.set_text_content("first")?;
            let middle = tx.create(CodeHighlightNode::default())?;
            tx.text(middle)?.set_text_content("middle")?;
            let last = tx.create(CodeHighlightNode::default())?;
            tx.text(last)?.set_text_content("last")?;
            let br = tx.create(LineBreak {})?;
            let br2 = tx.create(LineBreak {})?;
            tx.append(
                code,
                &[
                    highlight.key(),
                    br.key(),
                    middle.key(),
                    br2.key(),
                    last.key(),
                ],
            )?;
            tx.append(NodeKey::ROOT, &[code.key()])?;
            tx.select_start(middle)?;
            Ok((code, highlight))
        })?
        .0;
    let up = Command::KeyDown(KeyEvent {
        key: "ArrowUp".into(),
        ..KeyEvent::default()
    });
    assert_eq!(editor.dispatch(&up)?.0, Handled::No);
    assert_eq!(
        editor.state().view().first_child(NodeKey::ROOT),
        Some(code.key())
    );
    editor.update(|tx| tx.select_start(code))?;
    assert_eq!(editor.dispatch(&up)?.0, Handled::Yes);
    let state = editor.state().view();
    let first = state.first_child(NodeKey::ROOT).expect("caret block");
    assert!(state.is::<Paragraph>(first));
    assert_eq!(
        editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("caret")
            .anchor
            .key(),
        code.key()
    );
    editor.update(|tx| tx.select_start(highlight))?;
    assert_eq!(editor.dispatch(&up)?.0, Handled::Yes);
    assert_eq!(editor.state().view().children_keys(NodeKey::ROOT)?.len(), 3);
    Ok(())
}

#[test]
fn fresh_code_text_uses_edge_navigation_without_model_highlight_nodes() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (code, text) = editor
        .update(|tx| {
            let code = create_custom_code_node(tx, Some("rust"))?;
            set_custom_code(tx, code, Some("rust"), "let n = 1;")?;
            tx.append(NodeKey::ROOT, &[code.key()])?;
            let text = tx.first_child(code).expect("plain code text");
            assert_eq!(tx.type_name(text)?, "text");
            tx.select_start(text)?;
            Ok((code, text))
        })?
        .0;
    assert_eq!(
        editor
            .dispatch(&Command::KeyDown(KeyEvent {
                key: "ArrowUp".into(),
                ..KeyEvent::default()
            }))?
            .0,
        Handled::Yes
    );
    assert!(
        editor.state().view().is::<Paragraph>(
            editor
                .state()
                .view()
                .first_child(NodeKey::ROOT)
                .expect("leading paragraph")
        )
    );
    assert_eq!(editor.state().view().parent(text), Some(code.key()));
    assert_eq!(editor.state().view().type_name(text)?, "text");
    Ok(())
}

#[test]
fn code_transform_normalizes_programmatic_nested_insertions_and_keeps_source_caret_policy()
-> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((first, second, outside), _) = editor.update(|tx| {
        let first = create_custom_code_node(tx, Some("plaintext"))?;
        let second = create_custom_code_node(tx, Some("plaintext"))?;
        let paragraph = tx.create(Paragraph::default())?;
        let outside = tx.create_text("outside")?;
        tx.append(paragraph, &[outside.key()])?;
        tx.append(NodeKey::ROOT, &[first.key(), second.key(), paragraph.key()])?;
        tx.text(outside)?
            .select(Some(Utf16Offset(2)), Some(Utf16Offset(2)))?;
        Ok((first.key(), second.key(), outside.key()))
    })?;
    editor.update(|tx| {
        for (code, value) in [(first, "one\n\tvalue"), (second, "second")] {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text(value)?;
            tx.append(paragraph, &[text.key()])?;
            tx.append(code, &[paragraph.key()])?;
        }
        tx.text(outside)?
            .select(Some(Utf16Offset(2)), Some(Utf16Offset(2)))
    })?;
    let state = editor.state().view();
    assert_eq!(state.text_content(first), "one\n\tvalue");
    assert_eq!(state.text_content(second), "second");
    for code in [first, second] {
        assert!(
            state
                .children(code)
                .all(|child| { state.is_text(child) || state.is_line_break(child) })
        );
    }
    // Source's normalizer also moves an unrelated caret into the last dirty code.
    let caret = state
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    let selected = state.first_child(second).expect("normalized code text");
    assert_eq!(caret.anchor, Point::text(selected, Utf16Offset(2)));
    assert_eq!(caret.focus, caret.anchor);

    let before = editor.state().to_json()?;
    let children_before = editor.state().view().children_keys(first)?;
    let selection_before = editor.state().selection().cloned();
    let (_, commit) = editor.update(|tx| tx.mark_dirty(first))?;
    // mark_dirty clones its requested record. The normalizer must add no
    // mutations, child replacement, or selection changes on this second pass.
    assert_eq!(
        commit
            .changes
            .mutations
            .iter()
            .map(|(key, mutation)| (*key, *mutation))
            .collect::<Vec<_>>(),
        vec![(first, Mutation::Updated)]
    );
    assert_eq!(editor.state().view().children_keys(first)?, children_before);
    assert_eq!(editor.state().selection(), selection_before.as_ref());
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}

#[test]
fn code_transform_keeps_the_original_element_after_linebreak_and_valid_negative_edge_caret()
-> Result<(), Error> {
    for caret_kind in ["outside text", "outside element", "replaced text"] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("surface");
        let ((code, paragraph, outside), _) = editor.update(|tx| {
            let code = create_custom_code_node(tx, Some("plaintext"))?;
            let linebreak = tx.create(LineBreak {})?;
            let text = tx.create_text("base")?;
            tx.append(code, &[linebreak.key(), text.key()])?;
            let paragraph = tx.create(Paragraph::default())?;
            let outside = tx.create_text("outside")?;
            tx.append(paragraph, &[outside.key()])?;
            tx.append(NodeKey::ROOT, &[code.key(), paragraph.key()])?;
            tx.select_start(outside)?;
            Ok((code.key(), paragraph.key(), outside.key()))
        })?;
        editor.update(|tx| {
            let nested = tx.create(Paragraph::default())?;
            let text = tx.create_text("nested")?;
            tx.append(nested, &[text.key()])?;
            tx.append(code, &[nested.key()])?;
            match caret_kind {
                "outside element" => tx
                    .element(paragraph)?
                    .select(Some(ChildIndex(1)), Some(ChildIndex(1))),
                "replaced text" => tx.select_start(text),
                _ => tx.select_start(outside),
            }
        })?;
        let state = editor.state().view();
        assert_eq!(state.text_content(code), "\nbasenested");
        assert_eq!(state.children_size(code), 2);
        let caret = state
            .selection()
            .and_then(Selection::as_range)
            .expect("range");
        // Source's element arm restores the original element, even outside code.
        // Its text arm produces invalid offset -1 here. Native keeps the valid
        // existing caret while still applying the same content normalization.
        if caret_kind == "replaced text" {
            for point in [caret.anchor, caret.focus] {
                assert!(state.is_attached(point.key()));
                match point {
                    Point::Text { key, offset } => assert!(offset <= state.text_content_size(key)),
                    Point::Element { key, offset } => assert!(offset.0 <= state.children_size(key)),
                }
            }
        } else {
            let expected = if caret_kind == "outside element" {
                Point::element(paragraph, ChildIndex(1))
            } else {
                Point::text(outside, Utf16Offset::ZERO)
            };
            assert_eq!(caret.anchor, expected);
            assert_eq!(caret.focus, expected);
        }
    }
    Ok(())
}

// Source: @lexical/code-prism $codeNodeTransform sets tokenizer.defaultLanguage on a
// code node whose language is undefined; Macro sets PrismTokenizer.defaultLanguage to
// 'plaintext'. Only editors that register code highlighting run it.
fn code_language(editor: &Editor, key: NodeKey) -> Option<String> {
    editor
        .state()
        .view()
        .get::<lexical_rich_nodes::code::CodeNode>(key)
        .and_then(|code| code.language().map(str::to_owned))
}

#[test]
fn view_attached_body_defaults_an_unset_code_language_to_plaintext() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (unset, _) = editor.update(|tx| {
        let code = lexical_rich_nodes::code::create_code_node(tx, None, None)
            .map_err(|_| Error::Invariant("create code node"))?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        Ok(code.key())
    })?;
    assert_eq!(code_language(&editor, unset).as_deref(), Some("plaintext"));
    let (explicit, _) = editor.update(|tx| {
        let code = lexical_rich_nodes::code::create_code_node(tx, Some("rust"), None)
            .map_err(|_| Error::Invariant("create code node"))?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        Ok(code.key())
    })?;
    assert_eq!(code_language(&editor, explicit).as_deref(), Some("rust"));
    let (imported, _) = editor.update(|tx| {
        let json = serde_json::json!({
            "type": "custom-code", "version": 1, "format": "", "indent": 0,
            "direction": null, "children": [], "previewEnabled": false
        });
        let code = tx.import_node(json.as_object().expect("object"))?;
        tx.append(NodeKey::ROOT, &[code])?;
        Ok(code)
    })?;
    assert_eq!(
        code_language(&editor, imported).as_deref(),
        Some("plaintext")
    );
    Ok(())
}

#[test]
fn headless_surfaces_leave_an_unset_code_language_unset() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::Headless)
            .build()
            .expect("surface");
    let (code, _) = editor.update(|tx| {
        let code = lexical_rich_nodes::code::create_code_node(tx, None, None)
            .map_err(|_| Error::Invariant("create code node"))?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        Ok(code.key())
    })?;
    assert_eq!(code_language(&editor, code), None);
    Ok(())
}

// Source opens documents with setEditorState, which runs no transforms: a loaded code
// node keeps its unset language until a local update dirties it (open.ts receipt).
#[test]
fn opening_a_document_leaves_an_unset_code_language_until_a_local_edit() -> Result<(), Error> {
    let state: SerializedEditorState = serde_json::from_value(serde_json::json!({"root": {
        "type": "root", "version": 1, "format": "", "indent": 0, "direction": null,
        "children": [{
            "type": "custom-code", "version": 1, "format": "", "indent": 0,
            "direction": null, "previewEnabled": false,
            "children": [{"type": "text", "version": 1, "text": "plain block", "format": 0,
                "detail": 0, "mode": "normal", "style": ""}]
        }]
    }}))?;
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .initial_state(state)
            .build()
            .expect("surface");
    let code = editor.state().view().children_keys(NodeKey::ROOT)?[0];
    assert_eq!(code_language(&editor, code), None);
    let text = editor.state().view().children_keys(code)?[0];
    editor.update(|tx| {
        tx.text(text)?.set_text_content("plain blocky")?;
        Ok(())
    })?;
    assert_eq!(code_language(&editor, code).as_deref(), Some("plaintext"));
    Ok(())
}

// Source $codeNodeTransform also calls setIsSyntaxHighlightSupported on every run;
// the host learns each run through a typed event and checks its own grammar table.
#[test]
fn every_code_transform_run_reports_its_language_to_the_host() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (code, commit) = editor.update(|tx| {
        let code = lexical_rich_nodes::code::create_code_node(tx, None, None)
            .map_err(|_| Error::Invariant("create code node"))?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        Ok(code.key())
    })?;
    // Setting the default re-dirties the node, so the transform (and report) repeats.
    let reported: Vec<_> = commit.events_of(&code::CODE_HIGHLIGHT).cloned().collect();
    assert!(!reported.is_empty());
    for report in reported {
        assert_eq!(
            report,
            code::CodeHighlight {
                key: code.index(),
                generation: code.generation(),
                language: Some("plaintext".to_owned()),
            }
        );
    }
    let event = commit
        .events
        .iter()
        .find_map(|event| event_payload(event).transpose())
        .transpose()?;
    assert_eq!(
        event,
        Some(serde_json::json!({
            "key": code.index(), "generation": code.generation(), "language": "plaintext"
        }))
    );
    Ok(())
}
