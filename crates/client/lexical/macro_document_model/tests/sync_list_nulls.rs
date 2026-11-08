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

#[test]
fn source_nulls_stay_in_storage_while_editor_exports_omit_them_on_every_write_path() -> Result<()> {
    use lexical_loro::{LOCAL_ORIGIN, mirror};
    use lexical_model::{NodeKey, Read};
    use lexical_rich_nodes::list::ListItemNode;
    use loro::ToJson;

    let mut editor = headless_builder()
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
    let doc = new_doc(84)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &MACRO_SYNC_POLICY, 0)?;
    assert_eq!(
        doc.get_deep_value().to_json_value()["root"]["children"][0]["children"][0].get("checked"),
        Some(&serde_json::Value::Null)
    );
    let (_, commit) = editor.update(|tx| {
        let list = tx.children_keys(NodeKey::ROOT)?[0];
        let item = tx.create(ListItemNode::default())?;
        let text = tx.create_text("second")?;
        tx.set_state(
            item,
            &macro_document_model::node_ids::ID_STATE,
            Some("second-item".into()),
        )?;
        tx.set_state(
            text,
            &macro_document_model::node_ids::ID_STATE,
            Some("second-text".into()),
        )?;
        tx.append(item, &[text.key()])?;
        tx.append(list, &[item.key()])
    })?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?;
    let canonical = lexical_loro::synced_json(editor.state(), &MACRO_SYNC_POLICY)?;
    for item in canonical.root["children"][0]["children"]
        .as_array()
        .unwrap()
    {
        assert!(item.get("checked").is_none());
    }
    let stored = doc.get_deep_value().to_json_value();
    for item in stored["root"]["children"][0]["children"]
        .as_array()
        .unwrap()
    {
        assert_eq!(item.get("checked"), Some(&serde_json::Value::Null));
    }
    assert_eq!(reconstruct_state(&doc, &MACRO_SYNC_POLICY)?, canonical);
    projection
        .check(&doc, editor.state())
        .expect("strict canonical equality");
    let before = doc.oplog_vv();
    mirror::set_synced_state(&doc, &canonical, &MACRO_SYNC_POLICY)?;
    assert_eq!(
        doc.oplog_vv(),
        before,
        "full sync must not rewrite source nulls"
    );
    let fresh = new_doc(85)?;
    mirror::set_synced_state(&fresh, &canonical, &MACRO_SYNC_POLICY)?;
    let copied = fresh.get_deep_value().to_json_value();
    for item in copied["root"]["children"][0]["children"]
        .as_array()
        .unwrap()
    {
        assert_eq!(item.get("checked"), Some(&serde_json::Value::Null));
    }
    assert_eq!(reconstruct_state(&fresh, &MACRO_SYNC_POLICY)?, canonical);
    Ok(())
}
