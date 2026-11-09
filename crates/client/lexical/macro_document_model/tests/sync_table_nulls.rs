//! The source table exporter omits unset options that the mirror persists as null.
use lexical_loro::{LoroProjection, PlainPolicy, new_doc, reconstruct_state};
use loro::{Container, ExportMode, LoroValue, ValueOrContainer};
use macro_document_model::{Result, headless_builder, sync::MACRO_SYNC_POLICY};
use serde_json::json;

#[test]
fn source_table_unset_fields_reconstruct_without_changing_loro() -> Result<()> {
    let editor = headless_builder()
        .initial_state(serde_json::from_value(json!({"root":{
            "type":"root","version":1,"$":{"id":"root"},"children":[{
                "type":"table","version":1,"$":{"id":"table"},"children":[{
                    "type":"tablerow","version":1,"$":{"id":"row"},"children":[{
                        "type":"tablecell","version":1,"$":{"id":"cell"},"children":[{
                            "type":"paragraph","version":1,"$":{"id":"p"},"children":[]
                        }]
                    }]
                }]
            }]
        }}))?)
        .build()?;
    let doc = new_doc(71)?;
    let projection = LoroProjection::initialize(&doc, editor.state(), &MACRO_SYNC_POLICY, 0)?;
    let Some(ValueOrContainer::Container(Container::MovableList(children))) =
        doc.get_map("root").get("children")
    else {
        panic!("root children");
    };
    let Some(ValueOrContainer::Container(Container::Map(table))) = children.get(0) else {
        panic!("table");
    };
    let Some(ValueOrContainer::Container(Container::MovableList(rows))) = table.get("children")
    else {
        panic!("table rows");
    };
    let Some(ValueOrContainer::Container(Container::Map(row))) = rows.get(0) else {
        panic!("row");
    };
    let Some(ValueOrContainer::Container(Container::MovableList(cells))) = row.get("children")
    else {
        panic!("row cells");
    };
    let Some(ValueOrContainer::Container(Container::Map(cell))) = cells.get(0) else {
        panic!("cell");
    };
    // Exact source exportJSON undefined fields become null in the open mirror record.
    for key in [
        "colWidths",
        "frozenColumnCount",
        "frozenRowCount",
        "rowStriping",
    ] {
        table
            .insert(key, LoroValue::Null)
            .expect("source unset table option");
    }
    cell.insert("width", LoroValue::Null)
        .expect("source unset cell width");
    doc.commit();
    let before = doc.export(ExportMode::Snapshot).expect("source snapshot");
    let vv = doc.oplog_vv();
    let expected = lexical_loro::synced_json(editor.state(), &MACRO_SYNC_POLICY)?;
    assert_eq!(reconstruct_state(&doc, &MACRO_SYNC_POLICY)?, expected);
    projection
        .check(&doc, editor.state())
        .expect("strict projection equality");
    assert_eq!(doc.oplog_vv(), vv);
    assert_eq!(
        doc.export(ExportMode::Snapshot)
            .expect("unchanged source snapshot"),
        before
    );
    let plain = reconstruct_state(&doc, &PlainPolicy)?;
    assert_eq!(plain.root["children"][0]["colWidths"], json!(null));
    assert!(plain.root["children"][0].get("colWidths").is_some());
    assert!(
        plain.root["children"][0]["children"][0]["children"][0]
            .get("width")
            .is_some()
    );
    assert_eq!(
        expected.root["children"][0]["children"][0]["children"][0]["backgroundColor"],
        json!(null)
    );
    assert!(
        expected.root["children"][0]["children"][0]["children"][0]
            .get("backgroundColor")
            .is_some()
    );

    table
        .insert("colWidths", LoroValue::from(json!([12, null, 34])))
        .expect("source width array");
    table
        .insert("unknownNull", LoroValue::Null)
        .expect("unrecognized own null");
    cell.insert("width", 19).expect("real source cell width");
    doc.commit();
    let changed = reconstruct_state(&doc, &MACRO_SYNC_POLICY)?;
    assert_eq!(
        changed.root["children"][0]["colWidths"],
        json!([12, null, 34])
    );
    assert!(changed.root["children"][0].get("unknownNull").is_some());
    assert_eq!(
        changed.root["children"][0]["children"][0]["children"][0]["width"],
        json!(19)
    );
    assert!(
        projection.check(&doc, editor.state()).is_err(),
        "nonnull/arbitrary field mismatches remain strict"
    );
    Ok(())
}
