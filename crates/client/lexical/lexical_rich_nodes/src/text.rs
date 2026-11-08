//! Text-entity transforms shared by hashtag and custom entities.
pub mod entity;

use lexical_model::*;
/// Root text, including the core's block separators.
pub fn root_text_content(state: &impl Read) -> String {
    state.text_content(NodeKey::ROOT).into_owned()
}
/// An empty root is never reported while composing; trimming uses ECMAScript whitespace.
pub fn is_root_text_content_empty(state: &impl Read, is_composing: bool, trim: bool) -> bool {
    if is_composing {
        return false;
    }
    let text = root_text_content(state);
    (if trim {
        crate::selection::js_trim(&text)
    } else {
        &text
    })
    .is_empty()
}
/// Whether the default placeholder may be displayed; preserves upstream's first-child check.
pub fn can_show_placeholder(state: &impl Read, is_composing: bool) -> bool {
    if !is_root_text_content_empty(state, is_composing, false) {
        return false;
    }
    let Ok(children) = state.children_keys(NodeKey::ROOT) else {
        return false;
    };
    if children.len() > 1 {
        return false;
    }
    if let Some(child) = children.first().copied() {
        if state.is_decorator(child)
            || !state.is::<Paragraph>(child)
            || state.element_data(child).is_ok_and(|data| data.indent != 0)
        {
            return false;
        }
        let Ok(grandchildren) = state.children_keys(child) else {
            return false;
        };
        for _ in &grandchildren {
            if grandchildren.first().is_none_or(|key| !state.is_text(*key)) {
                return false;
            }
        }
    }
    true
}
/// Deprecated upstream character intersection, excluding block and nontext leaf widths.
pub fn find_text_intersection_from_characters(
    state: StateRef<'_>,
    target: Utf16Offset,
) -> Option<(NodeKey, Utf16Offset)> {
    let mut count = 0u32;
    for item in crate::utils::dfs_iter(state, None, None) {
        if state.is_text(item.node) {
            let size = state.text_content_size(item.node).get();
            if count.checked_add(size)? > target.get() {
                return Some((item.node, Utf16Offset(target.get() - count)));
            }
            count = count.checked_add(size)?;
        }
    }
    None
}
#[cfg(test)]
mod test;
