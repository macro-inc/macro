#![cfg(feature = "application")]

use document_session::register_editor_commands;
use lexical_model::*;
use lexical_rich_nodes::quote::QuoteNode;
use macro_document_model::{EditorType, surface};
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

struct ClipboardCalls(Arc<AtomicUsize>);

impl CommandListener for ClipboardCalls {
    fn handle(&self, _tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        if matches!(command, Command::InsertClipboardNodes { .. }) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
        Ok(Handled::No)
    }
}

#[derive(Clone, Copy, Debug)]
enum PasteKind {
    Heading,
    Checklist,
    Quote,
    Markdown,
    Internal,
}

fn paste_after_pending_format(kind: PasteKind, inside_quote: bool) -> Result<(), Error> {
    for pending in [
        TextFormat::BOLD,
        TextFormat::ITALIC,
        TextFormat::STRIKETHROUGH,
        TextFormat::UNDERLINE,
        TextFormat::CODE,
        TextFormat::SUBSCRIPT,
        TextFormat::SUPERSCRIPT,
        TextFormat::HIGHLIGHT,
        TextFormat::LOWERCASE,
        TextFormat::UPPERCASE,
        TextFormat::CAPITALIZE,
    ] {
        let mut editor = register_editor_commands(surface::preset_builder_with_mode(
            EditorType::MarkdownSync,
            EditorMode::ViewAttached,
        ))
        .build()
        .expect("actual application surface registry");
        let calls = Arc::new(AtomicUsize::new(0));
        editor.register_command_listener(
            CommandRegistration {
                command: CommandKind::InsertClipboardNodes,
                priority: CommandPriority::High,
                placement: Placement::After,
            },
            Arc::new(ClipboardCalls(calls.clone())),
        );
        editor.update(|tx| {
            let block = if inside_quote {
                tx.create(QuoteNode::default())?.key()
            } else {
                tx.create(Paragraph {})?.key()
            };
            tx.append(NodeKey::ROOT, &[block])?;
            tx.select_start(block)?;
            tx.set_selection_format(pending)?;
            tx.set_selection_style("color: red;")?;
            Ok(())
        })?;
        let text = json!({
            "type":"text", "version":1, "text":"pasted", "format":0,
            "detail":0, "mode":"normal", "style":""
        });
        let node = match kind {
            PasteKind::Heading => json!({
                "type":"heading", "version":1, "tag":"h2", "children":[text]
            }),
            PasteKind::Checklist => json!({
                "type":"list", "version":1, "listType":"check", "start":1,
                "children":[{
                    "type":"listitem", "version":1, "value":1, "checked":true,
                    "children":[text]
                }]
            }),
            PasteKind::Quote => json!({"type":"quote", "version":1, "children":[text]}),
            PasteKind::Markdown | PasteKind::Internal => {
                json!({"type":"paragraph", "version":1, "children":[text]})
            }
        };
        let payload = match kind {
            PasteKind::Markdown => ClipboardPayload {
                data: [("text/plain".into(), "pasted".into())]
                    .into_iter()
                    .collect(),
                ..ClipboardPayload::default()
            },
            PasteKind::Internal => ClipboardPayload {
                data: [(
                    "application/x-lexical-editor".into(),
                    json!({"namespace":"document-session", "nodes":[node]}).to_string(),
                )]
                .into_iter()
                .collect(),
                ..ClipboardPayload::default()
            },
            _ => ClipboardPayload {
                data: [("text/html".into(), "<p>pasted</p>".into())]
                    .into_iter()
                    .collect(),
                html_nodes: Some(vec![node.as_object().expect("DOM draft").clone()]),
                ..ClipboardPayload::default()
            },
        };
        let (handled, _) = editor.dispatch(&Command::Paste(payload))?;
        assert_eq!(handled, Handled::Yes, "{kind:?}, pending {pending:?}");
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "{kind:?}, pending {pending:?}"
        );
        let selection = editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("pasted range");
        assert!(selection.is_collapsed());
        assert_eq!(
            selection.format,
            TextFormat::empty(),
            "{kind:?}, pending {pending:?}"
        );
        assert_eq!(
            selection.style.as_ref(),
            "",
            "{kind:?}, pending {pending:?}"
        );
        let anchor = selection.anchor;
        let Point::Text { key, offset } = anchor else {
            panic!("paste must end in the actual inserted text: {anchor:?}");
        };
        assert_eq!(offset, Utf16Offset(6));
        assert_eq!(
            editor.state().view().text_data(key)?.text.as_str(),
            "pasted"
        );
        editor.update(|tx| tx.insert_text("z"))?;
        let range = editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("typed range");
        assert_eq!(range.anchor, Point::text(key, Utf16Offset(7)));
        let data = editor.state().view().text_data(key)?;
        assert_eq!(data.text.as_str(), "pastedz");
        assert_eq!(data.format, TextFormat::empty());
        assert_eq!(data.style.as_ref(), "");
    }
    Ok(())
}

#[test]
fn heading_paste_replaces_every_pending_typing_format() -> Result<(), Error> {
    paste_after_pending_format(PasteKind::Heading, false)
}

#[test]
fn checklist_paste_replaces_every_pending_typing_format() -> Result<(), Error> {
    paste_after_pending_format(PasteKind::Checklist, false)
}

#[test]
fn quote_paste_replaces_every_pending_typing_format() -> Result<(), Error> {
    paste_after_pending_format(PasteKind::Quote, false)
}

#[test]
fn markdown_paste_replaces_every_pending_typing_format() -> Result<(), Error> {
    paste_after_pending_format(PasteKind::Markdown, false)
}

#[test]
fn internal_paste_replaces_every_pending_typing_format() -> Result<(), Error> {
    paste_after_pending_format(PasteKind::Internal, false)
}

#[test]
fn paragraph_paste_inside_quote_replaces_every_pending_typing_format() -> Result<(), Error> {
    paste_after_pending_format(PasteKind::Internal, true)
}

#[test]
fn rich_paste_inherits_the_inserted_format_and_style_instead_of_resetting_to_plain()
-> Result<(), Error> {
    for html in [false, true] {
        let mut editor = register_editor_commands(surface::preset_builder_with_mode(
            EditorType::MarkdownSync,
            EditorMode::ViewAttached,
        ))
        .build()
        .expect("actual application surface registry");
        editor.update(|tx| {
            let p = tx.create(Paragraph {})?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_start(p)?;
            tx.set_selection_format(TextFormat::UNDERLINE)?;
            tx.set_selection_style("color: red;")
        })?;
        let inserted_style = if html { "" } else { "color: blue;" };
        let draft = json!({"type":"paragraph", "version":1, "children":[{
            "type":"text", "version":1, "text":"styled", "format":3,
            "style":inserted_style, "mode":"normal", "detail":0
        }]});
        let payload = if html {
            ClipboardPayload {
                data: [("text/html".into(), "<p><b><i>styled</i></b></p>".into())]
                    .into_iter()
                    .collect(),
                html_nodes: Some(vec![draft.as_object().expect("draft").clone()]),
                ..ClipboardPayload::default()
            }
        } else {
            ClipboardPayload {
                data: [(
                    "application/x-lexical-editor".into(),
                    json!({"namespace":"document-session", "nodes":[draft]}).to_string(),
                )]
                .into_iter()
                .collect(),
                ..ClipboardPayload::default()
            }
        };
        assert_eq!(editor.dispatch(&Command::Paste(payload))?.0, Handled::Yes);
        let range = editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("inserted range");
        assert_eq!(range.format, TextFormat::BOLD | TextFormat::ITALIC);
        assert_eq!(range.style.as_ref(), inserted_style);
        let key = range.anchor.key();
        editor.update(|tx| tx.insert_text("z"))?;
        let data = editor.state().view().text_data(key)?;
        assert_eq!(data.text.as_str(), "styledz");
        assert_eq!(data.format, TextFormat::BOLD | TextFormat::ITALIC);
        assert_eq!(data.style.as_ref(), inserted_style);
    }
    Ok(())
}

#[test]
fn explicit_plain_paste_preserves_the_current_typing_style() -> Result<(), Error> {
    let mut editor = register_editor_commands(surface::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    ))
    .build()
    .expect("actual application surface registry");
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_start(p)?;
        tx.set_selection_format(TextFormat::BOLD)?;
        tx.set_selection_style("color: red;")
    })?;
    assert_eq!(
        editor
            .dispatch(&Command::Paste(ClipboardPayload {
                data: [("text/plain".into(), "plain".into())]
                    .into_iter()
                    .collect(),
                intent: PasteIntent { plain_only: true },
                ..ClipboardPayload::default()
            }))?
            .0,
        Handled::Yes
    );
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("typed range");
    assert_eq!(range.format, TextFormat::BOLD);
    assert_eq!(range.style.as_ref(), "color: red;");
    let data = editor.state().view().text_data(range.anchor.key())?;
    assert_eq!(data.text.as_str(), "plain");
    assert_eq!(data.format, TextFormat::BOLD);
    assert_eq!(data.style.as_ref(), "color: red;");
    Ok(())
}

#[test]
fn direct_clipboard_command_stays_handled_in_paragraphs_and_table_cells() -> Result<(), Error> {
    use lexical_rich_nodes::table::{IncludeHeaders, create_table_node_with_dimensions};

    for in_table in [false, true] {
        let mut editor = register_editor_commands(surface::preset_builder_with_mode(
            EditorType::MarkdownSync,
            EditorMode::ViewAttached,
        ))
        .build()
        .expect("actual application handlers");
        editor.update(|tx| {
            let target = if in_table {
                let table =
                    create_table_node_with_dimensions(tx, 1, 1, IncludeHeaders::All(false))?;
                tx.append(NodeKey::ROOT, &[table.key()])?;
                let row = tx.first_child_or_err(table)?;
                let cell = tx.first_child_or_err(row)?;
                tx.first_child_or_err(cell)?
            } else {
                let paragraph = tx.create(Paragraph {})?;
                tx.append(NodeKey::ROOT, &[paragraph.key()])?;
                paragraph.key()
            };
            tx.select_start(target)?;
            tx.set_selection_format(TextFormat::BOLD)?;
            tx.set_selection_style("color: red;")?;
            let incoming = tx.create(Paragraph {})?;
            let text = tx.create_text("direct")?;
            tx.text(text)?
                .set_format(TextFormat::ITALIC)?
                .set_style("color: blue;")?;
            tx.append(incoming, &[text.key()])?;
            assert_eq!(
                tx.dispatch(&Command::InsertClipboardNodes {
                    nodes: vec![incoming.key()],
                    selection: SelectionSlot::Active,
                })?,
                Handled::Yes
            );
            let range = tx.range_selection()?;
            assert!(range.is_collapsed());
            assert_eq!(range.anchor, Point::text(text, Utf16Offset(6)));
            assert_eq!(range.format, TextFormat::ITALIC);
            assert_eq!(range.style.as_ref(), "color: blue;");
            assert!(tx.is_attached(text));
            assert_eq!(tx.text_data(text)?.text.as_str(), "direct");
            assert_eq!(
                tx.dispatch(&Command::InsertClipboardNodes {
                    nodes: vec![],
                    selection: SelectionSlot::Active,
                })?,
                Handled::Yes
            );
            assert_eq!(
                tx.range_selection()?.anchor,
                Point::text(text, Utf16Offset(6))
            );
            assert_eq!(tx.range_selection()?.format, TextFormat::ITALIC);
            assert_eq!(tx.range_selection()?.style.as_ref(), "color: blue;");
            Ok(())
        })?;
    }
    Ok(())
}
