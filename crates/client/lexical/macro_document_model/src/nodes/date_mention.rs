//! DateMentionNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable DateMentionNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DateMentionNode {
    /// Stored date payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub date: Maybe<String>,
    /// Stored display format payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub display_format: Maybe<String>,
    /// Stored mention uuid payload.
    #[serde(default, skip_serializing_if = "Maybe::is_missing")]
    pub mention_uuid: Maybe<String>,
}
impl NodeType for DateMentionNode {
    const TYPE: &'static str = "date-mention";
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
impl ImportPolicy for DateMentionNode {
    const IMPORTED_STATE: ImportedState = ImportedState::Full;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for DateMentionNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        true
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (js_optional(&self.display_format).to_owned()).into()
    }
}
impl SearchText for DateMentionNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some(js_optional(&self.display_format).into())
    }
}

/// Read an internal date body as a typed JSON payload or a bare ISO calendar value.
pub fn parse_date_mention_body(body: &str) -> Option<DateMentionNode> {
    let body = js_trim(body);
    if body.starts_with('{') {
        let data: Value = serde_json::from_str(body).ok()?;
        return Some(DateMentionNode {
            date: Maybe::Value(data.get("date")?.as_str()?.into()),
            display_format: Maybe::Value(data.get("displayFormat")?.as_str()?.into()),
            mention_uuid: data
                .get("mentionUuid")
                .and_then(Value::as_str)
                .map(|s| Maybe::Value(s.into()))
                .unwrap_or_default(),
        });
    }
    Some(DateMentionNode {
        date: Maybe::Value(body.into()),
        display_format: Maybe::Value(mention_date::bare_date_label(body)?),
        mention_uuid: Maybe::Missing,
    })
}

impl lexical_markdown::MarkdownText for DateMentionNode {
    fn markdown_text(&self) -> Option<&str> {
        self.display_format.as_ref().map(String::as_str)
    }
}
