//! Execute under scoped metadata, dropping every store guard before model callbacks.
use super::*;
use calls::{undefined, ResultValue};
use compat::CompatBatchOutcome as Outcome;
use lexical_model::*;
use scopes::with_current_host;

pub(super) fn execute(
    tx: &mut Transaction<'_>,
    operations: &[compat::CompatBatchOperation],
    normalize: bool,
    reservations: Vec<compat::CompatKeyReservation>,
) -> Result<compat::CompatBatchReply, BoundaryError> {
    let mut results = Vec::new();
    let mut selection_refs = BTreeMap::new();
    let mut outcome = Outcome::CompatBatchSuccess {};
    for (index, operation) in operations.iter().enumerate() {
        let mut call = None;
        let guard = ForeignReadOperation::begin()?;
        let result = if construction::creates(operation.operation) {
            with_current_host(|host| host.prepare_reserved_creation(operation)).and_then(
                |(construction, ticket)| {
                    construction
                        .execute(tx, ticket)
                        .map(|key| ResultValue::Node(Some(key)))
                        .map_err(BoundaryError::Model)
                },
            )
        } else {
            with_current_host(|host| host.batch_request(operation)).and_then(|request| {
                let result = scopes::dispatch_current(tx, &request);
                call = Some(request);
                result
            })
        };
        let result = guard.finish(result);
        for arg in call.iter().flat_map(|call| &call.args) {
            if let compat::ForeignCallbackValue::ForeignSelectionArgument { value } = arg {
                selection_refs.insert((value.editor_id, value.version, value.selection_id), *value);
            }
        }
        match result {
            Ok(result) => {
                let (reply, delta) = with_current_host(|host| {
                    let receiver = match &call {
                        Some(call) if call.has_receiver => Some(host.receiver(call)?),
                        _ => None,
                    };
                    let (reply, delta) = host.batch_delta(tx, result, receiver)?;
                    if construction::creates(operation.operation) {
                        let (reservation, key) = construction::reserved(&operation.receiver)?;
                        let record = delta
                            .records
                            .iter()
                            .find(|record| record.record.node.key == records::key(key))
                            .ok_or(BoundaryError::Invalid("constructed result record missing"))?;
                        host.capture_leases.hold(
                            capture_leases::NativeOwner::Update(host.update),
                            &[record.record.capture_id],
                        )?;
                        host.constructed.insert((reservation, key), record.record);
                    }
                    Ok((reply, delta))
                })?;
                for selection in reply.selections {
                    match selection {
                        compat::CompatSelectionData::CompatRangeSelection { reference, .. }
                        | compat::CompatSelectionData::CompatNodeSelection { reference, .. }
                        | compat::CompatSelectionData::CompatTableSelection { reference, .. } => {
                            selection_refs.insert(
                                (
                                    reference.editor_id,
                                    reference.version,
                                    reference.selection_id,
                                ),
                                reference,
                            );
                        }
                        _ => {}
                    }
                }
                results.push(compat::CompatBatchResult {
                    value: reply.value,
                    delta,
                });
            }
            Err(error) => {
                outcome = batch::failure(
                    error,
                    compat::CompatFailureLocation::CompatOperationFailure {
                        index: u32::try_from(index)
                            .map_err(|_| BoundaryError::Invalid("batch operation count"))?,
                    },
                );
                break;
            }
        }
    }
    if normalize && matches!(outcome, Outcome::CompatBatchSuccess {}) {
        let guard = ForeignReadOperation::begin()?;
        if let Err(error) = guard.finish(tx.flush().map_err(BoundaryError::Model)) {
            outcome = batch::failure(
                error,
                compat::CompatFailureLocation::CompatFinalizeFailure {},
            );
        }
    }
    let active = tx
        .selection()
        .and_then(|_| tx.foreign_selection_identity(SelectionSlot::Active));
    let facts = tx.view().foreign_update_facts();
    let source = tx.view().snapshot_for_foreign_read()?;
    with_current_host(|host| {
        host.selection_values
            .reconcile_active(active.as_ref(), host.update);
        let version = host
            .pending_version
            .ok_or(BoundaryError::Invalid("pending publication version"))?;
        let selection = host.selection(&source, version)?;
        let selections = selection_refs
            .values()
            .map(|reference| {
                host.selection_values
                    .get(*reference)
                    .map(|value| value.encoded())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let (_, delta) = host.batch_delta(tx, ResultValue::Scalar(undefined()), None)?;
        Ok(compat::CompatBatchReply {
            update_id: host.update,
            reservations,
            flags: 0,
            published: false,
            changed: tx.has_foreign_effects(),
            noop: false,
            version,
            mutation_epoch: host.mutation_epoch,
            composition: records::optional(tx.composition_key()),
            selection,
            selections,
            selection_bindings: vec![],
            tags: tx.tags().iter().map(ToString::to_string).collect(),
            dirty_leaves: facts
                .dirty_leaves
                .iter()
                .copied()
                .map(records::key)
                .collect(),
            dirty_elements: facts
                .dirty_elements
                .iter()
                .map(|(key, intent)| compat::CompatDirtyElement {
                    key: records::key(*key),
                    intentional: *intent == DirtyIntent::Intentional,
                })
                .collect(),
            dirty_type: match facts.dirty_type {
                ForeignDirtyType::Clean => 0,
                ForeignDirtyType::Nodes => 1,
                ForeignDirtyType::FullReconcile => 2,
            },
            delta,
            results,
            outcome,
        })
    })
}

#[cfg(test)]
mod test;
