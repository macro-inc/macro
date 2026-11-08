//! Model halves of `registerPlainText`; only range selections accept edits.
use crate::rich_text::{self, ArrowOutcome, BackspaceAction};
use lexical_model::*;
/// Plain text removes characters only from range selections.
pub fn delete_character(
    tx: &mut Transaction<'_>,
    direction: EditDirection,
    target: ModifyTarget,
) -> crate::Result<bool> {
    if !matches!(tx.selection(), Some(Selection::Range(_))) {
        return Ok(false);
    }
    rich_text::delete_character(tx, direction, target)
}
/// Plain text word deletion requires a range.
pub fn delete_word(
    tx: &mut Transaction<'_>,
    direction: EditDirection,
    target: ModifyTarget,
    character_target: ModifyTarget,
) -> crate::Result<bool> {
    rich_text::delete_word(tx, direction, target, character_target)
}
/// Plain text line deletion requires a range.
pub fn delete_line(
    tx: &mut Transaction<'_>,
    direction: EditDirection,
    target: ModifyTarget,
    character_target: ModifyTarget,
) -> crate::Result<bool> {
    rich_text::delete_line(tx, direction, target, character_target)
}
/// Insert a string only into a range; null and node selections are unhandled.
pub fn controlled_text_insertion(tx: &mut Transaction<'_>, text: &str) -> crate::Result<bool> {
    if !matches!(tx.selection(), Some(Selection::Range(_))) {
        return Ok(false);
    }
    rich_text::controlled_text_insertion(tx, text)
}
/// Enter inserts a line break in plain text, preserving the paragraph.
pub fn insert_paragraph(tx: &mut Transaction<'_>) -> crate::Result<bool> {
    rich_text::insert_line_break(tx, false)
}
/// Plain-text Backspace never outdents.
pub fn backspace_action(state: &impl Read) -> BackspaceAction {
    if enter_applies(state) {
        BackspaceAction::DeleteCharacter
    } else {
        BackspaceAction::NotHandled
    }
}
/// Plain-text horizontal arrows have no format escaping or node-selection handling.
pub fn arrow_horizontal(
    state: &impl Read,
    backward: bool,
    adjusted_is_backward: bool,
) -> crate::Result<ArrowOutcome> {
    let Some(Selection::Range(range)) = state.selection() else {
        return Ok(ArrowOutcome::NotHandled);
    };
    if crate::selection::should_override_default_character_selection(
        state.view(),
        range,
        adjusted_is_backward,
    )? {
        Ok(ArrowOutcome::MoveCharacter { backward })
    } else {
        Ok(ArrowOutcome::NotHandled)
    }
}
/// Enter applies only to a range.
pub fn enter_applies(state: &impl Read) -> bool {
    matches!(state.selection(), Some(Selection::Range(_)))
}
/// Delete applies only to a range.
pub fn delete_key_applies(state: &impl Read) -> bool {
    enter_applies(state)
}
/// Cut only a range; leave node selections unchanged.
pub fn cut_selection(tx: &mut Transaction<'_>) -> crate::Result<()> {
    if enter_applies(tx) {
        tx.remove_text()?;
    }
    Ok(())
}
/// Reuse the range-only line-break handler.
pub use rich_text::insert_line_break;
/// Reuse the range-only remove handler.
pub use rich_text::remove_text;
/// Select the whole document even with null selection (R2-11).
pub use rich_text::select_all;
/// Plain-text registration does not add any nodes.
pub fn register_plain_text(builder: EditorBuilder) -> EditorBuilder {
    builder
}
#[cfg(test)]
mod test;
