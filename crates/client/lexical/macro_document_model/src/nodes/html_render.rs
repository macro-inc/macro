//! HtmlRenderNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable HtmlRenderNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HtmlRenderNode {
    /// In-memory block alignment; upstream never serializes this property.
    #[serde(skip, default = "DecoratorBlockData::left")]
    pub block: DecoratorBlockData,
    /// Stored html payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub html: Maybe<String>,
    /// Stored adapt colors payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub adapt_colors: Maybe<bool>,
}
impl NodeType for HtmlRenderNode {
    const TYPE: &'static str = "html-render";
    type Kind = DecoratorKind;
    fn after_clone(&self) -> Option<Self> {
        let mut node = self.clone();
        node.block = DecoratorBlockData::left();
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
impl ImportPolicy for HtmlRenderNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for HtmlRenderNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        false
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (String::new()).into()
    }
}
impl SearchText for HtmlRenderNode {}

impl Default for HtmlRenderNode {
    fn default() -> Self {
        Self {
            block: DecoratorBlockData::left(),
            html: Maybe::Missing,
            adapt_colors: Maybe::Missing,
        }
    }
}

impl DecoratorBlock for HtmlRenderNode {
    fn block(&self) -> &DecoratorBlockData {
        &self.block
    }
    fn block_mut(&mut self) -> &mut DecoratorBlockData {
        &mut self.block
    }
}
