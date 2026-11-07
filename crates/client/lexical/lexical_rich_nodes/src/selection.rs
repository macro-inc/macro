//! View-independent selection predicates used by command handlers.
use lexical_model::*;
/// Whether character navigation reaches a decorator or enters a non-inline element.
/// `adjusted_is_backward` already incorporates the view's writing mode and direction.
pub fn should_override_default_character_selection(
    view: StateRef<'_>,
    range: &RangeSelection,
    adjusted_is_backward: bool,
) -> crate::Result<bool> {
    let focus = range.focus;
    view.node_or_err(focus.key())?;
    if let Point::Text { offset, key } = focus
        && ((adjusted_is_backward && offset > Utf16Offset::ZERO)
            || (!adjusted_is_backward && offset < view.text_content_size(key)))
    {
        return Ok(false);
    }
    // This is the node-caret walk used by upstream extendCaretToRange: entering
    // an element is a ChildCaret; leaving it is a SiblingCaret, which is skipped.
    let sibling = |key| {
        if adjusted_is_backward {
            view.prev_sibling(key)
        } else {
            view.next_sibling(key)
        }
    };
    let adjacent = match focus {
        Point::Text { key, .. } => sibling(key),
        Point::Element { key, offset } => {
            let index = if adjusted_is_backward {
                offset.0.checked_sub(1)
            } else {
                Some(offset.0)
            };
            index.and_then(|i| view.child_at_index(key, ChildIndex(i)))
        }
    };
    if let Some(key) = adjacent {
        return Ok(view.is_decorator(key) || (view.is_element(key) && !view.is_inline(key)));
    }
    let mut exiting = match focus {
        Point::Text { key, .. } => view.parent(key),
        Point::Element { key, .. } => Some(key),
    };
    while let Some(key) = exiting {
        if key == NodeKey::ROOT {
            return Ok(false);
        }
        if let Some(next) = sibling(key) {
            return Ok(view.is_decorator(next) || (view.is_element(next) && !view.is_inline(next)));
        }
        exiting = view.parent(key);
    }
    Ok(false)
}
#[cfg(test)]
mod test;
