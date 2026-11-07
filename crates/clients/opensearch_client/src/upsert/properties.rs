/// A denormalized entity property indexed on the entity's search doc so
/// search can filter by it. `values` holds every equality-filterable value
/// (select options, entity refs, links, text, bool); `number_value`/
/// `date_value` are split out only because they need range + sort semantics
/// that keyword can't provide. Always queried scoped by `definition_id`.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct IndexedProperty {
    /// The property definition id this value belongs to.
    pub definition_id: String,
    /// Every equality-filterable value as a keyword: select-option UUIDs,
    /// entity-reference ids, links, text, bool as "true"/"false".
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub values: Vec<String>,
    /// Numeric value (e.g. story points) — range + sort.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_value: Option<f64>,
    /// Date value as epoch milliseconds (e.g. due date) — range + sort.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_value: Option<i64>,
}
