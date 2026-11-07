//! DocumentCardNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable DocumentCardNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCardNode {
    /// In-memory block alignment; upstream never serializes this property.
    #[serde(skip, default = "DecoratorBlockData::center")]
    pub block: DecoratorBlockData,
    /// Stored document id payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub document_id: Maybe<String>,
    /// Stored document name payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub document_name: Maybe<String>,
    /// Stored block name payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub block_name: Maybe<String>,
    /// Stored block params payload.
    #[serde(default)]
    pub block_params: IndexMap<String, String>,
    /// Stored preview box payload.
    #[serde(default = "default_preview_box")]
    pub preview_box: PreviewBox,
    /// Stored preview data payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub preview_data: Maybe<Value>,
    /// Stored mention uuid payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub mention_uuid: Maybe<String>,
}
impl NodeType for DocumentCardNode {
    const TYPE: &'static str = "document-card";
    type Kind = DecoratorKind;
    fn after_clone(&self) -> Option<Self> {
        let mut node = self.clone();
        node.block = DecoratorBlockData::center();
        Some(node)
    }
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
impl ImportPolicy for DocumentCardNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for DocumentCardNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        false
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (js_optional(&self.document_name).to_owned()).into()
    }
}
impl SearchText for DocumentCardNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some("".into())
    }
}

impl Default for DocumentCardNode {
    fn default() -> Self {
        Self {
            block: DecoratorBlockData::center(),
            document_id: Maybe::Missing,
            document_name: Maybe::Missing,
            block_name: Maybe::Missing,
            block_params: IndexMap::new(),
            preview_box: default_preview_box(),
            preview_data: Maybe::Missing,
            mention_uuid: Maybe::Missing,
        }
    }
}

impl DecoratorBlock for DocumentCardNode {
    fn block(&self) -> &DecoratorBlockData {
        &self.block
    }
    fn block_mut(&mut self) -> &mut DecoratorBlockData {
        &mut self.block
    }
}
