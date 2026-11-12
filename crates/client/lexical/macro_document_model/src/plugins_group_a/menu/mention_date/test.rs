use crate::nodes::{DateMentionNode, Maybe};
use crate::{EditorType, surface};
use lexical_model::*;
use lexical_rich_nodes::table::{TableCellNode, TableNode, TableRowNode};
use serde_json::json;

#[test]
fn constructor_copies_strings_and_preserves_uuid_presence() -> Result<(), Error> {
    for (options, uuid) in [
        (json!({}), Maybe::Missing),
        (json!({"mentionUuid":null}), Maybe::Null),
        (json!({"mentionUuid":""}), Maybe::Value("".into())),
        (
            json!({"mentionUuid":"issued-reference"}),
            Maybe::Value("issued-reference".into()),
        ),
    ] {
        for (date, label) in [
            ("2026-06-15T12:00:00.000Z", "Today"),
            ("", ""),
            ("not-a-date", "Unparsed label"),
        ] {
            let mut editor = surface::preset_builder_with_mode(
                EditorType::MarkdownSync,
                EditorMode::ViewAttached,
            )
            .build()
            .expect("surface");
            editor.update(|tx| {
                let p = tx.create(Paragraph::default())?;
                tx.append(NodeKey::ROOT, &[p.key()])?;
                tx.select_end(p)
            })?;
            let mut payload = options.clone();
            payload["date"] = json!(date);
            payload["displayFormat"] = json!(label);
            let command = surface::decode_command(
                "group-a.insert-date-mention",
                &payload.to_string(),
                editor.state().max_key().generation(),
                None,
            )?
            .expect("date application command must decode");
            assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
            let view = editor.state().view();
            let p = view.first_child(NodeKey::ROOT).expect("paragraph");
            let key = view.first_child(p).expect("inserted date");
            let mention = view.get::<DateMentionNode>(key).expect("DateMentionNode");
            assert_eq!(mention.date, Maybe::Value(date.into()));
            assert_eq!(mention.display_format, Maybe::Value(label.into()));
            assert_eq!(mention.mention_uuid, uuid);
            assert_eq!(editor.state().root_text_content().as_ref(), label);
            let range = editor
                .state()
                .selection()
                .and_then(Selection::as_range)
                .expect("range");
            assert_eq!(range.anchor, Point::element(p, ChildIndex(1)));
            assert_eq!(range.focus, range.anchor);
        }
    }
    Ok(())
}

#[test]
fn insertion_matches_source_range_node_none_root_cell_and_typing_formats() -> Result<(), Error> {
    for mode in [
        "plain",
        "bold-node",
        "code-node",
        "bold-typing",
        "code-typing",
        "expanded-forward",
        "expanded-backward",
        "node",
        "none",
        "root",
        "cell",
    ] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("surface");
        let (cell_paragraph, _) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("body")?;
            tx.append(p, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_end(text)?;
            tx.set_text_node_range(text, Utf16Offset(2), text, Utf16Offset(2))?;
            match mode {
                "bold-node" | "bold-typing" => {
                    tx.text(text)?.set_format(TextFormat::BOLD)?;
                    if mode == "bold-typing" {
                        tx.set_selection_format(TextFormat::BOLD)?;
                    }
                }
                "code-node" | "code-typing" => {
                    tx.text(text)?.set_format(TextFormat::CODE)?;
                    if mode == "code-typing" {
                        tx.set_selection_format(TextFormat::CODE)?;
                    }
                }
                "expanded-forward" => {
                    tx.set_text_node_range(text, Utf16Offset(1), text, Utf16Offset(3))?
                }
                "expanded-backward" => {
                    tx.set_text_node_range(text, Utf16Offset(3), text, Utf16Offset(1))?
                }
                "none" => tx.replace_selection(None)?,
                "root" => tx.selection_from_view(ViewSelection::Range {
                    anchor: Point::element(NodeKey::ROOT, ChildIndex(1)),
                    focus: Point::element(NodeKey::ROOT, ChildIndex(1)),
                    resolution_dirty: false,
                })?,
                "node" => {
                    let old = tx.create(DateMentionNode {
                        date: Maybe::Value("old-date".into()),
                        display_format: Maybe::Value("Previous".into()),
                        mention_uuid: Maybe::Missing,
                    })?;
                    tx.append(p, &[old.key()])?;
                    let mut selection = NodeSelection::new();
                    selection.add(old.key());
                    tx.replace_selection(Some(Selection::Node(selection)))?;
                }
                "cell" => {
                    let table = tx.create(TableNode::default())?;
                    let row = tx.create(TableRowNode::default())?;
                    let cell = tx.create(TableCellNode::default())?;
                    let cell_p = tx.create(Paragraph::default())?;
                    let cell_text = tx.create_text("cell")?;
                    tx.append(cell_p, &[cell_text.key()])?;
                    tx.append(cell, &[cell_p.key()])?;
                    tx.append(row, &[cell.key()])?;
                    tx.append(table, &[row.key()])?;
                    tx.append(NodeKey::ROOT, &[table.key()])?;
                    // Match Source's actual command-entry point after its view admission.
                    tx.select_end(cell_text)?;
                    return Ok(Some((cell_p.key(), cell_text.key())));
                }
                _ => {}
            }
            Ok(None)
        })?;
        let before = editor.state().to_json()?;
        if mode == "cell" {
            // The complete native preset already owns this trailing paragraph before insertion.
            assert_eq!(
                editor.state().root_text_content().as_ref(),
                "body\n\ncell\n\n"
            );
            let (_, text) = cell_paragraph.expect("actual fixture cell text");
            let range = editor
                .state()
                .selection()
                .and_then(Selection::as_range)
                .expect("Source handler entry");
            assert_eq!(range.anchor, Point::text(text, Utf16Offset(4)));
            assert_eq!(range.focus, range.anchor);
        }
        let command = surface::decode_command(
            "group-a.insert-date-mention",
            r#"{"date":"2026-06-15T12:00:00.000Z","displayFormat":"Today"}"#,
            editor.state().max_key().generation(),
            None,
        )?
        .expect("date application command must decode");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes, "{mode}");
        let view = editor.state().view();
        let mentions = lexical_rich_nodes::utils::dfs(view, None, None)
            .into_iter()
            .filter(|entry| view.get::<DateMentionNode>(entry.node).is_some())
            .map(|entry| entry.node)
            .collect::<Vec<_>>();
        assert_eq!(mentions.len(), 1, "{mode}");
        let mention = mentions[0];
        let parent = view.parent(mention).expect("paragraph");
        assert_eq!(view.type_name(parent)?, Paragraph::TYPE, "{mode}");
        if let Some((original, _)) = cell_paragraph {
            assert_eq!(
                parent, original,
                "cell insertion descends into the original paragraph"
            );
        }
        let range = editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("caret");
        let expected = match mode {
            "expanded-forward" | "expanded-backward" => "bTodayy",
            "node" | "none" => "bodyToday",
            "root" => "body\n\nToday",
            "cell" => "body\n\ncellToday\n\n",
            _ => "boTodaydy",
        };
        assert_eq!(
            editor.state().root_text_content().as_ref(),
            expected,
            "{mode}"
        );
        let point = if matches!(mode, "node" | "none" | "root" | "cell") {
            Point::element(parent, ChildIndex(if mode == "root" { 1 } else { 2 }))
        } else {
            Point::text(
                view.next_sibling(mention).expect("next text"),
                Utf16Offset::ZERO,
            )
        };
        assert_eq!(range.anchor, point, "{mode}");
        assert_eq!(range.focus, point, "{mode}");
        assert_eq!(
            range.format,
            match mode {
                "bold-typing" => TextFormat::BOLD,
                "code-typing" => TextFormat::CODE,
                _ => TextFormat::empty(),
            },
            "{mode}"
        );
        if let Some(output) = std::env::var_os("NATIVE_MENTION_DATE_OUTPUT") {
            let raw = json!({"before":before,"after":editor.state().to_json()?,"text":editor.state().root_text_content().as_ref(),"selection":format!("{:?}",editor.state().selection())});
            std::fs::write(
                std::path::PathBuf::from(output).join(format!("selection-{mode}.json")),
                serde_json::to_vec_pretty(&raw)?,
            )
            .expect("owned native raw pair");
        }
    }
    Ok(())
}

#[test]
fn decoded_date_uses_current_selection_and_rejects_stale_generation_before_construction()
-> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (later, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let first = tx.create_text("first")?;
        tx.append(p, &[first.key()])?;
        let q = tx.create(Paragraph::default())?;
        let later = tx.create_text("later")?;
        tx.append(q, &[later.key()])?;
        tx.append(NodeKey::ROOT, &[p.key(), q.key()])?;
        tx.select_end(first)?;
        Ok(later.key())
    })?;
    let generation = editor.state().max_key().generation();
    let payload = r#"{"date":"2026-06-15T12:00:00.000Z","displayFormat":"Today"}"#;
    let command =
        surface::decode_command("group-a.insert-date-mention", payload, generation, None)?
            .expect("date application command must decode");
    editor.update(|tx| tx.select_end(later))?;
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    assert_eq!(
        editor.state().root_text_content().as_ref(),
        "first\n\nlaterToday"
    );
    let stale =
        surface::decode_command("group-a.insert-date-mention", payload, generation + 1, None)?
            .expect("stale date command");
    let before = editor.state().to_json()?;
    let max_key = editor.state().max_key();
    assert_eq!(editor.dispatch(&stale)?.0, Handled::No);
    assert_eq!(editor.state().to_json()?, before);
    assert_eq!(editor.state().max_key(), max_key);
    Ok(())
}

#[test]
fn closed_object_decoder_rejects_duplicate_fields_sequences_null_unknown_and_invalid_uuid()
-> Result<(), Error> {
    for payload in [
        r#"{"date":"first","date":"second","displayFormat":"Today"}"#,
        r#"{"date":"date","displayFormat":"first","displayFormat":"second"}"#,
        r#"{"date":"date","displayFormat":"Today","mentionUuid":"first","mentionUuid":"second"}"#,
        r#"["date","Today",null]"#,
        "null",
        r#"{"date":"date","displayFormat":"Today","unknown":true}"#,
        r#"{"date":"date","displayFormat":"Today","mentionUuid":42}"#,
        r#"{"date":"date","displayFormat":"Today","mentionUuid":{}}"#,
        r#"{"displayFormat":"Today"}"#,
        r#"{"date":"date"}"#,
        r#"{"date":null,"displayFormat":"Today"}"#,
        r#"{"date":"date","displayFormat":null}"#,
    ] {
        assert!(
            surface::decode_command("group-a.insert-date-mention", payload, 0, None).is_err(),
            "unsupported typed input: {payload}"
        );
    }
    Ok(())
}
