//! Owned reusable JSON storage; export hooks never borrow a shared scratch cell.
use super::*;
use serde_json::Value;

/// Owned capacity for one node export and its nested NodeState object.
/// Move it into `StateRef::export_json_reusing`; no previous content survives.
#[derive(Default)]
pub struct JsonExportBuffer {
    node: SerializedNode,
    state: SerializedNode,
}
impl JsonExportBuffer {
    /// Completed node JSON; the containing model snapshot remains immutable.
    pub fn json(&self) -> &SerializedNode {
        &self.node
    }
    /// Adjust completed JSON for an owning serialization policy, not the model.
    pub fn json_mut(&mut self) -> &mut SerializedNode {
        &mut self.node
    }
    /// Consume the buffer and retain the completed JSON as ordinary owned data.
    pub fn into_json(self) -> SerializedNode {
        self.node
    }
    fn prepare(mut self) -> Self {
        if let Some(Value::Object(mut values)) = self.node.remove("$") {
            values.clear();
            self.state = values;
        }
        self.node.clear();
        self.state.clear();
        self
    }
}
#[derive(Clone, Copy)]
enum StateSerialization {
    Parsed,
    Stored,
}
impl StateRef<'_> {
    /// Export a node with fresh owned storage.
    pub fn export_json(self, key: impl Into<NodeKey>) -> Result<SerializedNode, Error> {
        self.export_json_reusing(key, JsonExportBuffer::default())
            .map(JsonExportBuffer::into_json)
    }
    /// Export into moved caller-owned capacities, clearing every previous field.
    /// Hooks retain ordinary ordering without an ambient scratch borrow. Failure
    /// returns no partial or stale output buffer.
    pub fn export_json_reusing(
        self,
        key: impl Into<NodeKey>,
        buffer: JsonExportBuffer,
    ) -> Result<JsonExportBuffer, Error> {
        self.export_with_mode(key.into(), buffer, StateSerialization::Parsed)
    }
    /// Export imported NodeState slots as stored, retaining actual explicit writes.
    /// Ordinary public export still uses the canonical parsed values.
    pub fn export_stored_json(self, key: impl Into<NodeKey>) -> Result<SerializedNode, Error> {
        self.export_stored_json_reusing(key, JsonExportBuffer::default())
            .map(JsonExportBuffer::into_json)
    }
    /// Reuse owned capacities without replacing imported storage by a read memo.
    pub fn export_stored_json_reusing(
        self,
        key: impl Into<NodeKey>,
        buffer: JsonExportBuffer,
    ) -> Result<JsonExportBuffer, Error> {
        self.export_with_mode(key.into(), buffer, StateSerialization::Stored)
    }
    fn export_with_mode(
        self,
        key: NodeKey,
        buffer: JsonExportBuffer,
        mode: StateSerialization,
    ) -> Result<JsonExportBuffer, Error> {
        let slot = self.slot(key).ok_or(Error::NodeNotFound(key))?;
        let v = self.state.registry.vtable(slot.type_index);
        let JsonExportBuffer {
            node: mut json,
            state,
        } = self.export_framework_reusing(key, buffer, mode)?;
        if let Some(opaque) = crate::opaque::export(slot, &json) {
            json.clear();
            json.extend(opaque);
            return Ok(JsonExportBuffer { node: json, state });
        }
        let own_fields = slot.base.kind() != NodeKind::LineBreak;
        #[cfg(feature = "foreign-nodes")]
        let own_fields = own_fields || self.foreign_data(key).is_some();
        if own_fields {
            json.extend(slot.data.to_json()?);
        }
        (v.adjust_export_json)(slot.data.as_any(), NodeView { key, state: self }, &mut json)?;
        Ok(JsonExportBuffer { node: json, state })
    }
    pub(crate) fn export_framework_json(self, key: NodeKey) -> Result<SerializedNode, Error> {
        self.export_framework_reusing(key, JsonExportBuffer::default(), StateSerialization::Parsed)
            .map(JsonExportBuffer::into_json)
    }
    fn export_framework_reusing(
        self,
        key: NodeKey,
        buffer: JsonExportBuffer,
        mode: StateSerialization,
    ) -> Result<JsonExportBuffer, Error> {
        let slot = self.slot(key).ok_or(Error::NodeNotFound(key))?;
        let registration = self.state.registry.registered(slot.type_index);
        let v = self.state.registry.vtable(slot.type_index);
        let JsonExportBuffer {
            node: mut json,
            state: mut values,
        } = buffer.prepare();
        match &slot.base {
            BaseData::Element(data) => {
                json.insert("children".into(), serde_json::json!([]));
                json.insert("direction".into(), serde_json::to_value(data.direction)?);
                json.insert("format".into(), serde_json::to_value(data.format)?);
                json.insert("indent".into(), serde_json::json!(self.indent(key)));
            }
            BaseData::Text(data) => {
                json.insert("detail".into(), serde_json::json!(data.detail.bits()));
                json.insert("format".into(), serde_json::json!(data.format.bits()));
                json.insert("mode".into(), serde_json::to_value(data.mode)?);
                json.insert("style".into(), serde_json::json!(data.style));
                json.insert("text".into(), serde_json::json!(data.text.as_str()));
            }
            _ => {}
        }
        match &slot.base {
            BaseData::Element(data) => data.absent.omit(&mut json),
            BaseData::Text(data) => data.absent.omit(&mut json),
            _ => {}
        }
        json.insert("type".into(), serde_json::json!(registration.type_name));
        json.insert(
            "version".into(),
            serde_json::json!((v.json_version)(slot.data.as_any())),
        );
        if let Some(state) = &slot.state {
            #[cfg(feature = "foreign-nodes")]
            let layout = self
                .state
                .registry
                .foreign_states
                .layout(&registration.state_layout);
            #[cfg(feature = "foreign-nodes")]
            let layout = layout.as_ref();
            #[cfg(not(feature = "foreign-nodes"))]
            let layout = &registration.state_layout;
            values = match mode {
                StateSerialization::Parsed => state.export_reusing(layout, &mut json, values),
                StateSerialization::Stored => {
                    state.export_stored_reusing(layout, &mut json, values)
                }
            };
        }
        if let BaseData::Element(data) = &slot.base
            && !self.is_root_or_shadow_root(key)
            && (crate::opaque::raw(slot.data.as_ref()).is_some()
                || !self
                    .children(key)
                    .any(|child| self.kind(child) == Some(NodeKind::Text)))
        {
            if !data.text_format.is_empty() {
                json.insert(
                    "textFormat".into(),
                    serde_json::json!(data.text_format.bits()),
                );
            }
            if !data.text_style.is_empty() {
                json.insert("textStyle".into(), serde_json::json!(data.text_style));
            }
        }
        Ok(JsonExportBuffer {
            node: json,
            state: values,
        })
    }
}
#[cfg(test)]
mod stored_test;
#[cfg(test)]
mod test;
