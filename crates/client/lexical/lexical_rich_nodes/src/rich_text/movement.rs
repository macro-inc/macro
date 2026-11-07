use super::*;
use lexical_model::*;
/// View action after a model keyboard handler.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArrowOutcome {
    /// Let the view perform native behavior.
    NotHandled,
    /// Prevent the native action.
    Handled,
    /// Ask the view to move by one character using host layout.
    MoveCharacter {
        /// Logical direction passed to the view.
        backward: bool,
    },
}
/// Backspace command routing after view-specific target and language checks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BackspaceAction {
    /// Dispatch OUTDENT_CONTENT.
    Outdent,
    /// Dispatch DELETE_CHARACTER.
    DeleteCharacter,
    /// Use native behavior.
    NotHandled,
}
/// Route Backspace, including the collapsed front-of-indented-block case.
pub fn backspace_action(state: &impl Read) -> BackspaceAction {
    match state.selection() {
        Some(Selection::Range(range)) => {
            if range.is_collapsed()
                && range.anchor.offset() == 0
                && range.anchor.key() != NodeKey::ROOT
                && let Some(block) = state.find_matching_parent(range.anchor.key(), |v, k| {
                    v.is_element(k) && !v.is_inline(k)
                })
                && state.indent(block) > 0
                && (block == range.anchor.key()
                    || state.first_descendant(block) == Some(range.anchor.key()))
            {
                return BackspaceAction::Outdent;
            }
            BackspaceAction::DeleteCharacter
        }
        Some(Selection::Node(_)) => BackspaceAction::DeleteCharacter,
        _ => BackspaceAction::NotHandled,
    }
}
/// Whether Delete applies to the current selection kind.
pub fn delete_key_applies(state: &impl Read) -> bool {
    matches!(
        state.selection(),
        Some(Selection::Range(_) | Selection::Node(_))
    )
}
/// Convert a sole block-decorator selection to a range and process Enter escaping.
pub fn prepare_enter(
    tx: &mut Transaction<'_>,
    cfg: &EscapeFormatTriggerConfig,
) -> crate::Result<bool> {
    if let Some(Selection::Node(nodes)) = tx.selection() {
        let nodes = nodes.nodes(tx.view());
        if let [key] = nodes.as_slice()
            && tx.is_decorator(*key)
            && !tx.is_inline(*key)
        {
            tx.select_next(*key, None, None)?;
        }
    }
    if !matches!(tx.selection(), Some(Selection::Range(_))) {
        return Ok(false);
    }
    escape_formats_for_trigger(
        tx,
        SelectionSlot::Active,
        EscapeFormatTrigger::Enter,
        EscapeDirection::Both,
        cfg,
    )?;
    Ok(true)
}
/// Space and Tab process escaping without consuming the key.
pub fn escape_on_key(
    tx: &mut Transaction<'_>,
    trigger: EscapeFormatTrigger,
    cfg: &EscapeFormatTriggerConfig,
) -> crate::Result<bool> {
    if matches!(tx.selection(), Some(Selection::Range(_))) {
        escape_formats_for_trigger(
            tx,
            SelectionSlot::Active,
            trigger,
            EscapeDirection::Both,
            cfg,
        )?;
    }
    Ok(false)
}
/// Move above a selected or adjacent non-isolated block decorator.
pub fn arrow_up(tx: &mut Transaction<'_>, shift: bool) -> crate::Result<ArrowOutcome> {
    arrow_vertical(tx, shift, true)
}
/// Move below a selected decorator, or swallow navigation at the end of the root.
pub fn arrow_down(tx: &mut Transaction<'_>, shift: bool) -> crate::Result<ArrowOutcome> {
    arrow_vertical(tx, shift, false)
}
fn arrow_vertical(
    tx: &mut Transaction<'_>,
    shift: bool,
    backward: bool,
) -> crate::Result<ArrowOutcome> {
    let node = match tx.selection() {
        Some(Selection::Node(nodes)) => nodes.nodes(tx.view()).first().copied(),
        Some(Selection::Range(range)) => {
            if !backward && is_selection_at_end_of_root(tx.view(), range) {
                return Ok(ArrowOutcome::Handled);
            }
            if shift {
                return Ok(ArrowOutcome::NotHandled);
            }
            tx.adjacent_node(
                &range.focus,
                if backward {
                    EditDirection::Backward
                } else {
                    EditDirection::Forward
                },
            )?
            .filter(|k| tx.is_decorator(*k) && !tx.is_inline(*k) && !tx.is_isolated(*k))
        }
        _ => None,
    };
    if let Some(key) = node {
        if backward {
            tx.select_previous(key, None, None)?;
        } else {
            tx.select_next(key, Some(Utf16Offset::ZERO), Some(Utf16Offset::ZERO))?;
        }
        return Ok(ArrowOutcome::Handled);
    }
    Ok(ArrowOutcome::NotHandled)
}
fn is_selection_at_end_of_root(view: StateRef<'_>, range: &RangeSelection) -> bool {
    let focus = range.focus;
    matches!(focus, Point::Element { key: NodeKey::ROOT, offset } if offset.0 == view.children_size(NodeKey::ROOT))
}
/// Left arrow model routing; the view supplies parent RTL information.
pub fn arrow_left(
    tx: &mut Transaction<'_>,
    shift: bool,
    is_parent_rtl: bool,
    cfg: &EscapeFormatTriggerConfig,
) -> crate::Result<ArrowOutcome> {
    arrow_horizontal(tx, shift, is_parent_rtl, true, cfg)
}
/// Right arrow model routing; the view supplies parent RTL information.
pub fn arrow_right(
    tx: &mut Transaction<'_>,
    shift: bool,
    is_parent_rtl: bool,
    cfg: &EscapeFormatTriggerConfig,
) -> crate::Result<ArrowOutcome> {
    arrow_horizontal(tx, shift, is_parent_rtl, false, cfg)
}
fn arrow_horizontal(
    tx: &mut Transaction<'_>,
    shift: bool,
    rtl: bool,
    backward: bool,
    cfg: &EscapeFormatTriggerConfig,
) -> crate::Result<ArrowOutcome> {
    if let Some(Selection::Node(nodes)) = tx.selection()
        && let Some(key) = nodes.nodes(tx.view()).first().copied()
    {
        if backward != rtl {
            tx.select_previous(key, None, None)?;
        } else {
            tx.select_next(key, Some(Utf16Offset::ZERO), Some(Utf16Offset::ZERO))?;
        }
        return Ok(ArrowOutcome::Handled);
    }
    if !matches!(tx.selection(), Some(Selection::Range(_))) {
        return Ok(ArrowOutcome::NotHandled);
    }
    if !shift {
        escape_formats_for_trigger(
            tx,
            SelectionSlot::Active,
            EscapeFormatTrigger::Arrow,
            if backward {
                EscapeDirection::Start
            } else {
                EscapeDirection::End
            },
            cfg,
        )?;
    }
    if crate::selection::should_override_default_character_selection(
        tx.view(),
        tx.range_selection()?,
        backward != rtl,
    )? {
        return Ok(ArrowOutcome::MoveCharacter { backward });
    }
    Ok(ArrowOutcome::NotHandled)
}
/// Work around native movement stopping before an initial inline decorator.
pub fn move_to_end(tx: &mut Transaction<'_>, shift: bool) -> crate::Result<ArrowOutcome> {
    let Some(Selection::Range(range)) = tx.selection() else {
        return Ok(ArrowOutcome::NotHandled);
    };
    let Point::Element {
        key,
        offset: ChildIndex(0),
    } = range.anchor
    else {
        return Ok(ArrowOutcome::NotHandled);
    };
    if !has_inline_decorator_and_text(tx.view(), key) {
        return Ok(ArrowOutcome::NotHandled);
    }
    tx.select_end(key)?;
    if shift {
        tx.set_point(PointRole::Anchor, Point::element(key, ChildIndex(0)))?;
    }
    Ok(ArrowOutcome::Handled)
}
/// Move before an initial inline decorator when both endpoints belong to its block.
pub fn move_to_start(tx: &mut Transaction<'_>, shift: bool) -> crate::Result<ArrowOutcome> {
    let Some(Selection::Range(range)) = tx.selection() else {
        return Ok(ArrowOutcome::NotHandled);
    };
    let block =
        tx.find_matching_parent(range.focus.key(), |v, k| v.is_element(k) && !v.is_inline(k));
    let Some(block) = block else {
        return Ok(ArrowOutcome::NotHandled);
    };
    let anchor_block = tx.find_matching_parent(range.anchor.key(), |v, k| {
        v.is_element(k) && !v.is_inline(k)
    });
    let point = Point::element(block, ChildIndex(0));
    if anchor_block != Some(block)
        || range.focus == point
        || !has_inline_decorator_and_text(tx.view(), block)
    {
        return Ok(ArrowOutcome::NotHandled);
    }
    tx.set_point(PointRole::Focus, point)?;
    if !shift {
        tx.set_point(PointRole::Anchor, point)?;
    }
    Ok(ArrowOutcome::Handled)
}
fn has_inline_decorator_and_text(view: StateRef<'_>, key: NodeKey) -> bool {
    view.first_child(key)
        .is_some_and(|k| view.is_decorator(k) && view.is_inline(k))
        && view
            .last_descendant(key)
            .is_some_and(|k| !view.is_decorator(k))
}
#[cfg(test)]
mod test;
