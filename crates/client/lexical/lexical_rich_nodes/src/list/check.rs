//! Model checklist keyboard navigation; DOM focus and hit testing stay in the view.
use super::*;
/// Find the previous/next non-wrapper item, crossing nested-list boundaries.
pub fn find_check_list_item_sibling(
    st: &impl Read,
    item: Id<ListItemNode>,
    backward: bool,
) -> Option<Id<ListItemNode>> {
    let sibling = |k| {
        if backward {
            st.prev_sibling(k)
        } else {
            st.next_sibling(k)
        }
    };
    let mut next = sibling(item.key());
    let mut parent = st.parent(item).and_then(|k| st.parent(k));
    while next.is_none() && parent.is_some_and(|k| st.is::<ListItemNode>(k)) {
        let p = parent?;
        next = sibling(p);
        parent = st.parent(p).and_then(|k| st.parent(k));
    }
    while let Some(key) = next.filter(|k| st.is::<ListItemNode>(*k)) {
        let first = if backward {
            st.last_child(key)
        } else {
            st.first_child(key)
        };
        if let Some(list) = first.filter(|k| st.is::<ListNode>(*k)) {
            next = if backward {
                st.last_child(list)
            } else {
                st.first_child(list)
            };
        } else {
            return st.view().cast(key);
        }
    }
    None
}
/// Select the sibling's beginning; the view can focus the returned item's DOM.
pub fn select_check_list_item_sibling(
    tx: &mut Transaction<'_>,
    item: Id<ListItemNode>,
    backward: bool,
) -> Result<Option<Id<ListItemNode>>> {
    let sibling = find_check_list_item_sibling(tx, item, backward);
    if let Some(sibling) = sibling {
        tx.select_start(sibling)?;
    }
    Ok(sibling)
}
/// Checklist item whose caret is at its first position.
pub fn check_list_item_at_caret_start(st: &impl Read) -> Option<Id<ListItemNode>> {
    let range = st.view().selection()?.as_range()?;
    if !range.is_collapsed() {
        return None;
    }
    let anchor = range.anchor;
    if anchor.point_type() == PointType::Text && anchor.offset() != 0 {
        return None;
    }
    let block = st.find_matching_parent(anchor.key(), |v, k| v.is_element(k) && !v.is_inline(k))?;
    let item = st.view().cast::<ListItemNode>(block)?;
    if st
        .parent(item)
        .and_then(|p| st.get::<ListNode>(p))
        .is_none_or(|p| p.list_type() != ListType::Check)
    {
        return None;
    }
    if anchor.point_type() == PointType::Element || st.first_descendant(item) == Some(anchor.key())
    {
        Some(item)
    } else {
        None
    }
}

#[cfg(test)]
mod test;
