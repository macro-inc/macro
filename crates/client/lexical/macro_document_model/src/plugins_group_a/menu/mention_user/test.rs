use super::*;
use crate::{EditorType, surface};
use lexical_rich_nodes::table::{TableCellNode, TableNode, TableRowNode};
use serde_json::json;

#[test]
fn constructor_options_match_source_missing_null_empty_and_truthy_values() -> Result<(), Error> {
    for (options, expected_name, expected_uuid) in [
        (json!({}), "person", Maybe::Missing),
        (json!({"displayName":null}), "person", Maybe::Missing),
        (json!({"displayName":""}), "person", Maybe::Missing),
        (
            json!({"displayName":" Given ","mentionUuid":"issued-mention"}),
            " Given ",
            Maybe::Value("issued-mention".into()),
        ),
        (json!({"mentionUuid":null}), "person", Maybe::Null),
        (json!({"mentionUuid":""}), "person", Maybe::Value("".into())),
    ] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("surface");
        editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_end(p)
        })?;
        let generation = editor.state().max_key().generation();
        let mut payload = options;
        payload["userId"] = json!("fixture-user");
        payload["email"] = json!("person@example.com");
        let command = surface::decode_command(
            "group-a.insert-user-mention",
            &payload.to_string(),
            generation,
            None,
        )?
        .expect("insert");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
        let view = editor.state().view();
        let p = view.first_child(NodeKey::ROOT).expect("p");
        let mention = view
            .children_keys(p)?
            .into_iter()
            .find_map(|key| view.get::<UserMentionNode>(key))
            .expect("actual user mention");
        assert_eq!(mention.user_id.as_deref(), Some("fixture-user"));
        assert_eq!(mention.email.as_deref(), Some("person@example.com"));
        assert_eq!(mention.display_name, expected_name);
        assert_eq!(mention.mention_uuid, expected_uuid);
        assert_eq!(
            editor.state().root_text_content().as_ref(),
            format!("@{expected_name}")
        );
    }
    for (email, expected) in [("@example.com", "@example.com"), ("", "")] {
        let input: UserMentionInput =
            serde_json::from_value(json!({"userId":"fixture-user","email":email}))?;
        assert_eq!(construct(&input).display_name, expected);
    }
    Ok(())
}

#[test]
fn insertion_accepts_source_selection_and_format_cases_without_extra_guards() -> Result<(), Error> {
    for mode in [
        "plain",
        "bold",
        "expanded",
        "node",
        "none",
        "root",
        "shadow",
        "code-format",
        "composition",
    ] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("surface");
        editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("body")?;
            tx.append(p, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_end(text)?;
            tx.set_text_node_range(text, Utf16Offset(2), text, Utf16Offset(2))?;
            match mode {
                "bold" => {
                    tx.text(text)?.set_format(TextFormat::BOLD)?;
                    tx.set_selection_format(TextFormat::BOLD)?;
                }
                "code-format" => {
                    tx.text(text)?.set_format(TextFormat::CODE)?;
                }
                "expanded" => tx.set_text_node_range(text, Utf16Offset(1), text, Utf16Offset(3))?,
                "none" => tx.replace_selection(None)?,
                "root" => tx.selection_from_view(ViewSelection::Range {
                    anchor: Point::element(NodeKey::ROOT, ChildIndex(1)),
                    focus: Point::element(NodeKey::ROOT, ChildIndex(1)),
                    resolution_dirty: false,
                })?,
                "node" => {
                    let old = tx.create(UserMentionNode {
                        user_id: Maybe::Value("previous-user".into()),
                        email: Maybe::Value("previous@example.com".into()),
                        display_name: "previous".into(),
                        mention_uuid: Maybe::Missing,
                    })?;
                    tx.append(p, &[old.key()])?;
                    let mut selection = NodeSelection::new();
                    selection.add(old.key());
                    tx.replace_selection(Some(Selection::Node(selection)))?;
                }
                "shadow" => {
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
                    tx.select_end(cell_text)?;
                }
                "composition" => tx.set_composition_key(Some(text.key()))?,
                _ => {}
            }
            Ok(())
        })?;
        let before = editor.state().to_json()?;
        if mode == "shadow" {
            // The production preset already appends a trailing paragraph after tables.
            assert_eq!(
                editor.state().root_text_content().as_ref(),
                "body\n\ncell\n\n"
            );
        }
        let generation = editor.state().max_key().generation();
        let command = surface::decode_command(
            "group-a.insert-user-mention",
            r#"{"userId":"fixture-user","email":"person@example.com","displayName":"Person"}"#,
            generation,
            None,
        )?
        .expect("insert");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes, "{mode}");
        let mentions = lexical_rich_nodes::utils::dfs(editor.state().view(), None, None)
            .into_iter()
            .filter(|entry| {
                editor
                    .state()
                    .view()
                    .get::<UserMentionNode>(entry.node)
                    .is_some_and(|node| node.user_id.as_deref() == Some("fixture-user"))
            })
            .map(|entry| entry.node)
            .collect::<Vec<_>>();
        assert_eq!(mentions.len(), 1, "{mode}");
        let range = editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("caret");
        assert_eq!(range.anchor, range.focus, "{mode}");
        let mention = mentions[0];
        let expected_text = match mode {
            "expanded" => "b@Persony",
            "node" | "none" => "body@Person",
            "root" => "body\n\n@Person",
            "shadow" => "body\n\ncell@Person\n\n",
            _ => "bo@Persondy",
        };
        assert_eq!(
            editor.state().root_text_content().as_ref(),
            expected_text,
            "{mode}"
        );
        let parent = editor.state().view().parent(mention).expect("parent");
        let expected_point = if matches!(
            mode,
            "plain" | "bold" | "expanded" | "code-format" | "composition"
        ) {
            Point::text(
                editor
                    .state()
                    .view()
                    .next_sibling(mention)
                    .expect("Source next text"),
                Utf16Offset::ZERO,
            )
        } else {
            Point::element(parent, ChildIndex(if mode == "root" { 1 } else { 2 }))
        };
        assert_eq!(range.anchor, expected_point, "{mode}");
        assert_eq!(
            range.format,
            if mode == "bold" {
                TextFormat::BOLD
            } else {
                TextFormat::empty()
            },
            "{mode}"
        );
        if let Some(output) = std::env::var_os("NATIVE_MENTION_USER_OUTPUT") {
            let raw = json!({"before":before,"json":editor.state().to_json()?,"text":editor.state().root_text_content().as_ref(),"selection":format!("{:?}",editor.state().selection())});
            std::fs::write(
                std::path::PathBuf::from(output).join(format!("selection-{mode}.json")),
                serde_json::to_vec_pretty(&raw)?,
            )
            .expect("owned raw native proof");
        }
        assert_eq!(
            editor
                .state()
                .view()
                .type_name(editor.state().view().parent(mentions[0]).expect("parent"))?,
            Paragraph::TYPE,
            "{mode}"
        );
    }
    Ok(())
}

#[test]
fn separate_remove_then_io_uses_the_later_current_caret_and_generation() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (later, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let search = tx.create(crate::nodes::InlineSearchNode::default())?;
        tx.text(search)?.set_text_content("@person")?;
        tx.append(p, &[search.key()])?;
        let second = tx.create(Paragraph::default())?;
        let text = tx.create_text("later")?;
        tx.append(second, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key(), second.key()])?;
        tx.select_end(search)?;
        Ok(text.key())
    })?;
    let generation = editor.state().max_key().generation();
    let remove =
        surface::decode_command("group-a.search-remove", "{}", generation, None)?.expect("remove");
    assert_eq!(editor.dispatch(&remove)?.0, Handled::Yes);
    assert_eq!(editor.state().root_text_content().as_ref(), "\n\nlater");
    // Host tracking can await while the real selection changes.
    editor.update(|tx| tx.select_end(later))?;
    let insert = surface::decode_command(
        "group-a.insert-user-mention",
        r#"{"userId":"fixture-user","email":"person@example.com"}"#,
        editor.state().max_key().generation(),
        None,
    )?
    .expect("insert");
    assert_eq!(editor.dispatch(&insert)?.0, Handled::Yes);
    assert_eq!(
        editor.state().root_text_content().as_ref(),
        "\n\nlater@person"
    );
    Ok(())
}

#[test]
fn stale_generation_and_unsupported_typed_shapes_are_rejected_without_model_changes()
-> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let generation = editor.state().max_key().generation();
    let stale = surface::decode_command(
        "group-a.insert-user-mention",
        r#"{"userId":"fixture-user","email":"person@example.com"}"#,
        generation + 1,
        None,
    )?
    .expect("stale");
    let before = editor.state().to_json()?;
    assert_eq!(editor.dispatch(&stale)?.0, Handled::No);
    assert_eq!(editor.state().to_json()?, before);
    for payload in [
        json!({"email":"person@example.com"}),
        json!({"userId":"fixture-user","email":"person@example.com","displayName":42}),
        json!({"userId":"fixture-user","email":"person@example.com","extra":true}),
    ] {
        assert!(
            surface::decode_command(
                "group-a.insert-user-mention",
                &payload.to_string(),
                generation,
                None
            )
            .is_err()
        );
    }
    Ok(())
}
