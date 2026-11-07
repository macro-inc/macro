//! CursorSystemNotificationNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable CursorSystemNotificationNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorSystemNotificationNode {
    /// Stored source payload.
    pub source: String,
    /// Stored attributes payload.
    pub attributes: IndexMap<String, String>,
    /// Stored text payload.
    pub text: String,
}
impl NodeType for CursorSystemNotificationNode {
    const TYPE: &'static str = "system-notification";
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
impl ImportPolicy for CursorSystemNotificationNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for CursorSystemNotificationNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        1
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        false
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (self.text.clone()).into()
    }
}
impl SearchText for CursorSystemNotificationNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some(self.text.as_str().into())
    }
}

fn unescape_attribute(value: &str) -> crate::Result<String> {
    use lexical_rich_nodes::utils::matcher::RegexMatcher;
    let value = value
        .replace("\\_", "_")
        .replace("&quot;", "\"")
        .replace("&amp;", "&");
    let regex = RegexMatcher::new("<m-link>(.*?)</m-link>", "s")
        .map_err(|error| Error::invariant(error.to_string()))?;
    let units: Vec<_> = value.encode_utf16().collect();
    let mut output = String::new();
    let mut cursor = 0;
    for m in regex.find_all(&value) {
        output.push_str(&String::from_utf16_lossy(
            &units[cursor..m.index.get() as usize],
        ));
        let parsed = serde_json::from_str::<Value>(m.get(1).unwrap_or(""));
        let replacement = parsed
            .as_ref()
            .ok()
            .and_then(|value| {
                value
                    .get("text")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .or_else(|| value.get("url").and_then(Value::as_str))
            })
            .unwrap_or(m.full());
        output.push_str(replacement);
        cursor = m.end().get() as usize;
    }
    output.push_str(&String::from_utf16_lossy(&units[cursor..]));
    Ok(output)
}
/// Parse quoted notification attributes, including internal link envelopes in values.
pub fn parse_cursor_system_notification_attributes(
    tag: &str,
) -> crate::Result<IndexMap<String, String>> {
    use lexical_rich_nodes::utils::matcher::RegexMatcher;
    let regex = RegexMatcher::new(
        r#"([A-Za-z_\\][\w.:\\-]*)\s*=\s*"((?:<m-link>.*?</m-link>|[^"])*)""#,
        "",
    )
    .map_err(|error| Error::invariant(error.to_string()))?;
    let mut output = IndexMap::new();
    for m in regex.find_all(tag) {
        output.insert(
            unescape_attribute(m.get(1).unwrap_or(""))?,
            unescape_attribute(m.get(2).unwrap_or(""))?,
        );
    }
    Ok(output)
}
/// Read a notification only when its opening tag carries a nonempty source.
pub fn read_cursor_system_notification(
    opening_tag: &str,
    body: &str,
) -> crate::Result<Option<CursorSystemNotificationNode>> {
    let mut attributes = parse_cursor_system_notification_attributes(opening_tag)?;
    let Some(source) = attributes.shift_remove("source").filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    Ok(Some(CursorSystemNotificationNode {
        source,
        attributes,
        text: js_trim(body).into(),
    }))
}
/// Rebuild the original notification syntax with ordered and escaped attributes.
pub fn build_cursor_system_notification_markdown(data: &CursorSystemNotificationNode) -> String {
    let mut attributes = IndexMap::new();
    attributes.insert("source".to_owned(), data.source.clone());
    attributes.extend(data.attributes.clone());
    let attributes = attributes
        .iter()
        .map(|(name, value)| {
            format!(
                "{name}=\"{}\"",
                value.replace('&', "&amp;").replace('"', "&quot;")
            )
        })
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        "<system_notification {attributes}>\n{}\n</system_notification>",
        data.text
    )
}
