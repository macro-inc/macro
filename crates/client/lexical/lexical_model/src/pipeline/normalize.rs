use crate::*;
use std::sync::Arc;

fn eligible(tx: &Transaction<'_>, key: NodeKey) -> bool {
    tx.is_attached(key)
        && tx.is_simple_text(key)
        && tx
            .view()
            .text(key)
            .is_some_and(|data| !data.is_unmergeable())
}
fn can_merge(tx: &Transaction<'_>, left: NodeKey, right: NodeKey) -> bool {
    let (Some(a), Some(b)) = (tx.view().slot(left), tx.view().slot(right)) else {
        return false;
    };
    let (BaseData::Text(x), BaseData::Text(y)) = (&a.base, &b.base) else {
        return false;
    };
    x.mode == y.mode
        && x.format == y.format
        && x.style == y.style
        && ["mode", "format", "style"]
            .into_iter()
            .all(|field| x.absent.contains_field(field) == y.absent.contains_field(field))
        && (a
            .state
            .as_ref()
            .zip(b.state.as_ref())
            .is_some_and(|(a, b)| Arc::ptr_eq(a, b))
            || NodeState::equivalent(a.state.as_deref(), b.state.as_deref()))
}
pub(super) fn normalize_text_node(tx: &mut Transaction<'_>, mut key: NodeKey) -> Result<(), Error> {
    if !eligible(tx, key) {
        return Ok(());
    }
    if tx.text_content_size(key) == Utf16Offset::ZERO {
        return tx.remove(key, false);
    }
    while let Some(previous) = tx.prev_sibling(key).filter(|key| eligible(tx, *key)) {
        if tx.text_content_size(previous) == Utf16Offset::ZERO {
            tx.remove(previous, false)?;
        } else {
            if can_merge(tx, previous, key) {
                tx.normalized.insert(previous);
                tx.normalized.insert(key);
                tx.text(previous)?.merge_with_sibling(key)?;
                key = previous;
            }
            break;
        }
    }
    while let Some(next) = tx.next_sibling(key).filter(|key| eligible(tx, *key)) {
        if tx.text_content_size(next) == Utf16Offset::ZERO {
            tx.remove(next, false)?;
        } else {
            if can_merge(tx, key, next) {
                tx.normalized.insert(key);
                tx.normalized.insert(next);
                tx.text(key)?.merge_with_sibling(next)?;
            }
            break;
        }
    }
    Ok(())
}
/// Descend element endpoints into text without installing or dirtying a selection.
pub fn normalize_range_selection(
    view: StateRef<'_>,
    selection: &mut RangeSelection,
) -> Result<(), Error> {
    for point in [&mut selection.anchor, &mut selection.focus] {
        while let Point::Element { key, offset } = *point {
            let element = view.element(key).ok_or(Error::NotAnElement(key))?;
            let at_end = offset.0 == element.children_size();
            let child = if at_end {
                view.last_child(key)
            } else {
                view.child_at_index(key, offset)
            };
            let Some(child) = child else {
                break;
            };
            match view.kind(child) {
                Some(NodeKind::Text) => {
                    *point = Point::text(
                        child,
                        if at_end {
                            view.text_content_size(child)
                        } else {
                            Utf16Offset::ZERO
                        },
                    );
                }
                Some(NodeKind::Element) => {
                    *point = Point::element(
                        child,
                        if at_end {
                            ChildIndex(view.children_size(child))
                        } else {
                            ChildIndex(0)
                        },
                    );
                }
                _ => break,
            }
        }
    }
    Ok(())
}
