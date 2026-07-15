use chrono::{DateTime, Utc};
use opensearch_query_builder::{BoolQueryBuilder, QueryType, WildcardQuery};

/// Prefer a millisecond epoch timestamp, falling back to a second epoch
/// timestamp. During the seconds→millis migration new/backfilled docs carry a
/// `*_millis` field while older docs only have `*_seconds`.
pub(crate) fn millis_or_seconds(millis: Option<i64>, seconds: i64) -> Option<DateTime<Utc>> {
    millis
        .and_then(DateTime::from_timestamp_millis)
        .or_else(|| DateTime::from_timestamp(seconds, 0))
}

/// Like [`millis_or_seconds`] but both inputs are optional (e.g. email
/// `sent_at`, call `ended_at`).
pub(crate) fn opt_millis_or_seconds(
    millis: Option<i64>,
    seconds: Option<i64>,
) -> Option<DateTime<Utc>> {
    millis
        .and_then(DateTime::from_timestamp_millis)
        .or_else(|| seconds.and_then(|s| DateTime::from_timestamp(s, 0)))
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
