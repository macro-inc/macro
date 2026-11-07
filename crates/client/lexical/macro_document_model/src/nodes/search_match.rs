//! SearchMatchNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable SearchMatchNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatchNode {
    /// Stored mark payload.
    #[serde(flatten)]
    pub mark: MarkNode,
}
impl NodeType for SearchMatchNode {
    const TYPE: &'static str = "search-match";
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
impl ImportPolicy for SearchMatchNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdAndPeer;
    const IMPORT_ELEMENT_DATA: bool = false;
}
impl ElementNode for SearchMatchNode {
    type Parent = MarkNode;
    fn as_parent(&self) -> &Self::Parent {
        &self.mark
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        Some(&mut self.mark)
    }
    fn json_version(&self) -> u32 {
        1
    }
}
impl SearchText for SearchMatchNode {}
