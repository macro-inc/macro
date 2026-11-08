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
        json!({"request":23,"plainOnly":false,"hasFileEntries":true,"mobileImageRecovery":false})
            .to_string(),
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
