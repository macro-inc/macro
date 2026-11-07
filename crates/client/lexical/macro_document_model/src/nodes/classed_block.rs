//! ClassedBlockNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable ClassedBlockNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassedBlockNode {
    /// Stored tag payload.
    pub tag: ClassedBlockTag,
    /// Stored classes payload.
    #[serde(default)]
    pub classes: Vec<String>,
    /// Stored attributes payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub attributes: Maybe<IndexMap<String, String>>,
}
impl NodeType for ClassedBlockNode {
    const TYPE: &'static str = "classed-block";
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
impl ImportPolicy for ClassedBlockNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = false;
}
impl ElementNode for ClassedBlockNode {
    lexical_model::element_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
}
impl SearchText for ClassedBlockNode {}
