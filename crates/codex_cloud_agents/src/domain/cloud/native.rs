//! Native SSE inputs are decoded only after the session journal accepts them.
use super::CloudEvent;
use serde::{Deserialize, Serialize};

/// Complete SSE frame, retaining its original data and optional framing fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeRecord {
    /// SSE event name, empty when omitted.
    pub event: String,
    /// Explicit SSE id header, distinct from the WHAM JSON event identity.
    pub id: Option<String>,
    /// Original data lines joined with newlines by the SSE framer.
    pub data: String,
}
impl NativeRecord {
    /// Decode a durably captured input; unknown envelope kinds remain journaled.
    pub fn decode(&self) -> Result<Option<CloudEvent>, rootcause::Report> {
        let value: serde_json::Value = serde_json::from_str(&self.data)
            .map_err(|_| rootcause::report!("invalid cloud event JSON (body withheld)"))?;
        let kind = value.get("item_type").and_then(serde_json::Value::as_str);
        if !matches!(kind, Some("thread_event" | "log")) {
            return Ok(None);
        }
        let id = value
            .get("id")
            .and_then(serde_json::Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 512 && !id.chars().any(char::is_control))
            .ok_or_else(|| rootcause::report!("cloud event missing valid replay identity"))?;
        if kind == Some("log") {
            return Ok(Some(CloudEvent {
                id: id.into(),
                method: "log".into(),
                params: value,
            }));
        }
        let method = value
            .pointer("/event/method")
            .and_then(serde_json::Value::as_str)
            .filter(|method| !method.is_empty() && method.len() <= 256)
            .ok_or_else(|| rootcause::report!("cloud thread event missing method"))?;
        let params = value
            .pointer("/event/params")
            .filter(|params| params.is_object())
            .ok_or_else(|| rootcause::report!("cloud thread event missing structured params"))?;
        Ok(Some(CloudEvent {
            id: id.into(),
            method: method.into(),
            params: params.clone(),
        }))
    }

    /// Construct a synthetic native envelope for a domain event in demos and fixtures.
    pub fn from_event(event: CloudEvent) -> Self {
        let data = if event.method == "log" {
            let mut value = event.params;
            value["id"] = event.id.into();
            value["item_type"] = "log".into();
            value
        } else {
            serde_json::json!({"id":event.id,"item_type":"thread_event","event":{"method":event.method,"params":event.params}})
        };
        Self {
            event: String::new(),
            id: None,
            data: data.to_string(),
        }
    }
}
