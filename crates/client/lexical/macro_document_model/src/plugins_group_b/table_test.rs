use super::*;
use crate::{EditorType, surface};
use lexical_rich_nodes::{
    list::{ListItemNode, ListNode, ListType},
    table::*,
};
use serde_json::json;

#[test]
fn list_grid_conversion_keeps_inline_formatting_deeper_lists_and_ragged_padding()
-> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((list, header_text, deep), _) = editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let mut headers = Vec::new();
        let mut header_text = NodeKey::ROOT;
        let mut deep = NodeKey::ROOT;
        for (title, labels) in [("Header A", vec!["A1", "A2"]), ("Header B", vec!["B1"])] {
            let header = tx.create(ListItemNode::default())?;
            let text = tx.create_text(title)?;
            tx.text(text)?.set_format(TextFormat::BOLD)?;
            if title == "Header A" {
                header_text = text.key();
            }
            tx.append(header, &[text.key()])?;
            headers.push(header.key());
            let wrapper = tx.create(ListItemNode::default())?;
            let body = tx.create(ListNode::new(ListType::Bullet, 1))?;
            for label in labels {
                let item = tx.create(ListItemNode::default())?;
                let text = tx.create_text(label)?;
                tx.append(item, &[text.key()])?;
                tx.append(body, &[item.key()])?;
                if label == "A1" {
                    let wrapper = tx.create(ListItemNode::default())?;
                    let inner = tx.create(ListNode::new(ListType::Number, 1))?;
                    let child = tx.create(ListItemNode::default())?;
                    let content = tx.create_text("deeper")?;
                    tx.append(child, &[content.key()])?;
                    tx.append(inner, &[child.key()])?;
                    tx.append(wrapper, &[inner.key()])?;
                    tx.append(body, &[wrapper.key()])?;
                    deep = inner.key();
                }
            }
            tx.append(wrapper, &[body.key()])?;
            headers.push(wrapper.key());
        }
        tx.append(list, &headers)?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        tx.select_end(list)?;
        Ok((list.key(), header_text, deep))
    })?;
    let command = decode_command(
        "group-b.table",
        &json!({"action":"convert-list","key":list.index()}).to_string(),
        list.generation(),
        None,
    )?
    .expect("command");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    let state = editor.state().view();
    assert!(!state.contains(list));
    let table = state.first_child(NodeKey::ROOT).expect("table");
    assert!(state.is::<TableNode>(table));
    let rows = state.children_keys(table)?;
    assert_eq!(rows.len(), 3);
    for row in &rows {
        assert_eq!(state.children_size(*row), 2);
    }
    let first_row = *rows.first().expect("header row");
    let header = state.first_child(first_row).expect("header");
    assert_eq!(
        state
            .get::<TableCellNode>(header)
            .expect("cell")
            .header_state,
        TableCellHeaderState::ROW
    );
    assert_eq!(state.text_content(header), "Header A");
    assert!(
        state
            .text(header_text)
            .expect("original header text")
            .format
            .contains(TextFormat::BOLD)
    );
    assert_eq!(
        editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("caret")
            .anchor,
        Point::text(header_text, Utf16Offset(8))
    );
    let first_body = state
        .first_child(*rows.get(1).expect("body row"))
        .expect("body cell");
    assert_eq!(state.parent(deep), Some(first_body));
    assert_eq!(state.text_content(deep), "deeper");
    let last_row = *rows.last().expect("last row");
    let padded = state.last_child(last_row).expect("padded cell");
    assert_eq!(state.text_content(padded), "");
    assert!(state.is::<Paragraph>(state.first_child(padded).expect("empty caret paragraph")));
    assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    Ok(())
}

#[test]
fn list_grid_rejects_checklists_and_lists_without_a_column_shape_without_mutation()
-> Result<(), Error> {
    for kind in [ListType::Check, ListType::Bullet] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("surface");
        let (list, _) = editor.update(|tx| {
            let list = tx.create(ListNode::new(kind, 1))?;
            for label in ["one", "two"] {
                let item = tx.create(ListItemNode::default())?;
                let text = tx.create_text(label)?;
                tx.append(item, &[text.key()])?;
                tx.append(list, &[item.key()])?;
            }
            tx.append(NodeKey::ROOT, &[list.key()])?;
            Ok(list.key())
        })?;
        let before = editor.state().to_json()?;
        let command = decode_command(
            "group-b.table",
            &json!({"action":"convert-list","key":list.index()}).to_string(),
            list.generation(),
            None,
        )?
        .expect("command");
        assert_eq!(editor.dispatch(&command)?.0, Handled::No);
        assert_eq!(editor.state().to_json()?, before);
    }
    Ok(())
}
