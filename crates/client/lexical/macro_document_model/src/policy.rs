//! The single per-node import policy and Macro search-text interface.
use lexical_model::*;
use std::borrow::Cow;
/// Source exportJSON own-undefined fields; the mirror stores each absent value as null.
pub fn own_undefined_fields(node_type: &str) -> &'static [String] {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Properties {
        own_undefined: std::collections::BTreeMap<String, Vec<String>>,
    }
    static PROPERTIES: std::sync::OnceLock<Properties> = std::sync::OnceLock::new();
    PROPERTIES
        .get_or_init(|| {
            serde_json::from_str(include_str!("wire-properties.json"))
                .expect("valid generated wire property catalog")
        })
        .own_undefined
        .get(node_type)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}
/// NodeState fields retained by a TypeScript node's importJSON implementation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportedState {
    /// Keep every state field through updateFromJSON.
    Full,
    /// Keep only a nonempty id string.
    IdOnly,
    /// Keep id, peerId and sharedPeerIds with their upstream truthiness checks.
    IdAndPeer,
    /// Discard all state.
    None,
}
/// Shared lowering of node-specific import behavior onto the core JSON API.
pub trait ImportPolicy: NodeType {
    /// Which NodeState fields survive import.
    const IMPORTED_STATE: ImportedState;
    /// Whether framework element/text properties are restored.
    const IMPORT_ELEMENT_DATA: bool = true;
}
/// Macro-specific search override; None uses ordinary node text or traversal.
pub trait SearchText {
    /// Text for search indexing, when the node overrides ordinary content.
    fn search_text(&self) -> Option<Cow<'_, str>> {
        None
    }
}
/// Import own fields, replacements and exactly the state/base fields the node accepts.
pub fn import_with_policy<T: ImportPolicy>(
    tx: &mut Transaction<'_>,
    json: &SerializedNode,
) -> crate::ModelResult<NodeKey> {
    let mut json = json.clone();
    let state = match T::IMPORTED_STATE {
        ImportedState::Full => StateImportFilter::All,
        ImportedState::IdOnly => StateImportFilter::Only(&["id"]),
        ImportedState::IdAndPeer => StateImportFilter::Only(&["id", "peerId", "sharedPeerIds"]),
        ImportedState::None => StateImportFilter::None,
    };
    if matches!(
        T::IMPORTED_STATE,
        ImportedState::IdOnly | ImportedState::IdAndPeer
    ) && let Some(serde_json::Value::Object(values)) = json.get_mut("$")
    {
        values.retain(|name, value| match name.as_str() {
            "id" | "peerId" => value.as_str().is_some_and(|s| !s.is_empty()),
            "sharedPeerIds" => value.is_array(),
            _ => true,
        });
    }
    let key = tx.create(T::import_json(&json)?)?.key();
    tx.update_from_json_with(
        key,
        &json,
        JsonImport {
            state,
            base_fields: T::IMPORT_ELEMENT_DATA,
            own_fields: true,
        },
    )?;
    Ok(key)
}

// Base registered classes use the ordinary text traversal.
impl SearchText for lexical_rich_nodes::code::CodeNode {}
impl SearchText for lexical_rich_nodes::code::CodeHighlightNode {}
impl SearchText for lexical_rich_nodes::heading::HeadingNode {}
impl SearchText for lexical_rich_nodes::link::LinkNode {}
impl SearchText for lexical_rich_nodes::link::AutoLinkNode {}
impl SearchText for lexical_rich_nodes::list::ListNode {}
impl SearchText for lexical_rich_nodes::list::ListItemNode {}
impl SearchText for lexical_rich_nodes::mark::MarkNode {}
impl SearchText for lexical_rich_nodes::quote::QuoteNode {}
impl SearchText for lexical_rich_nodes::table::TableNode {}
impl SearchText for lexical_rich_nodes::table::TableCellNode {}
impl SearchText for lexical_rich_nodes::table::TableRowNode {}
