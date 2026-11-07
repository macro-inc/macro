//! Model port of `registerLexicalTextEntity` from Lexical v0.45.0 (MIT).
use lexical_model::*;

/// A match measured in JavaScript UTF-16 code units.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EntityMatch {
    /// Inclusive start.
    pub start: Utf16Offset,
    /// Exclusive end.
    pub end: Utf16Offset,
}
/// A text subtype that recognizes and creates entities from plain text.
pub trait TextEntity: TextNode {
    /// Find the first entity in a string.
    fn get_match(text: &str) -> Option<EntityMatch>;
    /// Create a fresh entity from the text of `from`.
    fn create(
        tx: &mut Transaction<'_>,
        from: NodeKey,
    ) -> std::result::Result<NodeKey, lexical_model::Error>;
}
/// Register the forward and reverse transforms for an entity type.
pub trait TextEntityBuilderExt {
    /// Transform exact plain text and this entity's own type, in registration order.
    fn text_entity<E: TextEntity>(self) -> Self;
}
impl TextEntityBuilderExt for EditorBuilder {
    fn text_entity<E: TextEntity>(self) -> Self {
        self.transform::<Text>(text_entity_text_transform::<E>)
            .transform::<E>(text_entity_reverse_transform::<E>)
    }
}
/// Convert matching portions of a plain text node into entities.
pub fn text_entity_text_transform<E: TextEntity>(
    tx: &mut Transaction<'_>,
    node: Id<Text>,
) -> std::result::Result<(), lexical_model::Error> {
    transform_text::<E>(tx, node, E::get_match)
}
pub(crate) fn transform_text<E: TextEntity>(
    tx: &mut Transaction<'_>,
    node: Id<Text>,
    get_match: impl Fn(&str) -> Option<EntityMatch>,
) -> std::result::Result<(), lexical_model::Error> {
    if !tx.is_simple_text(node) {
        return Ok(());
    }
    let mut prev = tx.prev_sibling(node);
    let mut text = tx.text_content(node).into_owned();
    let mut current = node.key();
    if let Some(previous) = prev.filter(|key| tx.is_text(*key)) {
        let previous_text = tx.text_content(previous).into_owned();
        let previous_len = TextBuffer::new(&previous_text).utf16_len();
        let combined = format!("{previous_text}{text}");
        let previous_match = get_match(&combined);
        if tx.is::<E>(previous) {
            if previous_match.is_none() || tx.text_data(previous)?.mode != TextMode::Normal {
                return replace_with_simple_text(tx, previous);
            }
            if let Some(m) = previous_match.filter(|m| m.end > previous_len) {
                let diff = m.end - previous_len;
                let buffer = TextBuffer::new(&text);
                let prefix = buffer.slice(Utf16Offset::ZERO..diff)?;
                tx.text(previous)?.select(None, None)?;
                tx.text(previous)?
                    .set_text_content(&format!("{previous_text}{prefix}"))?;
                if diff == buffer.utf16_len() {
                    tx.remove(node, false)?;
                } else {
                    tx.text(node)?
                        .set_text_content(buffer.slice(diff..buffer.utf16_len())?)?;
                }
                return Ok(());
            }
        } else if previous_match.is_none_or(|m| m.start < previous_len) {
            return Ok(());
        }
    }
    let mut skip = Utf16Offset::ZERO;
    loop {
        let matched = get_match(&text);
        text = match matched {
            Some(m) => {
                let buffer = TextBuffer::new(&text);
                if m.end <= m.start {
                    return Err(lexical_model::Error::Invariant("empty text entity match"));
                }
                buffer.slice(m.end..buffer.utf16_len())?.to_owned()
            }
            None => String::new(),
        };
        if text.is_empty()
            && let Some(next) = tx.next_sibling(current).filter(|k| tx.is_text(*k))
        {
            let combined = format!("{}{}", tx.text_content(current), tx.text_content(next));
            match get_match(&combined) {
                None => {
                    if tx.is::<E>(next) {
                        replace_with_simple_text(tx, next)?;
                    } else {
                        tx.mark_dirty(next)?;
                    }
                    return Ok(());
                }
                Some(m) if m.start != Utf16Offset::ZERO => return Ok(()),
                Some(_) => {}
            }
        }
        let Some(m) = matched else {
            return Ok(());
        };
        if m.start == Utf16Offset::ZERO
            && prev.is_some_and(|k| tx.is_text(k) && tx.is_text_entity(k))
        {
            skip = skip + m.end;
            continue;
        }
        let parts = if m.start == Utf16Offset::ZERO {
            tx.text(current)?.split_text(&[m.end])?
        } else {
            tx.text(current)?
                .split_text(&[m.start + skip, m.end + skip])?
        };
        let index = usize::from(m.start != Utf16Offset::ZERO);
        let to_replace = *parts.get(index).ok_or(lexical_model::Error::Invariant(
            "entity split has no matching text",
        ))?;
        let remainder = parts.get(index + 1).copied();
        let replacement = E::create(tx, to_replace)?;
        let format = tx.text_data(to_replace)?.format;
        tx.text(replacement)?.set_format(format)?;
        tx.replace(to_replace, replacement, false)?;
        let Some(next) = remainder else {
            return Ok(());
        };
        current = next;
        skip = Utf16Offset::ZERO;
        prev = Some(replacement);
    }
}
/// Restore invalid or adjacent entities to simple text.
pub fn text_entity_reverse_transform<E: TextEntity>(
    tx: &mut Transaction<'_>,
    node: Id<E>,
) -> std::result::Result<(), lexical_model::Error> {
    transform_reverse::<E>(tx, node, E::get_match)
}
pub(crate) fn transform_reverse<E: TextEntity>(
    tx: &mut Transaction<'_>,
    node: Id<E>,
    get_match: impl Fn(&str) -> Option<EntityMatch>,
) -> std::result::Result<(), lexical_model::Error> {
    let text = tx.text_content(node).into_owned();
    let Some(m) = get_match(&text).filter(|m| m.start == Utf16Offset::ZERO) else {
        return replace_with_simple_text(tx, node.key());
    };
    if TextBuffer::new(&text).utf16_len() > m.end {
        tx.text(node)?.split_text(&[m.end])?;
        return Ok(());
    }
    if let Some(prev) = tx
        .prev_sibling(node)
        .filter(|k| tx.is_text(*k) && tx.is_text_entity(*k))
    {
        replace_with_simple_text(tx, prev)?;
        replace_with_simple_text(tx, node.key())?;
    }
    if let Some(next) = tx
        .next_sibling(node)
        .filter(|k| tx.is_text(*k) && tx.is_text_entity(*k))
    {
        replace_with_simple_text(tx, next)?;
        if tx.is::<E>(node) {
            replace_with_simple_text(tx, node.key())?;
        }
    }
    Ok(())
}
fn replace_with_simple_text(
    tx: &mut Transaction<'_>,
    key: NodeKey,
) -> std::result::Result<(), lexical_model::Error> {
    let text = tx.text_data(key)?.clone();
    let replacement = tx.create_text(text.text.as_str())?;
    tx.text(replacement)?.set_format(text.format)?;
    tx.replace(key, replacement, false)?;
    Ok(())
}
#[cfg(test)]
mod test;
