//! VideoNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable VideoNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoNode {
    /// Stored media payload.
    #[serde(flatten)]
    pub media: MediaData,
    /// Stored controls payload.
    #[serde(default = "default_true")]
    pub controls: bool,
}
impl NodeType for VideoNode {
    const TYPE: &'static str = "video";
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
impl ImportPolicy for VideoNode {
    const IMPORTED_STATE: ImportedState = ImportedState::Full;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for VideoNode {
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
impl SearchText for VideoNode {}

impl Default for VideoNode {
    fn default() -> Self {
        Self {
            media: MediaData::default(),
            controls: true,
        }
    }
}
