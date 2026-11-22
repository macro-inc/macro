//! Ordinary-link normalization with caret-pair selection preservation.
use super::*;
/// Register ordinary links, their normalizer and default typed toggle handler.
pub fn link_extension(b: EditorBuilder) -> EditorBuilder {
    super::toggle::register_link(b, super::toggle::LinkConfig::default())
}
type CaretPair = [PointCaret; 2];
fn save(view: StateRef<'_>, point: Point) -> Result<CaretPair> {
    let caret = caret_from_point(view, &point, CaretDirection::Next)?;
    Ok([caret, caret.flipped(view)])
}
fn fix_boundary(
    tx: &Transaction<'_>,
    pair: &mut CaretPair,
    absorbing: NodeKey,
    merging: NodeKey,
) -> Result<()> {
    if pair
        .iter()
        .any(|c| matches!(c, PointCaret::Sibling(_)) && c.origin() == absorbing)
    {
        let child = ChildCaret::new(tx.view(), merging, CaretDirection::Next)
            .ok_or(Error::NotAnElement(merging))?;
        let fixed = normalize_caret(tx.view(), child.into())?;
        *pair = [fixed, fixed.flipped(tx.view())];
    }
    Ok(())
}
fn restore(tx: &mut Transaction<'_>, pairs: Option<[CaretPair; 2]>) -> Result<()> {
    if let Some(pairs) = pairs {
        for (role, pair) in [(PointRole::Anchor, pairs[0]), (PointRole::Focus, pairs[1])] {
            if let Some(caret) = pair.into_iter().find(|c| tx.is_attached(c.origin())) {
                let caret = normalize_caret(tx.view(), caret)?;
                tx.set_point_at(
                    SelectionSlot::Active,
                    role,
                    point_from_caret(tx.view(), &caret)?,
                )?;
            }
        }
        tx.normalize_selection_at(SelectionSlot::Active)?;
    }
    Ok(())
}
/// Lift block children, coalesce identical adjacent links and restore selection carets.
pub fn link_node_transform(tx: &mut Transaction<'_>, link: Id<LinkNode>) -> Result<()> {
    let mut pairs = tx
        .selection()
        .and_then(Selection::as_range)
        .map(|r| -> Result<_> { Ok([save(tx.view(), r.anchor)?, save(tx.view(), r.focus)?]) })
        .transpose()?;
    let mut transformed = false;
    for child in tx.children_keys(link)? {
        if tx.is_element(child) && !tx.is_inline(child) {
            let children = tx.children_keys(child)?;
            if !children.is_empty() {
                let inner = tx.copy_node(link, false)?;
                tx.append(inner, &children)?;
                tx.append(child, &[inner])?;
                transformed = true;
            }
            crate::utils::lift_to_nearest_root(tx, child, false)?;
        }
    }
    if tx.is_attached(link) {
        if let Some(prev) = tx
            .prev_sibling(link)
            .and_then(|k| tx.view().cast::<LinkNode>(k))
            .filter(|p| should_merge_adjacent_link(tx, *p, link))
        {
            if let Some(pairs) = &mut pairs {
                for pair in pairs {
                    fix_boundary(tx, pair, prev.key(), link.key())?;
                }
            }
            let children = tx.children_keys(link)?;
            tx.append(prev, &children)?;
            tx.remove(link, false)?;
            restore(tx, pairs)?;
            return Ok(());
        }
        if let Some(next) = tx
            .next_sibling(link)
            .and_then(|k| tx.view().cast::<LinkNode>(k))
            .filter(|n| should_merge_adjacent_link(tx, link, *n))
        {
            if let Some(pairs) = &mut pairs {
                for pair in pairs {
                    fix_boundary(tx, pair, link.key(), next.key())?;
                }
            }
            let children = tx.children_keys(next)?;
            tx.append(link, &children)?;
            tx.remove(next, false)?;
            transformed = true;
        }
    }
    if !transformed {
        return Ok(());
    }
    if !tx.can_be_empty(link) && tx.is_empty(link) {
        let parent = tx.parent(link);
        tx.remove(link, false)?;
        if let Some(parent) = parent.filter(|p| tx.is_empty(*p)) {
            tx.remove(parent, false)?;
        }
    }
    restore(tx, pairs)
}

#[cfg(test)]
mod test;
