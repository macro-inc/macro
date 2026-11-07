//! Heading payload and upstream editing hooks.
use lexical_model::*;
use serde::{Deserialize, Serialize};

/// The six HTML heading levels.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HeadingTagType {
    /// Level one.
    #[default]
    H1,
    /// Level two.
    H2,
    /// Level three.
    H3,
    /// Level four.
    H4,
    /// Level five.
    H5,
    /// Level six.
    H6,
}
/// Upstream `HeadingNode`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct HeadingNode {
    /// Heading level serialized after the element fields.
    pub tag: HeadingTagType,
}
impl NodeType for HeadingNode {
    const TYPE: &'static str = "heading";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for HeadingNode {
    element_node_base!();
    fn insert_new_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        selection: SelectionSlot,
        restore_selection: bool,
    ) -> std::result::Result<Option<NodeKey>, lexical_model::Error> {
        let range = tx
            .selection_at(selection)?
            .and_then(Selection::as_range)
            .cloned();
        let offset = range.as_ref().map_or(0, |s| s.anchor.offset());
        let last = tx.last_descendant(this);
        let at_end = last.is_none()
            || range.as_ref().is_some_and(|s| {
                last == Some(s.anchor.key()) && tx.text_content_size(s.anchor.key()).get() == offset
            });
        let new = if at_end || range.is_none() {
            tx.create(Paragraph {})?.key()
        } else {
            let tag = tx
                .get::<Self>(this)
                .ok_or(lexical_model::Error::NodeTypeMismatch(this.key()))?
                .tag;
            tx.create(Self { tag })?.key()
        };
        let direction = tx.element_data(this)?.direction;
        tx.element(new)?.set_direction(direction)?;
        tx.insert_after(this, new, restore_selection)?;
        if offset == 0 && !tx.is_empty(this) && range.is_some() {
            let paragraph = tx.create(Paragraph {})?;
            tx.select_start(paragraph)?;
            tx.replace(this, paragraph, true)?;
        }
        Ok(Some(new))
    }
    fn collapse_at_start(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        _selection: SelectionSlot,
    ) -> std::result::Result<bool, lexical_model::Error> {
        if tx.is_empty(this) {
            let paragraph = tx.create(Paragraph {})?;
            let children = tx.children_keys(this)?;
            tx.append(paragraph, &children)?;
            tx.replace(this, paragraph, false)?;
        }
        Ok(true)
    }
    fn extract_with_child(
        &self,
        _node: ElementView<'_>,
        _child: NodeKey,
        _selection: Option<&Selection>,
        _destination: CopyDestination,
    ) -> bool {
        true
    }
}
/// Create an unattached heading, applying registered replacements.
pub fn create_heading_node(
    tx: &mut Transaction<'_>,
    tag: HeadingTagType,
) -> crate::Result<Id<HeadingNode>> {
    Ok(tx.create(HeadingNode { tag })?)
}
/// Test heading ancestry.
pub fn is_heading_node(state: &impl Read, key: NodeKey) -> bool {
    state.is::<HeadingNode>(key)
}
/// Read a heading's level.
pub fn get_tag(state: &impl Read, key: Id<HeadingNode>) -> Option<HeadingTagType> {
    state.get::<HeadingNode>(key).map(|node| node.tag)
}
/// Change a heading's level.
pub fn set_tag(
    tx: &mut Transaction<'_>,
    key: Id<HeadingNode>,
    tag: HeadingTagType,
) -> crate::Result<()> {
    tx.get_mut::<HeadingNode>(key)?.tag = tag;
    Ok(())
}
#[cfg(test)]
mod test;
