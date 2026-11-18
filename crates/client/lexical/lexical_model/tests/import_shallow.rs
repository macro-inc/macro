//! Shallow imports preserve constructor input without importing framework children.
use lexical_model::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct ChildAware {
    observed: usize,
}
impl NodeType for ChildAware {
    const TYPE: &'static str = "child-aware";
    type Kind = ElementKind;
    impl_default_node!();
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> Result<NodeKey, Error> {
        let observed = json
            .get("children")
            .and_then(serde_json::Value::as_array)
            .map_or(0, Vec::len);
        Ok(tx.create(Self { observed })?.key())
    }
}
impl ElementNode for ChildAware {
    element_node_base!();
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct OwnChildren {
    children: Vec<String>,
}
impl NodeType for OwnChildren {
    const TYPE: &'static str = "own-children";
    type Kind = DecoratorKind;
    impl_default_node!();
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> Result<NodeKey, Error> {
        Ok(tx.create(Self::import_json(json)?)?.key())
    }
}
impl DecoratorNode for OwnChildren {
    decorator_node_base!();
}

#[test]
fn shallow_import_preserves_child_sensitive_constructor_context() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<ChildAware>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let draft =
        serde_json::json!({"type":"child-aware", "children":[{"type":"text", "text":"child"}]});
    let json = draft.as_object().expect("draft");
    let shallow = tx.import_node_shallow(json)?;
    assert_eq!(tx.get::<ChildAware>(shallow).expect("payload").observed, 1);
    assert_eq!(tx.children_size(shallow), 0);
    let recursive = tx.import_node(json)?;
    assert_eq!(
        tx.get::<ChildAware>(recursive).expect("payload").observed,
        1
    );
    assert_eq!(tx.children_size(recursive), 1);
    assert_eq!(tx.text_content(recursive), "child");
    Ok(())
}

#[test]
fn shallow_import_keeps_decorator_own_children() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<OwnChildren>()
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let draft = serde_json::json!({"type":"own-children", "children":["first", "second"]});
    let node = tx.import_node_shallow(draft.as_object().expect("draft"))?;
    assert_eq!(
        tx.get::<OwnChildren>(node).expect("payload").children,
        ["first", "second"]
    );
    assert_eq!(tx.kind(node), Some(NodeKind::Decorator));
    Ok(())
}
