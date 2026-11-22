//! Owned selection execution without host or value-ledger borrows across model hooks.
use super::{
    compat,
    selection_ops::{self, SelectionOpResult},
    selection_values::{Origin, SelectionValue},
};
use crate::BoundaryError;
use lexical_model::{ForeignSelectionIdentity, SelectionSlot, Transaction};

pub(super) struct SelectionExecution {
    pub result: Result<SelectionOpResult, BoundaryError>,
    pub value: SelectionValue,
    pub active_identity: Option<ForeignSelectionIdentity>,
    pub value_is_active: bool,
    pub writes_graph: bool,
    /// A mutable current query changed raw memo metadata without a graph write.
    pub value_metadata_changed: bool,
}

/// The parent validates receiver authority, frozen state and node arguments first.
/// Helper failures remain inside the result so the parent can publish their effects.
pub(super) fn execute(
    tx: &mut Transaction<'_>,
    mut value: SelectionValue,
    historical: bool,
    op: compat::CompatOperation,
    args: &[compat::ForeignCallbackValue],
) -> Result<SelectionExecution, BoundaryError> {
    use compat::CompatOperation as Op;
    let writes_graph = match op {
        Op::SelectionInsertText
        | Op::SelectionInsertNodes
        | Op::SelectionFormatText
        | Op::SelectionDeleteCharacter
        | Op::SelectionDeleteWord
        | Op::SelectionDeleteLine
        | Op::SelectionInsertParagraph
        | Op::SelectionInsertLineBreak
        | Op::SelectionExtract => true,
        Op::SelectionGetNodes
        | Op::SelectionGetTextContent
        | Op::SelectionIsCollapsed
        | Op::SelectionIsBackward
        | Op::SelectionHasFormat => false,
        _ => return Err(BoundaryError::Invalid("compatibility selection operation")),
    };
    let slot = if historical {
        tx.detach_foreign_selection(
            value.value.snapshot_for_foreign_read(),
            value.identity.clone(),
        )
    } else {
        tx.foreign_selection_slot(&value.identity)
            .unwrap_or_else(|| {
                tx.detach_foreign_selection(
                    value.value.snapshot_for_foreign_read(),
                    value.identity.clone(),
                )
            })
    };
    if !historical {
        tx.synchronize_foreign_selection_value(slot, value.value.snapshot_for_foreign_read())?;
    }
    let previous_backward = value
        .value
        .as_range()
        .and_then(lexical_model::RangeSelection::cached_is_backward);
    let result = selection_ops::apply(tx, slot, op, args);
    let current_slot = tx
        .foreign_selection_slot(&value.identity)
        .ok_or(BoundaryError::Invalid("selection identity retired"))?;
    if writes_graph || (!historical && value.origin != Origin::Frozen) {
        value.value = tx
            .selection_at(current_slot)?
            .ok_or(BoundaryError::Invalid("selection value retired"))?
            .snapshot_for_foreign_read();
    }
    if writes_graph {
        value.cached_nodes = None;
    }
    let value_metadata_changed = !writes_graph
        && !historical
        && value.origin != Origin::Frozen
        && previous_backward
            != value
                .value
                .as_range()
                .and_then(lexical_model::RangeSelection::cached_is_backward);
    Ok(SelectionExecution {
        result,
        value,
        active_identity: tx.foreign_selection_identity(SelectionSlot::Active),
        value_is_active: current_slot == SelectionSlot::Active,
        writes_graph,
        value_metadata_changed,
    })
}

#[cfg(test)]
mod test;
