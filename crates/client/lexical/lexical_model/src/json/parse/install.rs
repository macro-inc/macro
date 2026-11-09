//! Install parsed fields without changing custom import or replacement dispatch.
use super::{Child, FieldValue, ParsedNode};
use crate::node::AbsentKeys;
use crate::*;
use serde_json::Value;
use std::{any::TypeId, sync::Arc};

impl ParsedNode<'_> {
    pub(super) fn install(mut self, tx: &mut Transaction<'_>) -> Result<NodeKey, Error> {
        tx.guard_write()?;
        let name = match self.fields.get("type") {
            Some(FieldValue::String(name)) => name.clone(),
            _ => return Err(Error::Invariant("node type missing")),
        };
        let key = match self.builtin(tx, &name)? {
            Some(key) => key,
            None => {
                let json = self.serialized();
                let index = tx.pending.registry.import_index(&name, &json)?;
                (tx.pending.registry.vtable(index).import)(tx, &json)?
            }
        };
        if tx.kind(key) == Some(NodeKind::Element)
            && let Some(FieldValue::Children(children)) = self.fields.swap_remove("children")
        {
            for child in children {
                let Child::Node(child) = child else {
                    return Err(Error::NodePayloadNotObject);
                };
                let child = child.install(tx)?;
                tx.append(key, &[child])?;
            }
        }
        Ok(key)
    }

    fn builtin(&mut self, tx: &mut Transaction<'_>, name: &str) -> Result<Option<NodeKey>, Error> {
        let Some(registration) = tx.pending.registry.get(name) else {
            return Ok(None);
        };
        if registration.replaced_by.is_some() {
            return Ok(None);
        }
        let index = registration.index;
        let table = tx.pending.registry.vtable(index);
        #[cfg(feature = "foreign-nodes")]
        if table.foreign.is_some() {
            return Ok(None);
        }
        let root = table.type_id == TypeId::of::<Root>();
        let text = table.type_id == TypeId::of::<Text>();
        let paragraph = table.type_id == TypeId::of::<Paragraph>();
        let linebreak = table.type_id == TypeId::of::<LineBreak>();
        if !(root || text || paragraph || linebreak) {
            return Ok(None);
        }
        let layout = registration.state_layout.clone();
        #[cfg(feature = "foreign-nodes")]
        let layout = tx.pending.registry.foreign_states.layout(&layout);
        if layout.entries.iter().any(|entry| entry.flat) {
            return Ok(None);
        }
        let key = if root {
            NodeKey::ROOT
        } else if text {
            tx.create(Text::default())?.key()
        } else if paragraph {
            tx.create(Paragraph::default())?.key()
        } else {
            tx.create(LineBreak::default())?.key()
        };
        let mut state_json = SerializedNode::new();
        if let Some(value) = self.fields.swap_remove(NODE_STATE_KEY) {
            state_json.insert(NODE_STATE_KEY.to_owned(), value.into_serialized());
        }
        let shared = tx.pending.shared_state_configs.for_type(index)?;
        let previous = tx.view().slot(key).and_then(|slot| slot.state.clone());
        let state = NodeState::import(&state_json, &layout, previous.as_deref(), Some(&shared));
        tx.writable(key)?.state = state.map(Arc::new);
        if text {
            let format_type = self.string("format");
            let parsed_format = format_type.and_then(|text| text.parse::<TextFormatType>().ok());
            let format = parsed_format.map_or_else(
                || TextFormat::from_bits_retain(self.number("format")),
                TextFormatType::flag,
            );
            let mode = match self.string("mode") {
                Some("normal") => TextMode::Normal,
                Some("token") => TextMode::Token,
                Some("segmented") => TextMode::Segmented,
                _ => self
                    .fields
                    .get("mode")
                    .map(|value| serde_json::from_value(value.serialized()))
                    .transpose()?
                    .unwrap_or_default(),
            };
            let mut absent = self.absent(&["text", "format", "detail", "mode", "style"]);
            if format_type.is_some() && parsed_format.is_none() {
                absent.insert(AbsentKeys::FORMAT);
            }
            tx.writable(key)?.base = BaseData::Text(TextData {
                text: TextBuffer::new(self.take_string("text")),
                format,
                detail: TextDetail::from_bits_retain(self.number("detail")),
                mode,
                style: Arc::from(self.string("style").unwrap_or_default()),
                absent,
            });
        } else if root || paragraph {
            let direction = match self.fields.get("direction") {
                None | Some(FieldValue::Other(Value::Null)) => None,
                Some(FieldValue::String(text)) if text == "ltr" => Some(TextDirection::Ltr),
                Some(FieldValue::String(text)) if text == "rtl" => Some(TextDirection::Rtl),
                Some(value) => serde_json::from_value(value.serialized())?,
            };
            let mut data = tx
                .view()
                .element(key)
                .cloned()
                .ok_or(Error::NotAnElement(key))?;
            data.format = self
                .string("format")
                .and_then(|value| value.parse().ok())
                .unwrap_or_default();
            data.direction = direction;
            data.indent = self.number("indent");
            data.text_format = TextFormat::from_bits_retain(self.number("textFormat"));
            data.text_style = Arc::from(self.string("textStyle").unwrap_or_default());
            data.absent = self.absent(&["indent", "direction"]);
            tx.writable(key)?.base = BaseData::Element(data);
        }
        Ok(Some(key))
    }

    fn take_string(&mut self, name: &str) -> String {
        match self.fields.swap_remove(name) {
            Some(FieldValue::String(value)) => value.into_owned(),
            _ => String::new(),
        }
    }

    fn absent(&self, names: &[&str]) -> AbsentKeys {
        let mut absent = AbsentKeys::empty();
        for name in names {
            if !self.fields.contains_key(*name) {
                absent.insert(AbsentKeys::field(name));
            }
        }
        absent
    }
}
