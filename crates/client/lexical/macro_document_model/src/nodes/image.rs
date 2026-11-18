//! ImageNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable ImageNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageNode {
    /// View-only decorator lifetime; never persisted or exported as node properties.
    #[serde(skip)]
    pub render_revision: u64,
    /// In-memory block alignment; upstream never serializes this property.
    #[serde(skip, default = "DecoratorBlockData::center")]
    pub block: DecoratorBlockData,
    /// Stored media payload.
    #[serde(flatten)]
    pub media: MediaData,
    /// Stored alt payload.
    #[serde(default)]
    pub alt: String,
}
impl NodeType for ImageNode {
    const TYPE: &'static str = "image";
    type Kind = DecoratorKind;
    fn after_clone(&self) -> Option<Self> {
        let mut node = self.clone();
        node.block = DecoratorBlockData::center();
        if node.media.scale.0 == 0.0 || node.media.scale.0.is_nan() {
            node.media.scale = JsNumber(1.0);
        }
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
    fn update_from_json(&mut self, json: &SerializedNode) -> crate::ModelResult<()> {
        let mut next = Self::import_json(json)?;
        next.render_revision = self.render_revision;
        *self = next;
        Ok(())
    }
}
impl ImportPolicy for ImageNode {
    const IMPORTED_STATE: ImportedState = ImportedState::Full;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for ImageNode {
    lexical_model::decorator_node_base!();
    fn render_revision(&self) -> Option<u64> {
        Some(self.render_revision)
    }
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
impl SearchText for ImageNode {}

impl Default for ImageNode {
    fn default() -> Self {
        Self {
            render_revision: 0,
            block: DecoratorBlockData::center(),
            media: MediaData::default(),
            alt: String::new(),
        }
    }
}

impl DecoratorBlock for ImageNode {
    fn block(&self) -> &DecoratorBlockData {
        &self.block
    }
    fn block_mut(&mut self) -> &mut DecoratorBlockData {
        &mut self.block
    }
}
