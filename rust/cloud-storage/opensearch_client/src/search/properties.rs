use opensearch_query_builder::{NestedQuery, QueryType};

/// Nested path holding denormalized entity properties on a search doc.
pub(crate) const PROPERTIES_PATH: &str = "properties";

/// Build a `nested` query over `properties` matching docs that have any
/// nested entry whose `values` contains one of `option_ids`. There is no
/// `definition_id` constraint: tag option ids are globally unique, so this
/// matches a tag regardless of which definition owns it. Returns `None` when
/// there are no option ids.
pub(crate) fn build_tag_filter<'a>(option_ids: &[String]) -> Option<QueryType<'a>> {
    if option_ids.is_empty() {
        return None;
    }
    Some(
        NestedQuery::new(
            PROPERTIES_PATH,
            QueryType::terms(format!("{PROPERTIES_PATH}.values"), option_ids.to_vec()),
        )
        .ignore_unmapped(true)
        .into(),
    )
}
