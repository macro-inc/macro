use chrono::{DateTime, Utc};
use opensearch_query_builder::{BoolQueryBuilder, QueryType, WildcardQuery};

/// Convert an epoch-millisecond timestamp to a `DateTime<Utc>`.
pub(crate) fn millis_to_datetime(millis: Option<i64>) -> Option<DateTime<Utc>> {
    millis.and_then(DateTime::from_timestamp_millis)
}

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
                None,
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
