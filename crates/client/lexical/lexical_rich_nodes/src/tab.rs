//! Model half of TabIndentationExtension.
use lexical_model::*;
/// Prefer block indentation over inserting a tab at a normalized block start.
pub fn indent_over_tab(state: &impl Read, selection: &RangeSelection) -> crate::Result<bool> {
    let view = state.view();
    if selection
        .nodes(view)?
        .iter()
        .any(|k| view.is_element(*k) && !view.is_inline(*k) && view.can_indent(*k))
    {
        return Ok(true);
    }
    let first = if selection.focus.is_before(view, &selection.anchor)? {
        selection.focus
    } else {
        selection.anchor
    };
    let block = crate::utils::get_nearest_block_element_ancestor_or_throw(view, first.key())?;
    if !view.can_indent(block) {
        return Ok(false);
    }
    let descendant = view.first_descendant(block).unwrap_or(block);
    let start = if view.is_text(descendant) {
        Point::text(descendant, Utf16Offset::ZERO)
    } else if view.is_element(descendant) {
        Point::element(descendant, ChildIndex(0))
    } else {
        Point::element(
            view.parent_or_err(descendant)?,
            view.index_within_parent(descendant)
                .ok_or(lexical_model::Error::NoParent(descendant))?,
        )
    };
    Ok(first == start)
}
/// Indent selected blocks below an exclusive maximum; zero means unlimited.
pub fn indent_with_limit(
    tx: &mut Transaction<'_>,
    max_indent: Option<u32>,
    can_indent: &dyn Fn(StateRef<'_>, NodeKey) -> bool,
) -> crate::Result<bool> {
    crate::utils::handle_indent_and_outdent(tx, |tx, key| {
        let new = tx.indent(key).saturating_add(1);
        if max_indent.is_none_or(|max| max == 0 || new < max) && can_indent(tx.view(), key) {
            tx.set_indent(key, new)?;
        }
        Ok(())
    })
}
#[cfg(test)]
mod test;
