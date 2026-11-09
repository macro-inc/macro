//! Typed calls against a scoped real transaction or an owned historical read.
use super::*;
use compat::{CompatOperation as Op, ForeignCallbackValue as Value};
use lexical_model::*;

pub(super) struct ReplyScope<'a> {
    pub version: u64,
    pub update: u32,
    pub dirty: &'a [NodeKey],
    pub writable: &'a [NodeKey],
    pub receiver: Option<NodeKey>,
}
pub(super) enum ResultValue {
    WithSelection(Box<ResultValue>, compat::CompatSelectionData),
    Scalar(Value),
    Node(Option<NodeKey>),
    Nodes(Vec<NodeKey>),
    Selection,
    SelectionValue(compat::CompatSelectionData),
}
pub(super) fn null() -> Value {
    Value::ForeignOpaqueArgument {
        value: compat::ForeignOpaqueValue::ForeignNull {},
    }
}
pub(super) fn undefined() -> Value {
    Value::ForeignOpaqueArgument {
        value: compat::ForeignOpaqueValue::ForeignUndefined {},
    }
}
pub(super) fn text(value: &str) -> Value {
    Value::ForeignStringArgument {
        value: value.encode_utf16().collect(),
    }
}
pub(super) fn string(value: Option<&Value>) -> Result<String, BoundaryError> {
    let Some(Value::ForeignStringArgument { value }) = value else {
        return Err(BoundaryError::Invalid("compatibility string argument"));
    };
    String::from_utf16(value).map_err(|_| BoundaryError::Invalid("UTF-16 argument"))
}
pub(super) fn integer(value: Option<&Value>) -> Result<u32, BoundaryError> {
    let Some(Value::ForeignNumberArgument { value }) = value else {
        return Err(BoundaryError::Invalid("integer argument"));
    };
    if !value.is_finite() || *value < 0.0 || *value > f64::from(u32::MAX) || value.fract() != 0.0 {
        return Err(BoundaryError::Invalid("integer range"));
    }
    Ok(*value as u32)
}
fn mutates(op: Op) -> bool {
    matches!(
        op,
        Op::CreateText
            | Op::CreateParagraph
            | Op::CreateHeading
            | Op::CreateLineBreak
            | Op::CreateTab
            | Op::GetWritable
            | Op::Append
            | Op::SetTextContent
            | Op::SetIndent
            | Op::AddUpdateTag
            | Op::SetNativeField
            | Op::SetSelection
            | Op::SelectionInsertText
            | Op::SelectionInsertNodes
            | Op::SelectionFormatText
            | Op::SelectionDeleteCharacter
            | Op::SelectionDeleteWord
            | Op::SelectionDeleteLine
            | Op::SelectionInsertParagraph
            | Op::SelectionInsertLineBreak
            | Op::SelectionExtract
            | Op::SetCompositionKey
    )
}
impl Host {
    pub(super) fn node_argument(&self, value: Option<&Value>) -> Result<NodeKey, BoundaryError> {
        let reference = match value {
            Some(Value::ForeignNodeArgument { value }) => value,
            Some(Value::ForeignRecordArgument { value }) => return self.validate_record(*value),
            _ => return Err(BoundaryError::Invalid("compatibility node argument")),
        };
        if reference.editor_id != self.editor {
            return Err(BoundaryError::Invalid("foreign editor node"));
        }
        if !self.capture_index.contains_node(*reference) {
            return Err(BoundaryError::Invalid(
                "unissued compatibility node reference",
            ));
        }
        Ok(NodeKey::from_parts(KeyParts {
            index: reference.key.index,
            generation: reference.key.generation,
        }))
    }

    pub(super) fn validate_record(
        &self,
        reference: compat::ForeignRecordRef,
    ) -> Result<NodeKey, BoundaryError> {
        let capture_id = reference.capture_id;
        let capture = self
            .captures
            .get(&capture_id)
            .ok_or(BoundaryError::Invalid("unknown compatibility capture"))?;
        if reference != capture.reference || reference.node.editor_id != self.editor {
            return Err(BoundaryError::Invalid("compatibility capture mismatch"));
        }
        let key = NodeKey::from_parts(KeyParts {
            index: reference.node.key.index,
            generation: reference.node.key.generation,
        });
        if capture.source.record_identity(key)? != capture.identity {
            return Err(BoundaryError::Invalid(
                "compatibility record identity mismatch",
            ));
        }
        Ok(key)
    }
    pub(super) fn receiver(
        &self,
        request: &compat::CompatRequest,
    ) -> Result<NodeKey, BoundaryError> {
        if !request.has_receiver {
            return Err(BoundaryError::Invalid("compatibility receiver required"));
        }
        let reference = request.receiver;
        let key = self.validate_record(reference)?;
        Ok(key)
    }
    fn read_captured_field(
        &self,
        request: &compat::CompatRequest,
    ) -> Result<compat::CompatReply, BoundaryError> {
        let key = self.receiver(request)?;
        let capture_id = request.receiver.capture_id;
        let capture = self
            .captures
            .get(&capture_id)
            .ok_or(BoundaryError::Invalid("unknown compatibility capture"))?;
        let field = string(request.args.first())?;
        let records = capture.source.render_records([key])?;
        let record = records
            .first()
            .ok_or(BoundaryError::Invalid("captured record missing"))?;
        let links = record.links();
        let link = |value: Option<NodeKey>| value.map_or_else(null, |key| text(&key.to_string()));
        let number = |value: u32| Value::ForeignNumberArgument {
            value: f64::from(value),
        };
        let value = match field.as_str() {
            "__key" => text(&key.to_string()),
            "__type" => text(record.record().type_name()),
            "__parent" => link(links.parent),
            "__prev" => link(links.previous),
            "__next" => link(links.next),
            "__first" => link(links.first),
            "__last" => link(links.last),
            "__size" => number(links.size),
            "__cachedText" if key == NodeKey::ROOT => {
                record.root_cached_text().map_or_else(null, text)
            }
            "__text" => match record.base() {
                BaseData::Text(data) => text(data.text.as_str()),
                _ => return Err(Error::NotAText(key).into()),
            },
            "__format" => match record.base() {
                BaseData::Text(data) => number(data.format.bits()),
                BaseData::Element(data) => number(data.format.bits()),
                _ => return Err(BoundaryError::Invalid("captured format kind")),
            },
            "__style" => match record.base() {
                BaseData::Text(data) => text(&data.style),
                BaseData::Element(data) => text(&data.style),
                _ => return Err(BoundaryError::Invalid("captured style kind")),
            },
            "__indent" => match record.base() {
                BaseData::Element(data) => number(data.indent),
                _ => return Err(Error::NotAnElement(key).into()),
            },
            "__textFormat" => match record.base() {
                BaseData::Element(data) => number(data.text_format.bits()),
                _ => return Err(Error::NotAnElement(key).into()),
            },
            "__textStyle" => match record.base() {
                BaseData::Element(data) => text(&data.text_style),
                _ => return Err(Error::NotAnElement(key).into()),
            },
            "__dir" => match record.base() {
                BaseData::Element(data) => match data.direction {
                    None => null(),
                    Some(TextDirection::Ltr) => text("ltr"),
                    Some(TextDirection::Rtl) => text("rtl"),
                },
                _ => return Err(Error::NotAnElement(key).into()),
            },
            "__detail" => match record.base() {
                BaseData::Text(data) => number(data.detail.bits()),
                _ => return Err(Error::NotAText(key).into()),
            },
            "__mode" => match record.base() {
                BaseData::Text(data) => number(match data.mode {
                    TextMode::Normal => 0,
                    TextMode::Token => 1,
                    TextMode::Segmented => 2,
                }),
                _ => return Err(Error::NotAText(key).into()),
            },
            _ => return Err(BoundaryError::Invalid("unsupported captured field")),
        };
        Ok(compat::CompatReply {
            value,
            records: vec![],
            selections: vec![],
        })
    }
    pub(super) fn prepare_node_call(
        &mut self,
        request: &compat::CompatRequest,
    ) -> Result<super::native_calls::NativeCall, BoundaryError> {
        let receiver = if request.has_receiver {
            Some(self.receiver(request)?)
        } else {
            None
        };
        let mut nodes = vec![];
        match request.operation {
            Op::GetNodeByKey => nodes.push(self.node_argument(request.args.first())?),
            Op::Append => {
                let Some(Value::ForeignNodeArrayArgument { values }) = request.args.first() else {
                    return Err(BoundaryError::Invalid("append nodes"));
                };
                for value in values {
                    nodes.push(
                        self.node_argument(Some(&Value::ForeignNodeArgument { value: *value }))?,
                    );
                }
            }
            Op::SetCompositionKey => {
                if !matches!(
                    request.args.first(),
                    Some(Value::ForeignOpaqueArgument {
                        value: compat::ForeignOpaqueValue::ForeignNull {},
                    })
                ) {
                    nodes.push(self.node_argument(request.args.first())?);
                }
            }
            Op::SetNativeField => {
                if request.receiver.access != compat::ForeignAccess::Writable
                    || request.receiver.update_id != self.update
                    || Some(request.receiver.node.version) != self.pending_version
                {
                    return Err(BoundaryError::Invalid("captured field is frozen"));
                }
            }
            _ => {}
        }
        if matches!(
            request.operation,
            Op::GetWritable | Op::Append | Op::SetTextContent | Op::SetIndent
        ) {
            self.selection_values.invalidate_active_cache(self.update);
        }
        Ok(super::native_calls::NativeCall {
            request: request.clone(),
            receiver,
            nodes,
        })
    }
    pub(super) fn reply(
        &mut self,
        source: Arc<ForeignReadSnapshot>,
        result: ResultValue,
        scope: ReplyScope<'_>,
    ) -> Result<compat::CompatReply, BoundaryError> {
        let (result, mut selections) = match result {
            ResultValue::WithSelection(result, selection) => (*result, vec![selection]),
            result => (result, vec![]),
        };
        let ReplyScope {
            version,
            update,
            dirty,
            writable,
            receiver,
        } = scope;
        let mut keys: std::collections::HashSet<_> = dirty.iter().copied().collect();
        keys.extend(receiver);
        match &result {
            ResultValue::Node(key) => keys.extend(*key),
            ResultValue::Nodes(nodes) => keys.extend(nodes.iter().copied()),
            _ => {}
        }
        let mut keys: Vec<_> = keys.into_iter().collect();
        keys.sort_unstable();
        let records = self.records(
            source.clone(),
            keys,
            version,
            update,
            if update == 0 {
                compat::ForeignAccess::Frozen
            } else {
                compat::ForeignAccess::Writable
            },
            records::CaptureOptions {
                writable,
                include_root_cache: false,
            },
        )?;
        let references: std::collections::HashMap<_, _> = records
            .iter()
            .map(|record| {
                let node = record.record.node;
                (
                    NodeKey::from_parts(KeyParts {
                        index: node.key.index,
                        generation: node.key.generation,
                    }),
                    node,
                )
            })
            .collect();
        let reference = |key: NodeKey| {
            references
                .get(&key)
                .copied()
                .ok_or(BoundaryError::Invalid("result record missing"))
        };
        let value = match result {
            ResultValue::WithSelection(_, _) => {
                return Err(BoundaryError::Invalid("nested selection result"))
            }
            ResultValue::Scalar(value) => value,
            ResultValue::Node(Some(key)) => Value::ForeignNodeArgument {
                value: reference(key)?,
            },
            ResultValue::Node(None) => null(),
            ResultValue::Nodes(keys) => Value::ForeignNodeArrayArgument {
                values: keys.into_iter().map(reference).collect::<Result<_, _>>()?,
            },
            ResultValue::Selection | ResultValue::SelectionValue(_) => {
                let selection = match result {
                    ResultValue::SelectionValue(value) => value,
                    _ => self.selection(&source, version)?,
                };
                let value = match &selection {
                    compat::CompatSelectionData::CompatNoSelection {} => null(),
                    compat::CompatSelectionData::CompatRangeSelection { reference, .. }
                    | compat::CompatSelectionData::CompatNodeSelection { reference, .. }
                    | compat::CompatSelectionData::CompatTableSelection { reference, .. } => {
                        Value::ForeignSelectionArgument { value: *reference }
                    }
                    _ => return Err(BoundaryError::Invalid("unknown selection type")),
                };
                selections.push(selection);
                value
            }
        };
        Ok(compat::CompatReply {
            value,
            records,
            selections,
        })
    }
}
impl EditorSession {
    pub(super) fn compat_call_inner(
        &mut self,
        request: &[u8],
    ) -> Result<compat::CompatReply, BoundaryError> {
        let request = compat::CompatRequest::deserialize(request)?;
        let (host, machine) = self.compat_parts()?;
        if request.operation == Op::GetNodeField {
            return host.read_captured_field(&request);
        }
        if request.historical {
            if mutates(request.operation) {
                return Err(BoundaryError::Invalid("historical compatibility mutation"));
            }
            if host.pending_version == Some(request.state_version) {
                let machine::Session::Editor(session) = &mut machine.session else {
                    return Err(BoundaryError::Invalid("compatibility editor surface"));
                };
                let committed = session.surface().state().clone();
                let pending = host
                    .pending
                    .take()
                    .ok_or(BoundaryError::Invalid("compatibility update required"))?;
                let (pending, result) =
                    session.with_compat_update(pending, |tx| -> Result<_, BoundaryError> {
                        let source = Arc::new(tx.view().snapshot_for_foreign_read()?);
                        let result = source.with_read_transaction(&committed, |peer| {
                            super::scopes::dispatch(host, peer, &request)
                        })??;
                        Ok((source, result))
                    })?;
                host.pending = Some(pending);
                let (source, result) = result?;
                let receiver = if request.has_receiver {
                    Some(host.receiver(&request)?)
                } else {
                    None
                };
                return host.reply(
                    source,
                    result,
                    ReplyScope {
                        version: request.state_version,
                        update: 0,
                        dirty: &[],
                        writable: &[],
                        receiver,
                    },
                );
            }
            let state = host
                .states
                .get(&request.state_version)
                .ok_or(BoundaryError::Invalid("unknown compatibility version"))?
                .clone();
            let source = Arc::new(state.view().snapshot_for_foreign_read()?);
            let result = source.with_read_transaction(&state, |tx| {
                super::scopes::dispatch(host, tx, &request)
            })??;
            let receiver = if request.has_receiver {
                Some(host.receiver(&request)?)
            } else {
                None
            };
            return host.reply(
                source,
                result,
                ReplyScope {
                    version: request.state_version,
                    update: 0,
                    dirty: &[],
                    writable: &[],
                    receiver,
                },
            );
        }
        let machine::Session::Editor(session) = &mut machine.session else {
            return Err(BoundaryError::Invalid("compatibility editor surface"));
        };
        let pending = host
            .pending
            .take()
            .ok_or(BoundaryError::Invalid("compatibility update required"))?;
        let (pending, result) =
            session.with_compat_update(pending, |tx| -> Result<_, BoundaryError> {
                let operation = ForeignReadOperation::begin()?;
                let result = super::scopes::dispatch(host, tx, &request);
                let active = tx
                    .selection()
                    .and_then(|_| tx.foreign_selection_identity(SelectionSlot::Active));
                host.selection_values
                    .reconcile_active(active.as_ref(), host.update);
                let result = operation.finish(result)?;
                let source = Arc::new(tx.view().snapshot_for_foreign_read()?);
                let dirty = tx
                    .foreign_dirty_keys()
                    .filter(|key| tx.view().contains(*key))
                    .collect::<Vec<_>>();
                let writable = dirty
                    .iter()
                    .copied()
                    .filter(|key| tx.foreign_is_writable(*key))
                    .collect::<Vec<_>>();
                Ok((source, result, dirty, writable))
            })?;
        host.pending = Some(pending);
        let (source, result, dirty, writable) = result?;
        let receiver = if request.has_receiver {
            Some(host.receiver(&request)?)
        } else {
            None
        };
        host.reply(
            source,
            result,
            ReplyScope {
                version: host
                    .pending_version
                    .ok_or(BoundaryError::Invalid("pending publication version"))?,
                update: host.update,
                dirty: &dirty,
                writable: &writable,
                receiver,
            },
        )
    }
}
#[wasm_bindgen]
impl EditorSession {
    /// Execute one typed operation in the live update or an exact historical read.
    #[wasm_bindgen(js_name=compatCall)]
    pub fn compat_call(&mut self, request: &[u8]) -> Result<Vec<u8>, JsError> {
        self.compat_call_inner(request)
            .and_then(|reply| bytes(&reply))
            .map_err(js)
    }
}
