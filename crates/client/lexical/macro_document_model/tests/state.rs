//! Node constructor and state behavior.
use lexical_model::*;
use macro_document_model::{nodes::*, *};
#[test]
fn task_view_state_preserves_unknown_object_fields_and_rejects_arrays() -> Result<()> {
    let mut editor = export_registry();
    let mut tx = editor.transaction();
    let node = tx.import_node(serde_json::json!({"type":"task-list", "listType":"check", "start":1,"$":{"taskListView":{"filters":{"status":["todo"],"future":true},"future":7}}}).as_object().unwrap())?;
    let settings = get_task_list_view_settings(&tx, node)?;
    assert_eq!(settings.get("future"), Some(&serde_json::json!(7)));
    assert_eq!(settings["filters"]["future"], serde_json::json!(true));
    set_task_list_view_settings(
        &mut tx,
        node,
        std::sync::Arc::new(serde_json::json!({"custom":{"x":1}})),
    )?;
    assert_eq!(
        tx.export_json(node)?["$"]["taskListView"],
        serde_json::json!({"custom":{"x":1}})
    );
    let bad = tx.import_node(serde_json::json!({"type":"task-list", "listType":"check", "start":1,"$":{"taskListView":[]}}).as_object().unwrap())?;
    assert!(get_task_list_view_settings(&tx, bad)?.is_null());
    Ok(())
}
#[test]
fn watermark_cleanup_bypasses_its_ordinary_removal_guard() -> Result<()> {
    let mut editor = export_registry();
    let mut tx = editor.transaction();
    assert!(append_watermark_node_to_last(&mut tx, Some("tail".into()))?.is_none());
    let p = tx.create(Paragraph {})?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let watermark = append_watermark_node_to_last(&mut tx, Some("tail".into()))?.unwrap();
    tx.remove(watermark, false)?;
    assert_eq!(tx.parent(watermark), Some(NodeKey::ROOT));
    force_remove_watermark(&mut tx, watermark)?;
    assert_eq!(tx.parent(watermark), None);
    assert_eq!(tx.children_keys(NodeKey::ROOT)?, vec![p.key()]);
    Ok(())
}
