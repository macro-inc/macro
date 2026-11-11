//! Compact flushes retain one pending model update and acknowledge caught failures.
use super::*;
use calls::{ReplyScope, ResultValue};
use compat::{CompatBatchOutcome as Outcome, CompatOperation as Op};
use lexical_model::*;

pub(super) fn failure(error: BoundaryError, location: compat::CompatFailureLocation) -> Outcome {
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
    pub(super) fn refresh_selection_sidecars(
        &self,
        selections: impl IntoIterator<Item = compat::CompatSelectionData>,
    ) -> Result<Vec<compat::CompatSelectionData>, BoundaryError> {
        let mut references = BTreeMap::new();
        for selection in selections {
            let reference = match selection {
                compat::CompatSelectionData::CompatRangeSelection { reference, .. }
                | compat::CompatSelectionData::CompatNodeSelection { reference, .. }
                | compat::CompatSelectionData::CompatTableSelection { reference, .. } => reference,
                _ => continue,
            };
            references.insert(
                (
                    reference.editor_id,
                    reference.version,
                    reference.selection_id,
                ),
                reference,
            );
        }
        references
            .values()
            .map(|reference| {
                self.selection_values
                    .get(*reference)
                    .map(|value| value.encoded())
            })
            .collect()
    }
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
    pub(super) fn batch_request(
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
                compat::CompatBatchArgument::CompatSelectionIntentArgument { .. } => {
                    return Err(BoundaryError::Invalid(
                        "uninstalled selection intent adapter",
                    ));
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
    pub(super) fn batch_delta(
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
        let mut reply = self.reply(
            source.clone(),
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
        let removed: Vec<_> = tx.foreign_removed_keys().collect();
        reply.records.extend(
            self.retired_records(
                source,
                removed.clone(),
                self.pending_version
                    .ok_or(BoundaryError::Invalid("pending publication version"))?,
                self.update,
            )?,
        );
        let mut removed_keys: Vec<_> = removed.into_iter().map(records::key).collect();
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
        let host = self
            .compatibility
            .as_ref()
            .ok_or(BoundaryError::Invalid("compatibility session required"))?;
        if request.finalize && host.instance_runtime.is_none() {
            return Err(BoundaryError::Invalid(
                "hosted compact admission runtime required",
            ));
        }
        host.capture_leases.validate(&request.leases)?;
        host.retirement_epoch
            .checked_add(if request.finalize { 2 } else { 1 })
            .ok_or(BoundaryError::Invalid("capture retirement epoch exhausted"))?;
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
        let input_owner =
            capture_leases::NativeOwner::Stage(crate::compatibility_host::next_scope_id()?);
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
        host.pin_batch_inputs(input_owner, &request.operations)?;
        if let Err(error) = host.apply_capture_leases(&request.leases) {
            let removed = host.capture_leases.release_owner(input_owner);
            host.remove_captures(removed);
            return Err(error);
        }
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
        host.mutation_epoch = next_epoch;
        let execution = session.with_compat_update(pending, |tx| {
            super::scopes::with_pending_frame(host, || {
                // Final admission of an already-flushed update must not replay
                // its transforms or selection hooks.
                let normalize = if request.finalize {
                    super::batch_execution::Normalization::Admission
                } else {
                    super::batch_execution::Normalization::Updater
                };
                let mut reply = super::batch_execution::execute(
                    tx,
                    &request.operations,
                    normalize,
                    reservations,
                )?;
                if request.finalize
                    && reply.changed
                    && matches!(reply.outcome, Outcome::CompatBatchSuccess {})
                {
                    let mut phase_selections = vec![];
                    let phase = super::reconciliation::run(tx, &reply).and_then(|phase| {
                        phase_selections = phase.selections;
                        phase.error.map_or(Ok(()), Err)
                    });
                    let mut final_reply = super::batch_execution::execute(
                        tx,
                        &[],
                        super::batch_execution::Normalization::Deferred,
                        vec![],
                    )?;
                    final_reply.results = std::mem::take(&mut reply.results);
                    final_reply.reservations = std::mem::take(&mut reply.reservations);
                    final_reply.selection_bindings = std::mem::take(&mut reply.selection_bindings);
                    let selections = reply.selections.into_iter().chain(phase_selections);
                    final_reply.selections = super::scopes::with_current_host(|host| {
                        host.refresh_selection_sidecars(selections)
                    })?;
                    if let Err(error) = phase {
                        final_reply.outcome = failure(
                            error,
                            compat::CompatFailureLocation::CompatFinalizeFailure {},
                        );
                    }
                    reply = final_reply;
                }
                Ok(reply)
            })
        });
        let removed = host.capture_leases.release_owner(input_owner);
        host.remove_captures(removed);
        let (pending, reply) = execution?;
        host.pending = Some(pending);
        let mut reply = reply?;
        if !request.finalize || !matches!(reply.outcome, Outcome::CompatBatchSuccess {}) {
            return Ok(reply);
        }
        if !reply.changed {
            if !self.compat_finish_noop_inner()? {
                return Err(BoundaryError::Invalid(
                    "compact no-op retained model effects",
                ));
            }
            let (host, _) = self.compat_parts()?;
            let state = host
                .states
                .get(&host.version)
                .ok_or(BoundaryError::Invalid(
                    "current publication is not retained",
                ))?
                .clone();
            let source = state.view().snapshot_for_foreign_read()?;
            reply.version = host.version;
            reply.mutation_epoch = host.mutation_epoch;
            reply.selection = host.selection(&source, host.version)?;
            reply.selections = host.refresh_selection_sidecars(reply.selections)?;
            reply.dirty_type = 0;
            reply.noop = true;
            return Ok(reply);
        }
        let mut flags = 0;
        match self.compat_commit_admitted_inner(request.now, request.wall, true, &mut flags) {
            Ok((commit, error)) => {
                reply.flags = commit.flags;
                reply.published = true;
                reply.changed = commit.changed;
                reply.version = commit.version;
                reply.selection = commit.selection;
                reply.tags = commit.tags;
                reply.dirty_leaves = commit.dirty_leaves;
                reply.dirty_elements = commit.dirty_elements;
                reply.dirty_type = 0;
                // The pending mirror also observed nodes created and collected
                // inside this update; they are absent from prev/next commit
                // mutations but still require authoritative removal.
                let retired_keys: std::collections::HashSet<_> = reply
                    .delta
                    .removed_keys
                    .iter()
                    .map(|key| (key.index, key.generation))
                    .collect();
                let retired_records: Vec<_> = reply
                    .delta
                    .records
                    .iter()
                    .filter(|record| {
                        retired_keys.contains(&(
                            record.record.node.key.index,
                            record.record.node.key.generation,
                        ))
                    })
                    .cloned()
                    .collect();
                let mut removed = BTreeMap::new();
                for key in reply
                    .delta
                    .removed_keys
                    .into_iter()
                    .chain(commit.batch.removed_keys)
                {
                    removed.insert((key.index, key.generation), key);
                }
                let machine::Session::Editor(session) = &self.machine.session else {
                    return Err(BoundaryError::Invalid("compatibility editor surface"));
                };
                let removed_keys = removed
                    .into_values()
                    .filter(|key| {
                        let native = NodeKey::from_parts(KeyParts {
                            index: key.index,
                            generation: key.generation,
                        });
                        session.surface().state().node(native).is_none()
                    })
                    .collect();
                reply.delta = compat::CompatRecordDelta {
                    records: commit
                        .batch
                        .records
                        .into_iter()
                        .chain(retired_records)
                        .collect(),
                    removed_keys,
                    invalidate_root_text: !reply.dirty_leaves.is_empty()
                        || !reply.dirty_elements.is_empty(),
                };
                let (host, _) = self.compat_parts()?;
                reply.selections = host.refresh_selection_sidecars(reply.selections)?;
                reply.mutation_epoch = host.mutation_epoch;
                if let Some(error) = error {
                    reply.outcome = failure(
                        error,
                        compat::CompatFailureLocation::CompatFinalizeFailure {},
                    );
                }
                Ok(reply)
            }
            Err(error) => {
                let (host, _) = self.compat_parts()?;
                if host.pending.is_none() {
                    // Consumed/adopted failures cannot be represented as retryable.
                    // Return a fatal transport error, never a fabricated open scope.
                    if let Some(version) = host.pending_version.take() {
                        host.discard_reservations();
                        host.selection_values.finish_update(host.update, false);
                        host.selection_values.release_graph(version);
                        host.abandon_capture_graph(version);
                    }
                    return Err(error);
                }
                reply.flags = flags;
                reply.outcome = failure(
                    error,
                    compat::CompatFailureLocation::CompatFinalizeFailure {},
                );
                reply.mutation_epoch = host.mutation_epoch;
                Ok(reply)
            }
        }
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
