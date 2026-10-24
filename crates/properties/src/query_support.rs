//! PostgreSQL DATE-query composition for source-owned, authorized candidates.
//!
//! This is the narrow cross-domain adapter utility permitted by the Rust guardrails.
//! Source repositories own authorization predicates, execution, and hydration.
//! Candidate columns are `id text`, canonical property `entity_type text`,
//! `sort_value timestamptz`, and non-null `group_key text`.

use chrono::{DateTime, Utc};
use models_grouping::{
    CandidateDirection, CandidateGroupStats, CandidateIdentity, CandidatePage, CandidateQuery,
    CandidateSortValue, GroupByField, GroupedCandidate, PropertyDateRangeError, PropertyDateRanges,
    date_bucket_sql_key,
};
use sqlx::{Postgres, QueryBuilder};
use std::collections::BTreeSet;
use uuid::Uuid;

/// Append a correlated DATE value expression for the `candidate` source alias.
///
/// Only a stored Date variant is cast. Definition visibility and type checks
/// belong to the source service, not this SQL fragment.
fn push_date_property_value(query: &mut QueryBuilder<'_, Postgres>, property_definition_id: Uuid) {
    query.push("(SELECT CASE WHEN ep.values->>'type' = 'Date' THEN (ep.values->>'value')::timestamptz END FROM entity_properties ep WHERE ep.property_definition_id = ");
    query.push_bind(property_definition_id);
    query
        .push(" AND ep.entity_id = candidate.id AND ep.entity_type::text = candidate.entity_type)");
}

/// Partition the `group_date` column independently of the sorting value.
/// Bind every caller key and UTC boundary. Ranges cover all present dates.
pub fn push_date_range_bucket(
    query: &mut QueryBuilder<'_, Postgres>,
    ranges: &PropertyDateRanges,
) -> Result<(), PropertyDateRangeError> {
    ranges.validate()?;
    let (last, preceding) = ranges
        .ranges
        .split_last()
        .ok_or(PropertyDateRangeError::RangeCount)?;
    query.push("CASE WHEN group_date IS NULL THEN ");
    query.push_bind(ranges.missing_value_bucket_key.clone());
    for range in preceding {
        query.push(" WHEN group_date < ");
        query.push_bind(range.end.ok_or(PropertyDateRangeError::InvalidBounds)?);
        query.push(" THEN ");
        query.push_bind(range.key.clone());
    }
    query.push(" ELSE ");
    query.push_bind(last.key.clone());
    query.push(" END");
    Ok(())
}

/// Compose selected-property ordering and grouping over an authorized source.
///
/// The callback supplies `id`, canonical property `entity_type`, `activity_at`,
/// and nullable `project_id`. Property lookup, membership, counts, and limits all
/// run in SQL before source repositories hydrate the bounded selected IDs.
pub fn build_property_candidate_query<'a>(
    authorized: &crate::AuthorizedPropertyQuery,
    source: impl FnOnce(&mut QueryBuilder<'a, Postgres>) -> anyhow::Result<()>,
) -> anyhow::Result<QueryBuilder<'a, Postgres>> {
    build_property_candidate_query_impl(authorized.query(), source)
}

fn build_property_candidate_query_impl<'a>(
    descriptor: &CandidateQuery,
    source: impl FnOnce(&mut QueryBuilder<'a, Postgres>) -> anyhow::Result<()>,
) -> anyhow::Result<QueryBuilder<'a, Postgres>> {
    build_candidate_query(descriptor, |query| {
        query.push("WITH property_source AS (");
        source(query)?;
        query.push("), dated AS (SELECT candidate.*, ");
        if let Some(property) = descriptor.date_property_id {
            push_date_property_value(query, property);
        } else {
            query.push("candidate.activity_at");
        }
        query.push(" AS sort_value, ");
        let field = descriptor.grouping.as_ref().map(|grouping| &grouping.field);
        if let Some((property, _)) = field.and_then(GroupByField::date_ranges) {
            if let Some(GroupByField::Property {
                entity_type: Some(entity_type),
                ..
            }) = field
            {
                query.push("CASE WHEN candidate.entity_type = ");
                query.push_bind(entity_type.clone());
                query.push(" THEN ");
                push_date_property_value(query, property);
                query.push(" ELSE NULL END");
            } else {
                push_date_property_value(query, property);
            }
        } else {
            query.push("NULL::timestamptz");
        }
        query.push(" AS group_date FROM property_source candidate) SELECT candidate.id, candidate.entity_type, candidate.sort_value, ");
        match field {
            None => {
                query.push("''::text");
            }
            Some(GroupByField::Date) => {
                query.push(date_bucket_sql_key("candidate.activity_at"));
            }
            Some(GroupByField::EntityType) => {
                query.push("CASE candidate.entity_type WHEN 'TASK' THEN 'document' WHEN 'THREAD' THEN 'email' WHEN 'CALL_RECORD' THEN 'call' WHEN 'COMPANY' THEN 'crm_company' WHEN 'CONTACT' THEN 'crm_contact' ELSE lower(candidate.entity_type) END");
            }
            Some(GroupByField::Project) => {
                query.push("COALESCE(candidate.project_id, '')");
            }
            Some(GroupByField::Property { .. }) => {
                if let Some((_, ranges)) = field.and_then(GroupByField::date_ranges) {
                    push_date_range_bucket(query, ranges)
                        .map_err(|error| anyhow::anyhow!("invalid date ranges: {error:?}"))?;
                } else {
                    query.push("COALESCE(CASE grouped_property.values->>'type' WHEN 'EntityReference' THEN grouped_property.value->>'entity_id' WHEN 'SelectOption' THEN grouped_property.value#>>'{}' WHEN 'Link' THEN grouped_property.value#>>'{}' ELSE NULL END, '')");
                }
            }
            Some(GroupByField::Deadline { .. }) => {
                anyhow::bail!("use property date ranges instead of deadline grouping")
            }
        }
        query.push(" AS group_key FROM dated candidate ");
        if let Some(GroupByField::Property {
            property_definition_id,
            entity_type,
            bucketing: None,
        }) = field
        {
            query.push("LEFT JOIN LATERAL (SELECT ep.values, element.value FROM entity_properties ep LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(ep.values->'value') = 'array' THEN ep.values->'value' ELSE '[]'::jsonb END) AS element(value) ON TRUE WHERE ep.entity_id = candidate.id AND ep.entity_type::text = candidate.entity_type AND ep.property_definition_id = ");
            query.push_bind(*property_definition_id);
            if let Some(entity_type) = entity_type {
                query.push(" AND ep.entity_type::text = ");
                query.push_bind(entity_type.clone());
            }
            query.push(") grouped_property ON TRUE");
        }
        Ok(())
    })
}

/// One row of the bounded candidate query, decoded by the source repository.
#[derive(sqlx::FromRow)]
pub struct CandidateRow {
    entity_types: Vec<String>,
    group_key: String,
    total_count: i64,
    before_or_at_cursor_count: i64,
    id: Option<String>,
    entity_type: Option<String>,
    sort_value: Option<DateTime<Utc>>,
    row_number: Option<i64>,
}

/// Compose a bounded page over a source-owned, fully filtered CTE body.
///
/// The callback appends a SELECT body with binds and no surrounding parentheses.
/// Identity ties use bytewise ascending ID, then canonical entity type, matching
/// the Soup merge. This function never executes SQL or inspects source tables.
/// The source service validates definition visibility and DATE type first.
pub fn build_candidate_query<'a>(
    descriptor: &CandidateQuery,
    source: impl FnOnce(&mut QueryBuilder<'a, Postgres>) -> anyhow::Result<()>,
) -> anyhow::Result<QueryBuilder<'a, Postgres>> {
    descriptor.validate()?;
    let mut query = QueryBuilder::<Postgres>::new("WITH source_candidates AS (");
    source(&mut query)?;
    query.push(") , canonical AS (SELECT id COLLATE \"C\" AS id, entity_type COLLATE \"C\" AS entity_type, sort_value, group_key COLLATE \"C\" AS group_key FROM source_candidates), dedup AS (SELECT DISTINCT ON (group_key, entity_type, id) id, entity_type, sort_value, group_key FROM canonical WHERE id IS NOT NULL AND entity_type IS NOT NULL AND group_key IS NOT NULL");
    if let Some(key) = descriptor
        .grouping
        .as_ref()
        .and_then(|g| g.group_key.as_ref())
    {
        query.push(" AND group_key = ");
        query.push_bind(key.clone());
    }
    let direction = match descriptor.direction {
        CandidateDirection::Ascending => "ASC",
        CandidateDirection::Descending => "DESC",
    };
    query.push(" ORDER BY group_key, entity_type, id, sort_value ");
    query.push(direction);
    query.push(" NULLS LAST), ");
    if let Some(cursor) = &descriptor.cursor {
        query.push("cursor_position AS (SELECT ");
        query.push_bind(cursor.sort_value.0);
        query.push("::timestamptz AS sort_value, ");
        query.push_bind(cursor.identity.entity_type.clone());
        query.push("::text AS entity_type, ");
        query.push_bind(cursor.identity.id.clone());
        query.push("::text AS id), ");
    }
    query.push("positioned AS (SELECT d.*, ");
    if descriptor.cursor.is_some() {
        query.push("CASE WHEN d.sort_value IS NULL AND c.sort_value IS NOT NULL THEN TRUE WHEN d.sort_value IS NOT NULL AND c.sort_value IS NULL THEN FALSE WHEN d.sort_value IS NULL AND c.sort_value IS NULL THEN (d.id, d.entity_type) > (c.id, c.entity_type) ELSE (d.sort_value ");
        query.push(
            if matches!(descriptor.direction, CandidateDirection::Ascending) {
                ">"
            } else {
                "<"
            },
        );
        query.push(" c.sort_value OR (d.sort_value = c.sort_value AND (d.id, d.entity_type) > (c.id, c.entity_type))) END AS after_cursor FROM dedup d CROSS JOIN cursor_position c), ");
    } else {
        query.push("TRUE AS after_cursor FROM dedup d), ");
    }
    query.push("stats AS (SELECT group_key, count(*)::bigint AS total_count, count(*) FILTER (WHERE NOT after_cursor)::bigint AS before_or_at_cursor_count, array_agg(DISTINCT entity_type) AS entity_types FROM positioned GROUP BY group_key), ranked AS (SELECT id, entity_type, sort_value, group_key, row_number() OVER (PARTITION BY group_key ORDER BY sort_value ");
    query.push(direction);
    query.push(" NULLS LAST, id ASC, entity_type ASC) AS row_number FROM positioned WHERE after_cursor) SELECT stats.group_key, stats.total_count, stats.before_or_at_cursor_count, stats.entity_types, ranked.id, ranked.entity_type, ranked.sort_value, ranked.row_number FROM stats LEFT JOIN ranked ON ranked.group_key = stats.group_key AND ranked.row_number <= ");
    let limit = i64::from(descriptor.per_group_limit());
    query.push_bind(limit + 1);
    query.push(" ORDER BY stats.group_key, ranked.row_number");
    Ok(query)
}

/// Decode source-executed rows while preserving statistics for exhausted groups.
/// The extra lookahead candidate affects `has_more`, not the returned page size.
pub fn decode_candidate_page(
    rows: Vec<CandidateRow>,
    descriptor: &CandidateQuery,
) -> CandidatePage {
    let limit = i64::from(descriptor.per_group_limit());
    let mut page = CandidatePage::default();
    let mut entity_types = BTreeSet::new();
    for row in rows {
        entity_types.extend(row.entity_types);
        if page
            .groups
            .last()
            .is_none_or(|g: &CandidateGroupStats| g.group_key != row.group_key)
        {
            page.groups.push(CandidateGroupStats {
                group_key: row.group_key.clone(),
                total_count: row.total_count,
                before_or_at_cursor_count: row.before_or_at_cursor_count,
                has_more: false,
            });
        }
        if row.row_number.is_some_and(|n| n > limit) {
            if let Some(group) = page.groups.last_mut() {
                group.has_more = true;
            }
        } else if let (Some(id), Some(entity_type)) = (row.id, row.entity_type) {
            page.candidates.push(GroupedCandidate {
                identity: CandidateIdentity { id, entity_type },
                sort_value: CandidateSortValue(row.sort_value),
                group_key: row.group_key,
            });
        }
    }
    page.entity_types = entity_types.into_iter().collect();
    descriptor.order_page_groups(&mut page);
    page
}

#[cfg(test)]
mod test;
