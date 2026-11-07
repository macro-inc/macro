//! Read selected CSS values without changing the selection.
use super::*;
/// Read a common text style value, or an empty string when selected values disagree.
pub fn get_selection_style_value_for_property(
    state: StateRef<'_>,
    selection: &Selection,
    property: &str,
    default: &str,
) -> Result<String, Error> {
    let range = selection.as_range();
    if let Some(range) = range
        && range.is_collapsed()
        && !range.style.is_empty()
        && let Some(value) = style_object_from_css(&range.style).get(property)
    {
        return Ok(value.clone());
    }
    let endpoints = range
        .map(|range| -> Result<_, Error> {
            Ok(if range.is_backward(state)? {
                (range.focus, range.anchor)
            } else {
                (range.anchor, range.focus)
            })
        })
        .transpose()?;
    let mut value = None;
    for (index, node) in selection.nodes(state)?.into_iter().enumerate() {
        if !state.is_text(node) {
            continue;
        }
        if let Some((start, end)) = endpoints {
            if index == 0
                && start.key() == node
                && start.offset() == state.text_content_size(node).get()
            {
                continue;
            }
            if index != 0 && end.key() == node && end.offset() == 0 {
                continue;
            }
        }
        let next = style_object_from_css(&state.text_data(node)?.style)
            .get(property)
            .cloned()
            .unwrap_or_else(|| default.to_owned());
        if value.as_ref().is_some_and(|value| *value != next) {
            return Ok(String::new());
        }
        value = Some(next);
    }
    Ok(value.unwrap_or_else(|| default.to_owned()))
}
