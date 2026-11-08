//! CompletionNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable CompletionNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionNode {
    /// View opacity choice; import always restores true and JSON omits it.
    #[serde(skip, default = "default_true")]
    pub is_transparent: bool,
}
impl NodeType for CompletionNode {
    const TYPE: &'static str = "completion";
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
impl ImportPolicy for CompletionNode {
    const IMPORTED_STATE: ImportedState = ImportedState::None;
    const IMPORT_ELEMENT_DATA: bool = false;
}
impl ElementNode for CompletionNode {
    lexical_model::element_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn exclude_from_copy(&self, _: ElementView<'_>, _: Option<CopyDestination>) -> bool {
        true
    }
}
impl SearchText for CompletionNode {}

impl Default for CompletionNode {
    fn default() -> Self {
        Self {
            is_transparent: true,
        }
    }
}
