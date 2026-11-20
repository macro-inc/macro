use chrono::{DateTime, Utc};
use opensearch_query_builder::{BoolQueryBuilder, QueryType, WildcardQuery};

/// Convert an epoch-millisecond timestamp to a `DateTime<Utc>`.
pub(crate) fn millis_to_datetime(millis: Option<i64>) -> Option<DateTime<Utc>> {
    millis.and_then(DateTime::from_timestamp_millis)
}

/// Budget of matching children (chunks, messages, segments) returned for one
/// result, shared by its `has_child` clauses. Every returned child is
/// re-analysed by the plain highlighter and shipped in the response, so fetch
/// time and payload follow the child count, not the term count. A grouped
/// result row previews one match and expands to the rest.
pub(crate) const INNER_HITS_PER_RESULT: u32 = 10;

/// How many inner hits each of `clause_count` `has_child` clauses returns so
/// that together they stay within [`INNER_HITS_PER_RESULT`], and how many of
/// the clauses, counted from the first, carry inner hits at all.
///
/// Past the budget only the first clauses carry inner hits. A matching result
/// has a child for every term, so each row still gets matches to show.
pub(crate) fn split_inner_hits_budget(clause_count: usize) -> InnerHitsBudget {
    let clauses_with_inner_hits = u32::try_from(clause_count)
        .unwrap_or(u32::MAX)
        .clamp(1, INNER_HITS_PER_RESULT);

    InnerHitsBudget {
        clauses_with_inner_hits,
        inner_hits_per_clause: INNER_HITS_PER_RESULT / clauses_with_inner_hits,
    }
}

/// One result's [`INNER_HITS_PER_RESULT`] divided between its `has_child`
/// clauses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct InnerHitsBudget {
    clauses_with_inner_hits: u32,
    inner_hits_per_clause: u32,
}

impl InnerHitsBudget {
    /// The `inner_hits` size of the clause at `clause_index`, or `None` when
    /// the clause is past the budget and carries no inner hits.
    pub(crate) fn size_for_clause(self, clause_index: usize) -> Option<u32> {
        let within_budget = u32::try_from(clause_index)
            .is_ok_and(|clause_index| clause_index < self.clauses_with_inner_hits);

        within_budget.then_some(self.inner_hits_per_clause)
    }
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
