use super::*;
use crate::{EditorType, surface};
use lexical_rich_nodes::{heading::HeadingNode, quote::QuoteNode};

#[test]
fn plain_markdown_paste_imports_structure_through_a_registry_only_parser() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_start(p)?;
        Ok(())
    })?;
    let mut payload = ClipboardPayload::default();
    payload
        .data
        .insert("text/plain".into(), "# Title\n\n**strong** body".into());
    assert_eq!(editor.dispatch(&Command::Paste(payload))?.0, Handled::Yes);
    let state = editor.state().view();
    let blocks = state.children_keys(NodeKey::ROOT)?;
    assert!(state.is::<HeadingNode>(*blocks.first().expect("heading")));
    assert_eq!(
        state.text_content(*blocks.first().expect("heading")),
        "Title"
    );
    assert!(state.all_text_nodes(NodeKey::ROOT).any(|key| {
        state.text_content(key) == "strong"
            && state
                .text(key)
                .is_some_and(|text| text.format.contains(TextFormat::BOLD))
    }));
    Ok(())
}

#[test]
fn file_request_preempts_markdown_without_mutating_document_text() -> Result<(), Error> {
    use serde_json::json;
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("keep")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(text)?;
        Ok(())
    })?;
    let before = editor.state().to_json()?;
    let mut payload = ClipboardPayload {
        has_files: true,
        ..ClipboardPayload::default()
    };
    payload
        .data
        .insert("text/plain".into(), "# file content".into());
    payload.data.insert(
        "application/x-macro-paste-facts".into(),
        json!({"request":23,"hasFileEntries":true,"mobileImageRecovery":false}).to_string(),
    );
    let (handled, commit) = editor.dispatch(&Command::Paste(payload))?;
    assert_eq!(handled, Handled::Yes);
    assert_eq!(editor.state().to_json()?, before);
    let event = commit.events.first().expect("host request");
    assert_eq!(event.name(), "group-b.file-paste");
    assert_eq!(surface::event_payload(event)?, Some(json!({"request":23})));
    Ok(())
}

#[test]
fn clipboard_paragraphs_inserted_inside_quotes_keep_all_paragraphs_as_quotes() -> Result<(), Error>
{
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (handled, _) = editor.update(|tx| {
        let quote = tx.create(QuoteNode::default())?;
        let text = tx.create_text("prefix ")?;
        tx.append(quote, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[quote.key()])?;
        tx.select_end(text)?;
        let first = tx.create(Paragraph::default())?;
        let second = tx.create(Paragraph::default())?;
        let a = tx.create_text("one")?;
        let b = tx.create_text("two")?;
        tx.text(b)?.set_format(TextFormat::BOLD)?;
        tx.append(first, &[a.key()])?;
        tx.append(second, &[b.key()])?;
        tx.dispatch(&Command::InsertClipboardNodes {
            nodes: vec![first.key(), second.key()],
            selection: SelectionSlot::Active,
        })
    })?;
    assert_eq!(handled, Handled::Yes);
    let state = editor.state().view();
    assert!(
        state
            .children_keys(NodeKey::ROOT)?
            .iter()
            .all(|key| state.is::<QuoteNode>(*key))
    );
    assert_eq!(state.text_content(NodeKey::ROOT), "prefix one\n\ntwo");
    assert!(state.all_text_nodes(NodeKey::ROOT).any(|key| {
        state.text_content(key) == "two"
            && state
                .text(key)
                .is_some_and(|text| text.format.contains(TextFormat::BOLD))
    }));
    Ok(())
}

#[test]
fn captured_plain_paste_intent_yields_before_markdown_insertion() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_start(paragraph)?;
        Ok(())
    })?;
    let mut payload = ClipboardPayload {
        intent: PasteIntent { plain_only: true },
        ..ClipboardPayload::default()
    };
    payload
        .data
        .insert("text/plain".into(), "**literal**".into());
    let before = editor.state().to_json()?;
    assert_eq!(editor.dispatch(&Command::Paste(payload))?.0, Handled::No);
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}

#[test]
fn clipboard_file_facts_cannot_supply_plain_paste_intent() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_start(paragraph)?;
        Ok(())
    })?;
    let mut payload = ClipboardPayload::default();
    payload
        .data
        .insert("text/plain".into(), "**strong**".into());
    payload.data.insert(
        PASTE_FACTS_MIME.into(),
        serde_json::json!({
            "request": 0,
            "plainOnly": true,
            "hasFileEntries": false,
            "mobileImageRecovery": false
        })
        .to_string(),
    );
    assert_eq!(editor.dispatch(&Command::Paste(payload))?.0, Handled::Yes);
    let state = editor.state().view();
    assert_eq!(state.text_content(NodeKey::ROOT), "strong");
    assert!(state.all_text_nodes(NodeKey::ROOT).any(|key| {
        state.text_content(key) == "strong"
            && state
                .text(key)
                .is_some_and(|text| text.format.contains(TextFormat::BOLD))
    }));
    Ok(())
}

#[test]
fn captured_plain_paste_intent_leaves_html_for_rich_text_insertion() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_start(paragraph)?;
        Ok(())
    })?;
    let mut payload = ClipboardPayload {
        intent: PasteIntent { plain_only: true },
        html_nodes: Some(vec![
            serde_json::json!({
                "type": "paragraph", "version": 1,
                "children": [{"type": "text", "version": 1, "text": "rich", "format": 1}]
            })
            .as_object()
            .expect("paragraph")
            .clone(),
        ]),
        ..ClipboardPayload::default()
    };
    payload
        .data
        .insert("text/plain".into(), "**literal**".into());
    payload
        .data
        .insert("text/html".into(), "<p><strong>rich</strong></p>".into());
    let before = editor.state().to_json()?;
    assert_eq!(editor.dispatch(&Command::Paste(payload))?.0, Handled::No);
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}

#[test]
fn source_rich_clipboard_into_code_preserves_flat_content_and_caret() -> Result<(), Error> {
    use crate::nodes::CustomCodeNode;
    use lexical_rich_nodes::clipboard::{
        ClipboardEntry, MIME_LEXICAL, insert_data_transfer_for_rich_text,
    };

    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (code, _) = editor.update(|tx| {
        let code = tx.create(CustomCodeNode::default())?;
        let linebreak = tx.create(LineBreak {})?;
        let text = tx.create_text("const installCheck = \"durable\";")?;
        let trailing = tx.create(Paragraph::default())?;
        tx.append(code, &[linebreak.key(), text.key()])?;
        tx.append(NodeKey::ROOT, &[code.key(), trailing.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
            Point::element(code.key(), ChildIndex(1)),
        ))))?;
        Ok(code.key())
    })?;
    let (handled, _) = editor.update(|tx| {
        insert_data_transfer_for_rich_text(
            tx,
            "block-md-main_2",
            &[ClipboardEntry {
                mime: MIME_LEXICAL,
                data: include_str!("clipboard/code-paste-source.json"),
            }],
            None,
            SelectionSlot::Active,
        )
    })?;
    assert!(handled);

    // Trusted Source click, Ctrl+End, Enter, then a rich-only clipboard event.
    let state = editor.state().view();
    let root = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(root.len(), 2);
    assert_eq!(root[0], code);
    assert!(state.is::<Paragraph>(root[1]));
    assert!(state.is_empty(root[1]));
    let children = state.children_keys(code)?;
    assert!(
        children
            .iter()
            .all(|key| state.is_line_break(*key) || matches!(state.type_name(*key), Ok("text"))),
        "rich clipboard children must flatten into code runs"
    );
    assert_eq!(
        state.text_content(code),
        concat!(
            "\nInstall heading\n\nInstall list item\n\nInstall checked item\n\n",
            "const persistedValue = \"durable 😀\";\n\nInstall cell 1\n\nInstall cell 2\n\n",
            "Install cell 3\n\nInstall cell 4\n\nInstall quote\n\nInstall link\n\n",
            "Install end\n\nconst installCheck = \"durable\";"
        )
    );
    let caret = state
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    let point = Point::text(children[1], Utf16Offset(10));
    assert_eq!(caret.anchor, point);
    assert_eq!(caret.focus, point);
    Ok(())
}
