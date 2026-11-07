//! DiffNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable DiffNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffNode {
    /// Stored user id payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub user_id: Maybe<String>,
    /// Stored label payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub label: Maybe<String>,
}
impl NodeType for DiffNode {
    const TYPE: &'static str = "diff";
    type Kind = ElementKind;
    fn flag_probe() -> Option<Self> {
        Some(Self::default())
    }
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> crate::Result<NodeKey> {
        super::wire::import_node::<Self>(tx, json)
    }
    fn import_json(json: &SerializedNode) -> crate::Result<Self> {
        let json = super::wire::own_json(Self::TYPE, json)?;
        Ok(serde_json::from_value(Value::Object(json))?)
    }
}
impl ImportPolicy for DiffNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = false;
}
impl ElementNode for DiffNode {
    lexical_model::element_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
}
impl SearchText for DiffNode {}

impl Default for DiffNode {
    fn default() -> Self {
        Self {
            user_id: Maybe::Missing,
            label: Maybe::Value(default_diff_label()),
        }
    }
}
