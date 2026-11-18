//! Typed selection operations against the caller's current graph and value slot.
use super::compat;
use crate::BoundaryError;
use compat::{CompatOperation as Op, ForeignCallbackValue as Value};
use lexical_model::{
    EditDirection, Error, KeyParts, ModifyTarget, NodeKey, Point, PointType, Selection,
    SelectionSlot, TextFormat, TextFormatType, Transaction,
};

/// Values which the owning ledger encodes using its issued reference captures.
#[derive(Debug)]
pub(super) enum SelectionOpResult {
    Scalar(Value),
    Nodes(Vec<NodeKey>),
    None,
}

fn arity(args: &[Value], minimum: usize, maximum: usize) -> Result<(), BoundaryError> {
    if !(minimum..=maximum).contains(&args.len()) {
        return Err(BoundaryError::Invalid("selection argument count"));
    }
    Ok(())
}

fn text(value: Option<&Value>) -> Result<String, BoundaryError> {
    let Some(Value::ForeignStringArgument { value }) = value else {
        return Err(BoundaryError::Invalid("selection string argument"));
    };
    String::from_utf16(value).map_err(|_| BoundaryError::Invalid("UTF-16 argument"))
}

fn boolean(value: Option<&Value>) -> Result<bool, BoundaryError> {
    let Some(Value::ForeignBooleanArgument { value }) = value else {
        return Err(BoundaryError::Invalid("selection boolean argument"));
    };
    Ok(*value)
}

fn integer(value: f64) -> Result<u32, BoundaryError> {
    if !value.is_finite() || value < 0.0 || value > f64::from(u32::MAX) || value.fract() != 0.0 {
        return Err(BoundaryError::Invalid("selection integer argument"));
    }
    Ok(value as u32)
}

fn format(value: Option<&Value>) -> Result<TextFormatType, BoundaryError> {
    text(value)?
        .parse()
        .map_err(|_| BoundaryError::Invalid("selection text format"))
}

fn key(reference: &compat::ForeignNodeRef) -> NodeKey {
    NodeKey::from_parts(KeyParts {
        index: reference.key.index,
        generation: reference.key.generation,
    })
}

fn flag(value: u32) -> Result<bool, BoundaryError> {
    match value {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(BoundaryError::Invalid("selection target flag")),
    }
}

fn point(
    reference: &compat::ForeignNodeRef,
    offset: u32,
    kind: u32,
) -> Result<Point, BoundaryError> {
    let kind = match kind {
        0 => PointType::Text,
        1 => PointType::Element,
        _ => return Err(BoundaryError::Invalid("selection target point kind")),
    };
    Ok(Point::new(key(reference), offset, kind))
}

fn target(args: &[Value]) -> Result<ModifyTarget, BoundaryError> {
    if args.is_empty() {
        return Ok(ModifyTarget::RequireView);
    }
    let [Value::ForeignNodeArrayArgument { values: nodes }, Value::ForeignNumberArrayArgument { values }] =
        args
    else {
        return Err(BoundaryError::Invalid("selection target argument pair"));
    };
    let [anchor, focus] = nodes.as_slice() else {
        return Err(BoundaryError::Invalid("selection target node count"));
    };
    let [anchor_offset, anchor_kind, focus_offset, focus_kind, dirty, backward] = values.as_slice()
    else {
        return Err(BoundaryError::Invalid("selection target number count"));
    };
    Ok(ModifyTarget::View {
        anchor: point(anchor, integer(*anchor_offset)?, integer(*anchor_kind)?)?,
        focus: point(focus, integer(*focus_offset)?, integer(*focus_kind)?)?,
        resolution_dirty: flag(integer(*dirty)?)?,
        is_backward_in_dom: flag(integer(*backward)?)?,
    })
}

fn delete(
    tx: &mut Transaction<'_>,
    slot: SelectionSlot,
    op: Op,
    args: &[Value],
) -> Result<(), BoundaryError> {
    if !matches!(args.len(), 1 | 3 | 5) || (op == Op::SelectionDeleteCharacter && args.len() == 5) {
        return Err(BoundaryError::Invalid("selection deletion argument count"));
    }
    let direction = if boolean(args.first())? {
        EditDirection::Backward
    } else {
        EditDirection::Forward
    };
    let first = target(args.get(1..3).unwrap_or_default())?;
    let fallback = target(args.get(3..5).unwrap_or_default())?;
    match op {
        Op::SelectionDeleteCharacter => tx.delete_character_at(slot, direction, first)?,
        Op::SelectionDeleteWord => tx.delete_word_at(slot, direction, first, fallback)?,
        Op::SelectionDeleteLine => tx.delete_line_at(slot, direction, first, fallback)?,
        _ => return Err(BoundaryError::Invalid("selection deletion operation")),
    }
    Ok(())
}

/// Apply only the assigned value's operation; activation and ownership stay in the caller.
pub(super) fn apply(
    tx: &mut Transaction<'_>,
    slot: SelectionSlot,
    op: Op,
    args: &[Value],
) -> Result<SelectionOpResult, BoundaryError> {
    let result = match op {
        Op::SelectionGetNodes => {
            arity(args, 0, 0)?;
            let selection = tx.selection_at(slot)?.ok_or(Error::NoSelection)?;
            SelectionOpResult::Nodes(selection.nodes(tx.view())?)
        }
        Op::SelectionGetTextContent => {
            arity(args, 0, 0)?;
            let selection = tx.selection_at(slot)?.ok_or(Error::NoSelection)?;
            let value = selection.text_content(tx.view())?;
            SelectionOpResult::Scalar(Value::ForeignStringArgument {
                value: value.encode_utf16().collect(),
            })
        }
        Op::SelectionInsertText => {
            arity(args, 1, 1)?;
            tx.insert_text_at(slot, &text(args.first())?)?;
            SelectionOpResult::None
        }
        Op::SelectionInsertNodes => {
            arity(args, 1, 1)?;
            let Some(Value::ForeignNodeArrayArgument { values }) = args.first() else {
                return Err(BoundaryError::Invalid("selection node array argument"));
            };
            let nodes: Vec<_> = values.iter().map(key).collect();
            tx.insert_nodes_at(slot, &nodes)?;
            SelectionOpResult::None
        }
        Op::SelectionFormatText => {
            arity(args, 1, 2)?;
            let format = format(args.first())?;
            let align = match args.get(1) {
                None
                | Some(Value::ForeignOpaqueArgument {
                    value:
                        compat::ForeignOpaqueValue::ForeignNull {}
                        | compat::ForeignOpaqueValue::ForeignUndefined {},
                }) => None,
                Some(Value::ForeignNumberArgument { value }) => {
                    Some(TextFormat::from_bits_retain(integer(*value)?))
                }
                _ => return Err(BoundaryError::Invalid("selection alignment format")),
            };
            tx.format_text_at(slot, format, align)?;
            SelectionOpResult::None
        }
        Op::SelectionDeleteCharacter | Op::SelectionDeleteWord | Op::SelectionDeleteLine => {
            delete(tx, slot, op, args)?;
            SelectionOpResult::None
        }
        Op::SelectionInsertParagraph => {
            arity(args, 0, 0)?;
            SelectionOpResult::Nodes(tx.insert_paragraph_at(slot)?.into_iter().collect())
        }
        Op::SelectionInsertLineBreak => {
            arity(args, 0, 1)?;
            let select_start = match args.first() {
                None
                | Some(Value::ForeignOpaqueArgument {
                    value: compat::ForeignOpaqueValue::ForeignUndefined {},
                }) => false,
                value => boolean(value)?,
            };
            tx.insert_line_break_at(slot, select_start)?;
            SelectionOpResult::None
        }
        Op::SelectionExtract => {
            arity(args, 0, 0)?;
            SelectionOpResult::Nodes(tx.extract_at(slot)?)
        }
        Op::SelectionIsCollapsed => {
            arity(args, 0, 0)?;
            let value = tx
                .selection_at(slot)?
                .ok_or(Error::NoSelection)?
                .is_collapsed();
            SelectionOpResult::Scalar(Value::ForeignBooleanArgument { value })
        }
        Op::SelectionIsBackward => {
            arity(args, 0, 0)?;
            let value = if matches!(tx.selection_at(slot)?, Some(Selection::Range(_))) {
                tx.range_is_backward_at(slot)?
            } else {
                tx.selection_at(slot)?
                    .ok_or(Error::NoSelection)?
                    .is_backward(tx.view())?
            };
            SelectionOpResult::Scalar(Value::ForeignBooleanArgument { value })
        }
        Op::SelectionHasFormat => {
            arity(args, 1, 1)?;
            let value = tx.range_at(slot)?.has_format(format(args.first())?);
            SelectionOpResult::Scalar(Value::ForeignBooleanArgument { value })
        }
        _ => return Err(BoundaryError::Invalid("compatibility selection operation")),
    };
    Ok(result)
}

#[cfg(test)]
mod test;
