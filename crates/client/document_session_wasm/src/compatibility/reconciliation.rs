//! A real prepublication callback scope; no ancestor model/store borrow crosses JS.
use super::*;
use crate::compatibility_host::{error::returned, CallbackScope};
use lexical_model::*;
use std::cell::RefCell;

fn model_error(error: BoundaryError) -> Error {
    match error {
        BoundaryError::Model(error) => error,
        error => Error::invariant(error.to_string()),
    }
}
struct ReconcileScope<'tx, 'editor> {
    tx: RefCell<&'tx mut Transaction<'editor>>,
    context: compat::CompatHostContext,
    selection_refs: RefCell<BTreeMap<(u32, u64, u32), compat::ForeignSelectionRef>>,
}
impl ReconcileScope<'_, '_> {
    fn execute_ops(
        &self,
        leases: &compat::CompatCaptureLeases,
        operations: &[compat::CompatBatchOperation],
    ) -> Result<compat::CompatBatchReply, BoundaryError> {
        let mut tx = self
            .tx
            .try_borrow_mut()
            .map_err(|_| BoundaryError::Invalid("reconciliation operation is executing"))?;
        let owner = capture_leases::NativeOwner::Stage(crate::compatibility_host::next_scope_id()?);
        scopes::with_current_host(|host| {
            host.capture_leases.validate(leases)?;
            host.retirement_epoch
                .checked_add(1)
                .ok_or(BoundaryError::Invalid("capture retirement epoch exhausted"))?;
            let next = host
                .mutation_epoch
                .checked_add(1)
                .ok_or(BoundaryError::Invalid("mutation epoch exhausted"))?;
            for operation in operations {
                host.validate_batch_operation(operation)?;
            }
            host.pin_batch_inputs(owner, operations)?;
            if let Err(error) = host.apply_capture_leases(leases) {
                let removed = host.capture_leases.release_owner(owner);
                host.remove_captures(removed);
                return Err(error);
            }
            host.mutation_epoch = next;
            Ok(())
        })?;
        let result = batch_execution::execute(
            &mut tx,
            operations,
            batch_execution::Normalization::Deferred,
            vec![],
        );
        let result = result.and_then(|reply| {
            let mut refs = self
                .selection_refs
                .try_borrow_mut()
                .map_err(|_| BoundaryError::Invalid("selection sidecars are executing"))?;
            for selection in &reply.selections {
                let reference = match selection {
                    compat::CompatSelectionData::CompatRangeSelection { reference, .. }
                    | compat::CompatSelectionData::CompatNodeSelection { reference, .. }
                    | compat::CompatSelectionData::CompatTableSelection { reference, .. } => {
                        *reference
                    }
                    _ => continue,
                };
                refs.insert(
                    (
                        reference.editor_id,
                        reference.version,
                        reference.selection_id,
                    ),
                    reference,
                );
            }
            Ok(reply)
        });
        scopes::with_current_host(|host| {
            let removed = host.capture_leases.release_owner(owner);
            host.remove_captures(removed);
            Ok(())
        })?;
        result
    }
}
impl CallbackScope for ReconcileScope<'_, '_> {
    fn context(&self) -> compat::CompatHostContext {
        self.context
    }
    fn call(
        &self,
        request: compat::CompatCallbackRequest,
    ) -> Result<compat::CompatCallbackReply, Error> {
        let compat::CompatCallbackRequest::CompatCallbackBatch { request } = request else {
            return Err(Error::Invariant(
                "unsupported reconciliation callback operation",
            ));
        };
        codec::now(request.now, request.wall).map_err(model_error)?;
        if request.finalize {
            return Err(Error::Invariant("callback cannot finalize recursively"));
        }
        let compat::CompatBatchScope::CompatBatchContinue {
            update_id,
            expected_epoch,
        } = request.scope
        else {
            return Err(Error::Invariant("callback cannot open an update"));
        };
        scopes::with_current_host(|host| {
            if host.update != update_id
                || host.update != self.context.update_id
                || host.pending_version != Some(self.context.version)
                || host.mutation_epoch != expected_epoch
                || host.editor != self.context.editor_id
                || host.host_slot != Some(self.context.host_slot)
            {
                return Err(BoundaryError::Invalid("reconciliation callback authority"));
            }
            Ok(())
        })
        .map_err(model_error)?;
        let reply = self
            .execute_ops(&request.leases, &request.operations)
            .map_err(model_error)?;
        Ok(compat::CompatCallbackReply::CompatCallbackBatchReply { reply })
    }
}

pub(super) struct ReconcileReceipt {
    pub selections: Vec<compat::CompatSelectionData>,
    pub error: Option<BoundaryError>,
}
pub(super) fn run(
    tx: &mut Transaction<'_>,
    prior: &compat::CompatBatchReply,
) -> Result<ReconcileReceipt, BoundaryError> {
    let _span =
        tracing::info_span!("editor.compat.reconcile", nodes = prior.delta.records.len()).entered();
    let token = tx.begin_foreign_reconciliation()?;
    let (runtime, request) = scopes::with_current_host(|host| {
        let runtime = host.instance_runtime.clone().ok_or(BoundaryError::Invalid(
            "hosted reconciliation runtime required",
        ))?;
        let context = compat::CompatHostContext {
            host_slot: runtime.host_slot,
            scope_id: crate::compatibility_host::next_scope_id()?,
            editor_id: host.editor,
            update_id: host.update,
            version: host
                .pending_version
                .ok_or(BoundaryError::Invalid("pending publication version"))?,
            mutation_epoch: host.mutation_epoch,
            access: compat::CompatHostAccess::Mutable,
        };
        let request = compat::CompatHostRequest {
            context,
            delta: prior.delta.clone(),
            dirty_leaves: prior.dirty_leaves.clone(),
            dirty_elements: prior.dirty_elements.clone(),
            dirty_type: prior.dirty_type,
            composition: prior.composition,
            selection: prior.selection.clone(),
            selections: prior.selections.clone(),
            selection_bindings: prior.selection_bindings.clone(),
            call: compat::CompatHostCall::CompatHostReconcile {
                stage: compat::CompatReconcileStage {
                    stage_id: runtime.next_stage()?,
                    previous_version: host.version,
                    next_version: context.version,
                },
            },
        };
        let ids: Vec<_> = request
            .delta
            .records
            .iter()
            .map(|record| record.record.capture_id)
            .collect();
        host.capture_leases
            .hold(capture_leases::NativeOwner::Stage(context.scope_id), &ids)?;
        Ok((runtime, request))
    })?;
    let (result, references) = {
        let scope = ReconcileScope {
            tx: RefCell::new(&mut *tx),
            context: request.context,
            selection_refs: RefCell::default(),
        };
        let result = (|| -> Result<(), BoundaryError> {
            let reply = returned((runtime.transport)(&scope, &request)?)?;
            let compat::CompatHostResult::CompatHostReconcileAck { ack } = reply.result else {
                return Err(BoundaryError::Invalid(
                    "reconciliation acknowledgement required",
                ));
            };
            let compat::CompatHostCall::CompatHostReconcile { stage } = &request.call else {
                return Err(BoundaryError::Invalid("reconciliation stage required"));
            };
            if ack.stage_id != stage.stage_id {
                return Err(BoundaryError::Invalid("reconciliation stage mismatch"));
            }
            if !ack.value_patches.is_empty() {
                return Err(BoundaryError::Invalid(
                    "opaque reconciliation patches are not installed",
                ));
            }
            let receipt = scope.execute_ops(&ack.leases, &ack.operations)?;
            match receipt.outcome {
                compat::CompatBatchOutcome::CompatBatchSuccess {} => Ok(()),
                compat::CompatBatchOutcome::CompatBatchNativeFailure { error_text, .. } => {
                    Err(BoundaryError::Model(Error::invariant(
                        String::from_utf16(&error_text)
                            .map_err(|_| BoundaryError::Invalid("reconciliation error UTF16"))?,
                    )))
                }
                compat::CompatBatchOutcome::CompatBatchHostFailure {
                    host_slot, error, ..
                } => Err(BoundaryError::Model(
                    crate::compatibility_host::error::HostThrown::new(host_slot, error)?
                        .into_model_error(),
                )),
                _ => Err(BoundaryError::Invalid("unknown reconciliation outcome")),
            }
        })();
        (result, scope.selection_refs.into_inner())
    };
    let selections = scopes::with_current_host(|host| {
        references
            .values()
            .map(|reference| {
                host.selection_values
                    .get(*reference)
                    .map(|value| value.encoded())
            })
            .collect::<Result<Vec<_>, _>>()
    });
    scopes::with_current_host(|host| {
        let removed = host
            .capture_leases
            .release_owner(capture_leases::NativeOwner::Stage(request.context.scope_id));
        host.remove_captures(removed);
        Ok(())
    })?;
    let selections = selections?;
    let result = result.and_then(|()| {
        tx.finish_foreign_reconciliation(token)
            .map_err(BoundaryError::Model)
    });
    Ok(ReconcileReceipt {
        selections,
        error: result.err(),
    })
}

#[cfg(test)]
mod test;
