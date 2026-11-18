use super::*;
use lexical_model::*;
use lexical_rich_nodes::list::{ListItemNode, ListNode, ListType, register_list_nodes};
use serde_json::json;

struct TreeIndentPolicy;
static POLICY: TreeIndentPolicy = TreeIndentPolicy;
impl SyncPolicy for TreeIndentPolicy {
    fn stored_normalized_fields(&self, _: &str) -> &'static [&'static str] {
        &[]
    }
    fn is_dropped(&self, _: StateRef<'_>, _: NodeKey) -> bool {
        false
    }
    fn is_transparent(&self, _: StateRef<'_>, _: NodeKey) -> bool {
        false
    }
    fn is_dropped_json(&self, _: &SerializedNode) -> bool {
        false
    }
    fn is_transparent_json(&self, _: &SerializedNode) -> bool {
        false
    }
    fn local_state_keys(&self) -> &'static [&'static str] {
        &[]
    }
    fn ignore_in_remote_compare(&self, _: &str, _: &SerializedNode) -> &'static [&'static str] {
        &[]
    }
    fn keep_local_on_remote(&self, _: &str) -> &'static [&'static str] {
        &[]
    }
    fn indent_is_tree_depth(&self, kind: &str) -> bool {
        kind == "listitem"
    }
}

fn nested() -> Result<(Editor, NodeKey, NodeKey)> {
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("registered list fixture");
    let ((inner, item), _) = editor.update(|tx| {
        let outer = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let wrapper = tx.create(ListItemNode::default())?;
        let inner = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let item = tx.create(ListItemNode::default())?;
        let text = tx.create_text("item")?;
        tx.append(item, &[text.key()])?;
        tx.append(inner, &[item.key()])?;
        tx.append(wrapper, &[inner.key()])?;
        tx.append(outer, &[wrapper.key()])?;
        tx.append(NodeKey::ROOT, &[outer.key()])?;
        Ok((inner.key(), item.key()))
    })?;
    assert_eq!(editor.state().view().element_data(item)?.indent, 0);
    assert_eq!(editor.state().view().indent(item), 1);
    Ok((editor, inner, item))
}

#[test]
fn synthetic_mismatch_counts_this_batch_only_and_update_retains_raw_padding() -> Result<()> {
    // Synthetic inconsistent storage pins COUNTING ONLY, not Source restructuring parity.
    let (editor, _, item) = nested()?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &POLICY, 0)?;
    let map = projection.index.map(&doc, item)?;
    map.insert("indent", 2)?;
    doc.commit_with(loro::CommitOptions::new().origin("peer").timestamp(1));
    let batch = projection.take_remote(&doc, editor.state())?;
    assert_eq!(batch.stats.derived_indent_mismatches, 1);
    let update = batch
        .changes
        .iter()
        .find_map(|change| match change {
            NodeChange::Update {
                node: NodeTarget::Key(key),
                json,
            } if *key == item => Some(json),
            _ => None,
        })
        .expect("actual item Update");
    assert_eq!(update["indent"], json!(0));
    assert_eq!(
        schema::read_value(&map.get("indent").expect("stored indent"))?,
        json!(2)
    );
    assert_eq!(
        projection
            .take_remote(&doc, editor.state())?
            .stats
            .derived_indent_mismatches,
        0
    );
    doc.get_map("root").insert("format", "center")?;
    doc.commit_with(loro::CommitOptions::new().origin("peer").timestamp(2));
    let unrelated = projection.take_remote(&doc, editor.state())?;
    assert!(!unrelated.changes.is_empty());
    assert_eq!(unrelated.stats.derived_indent_mismatches, 0);
    Ok(())
}

#[test]
fn numeric_create_uses_raw_default_but_missing_and_null_are_preserved() -> Result<()> {
    for indent in [Some(json!(1)), None, Some(Value::Null)] {
        let (editor, inner, _) = nested()?;
        let doc = new_doc(1)?;
        let mut projection = LoroProjection::initialize(&doc, editor.state(), &POLICY, 0)?;
        let parent = projection.index.map(&doc, inner)?;
        let children = schema::children(&parent)?.expect("inner children");
        let created = children.insert_container(children.len(), LoroMap::new())?;
        let mut incoming = json!({"type":"listitem","version":1,"value":2,"format":"","direction":null,"children":[]})
            .as_object().expect("node").clone();
        if let Some(value) = indent.clone() {
            incoming.insert("indent".into(), value);
        }
        schema::initialize_map(&created, &incoming, schema::MapSchema::Node)?;
        doc.commit_with(loro::CommitOptions::new().origin("peer").timestamp(1));
        let batch = projection.take_remote(&doc, editor.state())?;
        assert_eq!(batch.stats.derived_indent_mismatches, 0);
        let node = batch
            .changes
            .iter()
            .find_map(|change| match change {
                NodeChange::Create { json, .. } if json.get("type") == Some(&json!("listitem")) => {
                    Some(json)
                }
                _ => None,
            })
            .expect("actual item Create");
        let expected = indent.as_ref().map(|value| {
            if value.is_number() {
                json!(0)
            } else {
                value.clone()
            }
        });
        assert_eq!(node.get("indent"), expected.as_ref());
        assert_eq!(
            schema::own_map(&created, &POLICY)?.get("indent"),
            indent.as_ref()
        );
    }
    Ok(())
}

#[test]
fn synthetic_corrupt_numeric_indents_count_without_changing_storage() -> Result<()> {
    // COUNT ONLY: no Source parity or restructuring claim for corrupt numbers.
    for stored in [json!(-1), json!(1.5), json!(18446744073709551616.0)] {
        let (editor, _, item) = nested()?;
        let doc = new_doc(1)?;
        let mut projection = LoroProjection::initialize(&doc, editor.state(), &POLICY, 0)?;
        let map = projection.index.map(&doc, item)?;
        map.insert("indent", schema::to_loro(&stored))?;
        doc.commit_with(loro::CommitOptions::new().origin("peer").timestamp(1));
        let batch = projection.take_remote(&doc, editor.state())?;
        assert_eq!(batch.stats.derived_indent_mismatches, 1);
        let update = batch
            .changes
            .iter()
            .find_map(|change| match change {
                NodeChange::Update {
                    node: NodeTarget::Key(key),
                    json,
                } if *key == item => Some(json),
                _ => None,
            })
            .expect("actual item Update");
        assert_eq!(update["indent"], json!(0));
        assert_eq!(
            schema::read_value(&map.get("indent").expect("stored numeric indent"))?,
            stored
        );
    }
    Ok(())
}
