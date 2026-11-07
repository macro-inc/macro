//! ReplyTargetNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable ReplyTargetNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyTargetNode {
    /// Stored parent payload.
    pub parent: ReplyTargetParent,
    /// Stored target message id payload.
    pub target_message_id: String,
    /// Stored target thread id payload.
    pub target_thread_id: String,
    /// Stored display text payload.
    pub display_text: String,
    /// Stored sender id payload.
    pub sender_id: String,
}
impl NodeType for ReplyTargetNode {
    const TYPE: &'static str = "reply-target";
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
impl ImportPolicy for ReplyTargetNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for ReplyTargetNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        2
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        false
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (self.display_text.clone()).into()
    }
}
impl SearchText for ReplyTargetNode {
    fn search_text(&self) -> Option<Cow<'_, str>> {
        Some(self.display_text.as_str().into())
    }
}

/// Validate reply data without discarding caller property order or future properties.
pub fn is_reply_target_data(value: &Value) -> bool {
    serde_json::from_value::<ReplyTargetNode>(value.clone())
        .is_ok_and(|node| !node.parent.id.is_empty())
}
/// Normalize historic channelId payloads; an existing parent is never overwritten.
pub fn read_reply_target_data(value: &Value) -> Option<Value> {
    if is_reply_target_data(value) {
        return Some(value.clone());
    }
    let mut object = value.as_object()?.clone();
    if object.contains_key("parent") {
        return None;
    }
    let channel = object.get("channelId")?.as_str()?.to_owned();
    object.shift_remove("channelId");
    object.insert(
        "parent".into(),
        serde_json::json!({"type":"channel", "id":channel}),
    );
    let value = Value::Object(object);
    is_reply_target_data(&value).then_some(value)
}
/// Wrap caller-ordered reply data, protecting the surrounding tag from embedded markup.
pub fn build_reply_target_markdown(data: &Value) -> String {
    format!(
        "<m-reply-target>{}</m-reply-target>",
        to_js_json_string(data).replace('<', "\\u003c")
    )
}
/// Remove at most one leading reply block and its surrounding JavaScript whitespace.
pub fn strip_leading_reply_target_markdown(markdown: &str) -> String {
    static RE: std::sync::LazyLock<regress::Regex> = std::sync::LazyLock::new(|| {
        regress::Regex::with_flags(r"^\s*<m-reply-target>.*?</m-reply-target>\s*", "s")
            .expect("literal reply block regex")
    });
    RE.find(markdown).map_or_else(
        || markdown.to_owned(),
        |m| markdown.get(m.end()..).unwrap_or_default().to_owned(),
    )
}
