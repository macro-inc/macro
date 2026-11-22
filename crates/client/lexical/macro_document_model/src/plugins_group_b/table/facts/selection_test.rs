use super::*;
use lexical_model::{EditorMode, Selection, TableSelection};

#[test]
fn selection_facts_keep_delete_bounds_distinct_from_merged_cell_paint() -> Result<(), Error> {
    let mut editor = crate::surface::preset_builder_with_mode(crate::EditorType::MarkdownSync, EditorMode::ViewAttached)
        .initial_state(serde_json::from_value(json!({"root":{"type":"root","children":[
            {"type":"table","children":[
                {"type":"tablerow","children":[
                    {"type":"tablecell","rowSpan":2,"children":[{"type":"paragraph","children":[]}]},
                    {"type":"tablecell","colSpan":2,"children":[{"type":"paragraph","children":[]}]}
                ]},
                {"type":"tablerow","children":[
                    {"type":"tablecell","children":[{"type":"paragraph","children":[]}]},
                    {"type":"tablecell","children":[{"type":"paragraph","children":[]}]}
                ]},
                {"type":"tablerow","children":[
                    {"type":"tablecell","children":[{"type":"paragraph","children":[]}]},
                    {"type":"tablecell","children":[{"type":"paragraph","children":[]}]},
                    {"type":"tablecell","children":[{"type":"paragraph","children":[]}]}
                ]}
            ]},
            {"type":"table","children":[{"type":"tablerow","children":[
                {"type":"tablecell","children":[{"type":"paragraph","children":[]}]}
            ]}]}
        ]}}))?)
        .build().expect("actual application registry");
    let tables = editor.state().view().children_keys(NodeKey::ROOT)?;
    let table = tables[0];
    let rows = editor.state().view().children_keys(table)?;
    let first = editor.state().view().children_keys(rows[0])?;
    let second = editor.state().view().children_keys(rows[1])?;
    let generation = table.generation();
    for (anchor, focus) in [(first[0], second[0]), (second[0], first[0])] {
        editor.update(|tx| {
            tx.set_selection(Some(Selection::Table(TableSelection::new(
                table, anchor, focus,
            ))))
        })?;
        let before = editor.state().to_json()?;
        let selection_before = editor.state().selection().cloned();
        let reply = query(
            "group-b.table-facts",
            &json!({"keys":[table.index(),tables[1].index()]}),
            generation,
            editor.state(),
        )?
        .expect("actual facts");
        let facts = &reply["tables"][0];
        assert_eq!(
            facts["selection"]["deleteExtent"],
            json!({"minRow":0,"maxRow":1,"minColumn":0,"maxColumn":1})
        );
        assert_eq!(
            facts["selection"]["selectedCellKeys"],
            json!([key(first[0]), key(first[1]), key(second[0]), key(second[1])])
        );
        assert_eq!(
            facts["cells"][0]["selectionDelete"],
            json!({"expandRows":true,"expandColumns":true})
        );
        // D is selected by the actual merged-cell closure, but its origin is
        // outside the hover-delete column bounds. The two facts cannot be aliases.
        assert_eq!(
            facts["cells"][3]["selectionDelete"],
            json!({"expandRows":true,"expandColumns":false})
        );
        assert_eq!(
            facts["cells"][4]["selectionDelete"],
            json!({"expandRows":false,"expandColumns":true})
        );
        assert_eq!(
            facts["cells"][6]["selectionDelete"],
            json!({"expandRows":false,"expandColumns":false})
        );
        assert_eq!(reply["tables"][1]["selection"], Value::Null);
        assert_eq!(
            reply["tables"][1]["cells"][0]["selectionDelete"],
            Value::Null
        );
        assert_eq!(
            editor.state().to_json()?,
            before,
            "query must not change serialized model"
        );
        assert_eq!(
            editor.state().selection(),
            selection_before.as_ref(),
            "query must preserve actual selection"
        );
    }
    let last = editor.state().view().children_keys(rows[2])?[2];
    let mut geometry = None;
    for target in [first[0], last] {
        editor.update(|tx| {
            tx.set_selection(Some(Selection::Table(TableSelection::new(
                table, target, target,
            ))))
        })?;
        let before = editor.state().to_json()?;
        let reply = query(
            "group-b.table-facts",
            &json!({"keys":[table.index()]}),
            generation,
            editor.state(),
        )?
        .expect("retargeted selection facts");
        assert_eq!(reply["generation"], json!(generation));
        assert_eq!(
            reply["tables"][0]["selection"]["selectedCellKeys"],
            json!([key(target)])
        );
        let current = (&reply["tables"][0]["rows"], &reply["tables"][0]["slots"]);
        if let Some((rows, slots)) = &geometry {
            assert_eq!(
                current,
                (rows, slots),
                "selection-only retargeting must preserve geometry"
            );
        } else {
            geometry = Some((current.0.clone(), current.1.clone()));
        }
        assert_eq!(editor.state().to_json()?, before);
    }
    editor.update(|tx| tx.set_selection(None))?;
    let reply = query(
        "group-b.table-facts",
        &json!({"keys":[table.index()]}),
        generation,
        editor.state(),
    )?
    .expect("facts without selection");
    assert_eq!(reply["tables"][0]["selection"], Value::Null);
    assert!(
        reply["tables"][0]["cells"]
            .as_array()
            .expect("cells")
            .iter()
            .all(|cell| cell["selectionDelete"].is_null())
    );
    editor.update(|tx| tx.select_start(first[0]))?;
    let reply = query(
        "group-b.table-facts",
        &json!({"keys":[table.index()]}),
        generation,
        editor.state(),
    )?
    .expect("facts with range selection");
    assert_eq!(reply["tables"][0]["selection"], Value::Null);
    assert!(
        reply["tables"][0]["cells"]
            .as_array()
            .expect("cells")
            .iter()
            .all(|cell| cell["selectionDelete"].is_null())
    );
    Ok(())
}
