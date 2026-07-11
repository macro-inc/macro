use opensearch_query_builder::{BoolQueryBuilder, NestedQuery, QueryType};

/// Nested path holding denormalized entity properties on a search doc.
pub(crate) const PROPERTIES_PATH: &str = "properties";

fn nested_values_query<'a>(option_ids: Vec<String>) -> QueryType<'a> {
    NestedQuery::new(
        PROPERTIES_PATH,
        QueryType::terms(format!("{PROPERTIES_PATH}.values"), option_ids),
    )
    .ignore_unmapped(true)
    .into()
}

/// Build a `nested` query over `properties` matching docs against `option_ids`.
/// There is no `definition_id` constraint: tag option ids are globally unique,
/// so this matches a tag regardless of which definition owns it. With
/// `match_all` false a doc matches when any nested entry's `values` contains
/// one of the ids; with `match_all` true every id must be present, expressed
/// as one nested clause per id ANDed inside `bool.must` (the ids may live on
/// different nested entries, e.g. a personal and a team tag definition).
/// Returns `None` when there are no option ids.
pub(crate) fn build_tag_filter<'a>(
    option_ids: &[String],
    match_all: bool,
) -> Option<QueryType<'a>> {
    if option_ids.is_empty() {
        return None;
    }
    if !match_all {
        return Some(nested_values_query(option_ids.to_vec()));
    }
    let mut all = BoolQueryBuilder::new();
    for option_id in option_ids {
        all.must(nested_values_query(vec![option_id.clone()]));
    }
    Some(all.build().into())
}
