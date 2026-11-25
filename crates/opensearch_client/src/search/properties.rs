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

/// Build a `nested` query over `properties` that every group of
/// `tag_groups` must meet, each by any one of its option ids in a nested
/// entry's `values`. There is no `definition_id` constraint: tag option ids
/// are globally unique, so this matches a tag regardless of which definition
/// owns it. Each group is its own nested clause, ANDed inside `bool.must`,
/// since its tags may live on a different nested entry than another
/// group's (e.g. a personal and a team tag definition). One group matches any
/// of its tags, and one id per group every one of them. Returns `None` when
/// there are no groups.
pub(crate) fn build_tag_filter<'a>(tag_groups: &[Vec<String>]) -> Option<QueryType<'a>> {
    match tag_groups {
        [] => None,
        [only] => Some(nested_values_query(only.clone())),
        groups => {
            let mut all = BoolQueryBuilder::new();
            for group in groups {
                all.must(nested_values_query(group.clone()));
            }
            Some(all.build().into())
        }
    }
}
