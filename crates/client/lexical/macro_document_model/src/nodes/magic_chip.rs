//! MagicChipNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable MagicChipNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagicChipNode {
    /// Stored agent session id payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub agent_session_id: Maybe<String>,
    /// Stored channel id payload.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "serde_with::rust::double_option"
    )]
    pub channel_id: Option<Option<String>>,
    /// Stored prompted message payload.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "serde_with::rust::double_option"
    )]
    pub prompted_message: Option<Option<OrderedMagicChipMessage>>,
    /// Stored status payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub status: Maybe<MagicChipStatus>,
}
/// A validated message retaining its actual raw JSON ordering and extra fields.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(transparent)]
pub struct OrderedMagicChipMessage(Value);
impl OrderedMagicChipMessage {
    /// Canonically serialize typed input that has no original JSON order witness.
    pub fn from_typed(message: MagicChipMessage) -> crate::ModelResult<Self> {
        Ok(Self(serde_json::to_value(message)?))
    }
}
impl<'de> Deserialize<'de> for OrderedMagicChipMessage {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        let raw = Value::deserialize(deserializer)?;
        let _: MagicChipMessage =
            serde_json::from_value(raw.clone()).map_err(serde::de::Error::custom)?;
        Ok(Self(raw))
    }
}
impl NodeType for MagicChipNode {
    const TYPE: &'static str = "magic-chip";
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
impl ImportPolicy for MagicChipNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for MagicChipNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        5
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        false
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (match &self.status {
            Maybe::Value(status) => status.as_str(),
            Maybe::Null => "null",
            Maybe::Missing => "undefined",
        }
        .to_owned())
        .into()
    }
}
impl SearchText for MagicChipNode {}

impl lexical_markdown::MarkdownText for MagicChipNode {
    fn markdown_text(&self) -> Option<&str> {
        self.status.as_ref().map(|value| value.as_str())
    }
}

#[cfg(test)]
mod test;
