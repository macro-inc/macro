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

#[test]
fn moving_a_cell_range_grows_the_target_grid_and_leaves_original_cells_empty() -> Result<(), Error>
{
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((table, a, b, target), _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 2, 2, IncludeHeaders::All(false))?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        let (map, _, _) = compute_table_map_skip_cell_check(tx.view(), table, None, None)?;
        for (row, col, label) in [(0, 0, "A"), (0, 1, "B"), (1, 0, "C"), (1, 1, "D")] {
            let cell = map.get(row, col).expect("cell").cell;
            tx.clear(cell)?;
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text(label)?;
            tx.append(p, &[text.key()])?;
            tx.append(cell, &[p.key()])?;
        }
        Ok((
            table.key(),
            map.get(0, 0).expect("A").cell.key(),
            map.get(0, 1).expect("B").cell.key(),
            map.get(1, 1).expect("D").cell.key(),
        ))
    })?;
    let before = editor.state().to_json()?;
    let no_op = decode_command(
        "group-b.table",
        &json!({"action":"move-cells","anchor":a.index(),"focus":b.index(),"target":b.index()})
            .to_string(),
        table.generation(),
        None,
    )?
    .expect("command");
    assert_eq!(editor.dispatch(&no_op)?.0, Handled::No);
    assert_eq!(editor.state().to_json()?, before);
    let command = decode_command("group-b.table",&json!({"action":"move-cells","anchor":a.index(),"focus":b.index(),"target":target.index()}).to_string(),table.generation(),None)?.expect("command");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    let state = editor.state().view();
    let table = state.cast::<TableNode>(table).expect("table");
    let (map, _, _) = compute_table_map_skip_cell_check(state, table, None, None)?;
    assert_eq!(map.row_count(), 2);
    assert_eq!(map.column_count(), 3);
    assert_eq!(state.text_content(a), "");
    assert_eq!(state.text_content(b), "");
    assert_eq!(state.text_content(map.get(1, 0).expect("C").cell), "C");
    assert_eq!(state.text_content(target), "A");
    assert_eq!(
        state.text_content(map.get(1, 2).expect("B target").cell),
        "B"
    );
    Ok(())
}

#[test]
fn hovered_row_delete_preserves_a_covering_selection_and_collapses_only_an_uncovered_one()
-> Result<(), Error> {
    for covered in [true, false] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("surface");
        let ((table, hovered), _) = editor.update(|tx| {
            let table = create_table_node_with_dimensions(tx, 3, 2, IncludeHeaders::All(false))?;
            tx.append(NodeKey::ROOT, &[table.key()])?;
            let (map, _, _) = compute_table_map_skip_cell_check(tx.view(), table, None, None)?;
            for (row, label) in [(0, "A"), (1, "B"), (2, "C")] {
                let cell = map.get(row, 0).expect("cell").cell;
                tx.clear(cell)?;
                let p = tx.create(Paragraph::default())?;
                let text = tx.create_text(label)?;
                tx.append(p, &[text.key()])?;
                tx.append(cell, &[p.key()])?;
            }
            let anchor = map.get(0, 0).expect("anchor").cell;
            let focus = map.get(if covered { 1 } else { 0 }, 1).expect("focus").cell;
            tx.set_selection(Some(Selection::Table(TableSelection::new(
                table.key(),
                anchor.key(),
                focus.key(),
            ))))?;
            Ok((
                table.key(),
                map.get(if covered { 1 } else { 2 }, 0)
                    .expect("hover")
                    .cell
                    .key(),
            ))
        })?;
        let command = decode_command(
            "group-b.table",
            &json!({"action":"delete","cell":hovered.index(),"axis":"row"}).to_string(),
            table.generation(),
            None,
        )?
        .expect("command");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
        let state = editor.state().view();
        assert_eq!(state.children_size(table), if covered { 1 } else { 2 });
        let table = state.cast::<TableNode>(table).expect("table");
        let (map, _, _) = compute_table_map_skip_cell_check(state, table, None, None)?;
        assert_eq!(
            state.text_content(map.get(0, 0).expect("survivor").cell),
            if covered { "C" } else { "A" }
        );
    }
    Ok(())
}

#[test]
fn resize_snapshot_uses_unmerged_rendered_columns_and_restores_unset_row_height()
-> Result<(), Error> {
    assert!(include_str!("../../../../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableCellResize.ts").contains("export const MIN_COLUMN_WIDTH = 120;"));
    assert!(include_str!("../../../../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tableCellResize.ts").contains("export const MIN_ROW_HEIGHT = 33;"));
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((table, cell, bottom0, bottom1, top2, row), _) = editor.update(|tx| {
        let table = create_table_node_with_dimensions(tx, 2, 3, IncludeHeaders::All(false))?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        let (map, _, _) = compute_table_map_skip_cell_check(tx.view(), table, None, None)?;
        let cell = map.get(0, 0).expect("merged cell").cell;
        tx.get_mut::<TableCellNode>(cell)?.col_span = 2;
        tx.remove(map.get(0, 1).expect("covered cell").cell, false)?;
        Ok((
            table.key(),
            cell.key(),
            map.get(1, 0).expect("bottom 0").cell.key(),
            map.get(1, 1).expect("bottom 1").cell.key(),
            map.get(0, 2).expect("top 2").cell.key(),
            tx.first_child(table).expect("first row"),
        ))
    })?;
    let before = editor.state().to_json()?;
    let data = json!({"cell":cell.index(),"edge":"right","zoom":1.25,"measurements":[
        {"key":cell.index(),"width":400,"height":60},
        {"key":bottom0.index(),"width":80,"height":60},
        {"key":bottom1.index(),"width":90,"height":60},
        {"key":top2.index(),"width":150,"height":60},
        {"key":row.index(),"width":550,"height":60}
    ]});
    let snapshot = surface::query(
        "group-b.table-resize",
        &data,
        table.generation(),
        editor.state(),
    )?
    .expect("snapshot");
    assert_eq!(
        snapshot,
        json!({"axis":"column","generation":table.generation(),"table":table.index(),"column":1,"baseWidths":[64,72,120],"revertWidths":[120,120,120]})
    );
    assert_eq!(editor.state().to_json()?, before);
    let command = decode_command("group-b.table",&json!({"action":"resize-column","table":table.index(),"column":1,"baseWidths":[64,72,120],"delta":80,"merge":false}).to_string(),table.generation(),None)?.expect("command");
    let (_, commit) = editor.dispatch(&command)?;
    assert!(commit.tags.contains(&UpdateTag::SkipScrollIntoView));
    assert!(!commit.tags.contains(&UpdateTag::HistoryMerge));
    assert_eq!(
        editor.state().view().export_json(table)?.get("colWidths"),
        Some(&json!([64, 152, 120]))
    );
    let command = decode_command(
        "group-b.table",
        &json!({"action":"restore-columns","table":table.index(),"widths":[120,120,120]})
            .to_string(),
        table.generation(),
        None,
    )?
    .expect("command");
    let (_, commit) = editor.dispatch(&command)?;
    assert!(commit.tags.contains(&UpdateTag::HistoryMerge));
    assert_eq!(editor.state().to_json()?, before);
    let mut data = data;
    data["edge"] = json!("bottom");
    let snapshot = surface::query(
        "group-b.table-resize",
        &data,
        table.generation(),
        editor.state(),
    )?
    .expect("snapshot");
    assert_eq!(
        snapshot,
        json!({"axis":"row","generation":table.generation(),"row":row.index(),"baseHeight":48,"revertHeight":null})
    );
    let command = decode_command(
        "group-b.table",
        &json!({"action":"resize-row","row":row.index(),"baseHeight":48,"delta":-100}).to_string(),
        table.generation(),
        None,
    )?
    .expect("command");
    editor.dispatch(&command)?;
    assert_eq!(
        editor
            .state()
            .view()
            .get::<TableRowNode>(row)
            .expect("row")
            .height
            .map(|height| height.0),
        Some(33.0)
    );
    let command = decode_command(
        "group-b.table",
        &json!({"action":"restore-row","row":row.index(),"height":null}).to_string(),
        table.generation(),
        None,
    )?
    .expect("command");
    editor.dispatch(&command)?;
    assert_eq!(editor.state().to_json()?, before);
    data["edge"] = json!("left");
    assert_eq!(
        surface::query(
            "group-b.table-resize",
            &data,
            table.generation(),
            editor.state()
        )?,
        Some(serde_json::Value::Null)
    );
    Ok(())
}
