//! List items and their restructuring hooks.
use super::*;
use super::{format::*, utils::*};
use serde::{Deserialize, Serialize};
/// Upstream ListItemNode payload.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ListItemNode {
    /// Raw stored checked state; use get_checked for parent-aware reads.
    #[serde(default, skip_serializing)]
    pub checked: Option<bool>,
    /// Current ordered-list number.
    pub value: i32,
}
impl Default for ListItemNode {
    fn default() -> Self {
        Self {
            checked: None,
            value: 1,
        }
    }
}
impl NodeType for ListItemNode {
    const TYPE: &'static str = "listitem";
    type Kind = ElementKind;
    impl_default_node!();
    fn static_transform() -> Option<TransformFn<Self>> {
        Some(list_item_node_transform)
    }
}
impl ElementNode for ListItemNode {
    element_node_base!();
    fn is_parent_required(&self, _: ElementView<'_>) -> bool {
        true
    }
    fn create_parent_element(tx: &mut Transaction<'_>, _: Id<Self>) -> Result<NodeKey> {
        Ok(create_list_node(tx, ListType::Bullet, 1)?.key())
    }
    fn can_merge_when_empty(&self, _: ElementView<'_>) -> bool {
        true
    }
    fn can_merge_with(&self, node: ElementView<'_>, other: NodeKey) -> bool {
        node.state.is::<Self>(other) || node.state.is::<Paragraph>(other)
    }
    fn adjust_export_json(&self, node: NodeView<'_>, json: &mut SerializedNode) -> Result<()> {
        let value = json.remove("value");
        if let Some(checked) = node
            .state
            .view()
            .cast(node.key)
            .and_then(|id| get_checked(&node.state, id))
        {
            json.insert("checked".into(), checked.into());
        }
        if let Some(value) = value {
            json.insert("value".into(), value);
        }
        Ok(())
    }
    fn append(tx: &mut Transaction<'_>, this: Id<Self>, nodes: &[NodeKey]) -> Result<()> {
        for &node in nodes {
            if tx.is_element(node) && tx.can_merge_with(this, node) {
                let children = tx.children_keys(node)?;
                tx.append(this, &children)?;
                tx.remove(node, false)?;
            } else {
                tx.default_append(this.key(), &[node])?;
            }
        }
        Ok(())
    }
    fn replace(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        replacement: NodeKey,
        include_children: bool,
    ) -> Result<NodeKey> {
        if tx.is::<Self>(replacement) {
            return tx.default_replace(this.key(), replacement, false);
        }
        set_indent(tx, this, 0)?;
        let list = tx.parent_or_err(this)?;
        if !tx.is::<ListNode>(list) {
            return Ok(replacement);
        }
        if tx.first_child(list) == Some(this.key()) {
            tx.insert_before(list, replacement, true)?;
        } else if tx.last_child(list) == Some(this.key()) {
            tx.insert_after(list, replacement, true)?;
        } else {
            let copy = tx.copy_node(list, false)?;
            let following: Vec<_> = tx.next_siblings(this).collect();
            tx.append(copy, &following)?;
            tx.insert_after(list, replacement, true)?;
            tx.insert_after(replacement, copy, true)?;
        }
        if include_children {
            if !tx.is_element(replacement) {
                return Err(Error::Invariant(
                    "includeChildren should only be true for ElementNodes",
                ));
            }
            let offset = tx.children_size(replacement);
            let children = tx.children_keys(this)?;
            tx.splice(replacement, ChildIndex(offset), 0, &children)?;
            remap_points(tx, SelectionSlot::Active, this.key(), replacement, offset)?;
        }
        tx.remove(this, false)?;
        if tx.is_empty(list) {
            tx.remove(list, false)?;
        }
        Ok(replacement)
    }
    fn insert_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        node: NodeKey,
        restore: bool,
    ) -> Result<NodeKey> {
        let list = tx.parent_or_err(this)?;
        if !tx.is::<ListNode>(list) {
            return Err(Error::Invariant(
                "insertAfter: list node is not parent of list item node",
            ));
        }
        if tx.is::<Self>(node) {
            return tx.default_insert_after(this.key(), node, restore);
        }
        let siblings: Vec<_> = tx.next_siblings(this).collect();
        tx.insert_after(list, node, restore)?;
        if !siblings.is_empty() {
            let copy = tx.copy_node(list, false)?;
            tx.append(copy, &siblings)?;
            tx.insert_after(node, copy, restore)?;
        }
        Ok(node)
    }
    fn remove(tx: &mut Transaction<'_>, this: Id<Self>, preserve: bool) -> Result<()> {
        let prev = tx.prev_sibling(this);
        let next = tx.next_sibling(this);
        tx.default_remove(this.key(), true, preserve)?;
        if let (Some(prev), Some(next)) = (prev, next)
            && is_nested_list_node(tx, prev)
            && is_nested_list_node(tx, next)
        {
            let a = list_id(tx, tx.first_child_or_err(prev)?)?;
            let b = list_id(tx, tx.first_child_or_err(next)?)?;
            merge_lists(tx, a, b)?;
            tx.remove(next, false)?;
        }
        Ok(())
    }
    fn reset_on_copy(tx: &mut Transaction<'_>, this: Id<Self>, original: NodeKey) -> Result<()> {
        if get_checked(tx, item_id(tx, original)?) == Some(true) {
            set_checked(tx, this, Some(false))?;
        }
        Ok(())
    }
    fn insert_new_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        _: SelectionSlot,
        restore: bool,
    ) -> Result<Option<NodeKey>> {
        let copy = tx.copy_node(this, false)?;
        tx.insert_after(this, copy, restore)?;
        Ok(Some(copy))
    }
    fn collapse_at_start(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        slot: SelectionSlot,
    ) -> Result<bool> {
        let paragraph = tx.create(Paragraph {})?;
        let children = tx.children_keys(this)?;
        tx.append(paragraph, &children)?;
        let list = tx.parent_or_err(this)?;
        let parent = tx.parent_or_err(list)?;
        if tx.children_size(list) == 1 {
            if tx.is::<Self>(parent) {
                tx.remove(list, false)?;
                tx.element(parent)?.select(None, None)?;
            } else {
                tx.insert_before(list, paragraph, true)?;
                tx.remove(list, false)?;
                remap_points(tx, slot, this.key(), paragraph.key(), 0)?;
            }
        } else {
            tx.insert_before(list, paragraph, true)?;
            tx.remove(this, false)?;
        }
        Ok(true)
    }
    fn indent(&self, node: ElementView<'_>) -> u32 {
        node.state
            .view()
            .cast(node.key)
            .map_or(0, |id| get_indent(&node.state, id))
    }
    fn set_indent(tx: &mut Transaction<'_>, this: Id<Self>, indent: u32) -> Result<()> {
        set_indent(tx, this, indent)
    }
    fn extract_with_child(
        &self,
        node: ElementView<'_>,
        _: NodeKey,
        selection: Option<&Selection>,
        _: CopyDestination,
    ) -> bool {
        selection
            .and_then(Selection::as_range)
            .is_some_and(|range| {
                node.state.is_parent_of(node.key, range.anchor.key())
                    && node.state.is_parent_of(node.key, range.focus.key())
                    && range.text_content(node.state).is_ok_and(|text| {
                        text.encode_utf16().count()
                            == node.state.text_content_size(node.key).get() as usize
                    })
            })
    }
}
/// Create an unattached item.
pub fn create_list_item_node(
    tx: &mut Transaction<'_>,
    checked: Option<bool>,
) -> Result<Id<ListItemNode>> {
    tx.create(ListItemNode { checked, value: 1 })
}
/// Test list-item ancestry.
pub fn is_list_item_node(st: &impl Read, k: NodeKey) -> bool {
    st.is::<ListItemNode>(k)
}
/// Read the current ordered number.
pub fn get_value(st: &impl Read, item: Id<ListItemNode>) -> Result<i32> {
    Ok(st
        .get::<ListItemNode>(item)
        .ok_or(Error::NodeTypeMismatch(item.key()))?
        .value)
}
/// Set the ordered number.
pub fn set_value(tx: &mut Transaction<'_>, item: Id<ListItemNode>, value: i32) -> Result<()> {
    tx.get_mut::<ListItemNode>(item)?.value = value;
    Ok(())
}
/// Checked state is exposed only under a checklist parent.
pub fn get_checked(st: &impl Read, item: Id<ListItemNode>) -> Option<bool> {
    st.parent(item)
        .and_then(|p| st.get::<ListNode>(p))
        .filter(|p| p.list_type() == ListType::Check)
        .map(|_| {
            st.get::<ListItemNode>(item)
                .is_some_and(|n| n.checked.unwrap_or(false))
        })
}
/// Set raw stored checked state.
pub fn set_checked(
    tx: &mut Transaction<'_>,
    item: Id<ListItemNode>,
    checked: Option<bool>,
) -> Result<()> {
    tx.get_mut::<ListItemNode>(item)?.checked = checked;
    Ok(())
}
/// Negate stored checked state, treating absent as false.
pub fn toggle_checked(tx: &mut Transaction<'_>, item: Id<ListItemNode>) -> Result<()> {
    let checked = tx
        .get::<ListItemNode>(item)
        .ok_or(Error::NodeTypeMismatch(item.key()))?
        .checked
        .unwrap_or(false);
    set_checked(tx, item, Some(!checked))
}
/// Attached nesting depth, or stored indent for detached serialization.
pub fn get_indent(st: &impl Read, item: Id<ListItemNode>) -> u32 {
    if st.parent(item).is_none() || !st.is_attached(item) {
        return st.element_data(item).map_or(0, |d| d.indent);
    }
    st.ancestors(item)
        .filter(|k| st.is::<ListItemNode>(*k))
        .count() as u32
}
/// Restructure the list one level at a time; detached items remain unchanged.
pub fn set_indent(tx: &mut Transaction<'_>, item: Id<ListItemNode>, target: u32) -> Result<()> {
    let current = get_indent(tx, item);
    if current < target {
        for _ in current..target {
            handle_indent(tx, item)?;
        }
    } else {
        for _ in target..current {
            handle_outdent(tx, item)?;
        }
    }
    Ok(())
}
/// Wrap contiguous orphan items, lifting their list out of invalid block parents.
pub fn list_item_node_transform(tx: &mut Transaction<'_>, item: Id<ListItemNode>) -> Result<()> {
    let Some(parent) = tx.parent(item) else {
        return Ok(());
    };
    if let Some(list) = tx.get::<ListNode>(parent) {
        if list.list_type() != ListType::Check && get_checked(tx, item).is_some() {
            set_checked(tx, item, None)?;
        }
        return Ok(());
    }
    let list = tx.create_parent_element(item)?;
    if !tx.is::<ListNode>(list) {
        return Err(Error::Invariant(
            "ListItemNode.createParentElementNode() must return a ListNode",
        ));
    }
    let mut children = Vec::new();
    for key in tx.prev_siblings(item).rev() {
        if !tx.is::<ListItemNode>(key) {
            break;
        }
        children.push(key);
    }
    children.reverse();
    children.push(item.key());
    for key in tx.next_siblings(item) {
        if !tx.is::<ListItemNode>(key) {
            break;
        }
        children.push(key);
    }
    tx.insert_before(item, list, true)?;
    tx.splice(list, ChildIndex(0), 0, &children)?;
    if !tx.is_root_or_shadow_root(parent) {
        crate::utils::lift_to_nearest_root(tx, list, true)?;
        if tx.is_empty(parent) && tx.is_attached(parent) {
            tx.remove(parent, false)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod test;
