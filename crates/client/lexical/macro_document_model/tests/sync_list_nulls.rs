//! Source listitem checked is undefined outside a checklist; the mirror stores null.
use lexical_loro::{LoroProjection, PlainPolicy, new_doc, reconstruct_state};
use loro::{Container, ExportMode, LoroValue, ValueOrContainer};
use macro_document_model::{Result, headless_builder, sync::MACRO_SYNC_POLICY};
use serde_json::json;

#[test]
fn unchecked_source_listitems_reconstruct_without_changing_loro_or_hiding_booleans() -> Result<()> {
    let editor = headless_builder()
        .initial_state(serde_json::from_value(json!({"root":{
            "type":"root","version":1,"$":{"id":"root"},"children":[{
                "type":"task-list","version":1,"listType":"bullet","start":1,"tag":"ul",
                "$":{"id":"list"},"children":[{
                    "type":"listitem","version":1,"value":1,"$":{"id":"item"},"children":[{
                        "type":"text","version":1,"text":"first","format":0,"detail":0,
                        "mode":"normal","style":"","$":{"id":"text"}
                    }]
                }]
            }]
        }}))?)
        .build()?;
    let doc = new_doc(83)?;
    let projection = LoroProjection::initialize(&doc, editor.state(), &MACRO_SYNC_POLICY, 0)?;
    let Some(ValueOrContainer::Container(Container::MovableList(children))) =
        doc.get_map("root").get("children")
    else {
        panic!("root children");
    };
    let Some(ValueOrContainer::Container(Container::Map(list))) = children.get(0) else {
        panic!("list");
    };
    let Some(ValueOrContainer::Container(Container::MovableList(items))) = list.get("children")
    else {
        panic!("list items");
    };
    let Some(ValueOrContainer::Container(Container::Map(item))) = items.get(0) else {
        panic!("item");
    };
    item.insert("checked", LoroValue::Null)
        .expect("source undefined");
    doc.commit();
    let before = doc.export(ExportMode::Snapshot).expect("source snapshot");
    let vv = doc.oplog_vv();
    let expected = lexical_loro::synced_json(editor.state(), &MACRO_SYNC_POLICY)?;
    assert!(
        expected.root["children"][0]["children"][0]
            .get("checked")
            .is_none()
    );
    assert_eq!(reconstruct_state(&doc, &MACRO_SYNC_POLICY)?, expected);
    projection
        .check(&doc, editor.state())
        .expect("strict equality");
    assert_eq!(doc.oplog_vv(), vv);
    assert_eq!(
        doc.export(ExportMode::Snapshot)
            .expect("unchanged raw snapshot"),
        before
    );
    let plain = reconstruct_state(&doc, &PlainPolicy)?;
    assert!(
        plain.root["children"][0]["children"][0]
            .get("checked")
            .is_some()
    );
    assert_eq!(
        plain.root["children"][0]["children"][0]["checked"],
        json!(null)
    );
    for value in [false, true] {
        item.insert("checked", value).expect("real checklist value");
        item.insert("unknownNull", LoroValue::Null)
            .expect("unknown own field");
        doc.commit();
        let actual = reconstruct_state(&doc, &MACRO_SYNC_POLICY)?;
        assert_eq!(
            actual.root["children"][0]["children"][0]["checked"],
            json!(value)
        );
        assert!(
            actual.root["children"][0]["children"][0]
                .get("unknownNull")
                .is_some()
        );
        assert!(projection.check(&doc, editor.state()).is_err());
    }
    Ok(())
}
