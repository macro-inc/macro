//! Typed calls against a scoped real transaction or an owned historical read.
use super::*;
use compat::{CompatOperation as Op, ForeignCallbackValue as Value};
use lexical_model::*;

struct ReplyScope<'a> {
    version: u64,
    update: u32,
    dirty: &'a [NodeKey],
    writable: &'a [NodeKey],
    receiver: Option<NodeKey>,
}
enum ResultValue {
    Scalar(Value),
    Node(Option<NodeKey>),
    Nodes(Vec<NodeKey>),
    Selection,
}
fn null() -> Value {
    Value::ForeignOpaqueArgument {
        value: compat::ForeignOpaqueValue::ForeignNull {},
    }
}
fn undefined() -> Value {
    Value::ForeignOpaqueArgument {
        value: compat::ForeignOpaqueValue::ForeignUndefined {},
    }
}
fn text(value: &str) -> Value {
    Value::ForeignStringArgument {
        value: value.encode_utf16().collect(),
    }
}
fn string(value: Option<&Value>) -> Result<String, BoundaryError> {
    let Some(Value::ForeignStringArgument { value }) = value else {
        return Err(BoundaryError::Invalid("compatibility string argument"));
    };
    String::from_utf16(value).map_err(|_| BoundaryError::Invalid("UTF-16 argument"))
}
fn integer(value: Option<&Value>) -> Result<u32, BoundaryError> {
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
    )
}
impl Host {
    fn node_argument(&self, value: Option<&Value>) -> Result<NodeKey, BoundaryError> {
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

    fn validate_record(
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
    fn receiver(&self, request: &compat::CompatRequest) -> Result<NodeKey, BoundaryError> {
        if !request.has_receiver {
            return Err(BoundaryError::Invalid("compatibility receiver required"));
        }
        let reference = request.receiver;
        let key = self.validate_record(reference)?;
        if request.historical && reference.node.version != request.state_version {
            return Err(BoundaryError::Invalid("historical receiver mismatch"));
        }
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
    fn dispatch(
        &self,
        tx: &mut Transaction<'_>,
        request: &compat::CompatRequest,
    ) -> Result<ResultValue, BoundaryError> {
        let receiver = if request.has_receiver {
            Some(self.receiver(request)?)
        } else {
            None
        };
        let key = || receiver.ok_or(BoundaryError::Invalid("compatibility receiver required"));
        let arg = |index| request.args.get(index);
        Ok(match request.operation {
            Op::GetRoot => ResultValue::Node(Some(NodeKey::ROOT)),
            Op::GetNodeByKey => {
                let key = self.node_argument(arg(0))?;
                ResultValue::Node(tx.contains(key).then_some(key))
            }
            Op::CreateText => ResultValue::Node(Some(tx.create_text(&string(arg(0))?)?.key())),
            Op::CreateParagraph => ResultValue::Node(Some(tx.create(Paragraph::default())?.key())),
            Op::CreateLineBreak => ResultValue::Node(Some(tx.create(LineBreak::default())?.key())),
            Op::CreateTab => ResultValue::Node(Some(tx.create(Tab::default())?.key())),
            Op::CreateHeading => {
                let tag = match string(arg(0))?.as_str() {
                    "h1" => lexical_rich_nodes::heading::HeadingTagType::H1,
                    "h2" => lexical_rich_nodes::heading::HeadingTagType::H2,
                    "h3" => lexical_rich_nodes::heading::HeadingTagType::H3,
                    "h4" => lexical_rich_nodes::heading::HeadingTagType::H4,
                    "h5" => lexical_rich_nodes::heading::HeadingTagType::H5,
                    "h6" => lexical_rich_nodes::heading::HeadingTagType::H6,
                    _ => return Err(BoundaryError::Invalid("heading tag")),
                };
                ResultValue::Node(Some(
                    tx.create(lexical_rich_nodes::heading::HeadingNode { tag })?
                        .key(),
                ))
            }
            Op::GetLatest => {
                let key = key()?;
                tx.node_or_err(key)?;
                ResultValue::Node(Some(key))
            }
            Op::GetWritable => {
                let key = key()?;
                tx.mark_dirty(key)?;
                ResultValue::Node(Some(key))
            }
            Op::Append => {
                let Some(Value::ForeignNodeArrayArgument { values }) = arg(0) else {
                    return Err(BoundaryError::Invalid("append nodes"));
                };
                let nodes = values
                    .iter()
                    .map(|value| {
                        self.node_argument(Some(&Value::ForeignNodeArgument { value: *value }))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let key = key()?;
                tx.append(key, &nodes)?;
                ResultValue::Node(Some(key))
            }
            Op::GetChildren => ResultValue::Nodes(tx.children_keys(key()?)?),
            Op::GetChildrenSize => ResultValue::Scalar(Value::ForeignNumberArgument {
                value: f64::from(tx.view().children_size(key()?)),
            }),
            Op::GetTextContent => ResultValue::Scalar(text(&tx.text_content(key()?))),
            Op::GetTextContentSize => ResultValue::Scalar(Value::ForeignNumberArgument {
                value: f64::from(tx.text_content_size(key()?).get()),
            }),
            Op::SetTextContent => {
                let key = key()?;
                tx.text(key)?.set_text_content(&string(arg(0))?)?;
                ResultValue::Node(Some(key))
            }
            Op::GetFirstChild => ResultValue::Node(tx.first_child(key()?)),
            Op::GetLastChild => ResultValue::Node(tx.last_child(key()?)),
            Op::GetParent => ResultValue::Node(tx.parent(key()?)),
            Op::GetPreviousSibling => ResultValue::Node(tx.prev_sibling(key()?)),
            Op::GetNextSibling => ResultValue::Node(tx.next_sibling(key()?)),
            Op::GetIndent => ResultValue::Scalar(Value::ForeignNumberArgument {
                value: f64::from(tx.indent(key()?)),
            }),
            Op::SetIndent => {
                let Some(Value::ForeignNumberArgument { value }) = arg(0) else {
                    return Err(BoundaryError::Invalid("indent argument"));
                };
                if !value.is_finite()
                    || *value < 0.0
                    || *value > f64::from(u32::MAX)
                    || value.fract() != 0.0
                {
                    return Err(BoundaryError::Invalid("indent range"));
                }
                let key = key()?;
                tx.set_indent(key, *value as u32)?;
                ResultValue::Node(Some(key))
            }
            Op::IsAttached => ResultValue::Scalar(Value::ForeignBooleanArgument {
                value: tx.is_attached(key()?),
            }),
            Op::IsInline => ResultValue::Scalar(Value::ForeignBooleanArgument {
                value: tx.is_inline(key()?),
            }),
            Op::SetNativeField => {
                if request.receiver.access != compat::ForeignAccess::Writable
                    || request.receiver.update_id != self.update
                    || Some(request.receiver.node.version) != self.pending_version
                {
                    return Err(BoundaryError::Invalid("captured field is frozen"));
                }
                let key = key()?;
                if !tx.foreign_is_writable(key) {
                    return Err(BoundaryError::Invalid("captured field is not writable"));
                }
                let field = string(arg(0))?;
                match field.as_str() {
                    "__text" => {
                        tx.text(key)?.set_text_content(&string(arg(1))?)?;
                    }
                    "__style" => {
                        let style = string(arg(1))?;
                        if tx.is_text(key) {
                            tx.text(key)?.set_style(&style)?;
                        } else {
                            tx.element(key)?.set_style(&style)?;
                        }
                    }
                    "__format" => {
                        let value = integer(arg(1))?;
                        if tx.is_text(key) {
                            tx.text(key)?
                                .set_format(TextFormat::from_bits_retain(value))?;
                        } else {
                            tx.element(key)?.set_format(match value {
                                0 => ElementFormat::Unset,
                                1 => ElementFormat::Left,
                                2 => ElementFormat::Center,
                                3 => ElementFormat::Right,
                                4 => ElementFormat::Justify,
                                5 => ElementFormat::Start,
                                6 => ElementFormat::End,
                                _ => return Err(BoundaryError::Invalid("element format")),
                            })?;
                        }
                    }
                    "__detail" => {
                        tx.text(key)?
                            .set_detail(TextDetail::from_bits_retain(integer(arg(1))?))?;
                    }
                    "__mode" => {
                        let mode = match integer(arg(1))? {
                            0 => TextMode::Normal,
                            1 => TextMode::Token,
                            2 => TextMode::Segmented,
                            _ => return Err(BoundaryError::Invalid("text mode")),
                        };
                        tx.text(key)?.set_mode(mode)?;
                    }
                    "__indent" => {
                        tx.set_indent(key, integer(arg(1))?)?;
                    }
                    "__textFormat" => {
                        tx.element(key)?
                            .set_text_format(TextFormat::from_bits_retain(integer(arg(1))?))?;
                    }
                    "__textStyle" => {
                        tx.element(key)?.set_text_style(&string(arg(1))?)?;
                    }
                    "__dir" => {
                        let direction = match arg(1) {
                            Some(Value::ForeignOpaqueArgument {
                                value: compat::ForeignOpaqueValue::ForeignNull {},
                            }) => None,
                            _ => Some(match string(arg(1))?.as_str() {
                                "ltr" => TextDirection::Ltr,
                                "rtl" => TextDirection::Rtl,
                                _ => return Err(BoundaryError::Invalid("element direction")),
                            }),
                        };
                        tx.element(key)?.set_direction(direction)?;
                    }
                    _ => return Err(BoundaryError::Invalid("unsupported native field patch")),
                }
                ResultValue::Node(Some(key))
            }
            Op::GetSelection => ResultValue::Selection,
            Op::GetCompositionKey => ResultValue::Node(tx.composition_key()),
            Op::AddUpdateTag => {
                tx.add_tag(
                    string(arg(0))?
                        .parse()
                        .expect("custom update tags are infallible"),
                );
                ResultValue::Scalar(undefined())
            }
            Op::ExportNodeJson => ResultValue::Scalar(text(&to_js_json_string(
                &serde_json::Value::Object(tx.export_json(key()?)?),
            ))),
            Op::ExportStateJson => ResultValue::Scalar(text(&to_js_json_string(
                &serde_json::to_value(tx.view().snapshot_for_foreign_read()?.state().to_json()?)?,
            ))),
            _ => {
                return Err(BoundaryError::Invalid(
                    "unsupported compatibility operation",
                ))
            }
        })
    }
    fn reply(
        &mut self,
        source: Arc<ForeignReadSnapshot>,
        result: ResultValue,
        scope: ReplyScope<'_>,
    ) -> Result<compat::CompatReply, BoundaryError> {
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
            writable,
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
        let mut selections = vec![];
        let value = match result {
            ResultValue::Scalar(value) => value,
            ResultValue::Node(Some(key)) => Value::ForeignNodeArgument {
                value: reference(key)?,
            },
            ResultValue::Node(None) => null(),
            ResultValue::Nodes(keys) => Value::ForeignNodeArrayArgument {
                values: keys.into_iter().map(reference).collect::<Result<_, _>>()?,
            },
            ResultValue::Selection => {
                let selection = self.selection(&source, version)?;
                let value = match &selection {
                    compat::CompatSelectionData::CompatNoSelection {} => null(),
                    compat::CompatSelectionData::CompatRangeSelection { reference, .. }
                    | compat::CompatSelectionData::CompatNodeSelection { reference, .. } => {
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
            let state = host
                .states
                .get(&request.state_version)
                .ok_or(BoundaryError::Invalid("unknown compatibility version"))?
                .clone();
            let source = Arc::new(state.view().snapshot_for_foreign_read()?);
            let result =
                source.with_read_transaction(&state, |tx| host.dispatch(tx, &request))??;
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
                let result = host.dispatch(tx, &request);
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
