use super::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

thread_local! {
    static EXPORT_CALLS: Cell<usize> = const { Cell::new(0) };
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct OrderedProps {
    payload: Value,
}
impl NodeType for OrderedProps {
    const TYPE: &'static str = "ordered-decorator-props";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for OrderedProps {
    decorator_node_base!();
    fn adjust_export_json(&self, _: NodeView<'_>, json: &mut SerializedNode) -> Result<(), Error> {
        EXPORT_CALLS.with(|calls| calls.set(calls.get() + 1));
        json.insert("fromExport".into(), true.into());
        Ok(())
    }
}

#[test]
fn ordered_nested_objects_in_arrays_publish_own_props_without_changing_value_equality()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .node::<OrderedProps>()
        .build()
        .expect("editor");
    let before = json!({"rows":[{"first":1,"second":2}]});
    let after = json!({"rows":[{"second":2,"first":1}]});
    assert_eq!(before, after);
    assert_ne!(before.to_string(), after.to_string());
    let (key, _) = editor.update(|tx| {
        let key = tx.create(OrderedProps { payload: before })?;
        tx.append(NodeKey::ROOT, &[key.key()])?;
        Ok(key)
    })?;
    let (_, commit) = editor.update(|tx| {
        tx.get_mut::<OrderedProps>(key)?.payload = after.clone();
        Ok(())
    })?;
    EXPORT_CALLS.with(|calls| calls.set(0));
    let diff = commit.diff(&DiffOptions::default())?;
    let props: Vec<_> = diff
        .ops
        .iter()
        .filter_map(|op| match op {
            DiffOp::NodeProps { key: actual, props } if *actual == key.key() => Some(props),
            _ => None,
        })
        .collect();
    assert_eq!(props.len(), 1);
    assert_eq!(props[0]["fromExport"], json!(true));
    assert_eq!(props[0]["payload"].to_string(), after.to_string());
    // The equal-payload fallback exports the actual prior and current snapshots.
    EXPORT_CALLS.with(|calls| assert_eq!(calls.get(), 2));
    Ok(())
}

#[test]
fn equal_order_cow_stays_quiet_and_value_changes_keep_the_existing_export_path() -> Result<(), Error>
{
    for (before, after, count, calls) in [
        (
            json!({"first":1,"second":2}),
            json!({"first":1,"second":2}),
            0,
            2,
        ),
        (json!(1), json!(2), 1, 1),
        (json!([1, 2]), json!([1, 3]), 1, 1),
    ] {
        let mut editor = Editor::builder(EditorMode::ViewAttached)
            .node::<OrderedProps>()
            .build()
            .expect("editor");
        let (key, _) = editor.update(|tx| {
            let key = tx.create(OrderedProps { payload: before })?;
            tx.append(NodeKey::ROOT, &[key.key()])?;
            Ok(key)
        })?;
        let (_, commit) = editor.update(|tx| {
            tx.get_mut::<OrderedProps>(key)?.payload = after;
            Ok(())
        })?;
        EXPORT_CALLS.with(|calls| calls.set(0));
        let diff = commit.diff(&DiffOptions::default())?;
        assert_eq!(
            diff.ops
                .iter()
                .filter(
                    |op| matches!(op, DiffOp::NodeProps { key: actual, .. } if *actual == key.key())
                )
                .count(),
            count
        );
        EXPORT_CALLS.with(|actual| assert_eq!(actual.get(), calls));
    }
    Ok(())
}
