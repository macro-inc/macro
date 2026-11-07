//! DiffTextNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable DiffTextNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffTextNode {
    /// Stored diff status payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub diff_status: Maybe<DiffStatus>,
    /// Stored author payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub author: Maybe<String>,
}
impl NodeType for DiffTextNode {
    const TYPE: &'static str = "diff-text";
    type Kind = TextKind;
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
impl ImportPolicy for DiffTextNode {
    const IMPORTED_STATE: ImportedState = ImportedState::None;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl TextNode for DiffTextNode {
    lexical_model::text_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
}
impl SearchText for DiffTextNode {}
