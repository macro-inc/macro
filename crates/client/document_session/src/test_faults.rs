//! Explicit simulation-only bad projection writes; no document handle escapes.
use crate::*;
use lexical_model::NodeKey;

/// Actual Loro mutation produced by the simulated serialization bug.
#[derive(Clone, Debug)]
pub struct ProjectionFaultWrite {
    /// Mutated node-map container.
    pub node: String,
    /// Actual author.
    pub peer: u64,
    /// Counter range start.
    pub start: i32,
    /// Counter range end.
    pub end: i32,
    /// Previous persisted node type.
    pub previous: String,
    /// Incorrect persisted node type.
    pub written: String,
}
pub(crate) struct PreparedFault {
    id: loro::ContainerID,
    previous: String,
    model: serde_json::Map<String, serde_json::Value>,
}
impl EditorSurface {
    pub(crate) fn prepare_projection_type_write(
        &self,
        doc: &loro::LoroDoc,
    ) -> Result<Option<PreparedFault>, SessionError> {
        let view = self.state().view();
        for (key, _) in view.descendants(NodeKey::ROOT) {
            if !matches!(view.type_name(key)?, "paragraph" | "quote") {
                continue;
            }
            let id = self
                .projection
                .as_ref()
                .and_then(|projection| projection.container_of(key))
                .cloned()
                .ok_or(SessionError::NotReady)?;
            let map = doc.get_map(&id);
            let previous = match map.get("type") {
                Some(loro::ValueOrContainer::Value(loro::LoroValue::String(value))) => {
                    value.to_string()
                }
                _ => return Err(SessionError::Configuration("missing projected node type")),
            };
            return Ok(Some(PreparedFault {
                id,
                previous,
                model: view.export_json(key)?,
            }));
        }
        Ok(None)
    }
    #[tracing::instrument(name = "doc.projection.inject", skip_all, err)]
    pub(crate) fn inject_projection_type_write(
        &mut self,
        doc: &loro::LoroDoc,
        fault: PreparedFault,
    ) -> Result<(), SessionError> {
        self.fault_quote = !self.fault_quote;
        let written = if self.fault_quote {
            "quote"
        } else {
            "paragraph"
        };
        let peer = doc.peer_id();
        let start = doc.oplog_vv().get(&peer).copied().unwrap_or(0);
        let map = doc.get_map(&fault.id);
        map.insert("type", written)?;
        // Preserve canonical snapshot JSON for each real class. The injected
        // error is an unsupported incremental type change, not invalid JSON.
        if written == "quote" {
            for key in ["textFormat", "textStyle"] {
                if map.get(key).is_some() {
                    map.delete(key)?;
                }
            }
        } else {
            let format = fault
                .model
                .get("textFormat")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(0);
            let style = fault
                .model
                .get("textStyle")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            map.insert("textFormat", format)?;
            map.insert("textStyle", style)?;
        }
        doc.commit_with(loro::CommitOptions::new().origin(lexical_loro::LOCAL_ORIGIN));
        let end = doc.oplog_vv().get(&peer).copied().unwrap_or(0);
        if fault.previous != written && end > start {
            tracing::error!(peer, start, end, previous = %fault.previous, written, "injected local projection serialization fault");
            self.projection_fault_writes.push(ProjectionFaultWrite {
                node: fault.id.to_string(),
                peer,
                start,
                end,
                previous: fault.previous,
                written: written.into(),
            });
        }
        Ok(())
    }
}
