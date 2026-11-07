//! Quote payload and upstream editing hooks.
use lexical_model::*;
use serde::{Deserialize, Serialize};
/// Upstream `QuoteNode`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct QuoteNode {}
impl NodeType for QuoteNode {
    const TYPE: &'static str = "quote";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for QuoteNode {
    element_node_base!();
    fn insert_new_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        _selection: SelectionSlot,
        restore_selection: bool,
    ) -> std::result::Result<Option<NodeKey>, lexical_model::Error> {
        let direction = tx.element_data(this)?.direction;
        let paragraph = tx.create(Paragraph {})?;
        tx.element(paragraph)?.set_direction(direction)?;
        tx.insert_after(this, paragraph, restore_selection)?;
        Ok(Some(paragraph.key()))
    }
    fn collapse_at_start(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        _selection: SelectionSlot,
    ) -> std::result::Result<bool, lexical_model::Error> {
        let paragraph = tx.create(Paragraph {})?;
        let children = tx.children_keys(this)?;
        tx.append(paragraph, &children)?;
        tx.replace(this, paragraph, false)?;
        Ok(true)
    }
    fn can_merge_when_empty(&self, _node: ElementView<'_>) -> bool {
        true
    }
}
/// Create an unattached quote.
pub fn create_quote_node(tx: &mut Transaction<'_>) -> crate::Result<Id<QuoteNode>> {
    Ok(tx.create(QuoteNode {})?)
}
/// Test quote ancestry.
pub fn is_quote_node(state: &impl Read, key: NodeKey) -> bool {
    state.is::<QuoteNode>(key)
}
#[cfg(test)]
mod test;
