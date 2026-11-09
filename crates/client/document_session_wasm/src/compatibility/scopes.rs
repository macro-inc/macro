//! Per-operation metadata is reborrowed only outside virtual model execution.
use super::*;
use calls::ResultValue;
use lexical_model::Transaction;
use std::cell::RefCell;

trait Metadata {
    fn clone_request(
        &self,
        runtime: &super::instance_runtime::InstanceRuntime,
        stage_id: u32,
        request: &lexical_model::ForeignInstanceCloneRequest,
    ) -> Result<compat::CompatHostRequest, lexical_model::Error>;
    fn selection(
        &self,
        tx: &mut Transaction<'_>,
        request: &compat::CompatRequest,
    ) -> Result<Option<selections::PreparedSelection>, BoundaryError>;
    fn previous(
        &self,
        source: &lexical_model::ForeignReadSnapshot,
        version: u64,
    ) -> Result<ResultValue, BoundaryError>;
    fn finish_selection(
        &self,
        completion: selections::SelectionCompletion,
    ) -> Result<ResultValue, BoundaryError>;
    fn prepare(
        &self,
        request: &compat::CompatRequest,
    ) -> Result<native_calls::NativeCall, BoundaryError>;
}
struct Frame<'a> {
    host: RefCell<&'a mut Host>,
    version: u64,
    update: u32,
}
impl Metadata for Frame<'_> {
    fn clone_request(
        &self,
        runtime: &super::instance_runtime::InstanceRuntime,
        stage_id: u32,
        request: &lexical_model::ForeignInstanceCloneRequest,
    ) -> Result<compat::CompatHostRequest, lexical_model::Error> {
        use lexical_model::*;
        let mut host = self
            .host
            .try_borrow_mut()
            .map_err(|_| Error::Invariant("compatibility metadata is executing"))?;
        if host.host_slot != Some(runtime.host_slot)
            || !host
                .owner_aliases
                .contains(&request.destination_owner.downgrade())
            || !host
                .owner_aliases
                .contains(&request.original.owner().downgrade())
        {
            return Err(Error::Invariant("clone source namespace is not registered"));
        }
        let source = Arc::new(request.source.clone());
        let record = host
            .records(
                source.clone(),
                vec![request.constructor_key],
                self.version,
                self.update,
                compat::ForeignAccess::Read,
                records::CaptureOptions {
                    writable: &[],
                    include_root_cache: false,
                },
            )
            .map_err(model_error)?
            .pop()
            .ok_or(Error::Invariant("clone source record is missing"))?;
        let mut destination = record.record.node;
        destination.key = records::key(request.destination_key);
        destination.instance_owner_id = runtime.editor;
        destination.instance_id = 0;
        let links = &request.required_links;
        let stage = compat::ForeignCloneStage {
            stage_id,
            mode: match request.mode {
                ForeignCloneMode::CopyOnWrite => compat::ForeignCloneMode::CopyOnWrite,
                ForeignCloneMode::Copy => compat::ForeignCloneMode::Copy,
                ForeignCloneMode::Restore => compat::ForeignCloneMode::Restore,
                ForeignCloneMode::Ephemeral => compat::ForeignCloneMode::Ephemeral,
            },
            editor_id: host.editor,
            update_id: self.update,
            version: self.version,
            source: record.record.node,
            ctor_key: records::key(request.constructor_key),
            destination,
            base: records::base_patch(&request.base),
            native_projection: record.native_projection.clone(),
            own_fields: compat::ForeignOpaqueValue::ForeignMissing {},
            required_links: compat::ForeignTreeLinks {
                parent: records::optional(links.parent),
                previous: records::optional(links.previous),
                next: records::optional(links.next),
                first: records::optional(links.first),
                last: records::optional(links.last),
                size: links.size,
            },
        };
        let facts = source.update_facts();
        Ok(compat::CompatHostRequest {
            context: compat::CompatHostContext {
                host_slot: runtime.host_slot,
                scope_id: crate::compatibility_host::next_scope_id()?,
                editor_id: host.editor,
                update_id: self.update,
                version: self.version,
                mutation_epoch: host.mutation_epoch,
                access: compat::CompatHostAccess::Clone,
            },
            delta: compat::CompatRecordDelta {
                records: vec![record.clone()],
                removed_keys: vec![],
                invalidate_root_text: false,
            },
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
            composition: records::optional(source.composition_key()),
            selection: host.selection(&source, self.version).map_err(model_error)?,
            selections: vec![],
            call: compat::CompatHostCall::CompatHostClone {
                stage,
                source_record: record,
            },
        })
    }
    fn selection(
        &self,
        tx: &mut Transaction<'_>,
        request: &compat::CompatRequest,
    ) -> Result<Option<selections::PreparedSelection>, BoundaryError> {
        self.host
            .try_borrow_mut()
            .map_err(|_| BoundaryError::Invalid("compatibility metadata is executing"))?
            .prepare_selection(tx, request)
    }
    fn previous(
        &self,
        source: &lexical_model::ForeignReadSnapshot,
        version: u64,
    ) -> Result<ResultValue, BoundaryError> {
        let selection = self
            .host
            .try_borrow_mut()
            .map_err(|_| BoundaryError::Invalid("compatibility metadata is executing"))?
            .selection(source, version)?;
        Ok(ResultValue::SelectionValue(selection))
    }
    fn finish_selection(
        &self,
        completion: selections::SelectionCompletion,
    ) -> Result<ResultValue, BoundaryError> {
        self.host
            .try_borrow_mut()
            .map_err(|_| BoundaryError::Invalid("compatibility metadata is executing"))?
            .finish_selection(completion)
    }
    fn prepare(
        &self,
        request: &compat::CompatRequest,
    ) -> Result<native_calls::NativeCall, BoundaryError> {
        self.host
            .try_borrow_mut()
            .map_err(|_| BoundaryError::Invalid("compatibility metadata is executing"))?
            .prepare_node_call(request)
    }
}
scoped_tls_hkt::scoped_thread_local!(static CURRENT: for<'a> &'a (dyn Metadata + 'a));

pub(super) fn dispatch(
    host: &mut Host,
    tx: &mut Transaction<'_>,
    request: &compat::CompatRequest,
) -> Result<ResultValue, BoundaryError> {
    // Preserve envelope validation even when a selection operation has no node
    // receiver of its own. Selection plans execute outside their ledger borrow.
    if request.has_receiver {
        host.receiver(request)?;
    }
    let version = if request.historical {
        request.state_version
    } else {
        host.pending_version
            .ok_or(BoundaryError::Invalid("compatibility update required"))?
    };
    let update = if request.historical { 0 } else { host.update };
    let frame = Frame {
        host: RefCell::new(host),
        version,
        update,
    };
    CURRENT.set(&frame, || {
        if let Some(result) = CURRENT.with(|scope| scope.selection(tx, request))? {
            return match result {
                selections::PreparedSelection::Ready(value) => Ok(value),
                selections::PreparedSelection::Previous { state, version } => {
                    let source = state.view().snapshot_for_foreign_read()?;
                    CURRENT.with(|scope| scope.previous(&source, version))
                }
                selections::PreparedSelection::Execute(plan) => {
                    let completion = plan.execute(tx)?;
                    CURRENT.with(|scope| scope.finish_selection(completion))
                }
            };
        }
        let prepared = CURRENT.with(|scope| scope.prepare(request))?;
        // Both RefCell guards have been dropped before a model hook can run.
        prepared.execute(tx)
    })
}

#[cfg(test)]
mod test;

fn model_error(error: BoundaryError) -> lexical_model::Error {
    match error {
        BoundaryError::Model(error) => error,
        error => lexical_model::Error::invariant(error.to_string()),
    }
}
struct CloneScope(compat::CompatHostContext);
impl crate::compatibility_host::CallbackScope for CloneScope {
    fn context(&self) -> compat::CompatHostContext {
        self.0
    }
    fn call(
        &self,
        _: compat::CompatCallbackRequest,
    ) -> Result<compat::CompatCallbackReply, lexical_model::Error> {
        Err(lexical_model::Error::Invariant(
            "clone scoped graph operations are not installed",
        ))
    }
}
pub(super) fn clone_instance(
    runtime: &super::instance_runtime::InstanceRuntime,
    stage_id: u32,
    request: &lexical_model::ForeignInstanceCloneRequest,
) -> Result<compat::CompatHostReply, lexical_model::Error> {
    if !CURRENT.is_set() {
        return Err(lexical_model::Error::Invariant(
            "clone requires an active compatibility frame",
        ));
    }
    let request = CURRENT.with(|scope| scope.clone_request(runtime, stage_id, request))?;
    let reply = (runtime.transport)(&CloneScope(request.context), &request)?;
    crate::compatibility_host::error::returned(reply)
}
