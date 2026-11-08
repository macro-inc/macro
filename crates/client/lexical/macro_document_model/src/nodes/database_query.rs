//! DatabaseQueryNode: own payload and model hooks; no browser runtime.
use super::*;
/// Portable DatabaseQueryNode payload in upstream exportJSON field order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseQueryNode {
    /// Stored data payload.
    #[serde(flatten)]
    pub data: DatabaseQueryData,
}
impl NodeType for DatabaseQueryNode {
    const TYPE: &'static str = "database-query";
    type Kind = DecoratorKind;
    const FLAGS_PER_INSTANCE: bool = true;
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
impl ImportPolicy for DatabaseQueryNode {
    const IMPORTED_STATE: ImportedState = ImportedState::IdOnly;
    const IMPORT_ELEMENT_DATA: bool = true;
}
impl DecoratorNode for DatabaseQueryNode {
    lexical_model::decorator_node_base!();
    fn json_version(&self) -> u32 {
        2
    }
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        self.data.display_mode == DatabaseQueryDisplayMode::Scalar
    }
    fn text_content<'s>(&self, _: DecoratorView<'s>) -> Cow<'s, str> {
        (self
            .data
            .title
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(if self.data.prompt.is_empty() {
                "Database answer"
            } else {
                &self.data.prompt
            })
            .to_owned())
        .into()
    }
}
impl SearchText for DatabaseQueryNode {}

/// Read a JSON tag payload with the same validation and entity decoding as the source.
pub fn parse_database_query_json(json: &str) -> Option<DatabaseQueryData> {
    parse_database_query_data(&serde_json::from_str::<Value>(json).ok()?)
}
/// Validate and wrap a query payload, escaping tag-opening characters after stringify.
pub fn database_query_markdown(data: &Value) -> crate::ModelResult<String> {
    let data = parse_database_query_data(data).ok_or(Error::Invariant("Invalid database query"))?;
    let json = to_js_json_string(&serde_json::to_value(data)?).replace('<', "\\u003c");
    Ok(format!("<m-db-query>{json}</m-db-query>"))
}
