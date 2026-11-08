//! Plain code runs and indentation removal, without syntax highlighting.
use lexical_model::*;
/// Split LF and tab separators into nodes, preserving CR and all other text.
pub fn plainify_code_content(tx: &mut Transaction<'_>, text: &str) -> Result<Vec<NodeKey>, Error> {
    let mut out = Vec::new();
    for (line_index, line) in text.split('\n').enumerate() {
        if line_index != 0 {
            out.push(tx.create(LineBreak {})?.key());
        }
        for (part_index, part) in line.split('\t').enumerate() {
            if part_index != 0 {
                out.push(tx.create(Tab {})?.key());
            }
            if !part.is_empty() {
                out.push(tx.create_text(part)?.key());
            }
        }
    }
    Ok(out)
}
/// Remove up to tab_size leading spaces and shift matching text selection points.
pub fn outdent_leading_spaces(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    tab_size: u32,
) -> Result<bool, Error> {
    let text = tx.text_content(node);
    let leading = text.bytes().take_while(|byte| *byte == b' ').count();
    let count = u32::try_from(leading)
        .map_err(|_| Error::Invariant("code indentation exceeds UTF-16 range"))?
        .min(tab_size);
    if count == 0 {
        return Ok(false);
    }
    let previous = tx.selection().and_then(Selection::as_range).cloned();
    tx.text(node)?
        .splice_text(Utf16Offset::ZERO..Utf16Offset(count), "", false)?;
    if let Some(range) = previous {
        for (role, point) in [
            (PointRole::Anchor, range.anchor),
            (PointRole::Focus, range.focus),
        ] {
            if let Point::Text { key, offset } = point
                && key == node
            {
                tx.set_point(
                    role,
                    Point::text(key, offset.saturating_sub(Utf16Offset(count))),
                )?;
            }
        }
    }
    Ok(true)
}
#[cfg(test)]
mod test;
