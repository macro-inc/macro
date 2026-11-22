//! Selection values retain their own identity while each call chooses its graph.
use super::*;
use calls::ResultValue;
use compat::{CompatOperation as Op, ForeignCallbackValue as Value};
use lexical_model::*;
use selection_values::{Origin, Scope};
pub(super) enum PreparedSelection {
    Ready(ResultValue),
    Execute(SelectionPlan),
    Previous { state: EditorState, version: u64 },
}
pub(super) struct SelectionPlan {
    value: selection_values::SelectionValue,
    historical: bool,
    op: Op,
    args: Vec<Value>,
    version: u64,
    update: u32,
}
pub(super) struct SelectionCompletion {
    execution: selection_execution::SelectionExecution,
    historical: bool,
    op: Op,
    version: u64,
    update: u32,
}
impl SelectionPlan {
    pub fn execute(self, tx: &mut Transaction<'_>) -> Result<SelectionCompletion, BoundaryError> {
        let execution =
            selection_execution::execute(tx, self.value, self.historical, self.op, &self.args)?;
        Ok(SelectionCompletion {
            execution,
            historical: self.historical,
            op: self.op,
            version: self.version,
            update: self.update,
        })
    }
}
fn reference(
    data: &compat::CompatSelectionData,
) -> Result<Option<compat::ForeignSelectionRef>, BoundaryError> {
    match data {
        compat::CompatSelectionData::CompatNoSelection {} => Ok(None),
        compat::CompatSelectionData::CompatRangeSelection { reference, .. }
        | compat::CompatSelectionData::CompatNodeSelection { reference, .. }
        | compat::CompatSelectionData::CompatTableSelection { reference, .. } => {
            Ok(Some(*reference))
        }
        compat::CompatSelectionData::Unknown => {
            Err(BoundaryError::Invalid("unknown selection kind"))
        }
    }
}
impl Host {
    fn value_argument(
        &self,
        value: Option<&Value>,
    ) -> Result<selection_values::SelectionValue, BoundaryError> {
        let Some(Value::ForeignSelectionArgument { value }) = value else {
            return Err(BoundaryError::Invalid("selection receiver"));
        };
        self.selection_values.get(*value)
    }
    fn validate_selection_nodes(&self, args: &[Value]) -> Result<(), BoundaryError> {
        for arg in args {
            match arg {
                Value::ForeignNodeArgument { .. } | Value::ForeignRecordArgument { .. } => {
                    self.node_argument(Some(arg))?;
                }
                Value::ForeignNodeArrayArgument { values } => {
                    for value in values {
                        self.node_argument(Some(&Value::ForeignNodeArgument { value: *value }))?;
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }
    pub(super) fn prepare_selection(
        &mut self,
        tx: &mut Transaction<'_>,
        request: &compat::CompatRequest,
    ) -> Result<Option<PreparedSelection>, BoundaryError> {
        let ready = |value| Some(PreparedSelection::Ready(value));
        let op = request.operation;
        let version = if request.historical {
            request.state_version
        } else {
            self.pending_version
                .ok_or(BoundaryError::Invalid("pending publication version"))?
        };
        if matches!(
            op,
            Op::CreateRangeSelection | Op::CreateNodeSelection | Op::CreateTableSelection
        ) {
            if !request.args.is_empty() {
                return Err(BoundaryError::Invalid("selection constructor arguments"));
            }
            let value = match op {
                Op::CreateRangeSelection => Selection::Range(RangeSelection::at_root()),
                Op::CreateNodeSelection => Selection::Node(NodeSelection::new()),
                _ => Selection::Table(TableSelection::new(
                    NodeKey::ROOT,
                    NodeKey::ROOT,
                    NodeKey::ROOT,
                )),
            };
            let value = self
                .selection_values
                .allocate(value, version, self.update)?;
            return Ok(ready(ResultValue::Scalar(
                Value::ForeignSelectionArgument { value },
            )));
        }
        if op == Op::GetPreviousSelection {
            // $getPreviousSelection reads the editor's committed state even
            // when the caller's active read graph is an older publication.
            let committed = self
                .states
                .get(&self.version)
                .ok_or(BoundaryError::Invalid("current compatibility publication"))?
                .clone();
            return Ok(Some(PreparedSelection::Previous {
                state: committed,
                version: self.version,
            }));
        }
        if !matches!(
            op,
            Op::SetSelection
                | Op::SelectionClone
                | Op::SelectionGetNodes
                | Op::SelectionGetTextContent
                | Op::SelectionInsertText
                | Op::SelectionInsertNodes
                | Op::SelectionFormatText
                | Op::SelectionDeleteCharacter
                | Op::SelectionDeleteWord
                | Op::SelectionDeleteLine
                | Op::SelectionInsertParagraph
                | Op::SelectionInsertLineBreak
                | Op::SelectionExtract
                | Op::SelectionIsCollapsed
                | Op::SelectionIsBackward
                | Op::SelectionHasFormat
                | Op::NodeSelectionAdd
                | Op::NodeSelectionDelete
                | Op::NodeSelectionClear
                | Op::NodeSelectionHas
        ) {
            return Ok(None);
        }
        if op == Op::SetSelection
            && matches!(
                request.args.first(),
                Some(Value::ForeignOpaqueArgument {
                    value: compat::ForeignOpaqueValue::ForeignNull {}
                })
            )
        {
            tx.replace_selection(None)?;
            return Ok(ready(ResultValue::Scalar(calls::undefined())));
        }
        let mut value = self.value_argument(request.args.first())?;
        let args = &request.args[1..];
        self.validate_selection_nodes(args)?;
        if op == Op::SelectionClone {
            if !args.is_empty() {
                return Err(BoundaryError::Invalid("selection clone arguments"));
            }
            let cloned = value.value.clone().with_foreign_value_metadata(false, None);
            let value = self
                .selection_values
                .allocate(cloned, version, self.update)?;
            return Ok(ready(ResultValue::Scalar(
                Value::ForeignSelectionArgument { value },
            )));
        }
        let writes_graph = matches!(
            op,
            Op::SetSelection
                | Op::SelectionInsertText
                | Op::SelectionInsertNodes
                | Op::SelectionFormatText
                | Op::SelectionDeleteCharacter
                | Op::SelectionDeleteWord
                | Op::SelectionDeleteLine
                | Op::SelectionInsertParagraph
                | Op::SelectionInsertLineBreak
                | Op::SelectionExtract
        );
        if writes_graph && (request.historical || value.origin == Origin::Frozen) {
            return Err(BoundaryError::Invalid("frozen selection mutation"));
        }
        if matches!(
            op,
            Op::NodeSelectionAdd
                | Op::NodeSelectionDelete
                | Op::NodeSelectionClear
                | Op::NodeSelectionHas
        ) {
            if args.len() != usize::from(op != Op::NodeSelectionClear) {
                return Err(BoundaryError::Invalid("node selection argument count"));
            }
            let node = if op == Op::NodeSelectionClear {
                None
            } else {
                Some(self.node_argument(args.first())?)
            };
            let Selection::Node(nodes) = &mut value.value else {
                return Err(BoundaryError::Invalid("node selection required"));
            };
            let result = match op {
                Op::NodeSelectionHas => ResultValue::Scalar(Value::ForeignBooleanArgument {
                    value: nodes.keys().any(|key| Some(key) == node),
                }),
                Op::NodeSelectionAdd => {
                    nodes.add(node.ok_or(BoundaryError::Invalid("node selection key"))?);
                    ResultValue::Scalar(calls::undefined())
                }
                Op::NodeSelectionDelete => {
                    nodes.delete(node.ok_or(BoundaryError::Invalid("node selection key"))?);
                    ResultValue::Scalar(calls::undefined())
                }
                _ => {
                    nodes.clear();
                    ResultValue::Scalar(calls::undefined())
                }
            };
            if op != Op::NodeSelectionHas {
                value.cached_nodes = None;
                self.selection_values.patch(
                    value.reference,
                    value.encoded(),
                    Scope {
                        historical: request.historical,
                        state_version: version,
                        update: self.update,
                        activate: false,
                    },
                )?;
                if !request.historical && matches!(value.origin, Origin::Active { .. }) {
                    let slot = tx
                        .foreign_selection_slot(&value.identity)
                        .ok_or(BoundaryError::Invalid("active selection identity"))?;
                    tx.synchronize_foreign_selection_value(slot, value.value)?;
                }
            }
            return Ok(ready(result));
        }
        if op != Op::SetSelection {
            return Ok(Some(PreparedSelection::Execute(SelectionPlan {
                value,
                historical: request.historical,
                op,
                args: args.to_vec(),
                version,
                update: self.update,
            })));
        }
        let slot = tx
            .foreign_selection_slot(&value.identity)
            .unwrap_or_else(|| {
                tx.detach_foreign_selection(
                    value.value.snapshot_for_foreign_read(),
                    value.identity.clone(),
                )
            });
        value.cached_nodes = None;
        let backward = value
            .value
            .as_range()
            .and_then(RangeSelection::cached_is_backward);
        value.value = value.value.with_foreign_value_metadata(true, backward);
        self.selection_values.patch(
            value.reference,
            value.encoded(),
            Scope {
                historical: false,
                state_version: version,
                update: self.update,
                activate: true,
            },
        )?;
        tx.synchronize_foreign_selection_value(slot, value.value)?;
        tx.activate_foreign_selection(slot)?;
        let active = tx.foreign_selection_identity(SelectionSlot::Active);
        self.selection_values
            .reconcile_active(active.as_ref(), self.update);
        Ok(ready(ResultValue::Scalar(calls::undefined())))
    }
    pub(super) fn finish_selection(
        &mut self,
        completion: SelectionCompletion,
    ) -> Result<ResultValue, BoundaryError> {
        let SelectionCompletion {
            execution,
            historical,
            op,
            version,
            update,
        } = completion;
        let selection_execution::SelectionExecution {
            result,
            value,
            active_identity,
            value_is_active,
            writes_graph,
            value_metadata_changed,
        } = execution;
        if writes_graph {
            self.selection_values.invalidate_active_cache(update);
        }
        let encoded = value.encoded();
        if writes_graph || value_metadata_changed {
            self.selection_values.patch(
                value.reference,
                encoded.clone(),
                Scope {
                    historical: false,
                    state_version: version,
                    update,
                    activate: value_is_active,
                },
            )?;
        }
        if !historical {
            self.selection_values
                .reconcile_active(active_identity.as_ref(), update);
        }
        let result = match result? {
            selection_ops::SelectionOpResult::Scalar(value) => ResultValue::Scalar(value),
            selection_ops::SelectionOpResult::None => ResultValue::Scalar(calls::undefined()),
            selection_ops::SelectionOpResult::Nodes(mut nodes)
                if op == Op::SelectionInsertParagraph =>
            {
                ResultValue::Node(nodes.pop())
            }
            selection_ops::SelectionOpResult::Nodes(nodes) => ResultValue::Nodes(nodes),
        };
        if writes_graph || value_metadata_changed {
            Ok(ResultValue::WithSelection(Box::new(result), encoded))
        } else {
            Ok(result)
        }
    }
}

impl EditorSession {
    pub(super) fn compat_set_selection_inner(
        &mut self,
        bytes: &[u8],
    ) -> Result<compat::CompatReply, BoundaryError> {
        let patch = compat::CompatSelectionPatch::deserialize(bytes)?;
        let (host, machine) = self.compat_parts()?;
        let graph = if patch.historical {
            if !host.states.contains_key(&patch.state_version)
                && host.pending_version != Some(patch.state_version)
            {
                return Err(BoundaryError::Invalid("unknown compatibility version"));
            }
            patch.state_version
        } else {
            host.pending_version
                .ok_or(BoundaryError::Invalid("compatibility update required"))?
        };
        let Some(reference) = reference(&patch.selection)? else {
            if patch.activate {
                if patch.historical {
                    return Err(BoundaryError::Invalid("historical selection activation"));
                }
                let machine::Session::Editor(session) = &mut machine.session else {
                    return Err(BoundaryError::Invalid("compatibility editor surface"));
                };
                let pending = host
                    .pending
                    .take()
                    .ok_or(BoundaryError::Invalid("compatibility update required"))?;
                let (pending, result) =
                    session.with_compat_update(pending, |tx| tx.replace_selection(None))?;
                host.pending = Some(pending);
                result?;
                host.selection_values.reconcile_active(None, host.update);
            }
            return Ok(compat::CompatReply {
                value: calls::null(),
                records: vec![],
                selections: vec![],
            });
        };
        let cached = match &patch.selection {
            compat::CompatSelectionData::CompatRangeSelection { cached_nodes, .. }
            | compat::CompatSelectionData::CompatNodeSelection { cached_nodes, .. }
            | compat::CompatSelectionData::CompatTableSelection { cached_nodes, .. } => {
                cached_nodes
            }
            _ => return Err(BoundaryError::Invalid("selection body")),
        };
        for node in cached {
            host.node_argument(Some(&Value::ForeignNodeArgument { value: *node }))?;
        }
        let value = host.selection_values.patch(
            reference,
            patch.selection,
            Scope {
                historical: patch.historical,
                state_version: graph,
                update: host.update,
                activate: patch.activate,
            },
        )?;
        if !patch.historical && (patch.activate || matches!(value.origin, Origin::Active { .. })) {
            let machine::Session::Editor(session) = &mut machine.session else {
                return Err(BoundaryError::Invalid("compatibility editor surface"));
            };
            let pending = host
                .pending
                .take()
                .ok_or(BoundaryError::Invalid("compatibility update required"))?;
            let (pending, result) =
                session.with_compat_update(pending, |tx| -> Result<(), Error> {
                    let slot = tx
                        .foreign_selection_slot(&value.identity)
                        .unwrap_or_else(|| {
                            tx.detach_foreign_selection(
                                value.value.snapshot_for_foreign_read(),
                                value.identity.clone(),
                            )
                        });
                    tx.synchronize_foreign_selection_value(
                        slot,
                        value.value.snapshot_for_foreign_read(),
                    )?;
                    if patch.activate {
                        tx.activate_foreign_selection(slot)?;
                    }
                    Ok(())
                })?;
            host.pending = Some(pending);
            result?;
        }
        if !patch.historical {
            let machine::Session::Editor(session) = &mut machine.session else {
                return Err(BoundaryError::Invalid("compatibility editor surface"));
            };
            let pending = host
                .pending
                .take()
                .ok_or(BoundaryError::Invalid("compatibility update required"))?;
            let (pending, active) = session.with_compat_update(pending, |tx| {
                tx.selection()
                    .and_then(|_| tx.foreign_selection_identity(SelectionSlot::Active))
            })?;
            host.pending = Some(pending);
            host.selection_values
                .reconcile_active(active.as_ref(), host.update);
        }
        Ok(compat::CompatReply {
            value: Value::ForeignSelectionArgument { value: reference },
            records: vec![],
            selections: vec![value.encoded()],
        })
    }
}
#[wasm_bindgen]
impl EditorSession {
    /// Synchronize one owned selection value against the caller's chosen graph.
    #[wasm_bindgen(js_name=compatSetSelection)]
    pub fn compat_set_selection(&mut self, request: &[u8]) -> Result<Vec<u8>, JsError> {
        self.compat_set_selection_inner(request)
            .and_then(|reply| bytes(&reply))
            .map_err(js)
    }
    /// Retain a value independently of its original allocation graph.
    #[wasm_bindgen(js_name=compatRetainSelection)]
    pub fn compat_retain_selection(&mut self, reference: &[u8]) -> Result<(), JsError> {
        let reference = compat::ForeignSelectionRef::deserialize(reference)
            .map_err(BoundaryError::from)
            .map_err(js)?;
        let (host, _) = self.compat_parts().map_err(js)?;
        host.selection_values.retain(reference).map_err(js)
    }
    /// Release exactly one JS binding lease without releasing its graph.
    #[wasm_bindgen(js_name=compatReleaseSelection)]
    pub fn compat_release_selection(&mut self, reference: &[u8]) -> Result<(), JsError> {
        let reference = compat::ForeignSelectionRef::deserialize(reference)
            .map_err(BoundaryError::from)
            .map_err(js)?;
        let (host, _) = self.compat_parts().map_err(js)?;
        host.selection_values.release(reference).map_err(js)
    }
}
