//! SQL grouping expressions for soup queries.

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use models_grouping::{
    DEFAULT_HORIZON_DAYS, GroupByField, GtdBoundaries, date_bucket_sql_key, date_bucket_sql_order,
    gtd_boundaries, gtd_bucket_sql_key, gtd_bucket_sql_order,
};
use std::borrow::Cow;

/// Alias of the lateral join that exposes a scalar date property as text.
const DUE_TEXT_EXPR: &str = "ep_due.due_text";

/// Resolve the bucket boundaries a [`GroupByField::DueDateBucket`] asks for.
///
/// An unrecognized timezone degrades to UTC rather than failing the query: the
/// value comes from a client header, and a mistyped zone should mis-bucket by
/// hours, not return an error page.
fn due_date_boundaries(
    time_zone: Option<&str>,
    horizon_days: Option<u16>,
    now: DateTime<Utc>,
) -> GtdBoundaries {
    let tz = time_zone
        .and_then(|tz| tz.parse::<Tz>().ok())
        .unwrap_or(chrono_tz::UTC);

    gtd_boundaries(now, tz, horizon_days.unwrap_or(DEFAULT_HORIZON_DAYS))
}

/// Build the group select expression for a field.
pub fn group_select_expr(field: &GroupByField) -> Cow<'static, str> {
    group_select_expr_at(field, Utc::now())
}

/// [`group_select_expr`] against a fixed clock.
///
/// Due-date bucketing bakes the day boundaries into the SQL, so the caller must
/// be able to pin `now` — both for tests and so every expression in one query
/// (the key appears three times: select, partition, and filter) is generated
/// from a single moment. Two calls straddling midnight would otherwise
/// partition on one set of boundaries and count on another.
pub fn group_select_expr_at(field: &GroupByField, now: DateTime<Utc>) -> Cow<'static, str> {
    match field {
        GroupByField::Date => Cow::Owned(date_bucket_sql_key("sort_ts")),
        GroupByField::DueDateBucket {
            time_zone,
            horizon_days,
            ..
        } => Cow::Owned(gtd_bucket_sql_key(
            DUE_TEXT_EXPR,
            &due_date_boundaries(time_zone.as_deref(), *horizon_days, now),
        )),
        GroupByField::EntityType => Cow::Borrowed("item_type"),
        GroupByField::Project => Cow::Borrowed("COALESCE(project_id::text, '')"),
        GroupByField::Property { .. } => Cow::Borrowed(
            "COALESCE(
                CASE ep_group.values->>'type'
                    WHEN 'EntityReference' THEN ep_group.val->>'entity_id'
                    WHEN 'SelectOption'    THEN ep_group.val#>>'{}'
                    WHEN 'Link'            THEN ep_group.val#>>'{}'
                    ELSE NULL
                END,
                ''
            )",
        ),
    }
}

/// Build the group order expression for a field.
pub fn group_order_expr(field: &GroupByField) -> Cow<'static, str> {
    group_order_expr_at(field, Utc::now())
}

/// [`group_order_expr`] against a fixed clock. See [`group_select_expr_at`].
pub fn group_order_expr_at(field: &GroupByField, now: DateTime<Utc>) -> Cow<'static, str> {
    match field {
        GroupByField::Date => Cow::Owned(date_bucket_sql_order("sort_ts")),
        GroupByField::DueDateBucket {
            time_zone,
            horizon_days,
            ..
        } => Cow::Owned(gtd_bucket_sql_order(
            DUE_TEXT_EXPR,
            &due_date_boundaries(time_zone.as_deref(), *horizon_days, now),
        )),
        GroupByField::EntityType => Cow::Borrowed("item_type"),
        GroupByField::Project => Cow::Borrowed("project_id NULLS LAST"),
        GroupByField::Property { .. } => Cow::Borrowed(
            "COALESCE(
                (SELECT po.display_order FROM property_options po
                 WHERE po.id::text =
                   CASE ep_group.values->>'type'
                        WHEN 'SelectOption' THEN ep_group.val#>>'{}'
                        ELSE NULL
                   END),
                999999
            )",
        ),
    }
}

/// Result of building a group JOIN clause with optional bind parameter.
pub struct GroupJoinClause {
    /// The SQL JOIN clause (may contain `$10` placeholder for entity_type).
    /// Callers must ensure the entity_type value is bound at $10 (and that $9
    /// is bound — with `group_key` or NULL — so the indices line up).
    pub sql: String,
    /// Entity type value to bind at `$10`, if present
    pub entity_type_bind: Option<String>,
}

/// Build the JOIN clause for property-based grouping.
/// Returns SQL with `$10` placeholder for entity_type when present.
///
/// The clause LATERAL-expands `entity_properties.values->'value'` into one row
/// per element, so multi-value properties (e.g. assignees) place each item into
/// every group it belongs to. Items without a matching row, or with an empty
/// array / scalar value, produce a single row with NULL `val` (→ "Not Set").
/// Property rows are also matched to the Soup item's canonical property entity
/// type, so a task ignores legacy `DOCUMENT` assignments for the same id.
pub fn group_join_clause(field: &GroupByField) -> Option<GroupJoinClause> {
    match field {
        GroupByField::Property {
            property_definition_id,
            entity_type,
        } => {
            let (entity_type_filter, entity_type_bind) = match entity_type {
                Some(et) => ("AND ep.entity_type = $10".to_string(), Some(et.clone())),
                None => (String::new(), None),
            };

            Some(GroupJoinClause {
                sql: format!(
                    "LEFT JOIN LATERAL (
                        SELECT ep.values, elem.val
                        FROM entity_properties ep
                        LEFT JOIN LATERAL jsonb_array_elements(
                            CASE WHEN jsonb_typeof(ep.values->'value') = 'array'
                                 THEN ep.values->'value'
                                 ELSE '[]'::jsonb
                            END
                        ) elem(val) ON TRUE
                        WHERE ep.entity_id = t.id::text
                          AND ep.entity_type = t.property_entity_type
                          AND ep.property_definition_id = '{}'
                          {}
                    ) ep_group ON TRUE",
                    property_definition_id, entity_type_filter
                ),
                entity_type_bind,
            })
        }
        // A `Date` property value is a JSON *scalar*, so the array-expanding
        // lateral above would hand back NULL for every row. Read the value
        // straight out as text instead — see `models_grouping::gtd_buckets` for
        // why the comparison stays textual rather than casting to timestamptz.
        //
        // `LIMIT 1` is a safety net, not an expectation: a date property is
        // single-valued, and duplicating rows here would double-count items in
        // the group totals.
        GroupByField::DueDateBucket {
            property_definition_id,
            entity_type,
            ..
        } => {
            let (entity_type_filter, entity_type_bind) = match entity_type {
                Some(et) => ("AND ep.entity_type = $10".to_string(), Some(et.clone())),
                None => (String::new(), None),
            };

            Some(GroupJoinClause {
                sql: format!(
                    "LEFT JOIN LATERAL (
                        SELECT ep.values->>'value' AS due_text
                        FROM entity_properties ep
                        WHERE ep.entity_id = t.id::text
                          AND ep.entity_type = t.property_entity_type
                          AND ep.property_definition_id = '{}'
                          AND ep.values->>'type' = 'Date'
                          {}
                        LIMIT 1
                    ) ep_due ON TRUE",
                    property_definition_id, entity_type_filter
                ),
                entity_type_bind,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod test;
