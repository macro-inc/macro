//! EquationNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable EquationNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EquationNode {
    /// Stored equation payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub equation: Maybe<String>,
    /// Stored inline payload.
    #[serde(default)]
    pub inline: bool,
}
impl NodeType for EquationNode {
    const TYPE: &'static str = "equation";
    type Kind = DecoratorKind;
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
impl ImportPolicy for EquationNode {
    const IMPORTED_STATE: ImportedState = ImportedState::Full;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for EquationNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        true
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (js_optional(&self.equation).to_owned()).into()
    }
}
impl SearchText for EquationNode {}
