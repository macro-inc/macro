//! SnapshotNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable SnapshotNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotNode {
    /// Stored document id payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub document_id: Maybe<String>,
    /// Stored document name payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub document_name: Maybe<String>,
    /// Stored block name payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub block_name: Maybe<String>,
    /// Stored content payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub content: Maybe<String>,
    /// Stored snapshot date payload.
    #[serde(default)]
    pub snapshot_date: String,
    /// Stored mention uuid payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub mention_uuid: Maybe<String>,
}
impl NodeType for SnapshotNode {
    const TYPE: &'static str = "snapshot";
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
impl ImportPolicy for SnapshotNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for SnapshotNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        true
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (js_optional(&self.document_name).to_owned()).into()
    }
}
impl SearchText for SnapshotNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some(js_optional(&self.document_name).into())
    }
}

impl lexical_markdown::MarkdownText for SnapshotNode {
    fn markdown_text(&self) -> Option<&str> {
        self.document_name.as_ref().map(String::as_str)
    }
}
