//! DiffDeleteNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable DiffDeleteNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffDeleteNode {}
impl NodeType for DiffDeleteNode {
    const TYPE: &'static str = "diff-delete";
    type Kind = ElementKind;
    lexical_model::impl_default_node!();
    fn flag_probe() -> Option<Self> {
        Some(Self::default())
    }
    fn import(tx: &mut Transaction<'_>, json: &SerializedNode) -> crate::ModelResult<NodeKey> {
        super::wire::import_node::<Self>(tx, json)
    }
    fn import_json(json: &SerializedNode) -> crate::ModelResult<Self> {
        let json = super::wire::own_json(Self::TYPE, json)?;
        Ok(serde_json::from_value(Value::Object(json))?)
    }
}
impl ImportPolicy for DiffDeleteNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = false;
}
impl ElementNode for DiffDeleteNode {
    lexical_model::element_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
}
impl SearchText for DiffDeleteNode {}
