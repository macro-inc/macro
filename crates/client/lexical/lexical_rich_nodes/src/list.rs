//! List nodes, restructuring operations, command handlers and checklist navigation.
pub mod check;
pub mod format;
pub mod item;
pub mod node;
pub mod register;
pub mod utils;
pub use item::{ListItemNode, create_list_item_node, is_list_item_node};
use lexical_model::*;
pub use node::{ListNode, ListNodeTagType, ListType, create_list_node, is_list_node};
pub use register::{
    ListConfig, RegisterListOptions, list_extension, register_list, register_list_nodes,
};
type Result<T> = std::result::Result<T, Error>;
fn list_id(st: &impl Read, key: NodeKey) -> Result<Id<ListNode>> {
    st.view().cast(key).ok_or(Error::NodeTypeMismatch(key))
}
fn item_id(st: &impl Read, key: NodeKey) -> Result<Id<ListItemNode>> {
    st.view().cast(key).ok_or(Error::NodeTypeMismatch(key))
}
fn remap_points(
    tx: &mut Transaction<'_>,
    slot: SelectionSlot,
    from: NodeKey,
    to: NodeKey,
    offset: u32,
) -> Result<()> {
    if let Some(range) = tx
        .selection_at(slot)?
        .and_then(Selection::as_range)
        .cloned()
    {
        for (role, p) in [
            (PointRole::Anchor, range.anchor),
            (PointRole::Focus, range.focus),
        ] {
            if let Point::Element { key, offset: old } = p
                && key == from
            {
                tx.set_point_at(slot, role, Point::element(to, ChildIndex(offset + old.0)))?;
            }
        }
    }
    Ok(())
}

mod commands;
pub use commands::*;
