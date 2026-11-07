//! Overflow wrapper; character-limit policy remains in the view.
use lexical_model::*;
use serde::{Deserialize, Serialize};
/// Upstream `OverflowNode`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct OverflowNode {}
impl NodeType for OverflowNode {
    const TYPE: &'static str = "overflow";
    type Kind = ElementKind;
    impl_default_node!();
    fn static_transform() -> Option<TransformFn<Self>> {
        Some(overflow_node_transform)
    }
}
impl ElementNode for OverflowNode {
    element_node_base!();
    fn insert_new_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        selection: SelectionSlot,
        restore_selection: bool,
    ) -> std::result::Result<Option<NodeKey>, lexical_model::Error> {
        let parent = tx.parent_or_err(this)?;
        tx.insert_new_after(parent, selection, restore_selection)
    }
    fn exclude_from_copy(
        &self,
        _node: ElementView<'_>,
        _destination: Option<CopyDestination>,
    ) -> bool {
        true
    }
}
/// Intrinsic transform removing empty overflow wrappers.
pub fn overflow_node_transform(
    tx: &mut Transaction<'_>,
    node: Id<OverflowNode>,
) -> std::result::Result<(), lexical_model::Error> {
    if tx.is_empty(node) {
        tx.remove(node, false)?;
    }
    Ok(())
}
/// Create an unattached overflow wrapper.
pub fn create_overflow_node(tx: &mut Transaction<'_>) -> crate::Result<Id<OverflowNode>> {
    Ok(tx.create(OverflowNode {})?)
}
/// Test overflow ancestry.
pub fn is_overflow_node(state: &impl Read, key: NodeKey) -> bool {
    state.is::<OverflowNode>(key)
}
#[cfg(test)]
mod test;
