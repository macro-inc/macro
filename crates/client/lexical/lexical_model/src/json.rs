//! Import policy shared by node types and transactions.
/// Serialized field containing extensible node state.
pub const NODE_STATE_KEY: &str = "$";
/// Controls which fields a custom node importer accepts.
#[derive(Clone, Copy, Debug)]
pub struct JsonImport {
    /// State names to preserve.
    pub state: StateImportFilter,
    /// Import framework fields through virtual setters.
    pub base_fields: bool,
    /// Import user payload fields.
    pub own_fields: bool,
}
impl JsonImport {
    /// All state, base and own fields.
    pub const FULL: Self = Self {
        state: StateImportFilter::All,
        base_fields: true,
        own_fields: true,
    };
}
/// Extensible node state filtering during import.
#[derive(Clone, Copy, Debug)]
pub enum StateImportFilter {
    /// Keep every state name.
    All,
    /// Keep only the listed names.
    Only(&'static [&'static str]),
    /// Drop all imported state.
    None,
}
