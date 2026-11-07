//! PasteNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable PasteNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteNode {
    /// In-memory block alignment; upstream never serializes this property.
    #[serde(skip, default = "DecoratorBlockData::center")]
    pub block: DecoratorBlockData,
    /// Stored content payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub content: Maybe<String>,
    /// Stored origin payload.
    pub origin: PasteOrigin,
}
impl NodeType for PasteNode {
    const TYPE: &'static str = "paste";
    type Kind = DecoratorKind;
    fn after_clone(&self) -> Option<Self> {
        let mut node = self.clone();
        node.block = DecoratorBlockData::center();
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
impl ImportPolicy for PasteNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for PasteNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        false
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (js_optional(&self.content).to_owned()).into()
    }
}
impl SearchText for PasteNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some(js_optional(&self.content).into())
    }
}

impl Default for PasteNode {
    fn default() -> Self {
        Self {
            block: DecoratorBlockData::center(),
            content: Maybe::Missing,
            origin: PasteOrigin::Pasted,
        }
    }
}

impl DecoratorBlock for PasteNode {
    fn block(&self) -> &DecoratorBlockData {
        &self.block
    }
    fn block_mut(&mut self) -> &mut DecoratorBlockData {
        &mut self.block
    }
}
