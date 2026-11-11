use super::*;
use crate::{EditorType, surface};
use lexical_rich_nodes::heading::HeadingTagType;
use lexical_rich_nodes::link::{LinkAttributes, create_link_node};

fn editor() -> Editor {
    surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
        .build()
        .expect("actual surface")
}

fn facts(editor: &Editor) -> Result<Value, Error> {
    Ok(surface::query(
        "group-b.format-facts",
        &json!({}),
        editor.state().max_key().generation(),
        editor.state(),
    )?
    .expect("known query"))
}

#[test]
fn query_requires_exact_input_and_generation_before_reading_selection() -> Result<(), Error> {
    let editor = editor();
    assert_eq!(
        query("other", &Value::Null, u32::MAX, editor.state())?,
        None
    );
    assert!(
        query(
            "group-b.format-facts",
            &json!({"extra": true}),
            0,
            editor.state()
        )
        .is_err()
    );
    assert!(query("group-b.format-facts", &Value::Null, 0, editor.state()).is_err());
    assert!(query("group-b.format-facts", &json!({}), u32::MAX, editor.state()).is_err());
    assert!(matches!(
        query(
            "group-b.format-facts",
            &Value::Null,
            u32::MAX,
            editor.state()
        ),
        Err(Error::Invariant("application query generation"))
    ));
    for data in [
        json!([]),
        json!([1]),
        json!(true),
        json!(false),
        json!(1),
        json!(1.5),
        json!(""),
        json!("{}"),
    ] {
        assert!(query("group-b.format-facts", &data, 0, editor.state()).is_err());
    }
    assert_eq!(facts(&editor)?, json!({"generation": 0, "range": null}));
    Ok(())
}

#[test]
fn mixed_backward_range_returns_document_order_kinds_and_actual_link_presence() -> Result<(), Error>
{
    let mut editor = editor();
    let ((first, last), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let first = tx.create_text("Plain")?;
        tx.append(p, &[first.key()])?;
        let h4 = tx.create(HeadingNode {
            tag: HeadingTagType::H4,
        })?;
        let four = tx.create_text("Four")?;
        tx.append(h4, &[four.key()])?;
        let linked = tx.create(Paragraph::default())?;
        let link = create_link_node(tx, "https://example.com", LinkAttributes::default())?;
        let label = tx.create_text("linked")?;
        tx.append(link, &[label.key()])?;
        tx.append(linked, &[link.key()])?;
        let h6 = tx.create(HeadingNode {
            tag: HeadingTagType::H6,
        })?;
        let last = tx.create_text("Six")?;
        tx.append(h6, &[last.key()])?;
        tx.append(NodeKey::ROOT, &[p.key(), h4.key(), linked.key(), h6.key()])?;
        Ok((first.key(), last.key()))
    })?;
    for backward in [false, true] {
        editor.update(|tx| {
            let (anchor, focus) = if backward {
                (
                    Point::text(last, Utf16Offset(3)),
                    Point::text(first, Utf16Offset(0)),
                )
            } else {
                (
                    Point::text(first, Utf16Offset(0)),
                    Point::text(last, Utf16Offset(3)),
                )
            };
            let mut range = RangeSelection::collapsed(anchor);
            range.focus = focus;
            range.format = TextFormat::BOLD | TextFormat::ITALIC;
            tx.set_selection(Some(Selection::Range(range)))
        })?;
        assert_eq!(
            facts(&editor)?,
            json!({
                "generation": 0,
                "range": {"format": 3, "hasLinks": true, "elementsInRange": ["paragraph", "heading4", "heading6"]}
            })
        );
    }
    Ok(())
}

#[test]
fn collapsed_link_checks_only_the_immediate_parent_and_root_has_no_kind() -> Result<(), Error> {
    let mut editor = editor();
    let ((link, label), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let link = create_link_node(tx, "https://example.com", LinkAttributes::default())?;
        let label = tx.create_text("linked")?;
        tx.append(link, &[label.key()])?;
        tx.append(p, &[link.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((link.key(), label.key()))
    })?;
    for (point, has_links, kinds) in [
        (Point::text(label, Utf16Offset(2)), true, vec!["paragraph"]),
        (
            Point::element(link, ChildIndex(0)),
            false,
            vec!["paragraph"],
        ),
        (Point::element(NodeKey::ROOT, ChildIndex(0)), false, vec![]),
    ] {
        editor.update(|tx| {
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(point))))
        })?;
        assert_eq!(
            facts(&editor)?,
            json!({"generation": 0,
            "range": {"format": 0, "hasLinks": has_links, "elementsInRange": kinds}})
        );
    }
    Ok(())
}

#[test]
fn inherited_autolink_and_nonrange_selection_follow_source_branches() -> Result<(), Error> {
    use lexical_rich_nodes::link::{AutoLinkAttributes, create_auto_link_node};
    let mut editor = editor();
    let ((link, label), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let link = create_auto_link_node(tx, "https://example.com", AutoLinkAttributes::default())?;
        let label = tx.create_text("linked")?;
        tx.append(link, &[label.key()])?;
        tx.append(p, &[link.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
            Point::text(label, Utf16Offset(2)),
        ))))?;
        Ok((link.key(), label.key()))
    })?;
    assert_eq!(facts(&editor)?["range"]["hasLinks"], true);
    editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
            Point::element(link, ChildIndex(0)),
        ))))
    })?;
    assert_eq!(facts(&editor)?["range"]["hasLinks"], false);
    editor.update(|tx| {
        let mut selection = NodeSelection::new();
        selection.add(label);
        tx.set_selection(Some(Selection::Node(selection)))
    })?;
    assert_eq!(facts(&editor)?["range"], Value::Null);
    Ok(())
}

#[test]
fn distinct_shadow_roots_keep_the_anchor_chain_on_equal_endpoint_indices() -> Result<(), Error> {
    use lexical_rich_nodes::table::{TableCellNode, TableNode, TableRowNode};
    let mut editor = editor();
    let ((first, last), _) = editor.update(|tx| {
        let table = tx.create(TableNode::default())?;
        let row = tx.create(TableRowNode::default())?;
        let left = tx.create(TableCellNode::default())?;
        let right = tx.create(TableCellNode::default())?;
        let h4 = tx.create(HeadingNode {
            tag: HeadingTagType::H4,
        })?;
        let first = tx.create_text("Four")?;
        tx.append(h4, &[first.key()])?;
        let h6 = tx.create(HeadingNode {
            tag: HeadingTagType::H6,
        })?;
        let last = tx.create_text("Six")?;
        tx.append(h6, &[last.key()])?;
        tx.append(left, &[h4.key()])?;
        tx.append(right, &[h6.key()])?;
        tx.append(row, &[left.key(), right.key()])?;
        tx.append(table, &[row.key()])?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        Ok((first.key(), last.key()))
    })?;
    let view = editor.state().view();
    for (anchor, focus, expected) in [(first, last, "heading4"), (last, first, "heading6")] {
        let mut range = RangeSelection::collapsed(Point::text(anchor, Utf16Offset(0)));
        range.focus = Point::text(focus, Utf16Offset(1));
        assert_eq!(element_kinds(view, &range)?, vec![expected]);
    }
    Ok(())
}

#[test]
fn list_kinds_preserve_source_labels_and_javascript_string_coercion() -> Result<(), Error> {
    use lexical_rich_nodes::list::{ListItemNode, ListType, register_list_nodes};
    for (raw, expected) in [
        (Some(json!("bullet")), "list-bullet"),
        (Some(json!("number")), "list-number"),
        (Some(json!("check")), "list-check"),
        (Some(json!("future")), "list-future"),
        (Some(Value::Null), "list-null"),
        (None, "list-undefined"),
    ] {
        let mut editor = register_list_nodes(Editor::builder(EditorMode::ViewAttached))
            .build()
            .expect("actual list nodes without the task-list conversion policy");
        editor.update(|tx| {
            let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
            let mut data = serde_json::Map::new();
            data.insert("start".into(), json!(1));
            if let Some(raw) = raw {
                data.insert("listType".into(), raw);
            }
            tx.update_from_json(list, &data)?;
            let item = tx.create(ListItemNode::default())?;
            let text = tx.create_text("item")?;
            tx.append(item, &[text.key()])?;
            tx.append(list, &[item.key()])?;
            tx.append(NodeKey::ROOT, &[list.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(0)),
            ))))
        })?;
        assert_eq!(
            facts(&editor)?["range"]["elementsInRange"],
            json!([expected])
        );
    }
    Ok(())
}
