//! ImageNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable ImageNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageNode {
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
impl ImportPolicy for ImageNode {
    const IMPORTED_STATE: ImportedState = ImportedState::Full;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for ImageNode {
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
impl SearchText for ImageNode {}
