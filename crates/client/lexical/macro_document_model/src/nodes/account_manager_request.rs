//! AccountManagerRequestNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable AccountManagerRequestNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountManagerRequestNode {
    /// Stored grant id payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub grant_id: Maybe<String>,
}
impl NodeType for AccountManagerRequestNode {
    const TYPE: &'static str = "account-manager-request";
    type Kind = DecoratorKind;
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
impl ImportPolicy for AccountManagerRequestNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for AccountManagerRequestNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        true
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        ("Account manager request".to_owned()).into()
    }
}
impl SearchText for AccountManagerRequestNode {}
