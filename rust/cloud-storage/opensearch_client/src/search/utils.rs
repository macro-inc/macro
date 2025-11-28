use opensearch_query_builder::{BoolQueryBuilder, QueryType, WildcardQuery};

pub fn should_wildcard_field_query_builder<'a>(
    field: &'a str,
    values: &'a [String],
) -> QueryType<'a> {
    let mut should_query = BoolQueryBuilder::new();
    should_query.minimum_should_match(1);
    let wildcard_queries: Vec<WildcardQuery> = values
        .iter()
        .map(|value| {
            WildcardQuery::new(
                field.to_string(),
                format!("*{}*", value.to_lowercase()),
                true,
            )
        })
        .collect();
    for query in wildcard_queries {
        should_query.should(QueryType::WildCard(query));
    }

    should_query.build().into()
}

#[cfg(test)]
mod test;
