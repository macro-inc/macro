//! DocumentMentionNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable DocumentMentionNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMentionNode {
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
    /// Stored mention uuid payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub mention_uuid: Maybe<String>,
    /// Stored collapsed payload.
    #[serde(default)]
    pub collapsed: bool,
    /// Stored channel type payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub channel_type: Maybe<String>,
    /// Stored created at payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub created_at: Maybe<i64>,
}
impl NodeType for DocumentMentionNode {
    const TYPE: &'static str = "document-mention";
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
impl ImportPolicy for DocumentMentionNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for DocumentMentionNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        2
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        true
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (js_optional(&self.document_name).to_owned()).into()
    }
}
impl SearchText for DocumentMentionNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some("".into())
    }
}

/// Create an authored mention, assigning its timestamp from the injected clock when absent.
pub fn create_document_mention_node(
    tx: &mut Transaction<'_>,
    mut node: DocumentMentionNode,
) -> crate::ModelResult<Id<DocumentMentionNode>> {
    if matches!(node.created_at, Maybe::Missing | Maybe::Null) {
        node.created_at = Maybe::Value(
            i64::try_from(crate::now_ms(tx)?)
                .map_err(|error| Error::invariant(error.to_string()))?,
        );
    }
    tx.create(node)
}
