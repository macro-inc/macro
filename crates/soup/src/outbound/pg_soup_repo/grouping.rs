//! SQL grouping expressions for soup queries.

use models_grouping::{GroupByField, date_bucket_sql_key, date_bucket_sql_order};
use std::borrow::Cow;

/// Build the group select expression for a field.
pub fn group_select_expr(field: &GroupByField) -> Cow<'static, str> {
    match field {
        GroupByField::Date => Cow::Owned(date_bucket_sql_key("sort_ts")),
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
    match field {
        GroupByField::Date => Cow::Owned(date_bucket_sql_order("sort_ts")),
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
                          AND ep.property_definition_id = '{}'
                          {}
                    ) ep_group ON TRUE",
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
