//! HorizontalRuleNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable HorizontalRuleNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HorizontalRuleNode {
    /// In-memory block alignment; upstream never serializes this property.
    #[serde(skip, default = "DecoratorBlockData::default")]
    pub block: DecoratorBlockData,
}
impl NodeType for HorizontalRuleNode {
    const TYPE: &'static str = "horizontalrule";
    type Kind = DecoratorKind;
    lexical_model::impl_default_node!();
    fn after_clone(&self) -> Option<Self> {
        let mut node = self.clone();
        node.block = DecoratorBlockData::default();
        Some(node)
    }
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
impl ImportPolicy for HorizontalRuleNode {
    const IMPORTED_STATE: ImportedState = ImportedState::Full;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for HorizontalRuleNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        false
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        ("\n".to_owned()).into()
    }
}
impl SearchText for HorizontalRuleNode {}

impl DecoratorBlock for HorizontalRuleNode {
    fn block(&self) -> &DecoratorBlockData {
        &self.block
    }
    fn block_mut(&mut self) -> &mut DecoratorBlockData {
        &mut self.block
    }
}
