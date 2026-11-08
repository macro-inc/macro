use super::*;

// LexicalTableNode.updateFromJSON/exportJSON preserve null, but omit undefined.
#[test]
fn table_column_widths_distinguish_missing_null_empty_and_values() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    for (input, expected) in [
        (serde_json::json!({"type":"table"}), serde_json::json!({})),
        (
            serde_json::json!({"type":"table","colWidths":null}),
            serde_json::json!({"colWidths":null}),
        ),
        (
            serde_json::json!({"type":"table","colWidths":[]}),
            serde_json::json!({"colWidths":[]}),
        ),
        (
            serde_json::json!({"type":"table","colWidths":[120,92.5,null]}),
            serde_json::json!({"colWidths":[120,92.5,null]}),
        ),
    ] {
        let table = tx.import_node(input.as_object().expect("table"))?;
        let exported = tx.view().export_json(table)?;
        assert_eq!(exported.get("colWidths"), expected.get("colWidths"));
    }
    Ok(())
}

// LexicalTableCellNode.test.ts: creation, header flags and serialization.
#[test]
fn cell_headers_use_masking_and_upstream_arithmetic_toggle() {
    let mut cell = TableCellNode::new(TableCellHeaderState::ROW, 2, Some(JsNumber(92.5)));
    assert_eq!(cell.row_span, 1);
    assert_eq!(cell.col_span, 2);
    assert_eq!(cell.width, Some(JsNumber(92.5)));
    assert!(cell.has_header());
    assert!(cell.has_header_state(TableCellHeaderState::ROW));
    assert!(!cell.has_header_state(TableCellHeaderState::COLUMN));
    cell.toggle_header_style(TableCellHeaderState::BOTH);
    assert_eq!(cell.header_state.bits(), 4);
    assert!(cell.has_header());
    assert_eq!(
        serde_json::to_value(cell.header_state).expect("header"),
        serde_json::json!(4)
    );
    cell.set_header_styles(TableCellHeaderState::COLUMN, TableCellHeaderState::BOTH);
    assert_eq!(cell.header_state.bits(), 6);
    cell.set_header_styles(
        TableCellHeaderState::NO_STATUS,
        TableCellHeaderState::from_bits_retain(7),
    );
    assert!(!cell.has_header());
    cell.toggle_header_style(TableCellHeaderState::ROW);
    cell.toggle_header_style(TableCellHeaderState::ROW);
    assert_eq!(cell.header_state, TableCellHeaderState::NO_STATUS);
    cell.set_vertical_align(Some("top".into()));
    assert_eq!(cell.vertical_align.as_deref(), Some("top"));
    assert!(
        serde_json::to_value(&cell)
            .expect("cell")
            .get("verticalAlign")
            .is_none()
    );
    cell.set_vertical_align(Some("middle".into()));
    assert_eq!(
        serde_json::to_value(&cell).expect("cell")["verticalAlign"],
        "middle"
    );
    cell.set_vertical_align(Some(String::new()));
    assert_eq!(cell.vertical_align, None);
    assert_eq!(
        TableCellNode::default(),
        TableCellNode::new(TableCellHeaderState::NO_STATUS, 1, None)
    );
}

#[test]
fn table_json_coerces_falsy_imports_and_preserves_fractional_dimensions() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .node_trait::<TableNode, dyn CanSelectBefore>(|node| node)
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let table = tx.import_node(serde_json::json!({"type":"table","version":1,"direction":null,"indent":0,"children":[],"colWidths":[100,92.5,null],"rowStriping":null,"frozenColumnCount":0,"frozenRowCount":null}).as_object().expect("object"))?;
    let row = tx.import_node(
        serde_json::json!({"type":"tablerow","version":1,"direction":null,"indent":0,"children":[],"height":0})
            .as_object()
            .expect("object"),
    )?;
    let cell = tx.import_node(serde_json::json!({"type":"tablecell","version":1,"direction":null,"indent":0,"children":[],"colSpan":0,"rowSpan":null,"width":0,"backgroundColor":"","verticalAlign":"bottom","headerState":7}).as_object().expect("object"))?;
    tx.append(row, &[cell])?;
    tx.append(table, &[row])?;
    tx.append(NodeKey::ROOT, &[table])?;
    tx.element(table)?
        .set_text_format(TextFormat::BOLD)?
        .set_text_style("color:red")?;
    assert!(tx.is_shadow_root(table));
    assert!(tx.is_shadow_root(row));
    assert!(tx.is_shadow_root(cell));
    assert!(!tx.can_be_empty(table));
    assert!(!tx.can_indent(cell));
    assert!(
        tx.view()
            .get_dyn::<dyn CanSelectBefore>(table)
            .expect("capability")
            .can_select_before()
    );
    assert_eq!(
        TableNode::column_count(tx.view(), tx.view().cast(table).expect("table")),
        1
    );
    assert_eq!(
        tx.get::<TableRowNode>(row).expect("row").height,
        Some(JsNumber(0.0))
    );
    assert_eq!(tx.get::<TableCellNode>(cell).expect("cell").col_span, 1);
    assert_eq!(tx.get::<TableCellNode>(cell).expect("cell").row_span, 1);
    assert_eq!(
        tx.get::<TableCellNode>(cell).expect("cell").header_state,
        TableCellHeaderState::BOTH
    );
    assert_eq!(tx.get::<TableCellNode>(cell).expect("cell").width, None);
    assert_eq!(
        tx.get::<TableCellNode>(cell)
            .expect("cell")
            .background_color,
        None
    );
    let exported = tx.view().export_node(table)?;
    assert_eq!(exported, serde_json::json!({"children":[{"children":[{"children":[],"direction":null,"format":"","indent":0,"type":"tablecell","version":1,"verticalAlign":"bottom","backgroundColor":null,"colSpan":1,"headerState":3,"rowSpan":1}],"direction":null,"format":"","indent":0,"type":"tablerow","version":1,"height":0}],"direction":null,"format":"","indent":0,"type":"table","version":1,"colWidths":[100,92.5,null]}).as_object().expect("object").clone());
    assert!(!exported.contains_key("textFormat"));
    assert!(!exported.contains_key("textStyle"));
    assert_eq!(
        serde_json::to_string(&JsNumber(100.0)).expect("integer"),
        "100"
    );
    assert_eq!(
        serde_json::to_string(&JsNumber(92.5)).expect("fraction"),
        "92.5"
    );
    assert_eq!(
        serde_json::from_str::<JsNumber>("92.5").expect("number"),
        JsNumber(92.5)
    );
    assert!(serde_json::from_value::<TableCellNode>(serde_json::json!({"colSpan":-1})).is_err());
    assert!(serde_json::from_value::<TableCellNode>(serde_json::json!({"rowSpan":1.5})).is_err());
    Ok(())
}

// LexicalTableRowNode.test.ts: constructor and height field.
#[test]
fn row_height_and_default_table_payload_have_literal_exports() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let table = tx.create(TableNode::default())?;
    let row = tx.create(TableRowNode {
        height: Some(JsNumber(31.25)),
    })?;
    let cell = tx.create(TableCellNode::default())?;
    tx.append(table, &[row.key()])?;
    tx.append(row, &[cell.key()])?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    assert_eq!(tx.view().export_json(row)?, serde_json::json!({"children":[],"direction":null,"format":"","indent":0,"type":"tablerow","version":1,"height":31.25}).as_object().expect("object").clone());
    assert_eq!(
        serde_json::to_value(TableNode::default()).expect("table"),
        serde_json::json!({})
    );
    assert_eq!(
        serde_json::to_value(TableRowNode::default()).expect("row"),
        serde_json::json!({})
    );
    assert!(tx.collapse_at_start(cell, SelectionSlot::Active)?);
    let empty = tx.create(TableNode::default())?;
    assert_eq!(TableNode::column_count(tx.view(), empty), 0);
    Ok(())
}

#[test]
fn imported_header_numbers_use_javascript_bitwise_truncation() {
    let negative: TableCellNode =
        serde_json::from_value(serde_json::json!({"headerState":-1})).expect("cell");
    assert_eq!(negative.header_state, TableCellHeaderState::BOTH);
    let fractional: TableCellNode =
        serde_json::from_value(serde_json::json!({"headerState":6.75})).expect("cell");
    assert_eq!(fractional.header_state, TableCellHeaderState::COLUMN);
    assert_eq!(
        serde_json::to_value(JsNumber(f64::INFINITY)).expect("JS number"),
        serde_json::Value::Null
    );
    assert_eq!(
        serde_json::to_value(JsNumber(-0.0)).expect("JS number"),
        serde_json::json!(0)
    );
}
