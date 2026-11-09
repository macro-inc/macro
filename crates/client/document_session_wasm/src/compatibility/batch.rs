//! Compact flushes retain one pending model update and acknowledge caught failures.
use super::*;
use calls::{ReplyScope, ResultValue};
use compat::{CompatBatchOutcome as Outcome, CompatOperation as Op};
use lexical_model::*;

fn failure(error: BoundaryError, location: compat::CompatFailureLocation) -> Outcome {
    if let BoundaryError::Model(error) = &error {
        if let Some(cause) = crate::compatibility_host::error::HostThrown::from_model_error(error) {
            return Outcome::CompatBatchHostFailure {
                location,
                host_slot: cause.host_slot(),
                error: cause.value().clone(),
            };
        }
    }
    Outcome::CompatBatchNativeFailure {
        location,
        error_text: error.to_string().encode_utf16().collect(),
    }
}
impl Host {
    fn batch_operand(
        &self,
        operand: &compat::CompatNodeOperand,
    ) -> Result<Option<compat::ForeignRecordRef>, BoundaryError> {
        match operand {
            compat::CompatNodeOperand::CompatNoNode {} => Ok(None),
            compat::CompatNodeOperand::CompatCapturedNode { record } => {
                self.validate_record(*record)?;
                Ok(Some(*record))
            }
            compat::CompatNodeOperand::CompatReservedNode { .. } => {
                let reference = self
                    .constructed
                    .get(&super::construction::reserved(operand)?)
                    .ok_or(BoundaryError::Invalid("reserved node is not constructed"))?;
                self.validate_record(*reference)?;
                Ok(Some(*reference))
            }
            _ => Err(BoundaryError::Invalid("unknown node operand")),
        }
    }
    fn batch_request(
        &self,
        operation: &compat::CompatBatchOperation,
    ) -> Result<compat::CompatRequest, BoundaryError> {
        if !matches!(
            operation.initial_instance,
            compat::CompatInstanceSeed::CompatNoInstanceSeed {}
        ) || matches!(
            operation.operation,
            Op::CreateText
                | Op::CreateParagraph
                | Op::CreateLineBreak
                | Op::CreateTab
                | Op::CreateHeading
                | Op::CreateRegisteredNode
        ) {
            return Err(BoundaryError::Invalid(
                "uninstalled reserved creation adapter",
            ));
        }
        let receiver = self.batch_operand(&operation.receiver)?;
        let mut args = Vec::with_capacity(operation.args.len());
        for arg in &operation.args {
            args.push(match arg {
                compat::CompatBatchArgument::CompatValueArgument { value } => {
                    if let compat::ForeignCallbackValue::ForeignSelectionArgument { value } = value
                    {
                        self.selection_values.get(*value)?;
                    }
                    value.clone()
                }
                compat::CompatBatchArgument::CompatNodeArgument { value } => {
                    let record = self
                        .batch_operand(value)?
                        .ok_or(BoundaryError::Invalid("node operand required"))?;
                    compat::ForeignCallbackValue::ForeignNodeArgument { value: record.node }
                }
                compat::CompatBatchArgument::CompatNodeArrayArgument { values } => {
                    let values = values
                        .iter()
                        .map(|value| {
                            self.batch_operand(value)?
                                .map(|record| record.node)
                                .ok_or(BoundaryError::Invalid("node operand required"))
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    compat::ForeignCallbackValue::ForeignNodeArrayArgument { values }
                }
                _ => return Err(BoundaryError::Invalid("unknown batch argument")),
            });
        }
        // The legacy request has an explicit has_receiver discriminant. Its
        // absent payload is unused internally and is never emitted as authority.
        let absent = compat::ForeignRecordRef {
            node: compat::ForeignNodeRef {
                editor_id: 0,
                version: 0,
                key: records::key(NodeKey::ROOT),
                instance_owner_id: 0,
                class_id: 0,
                instance_id: 0,
            },
            update_id: 0,
            access: compat::ForeignAccess::Unknown,
            capture_id: 0,
        };
        Ok(compat::CompatRequest {
            operation: operation.operation,
            historical: false,
            state_version: self.pending_version.unwrap_or(self.version),
            has_receiver: receiver.is_some(),
            receiver: receiver.unwrap_or(absent),
            args,
        })
    }
    fn batch_delta(
        &mut self,
        tx: &Transaction<'_>,
        result: ResultValue,
        receiver: Option<NodeKey>,
    ) -> Result<(compat::CompatReply, compat::CompatRecordDelta), BoundaryError> {
        let source = Arc::new(tx.view().snapshot_for_foreign_read()?);
        let dirty: Vec<_> = tx
            .foreign_dirty_keys()
            .filter(|key| tx.contains(*key))
            .collect();
        let writable: Vec<_> = dirty
            .iter()
            .copied()
            .filter(|key| tx.foreign_is_writable(*key))
            .collect();
        let reply = self.reply(
            source,
            result,
            ReplyScope {
                version: self
                    .pending_version
                    .ok_or(BoundaryError::Invalid("pending publication version"))?,
                update: self.update,
                dirty: &dirty,
                writable: &writable,
                receiver,
            },
        )?;
        let mut removed_keys: Vec<_> = tx.foreign_removed_keys().map(records::key).collect();
        removed_keys.sort_by_key(|key| (key.index, key.generation));
        let delta = compat::CompatRecordDelta {
            records: reply.records.clone(),
            removed_keys,
            invalidate_root_text: tx.has_dirty_nodes(),
        };
        Ok((reply, delta))
    }
}
impl EditorSession {
    pub(super) fn compat_batch_inner(
        &mut self,
        bytes_in: &[u8],
    ) -> Result<compat::CompatBatchReply, BoundaryError> {
        let request = compat::CompatBatchRequest::deserialize(bytes_in)?;
        let _span = tracing::info_span!(
            "editor.compat.batch",
            operations = request.operations.len(),
            admit = request.finalize
        )
        .entered();
        codec::now(request.now, request.wall)?;
        if request.finalize {
            return Err(BoundaryError::Invalid(
                "uninstalled compact admission adapter",
            ));
        }
        let host = self
            .compatibility
            .as_ref()
            .ok_or(BoundaryError::Invalid("compatibility session required"))?;
        if request.leases.editor_id != host.editor
            || !request.leases.retain.is_empty()
            || !request.leases.release.is_empty()
        {
            return Err(BoundaryError::Invalid(
                "uninstalled compact capture lease adapter",
            ));
        }
        for operation in &request.operations {
            host.validate_batch_operation(operation)?;
        }
        let epoch_steps = match &request.scope {
            compat::CompatBatchScope::CompatBatchBegin { .. } => {
                if host.pending.is_some() {
                    return Err(BoundaryError::Invalid(
                        "compatibility update already active",
                    ));
                }
                2
            }
            compat::CompatBatchScope::CompatBatchContinue { .. } => 1,
            _ => return Err(BoundaryError::Invalid("unknown batch scope")),
        };
        host.mutation_epoch
            .checked_add(epoch_steps)
            .ok_or(BoundaryError::Invalid("mutation epoch exhausted"))?;
        let mut reservations = Vec::new();
        match request.scope {
            compat::CompatBatchScope::CompatBatchBegin {
                expected_version,
                begin,
            } => {
                let (host, machine) = self.compat_parts()?;
                let machine::Session::Editor(session) = &machine.session else {
                    return Err(BoundaryError::Invalid("compatibility editor surface"));
                };
                if !host
                    .owner
                    .same_owner(&session.surface().state().view().foreign_instance_owner())
                    || !host
                        .receipts
                        .lock()
                        .map_err(|_| BoundaryError::Invalid("compatibility receipt lock"))?
                        .is_empty()
                {
                    return Err(BoundaryError::Invalid(
                        "unacknowledged compatibility publication",
                    ));
                }
                if host.version != expected_version {
                    return Err(BoundaryError::Invalid("batch source version conflict"));
                }
                reservations.push(
                    self.compat_begin_compact_inner(&bytes(&begin)?)?
                        .reservation,
                );
            }
            compat::CompatBatchScope::CompatBatchContinue {
                update_id,
                expected_epoch,
            } => {
                let host = self
                    .compatibility
                    .as_ref()
                    .ok_or(BoundaryError::Invalid("compatibility session required"))?;
                if host.pending.is_none()
                    || host.update != update_id
                    || host.mutation_epoch != expected_epoch
                {
                    return Err(BoundaryError::Invalid("batch continuation authority"));
                }
            }
            _ => return Err(BoundaryError::Invalid("unknown batch scope")),
        }
        let (host, machine) = self.compat_parts()?;
        let next_epoch = host
            .mutation_epoch
            .checked_add(1)
            .ok_or(BoundaryError::Invalid("mutation epoch exhausted"))?;
        let machine::Session::Editor(session) = &mut machine.session else {
            return Err(BoundaryError::Invalid("compatibility editor surface"));
        };
        let pending = host
            .pending
            .take()
            .ok_or(BoundaryError::Invalid("compatibility update required"))?;
        let (pending, reply) =
            session.with_compat_update(pending, |tx| -> Result<_, BoundaryError> {
                let mut results = Vec::new();
                let mut selection_refs = BTreeMap::new();
                let mut outcome = Outcome::CompatBatchSuccess {};
                for (index, operation) in request.operations.iter().enumerate() {
                    let mut call = None;
                    let guard = ForeignReadOperation::begin()?;
                    let result = if super::construction::creates(operation.operation) {
                        host.prepare_reserved_creation(operation).and_then(
                            |(construction, ticket)| {
                                construction
                                    .execute(tx, ticket)
                                    .map(|key| ResultValue::Node(Some(key)))
                                    .map_err(BoundaryError::Model)
                            },
                        )
                    } else {
                        host.batch_request(operation).and_then(|request| {
                            let result = super::scopes::dispatch(host, tx, &request);
                            call = Some(request);
                            result
                        })
                    };
                    let result = guard.finish(result);
                    for arg in call.iter().flat_map(|call| &call.args) {
                        if let compat::ForeignCallbackValue::ForeignSelectionArgument { value } =
                            arg
                        {
                            selection_refs.insert(
                                (value.editor_id, value.version, value.selection_id),
                                *value,
                            );
                        }
                    }
                    match result {
                        Ok(result) => {
                            let receiver = match &call {
                                Some(call) if call.has_receiver => Some(host.receiver(call)?),
                                _ => None,
                            };
                            let (reply, delta) = host.batch_delta(tx, result, receiver)?;
                            if super::construction::creates(operation.operation) {
                                let (reservation, key) =
                                    super::construction::reserved(&operation.receiver)?;
                                let record = delta
                                    .records
                                    .iter()
                                    .find(|record| record.record.node.key == records::key(key))
                                    .ok_or(BoundaryError::Invalid(
                                        "constructed result record missing",
                                    ))?;
                                host.constructed.insert((reservation, key), record.record);
                            }
                            for selection in reply.selections {
                                match selection {
                                    compat::CompatSelectionData::CompatRangeSelection {
                                        reference,
                                        ..
                                    }
                                    | compat::CompatSelectionData::CompatNodeSelection {
                                        reference,
                                        ..
                                    }
                                    | compat::CompatSelectionData::CompatTableSelection {
                                        reference,
                                        ..
                                    } => {
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
                            outcome = failure(
                                error,
                                compat::CompatFailureLocation::CompatOperationFailure {
                                    index: u32::try_from(index).map_err(|_| {
                                        BoundaryError::Invalid("batch operation count")
                                    })?,
                                },
                            );
                            break;
                        }
                    }
                }
                if matches!(outcome, Outcome::CompatBatchSuccess {}) {
                    let guard = ForeignReadOperation::begin()?;
                    if let Err(error) = guard.finish(super::scopes::flush(host, tx)) {
                        outcome = failure(
                            error,
                            compat::CompatFailureLocation::CompatFinalizeFailure {},
                        );
                    }
                }
                let active = tx
                    .selection()
                    .and_then(|_| tx.foreign_selection_identity(SelectionSlot::Active));
                host.selection_values
                    .reconcile_active(active.as_ref(), host.update);
                let facts = tx.view().foreign_update_facts();
                let source = tx.view().snapshot_for_foreign_read()?;
                let selection = host.selection(
                    &source,
                    host.pending_version
                        .ok_or(BoundaryError::Invalid("pending publication version"))?,
                )?;
                let selections = selection_refs
                    .values()
                    .map(|reference| {
                        host.selection_values
                            .get(*reference)
                            .map(|value| value.encoded())
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let (_, delta) =
                    host.batch_delta(tx, ResultValue::Scalar(calls::undefined()), None)?;
                Ok(compat::CompatBatchReply {
                    update_id: host.update,
                    reservations,
                    flags: 0,
                    published: false,
                    changed: tx.has_foreign_effects(),
                    noop: false,
                    version: host
                        .pending_version
                        .ok_or(BoundaryError::Invalid("pending publication version"))?,
                    mutation_epoch: next_epoch,
                    composition: records::optional(tx.composition_key()),
                    selection,
                    selections,
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
            })?;
        host.pending = Some(pending);
        host.mutation_epoch = next_epoch;
        reply
    }
}
#[wasm_bindgen]
impl EditorSession {
    /// Apply an ordered native operation list and synchronously normalize its pending state.
    #[wasm_bindgen(js_name = compatBatch)]
    pub fn compat_batch(&mut self, request: &[u8]) -> Result<Vec<u8>, JsError> {
        self.compat_batch_inner(request)
            .and_then(|reply| bytes(&reply))
            .map_err(js)
    }
}

#[cfg(test)]
mod test;
