//! Read-only export selections, with lossy UTF-16 boundary slicing.
use lexical_model::*;
/// Core selected-node predicate, including inline decorator and element-boundary rules.
pub fn is_selected(state: &EditorState, key: NodeKey, selection: &Selection) -> bool {
    state.is_selected(key, Some(selection))
}
/// Return a changed selected boundary slice; lone surrogate halves become U+FFFD.
pub fn slice_selected_text(
    state: &EditorState,
    selection: &Selection,
    key: NodeKey,
) -> crate::Result<Option<String>> {
    let Selection::Range(range) = selection else {
        return Ok(None);
    };
    let data = state.text_data(key)?;
    if data.mode != TextMode::Normal || !is_selected(state, key, selection) {
        return Ok(None);
    }
    if range.anchor.key() != key && range.focus.key() != key {
        return Ok(None);
    }
    let (a, f) = state.character_offsets(selection)?;
    let (first, last) = if range.is_backward(state.view())? {
        (range.focus, range.anchor)
    } else {
        (range.anchor, range.focus)
    };
    let (start, end) = if range.anchor.key() == range.focus.key() {
        (a.min(f).get(), a.max(f).get())
    } else if first.key() == key {
        (
            if range.is_backward(state.view())? {
                f
            } else {
                a
            }
            .get(),
            data.text.utf16_len().get(),
        )
    } else if last.key() == key {
        (
            0,
            if range.is_backward(state.view())? {
                a
            } else {
                f
            }
            .get(),
        )
    } else {
        return Ok(None);
    };
    let units = data.text.as_str().encode_utf16().collect::<Vec<_>>();
    let from = (start as usize).min(units.len());
    let to = (end as usize).min(units.len());
    let text = String::from_utf16_lossy(units.get(from..to).unwrap_or_default());
    Ok((text != data.text.as_str()).then_some(text))
}
