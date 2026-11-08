//! Portable clipboard strings and model insertion; DOM conversion stays in the view.
use lexical_model::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
mod drop;
mod export;
mod import;
pub use drop::*;
pub use export::*;
pub use import::*;
/// Namespace-tagged internal clipboard representation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LexicalClipboardPayload {
    /// Editor namespace for internal paste compatibility.
    pub namespace: String,
    /// Serialized top-level selected nodes.
    pub nodes: Vec<Value>,
}
/// Plain text MIME type.
pub const MIME_PLAIN: &str = "text/plain";
/// HTML MIME type, converted to nodes by the view.
pub const MIME_HTML: &str = "text/html";
/// Internal editor MIME type.
pub const MIME_LEXICAL: &str = "application/x-lexical-editor";
/// URI fallback MIME type.
pub const MIME_URI_LIST: &str = "text/uri-list";
/// View-owned internal drag marker.
pub const MIME_LEXICAL_DRAG: &str = "application/x-lexical-drag";
/// One entry read by the view in DataTransfer order.
pub struct ClipboardEntry<'a> {
    /// MIME type.
    pub mime: &'a str,
    /// Raw clipboard string.
    pub data: &'a str,
}
#[cfg(test)]
mod test;
