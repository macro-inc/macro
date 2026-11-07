//! Text slicing and style patching over active or detached selections.
use super::*;
/// A style update. Computed values read the original parsed style.
pub enum StylePatchValue {
    /// Set a literal property value.
    Set(String),
    /// Remove a property.
    Remove,
    /// Compute a new value from the original style and the current target.
    Compute(Box<dyn Fn(Option<&str>, PatchTarget) -> String>),
}
/// Property updates in application order.
pub type StylePatch = indexmap::IndexMap<String, StylePatchValue>;
/// The target supplied to a computed style update.
#[derive(Clone, Copy, Debug)]
pub enum PatchTarget {
    /// A text node.
    Text(NodeKey),
    /// An empty element's text style.
    Element(NodeKey),
    /// A collapsed range's typing style.
    CollapsedSelection,
}
fn patched_style(style: &str, patch: &StylePatch, target: PatchTarget) -> String {
    let previous = style_object_from_css(style);
    let mut next = previous.clone();
    for (key, value) in patch {
        match value {
            StylePatchValue::Remove => {
                next.shift_remove(key);
            }
            StylePatchValue::Set(value) => {
                next.insert(key.clone(), value.clone());
            }
            StylePatchValue::Compute(compute) => {
                next.insert(
                    key.clone(),
                    compute(previous.get(key).map(String::as_str), target),
                );
            }
        }
    }
    css_from_style_object(&next)
}
/// Put a range in document order, using the containing view for cross-node points.
pub fn ensure_forward_range_selection(
    state: StateRef<'_>,
    selection: &mut RangeSelection,
) -> Result<(), Error> {
    if selection.is_backward(state)? {
        std::mem::swap(&mut selection.anchor, &mut selection.focus);
    }
    Ok(())
}
/// Whether a point is at its text or element end.
pub fn is_at_node_end(state: &impl Read, point: &Point) -> Result<bool, Error> {
    match *point {
        Point::Text { key, offset } if state.is_text(key) => {
            Ok(offset == state.text_content_size(key))
        }
        Point::Element { key, offset } if state.is_element(key) => {
            Ok(offset.0 == state.children_size(key))
        }
        _ => Err(Error::Invariant(
            "isAtNodeEnd expected a text or element point",
        )),
    }
}
/// Slice only selected boundary text; token and segmented nodes remain whole.
pub fn slice_selected_text_node_content(
    state: StateRef<'_>,
    selection: &Selection,
    text: NodeKey,
) -> Result<String, Error> {
    let data = state.text_data(text)?;
    let Selection::Range(range) = selection else {
        return Ok(data.text.as_str().to_owned());
    };
    if data.mode != TextMode::Normal || !range.nodes(state)?.contains(&text) {
        return Ok(data.text.as_str().to_owned());
    }
    let (start, end) = if range.is_backward(state)? {
        (range.focus, range.anchor)
    } else {
        (range.anchor, range.focus)
    };
    let from = if start.key() == text {
        Utf16Offset(start.offset())
    } else {
        Utf16Offset::ZERO
    };
    let to = if end.key() == text {
        Utf16Offset(end.offset())
    } else {
        state.text_content_size(text)
    };
    Ok(data.text.slice(from..to)?.to_owned())
}
/// Visit each formattable selected text run, splitting partial normal text first.
pub fn for_each_selected_text_node(
    tx: &mut Transaction<'_>,
    mut f: impl FnMut(&mut Transaction<'_>, NodeKey) -> Result<(), Error>,
) -> Result<(), Error> {
    let Some(selection) = tx.selection().cloned() else {
        return Ok(());
    };
    let slices = if let Selection::Range(range) = &selection {
        let (a, b) = caret_range_from_selection(tx.view(), range)?.text_slices(tx.view())?;
        [a, b]
            .into_iter()
            .flatten()
            .map(|slice| (slice.caret.origin, slice.slice_indices()))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    for node in selection.nodes(tx.view())? {
        if !tx.is_text(node) || !tx.can_have_format(node) {
            continue;
        }
        let size = tx.text_content_size(node);
        let slice = slices
            .iter()
            .find(|(key, _)| *key == node)
            .map(|(_, slice)| slice.clone())
            .unwrap_or(Utf16Offset::ZERO..size);
        if slice.start == slice.end {
            continue;
        }
        let target =
            if tx.text_data(node)?.mode != TextMode::Normal || slice == (Utf16Offset::ZERO..size) {
                node
            } else {
                let parts = tx.text(node)?.split_text(&[slice.start, slice.end])?;
                *parts
                    .get(usize::from(slice.start != Utf16Offset::ZERO))
                    .ok_or(Error::Invariant("selected text split is empty"))?
            };
        f(tx, target)?;
    }
    if let Ok(range) = tx.range_selection()
        && matches!((range.anchor, range.focus), (Point::Text {key:a,..}, Point::Text {key:b,..}) if a == b)
        && range.is_backward(tx.view())?
    {
        let (a, f) = (range.anchor, range.focus);
        tx.set_point(PointRole::Anchor, f)?;
        tx.set_point(PointRole::Focus, a)?;
    }
    Ok(())
}
fn patch_element(tx: &mut Transaction<'_>, node: NodeKey, patch: &StylePatch) -> Result<(), Error> {
    let next = patched_style(
        &tx.element_data(node)?.text_style,
        patch,
        PatchTarget::Element(node),
    );
    tx.element(node)?.set_text_style(&next)?;
    Ok(())
}
/// Patch argument typing style and empty elements, but active selected text, as upstream does.
pub fn patch_style_text(
    tx: &mut Transaction<'_>,
    slot: SelectionSlot,
    patch: &StylePatch,
) -> Result<(), Error> {
    let selection = tx.selection_at(slot)?.cloned();
    let mut patched = Vec::new();
    if let Some(Selection::Range(range)) = &selection
        && range.is_collapsed()
    {
        let style = patched_style(&range.style, patch, PatchTarget::CollapsedSelection);
        tx.set_selection_style_at(slot, &style)?;
        let key = range.anchor.key();
        if tx.is_element(key) && tx.children_size(key) == 0 {
            patch_element(tx, key, patch)?;
            patched.push(key);
        }
    }
    for_each_selected_text_node(tx, |tx, key| {
        let style = patched_style(&tx.text_data(key)?.style, patch, PatchTarget::Text(key));
        tx.text(key)?.set_style(&style)?;
        Ok(())
    })?;
    if let Some(selection) = tx.selection_at(slot)?.cloned() {
        for key in selection.nodes(tx.view())? {
            if tx.is_element(key)
                && tx.can_be_empty(key)
                && tx.children_size(key) == 0
                && !patched.contains(&key)
            {
                patch_element(tx, key, patch)?;
                patched.push(key);
            }
        }
    }
    Ok(())
}
#[cfg(test)]
mod test;
