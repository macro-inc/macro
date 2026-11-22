use super::*;
use crate::EditorType;

#[test]
fn bulk_facts_preserve_span_origins_ragged_holes_and_stored_fields_without_writes()
-> Result<(), Error> {
    let mut editor = crate::preset_builder(EditorType::MarkdownSync)
        .build()
        .expect("registry");
    let state = editor.parse_editor_state(&serde_json::from_value(json!({"root":{"type":"root","children":[
        {"type":"table","colWidths":[120,null,0],"frozenRowCount":1,"frozenColumnCount":2,"rowStriping":true,"children":[
            {"type":"tablerow","height":33.5,"children":[
                {"type":"tablecell","rowSpan":2,"headerState":2,"children":[{"type":"paragraph","children":[{"type":"text","text":"A"}]}]},
                {"type":"tablecell","colSpan":2,"headerState":1,"width":77.5,"backgroundColor":"#112233","verticalAlign":"bottom","children":[{"type":"paragraph","children":[{"type":"text","text":"B"}]}]}
            ]},
            {"type":"tablerow","children":[{"type":"tablecell","rowSpan":2,"children":[{"type":"paragraph","children":[{"type":"text","text":"C"}]}]}]},
            {"type":"tablerow","children":[]}
        ]}
    ]}}))?)?;
    let view = state.view();
    let table = view.children(NodeKey::ROOT).next().expect("table");
    let rows = view.children_keys(table)?;
    let first = view.children_keys(rows[0])?;
    let c = view.children_keys(rows[1])?[0];
    let generation = state.max_key().generation();
    let before = state.to_json()?;
    let reply = super::super::query(
        "group-b.table-facts",
        &json!({"keys":[table.index()]}),
        generation,
        &state,
    )?
    .expect("facts");
    let table_facts = &reply["tables"][0];
    assert_eq!(
        table_facts["slots"],
        json!([
            [key(first[0]), key(first[1]), key(first[1])],
            [key(first[0]), key(c)],
            [Value::Null, key(c)]
        ])
    );
    assert_eq!(table_facts["rowCount"], 3);
    assert_eq!(table_facts["columnCount"], 3);
    assert_eq!(table_facts["cells"].as_array().expect("cells").len(), 3);
    assert_eq!(table_facts["cells"][0]["rowSpan"], 2);
    assert_eq!(table_facts["cells"][1]["colSpan"], 2);
    assert_eq!(table_facts["cells"][1]["headerState"], 1);
    assert_eq!(table_facts["cells"][1]["width"], 77.5);
    assert_eq!(table_facts["cells"][1]["backgroundColor"], "#112233");
    assert_eq!(table_facts["cells"][1]["verticalAlign"], "bottom");
    assert_eq!(table_facts["cells"][2]["row"], 1);
    assert_eq!(table_facts["cells"][2]["column"], 1);
    assert_eq!(table_facts["rows"][0]["height"], 33.5);
    assert_eq!(table_facts["rows"][2]["cellKeys"], json!([]));
    assert_eq!(
        table_facts["colWidths"],
        json!({"kind":"value","value":[120,null,0]})
    );
    assert_eq!(table_facts["frozenRowCount"], 1);
    assert_eq!(table_facts["frozenColumnCount"], 2);
    assert_eq!(table_facts["rowStriping"], true);
    assert_eq!(state.to_json()?, before);
    Ok(())
}

#[test]
fn bulk_facts_keep_presence_request_order_and_generation_type_guards() -> Result<(), Error> {
    let mut editor = crate::preset_builder(EditorType::MarkdownSync)
        .build()
        .expect("registry");
    let cell = json!({"type":"tablecell","children":[{"type":"paragraph","children":[]}]});
    let state = editor.parse_editor_state(&serde_json::from_value(
        json!({"root":{"type":"root","children":[
            {"type":"table","children":[{"type":"tablerow","children":[cell.clone()]}]},
            {"type":"table","colWidths":null,"children":[{"type":"tablerow","children":[cell]}]}
        ]}}),
    )?)?;
    let tables = state.view().children_keys(NodeKey::ROOT)?;
    let generation = state.max_key().generation();
    let reply = query(
        "group-b.table-facts",
        &json!({"keys":[tables[1].index(),tables[0].index()]}),
        generation,
        &state,
    )?
    .expect("facts");
    assert_eq!(reply["tables"][0]["key"], key(tables[1]));
    assert_eq!(reply["tables"][0]["colWidths"], json!({"kind":"null"}));
    assert_eq!(reply["tables"][1]["colWidths"], json!({"kind":"missing"}));
    assert_eq!(
        query("unknown", &Value::Null, generation + 1, &state)?,
        None
    );
    let error = query("group-b.table-facts", &Value::Null, generation + 1, &state)
        .expect_err("stale first");
    assert_eq!(error.to_string(), "application query generation");
    for bad in [
        json!({"keys":[tables[0].index(),0]}),
        json!({"keys":[u32::MAX]}),
        json!({"keys":[],"invented":1}),
        Value::Null,
    ] {
        assert!(query("group-b.table-facts", &bad, generation, &state).is_err());
    }
    assert_eq!(
        query(
            "group-b.table-facts",
            &json!({"keys":[]}),
            generation,
            &state
        )?,
        Some(json!({"generation":generation,"tables":[]}))
    );
    Ok(())
}

#[test]
fn stored_numbers_follow_export_semantics_without_rewriting_the_live_values() -> Result<(), Error> {
    use lexical_rich_nodes::table::{JsNumber, TableCellHeaderState};
    let mut editor = crate::preset_builder(crate::EditorType::MarkdownSync)
        .build()
        .expect("registry");
    let (table, _) = editor.update(|tx| {
        let table = tx.create(TableNode {
            col_widths: ColumnWidths::Values(vec![
                Some(JsNumber(f64::NAN)),
                Some(JsNumber(-0.0)),
                None,
            ]),
            ..Default::default()
        })?;
        let row = tx.create(TableRowNode {
            height: Some(JsNumber(f64::INFINITY)),
        })?;
        let cell = tx.create(TableCellNode {
            header_state: TableCellHeaderState::from_bits_retain(4),
            ..Default::default()
        })?;
        let paragraph = tx.create(lexical_model::Paragraph::default())?;
        tx.append(cell, &[paragraph.key()])?;
        tx.append(row, &[cell.key()])?;
        tx.append(table, &[row.key()])?;
        tx.append(NodeKey::ROOT, &[table.key()])?;
        Ok(table.key())
    })?;
    let reply = query(
        "group-b.table-facts",
        &json!({"keys":[table.index()]}),
        table.generation(),
        editor.state(),
    )?
    .expect("facts");
    assert_eq!(
        reply["tables"][0]["colWidths"],
        json!({"kind":"value","value":[null,0,null]})
    );
    assert_eq!(reply["tables"][0]["rows"][0]["height"], Value::Null);
    assert_eq!(reply["tables"][0]["cells"][0]["headerState"], 4);
    let live = editor.state().view().get_or_err::<TableNode>(table)?;
    let widths = live.col_widths.as_ref().expect("widths");
    assert!(widths[0].expect("nan").0.is_nan());
    assert!(widths[1].expect("negative zero").0.is_sign_negative());
    Ok(())
}
