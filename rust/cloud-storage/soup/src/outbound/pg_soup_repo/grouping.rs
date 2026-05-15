//! SQL grouping expressions for soup queries.

use models_grouping::{GroupByField, date_bucket_sql_key, date_bucket_sql_order};
use std::borrow::Cow;

/// Build the group select expression for a field.
pub fn group_select_expr(field: &GroupByField) -> Cow<'static, str> {
    match field {
        GroupByField::Date => Cow::Owned(date_bucket_sql_key("sort_ts")),
        GroupByField::EntityType => Cow::Borrowed("item_type"),
        GroupByField::Project => Cow::Borrowed("COALESCE(project_id::text, '')"),
        GroupByField::Property { .. } => {
            // For select options, value is an array of UUIDs like ["uuid1", "uuid2"]
            // Extract the first element as text
            Cow::Borrowed("COALESCE(ep_group.values->'value'->>0, '')")
        }
    }
}

/// Build the group order expression for a field.
pub fn group_order_expr(field: &GroupByField) -> Cow<'static, str> {
    match field {
        GroupByField::Date => Cow::Owned(date_bucket_sql_order("sort_ts")),
        GroupByField::EntityType => Cow::Borrowed("item_type"),
        GroupByField::Project => Cow::Borrowed("project_id NULLS LAST"),
        GroupByField::Property { .. } => {
            // values->'value' is an array of UUID strings, extract first and lookup display_order
            Cow::Borrowed(
                "COALESCE((SELECT po.display_order FROM property_options po WHERE po.id::text = (ep_group.values->'value'->>0)), 999999)",
            )
        }
    }
}

/// Result of building a group JOIN clause with optional bind parameter.
pub struct GroupJoinClause {
    /// The SQL JOIN clause (may contain $10 placeholder for entity_type)
    pub sql: String,
    /// Entity type value to bind at $10, if present
    pub entity_type_bind: Option<String>,
}

/// Build the JOIN clause for property-based grouping.
/// Returns SQL with $10 placeholder for entity_type when present.
pub fn group_join_clause(field: &GroupByField) -> Option<GroupJoinClause> {
    match field {
        GroupByField::Property {
            property_definition_id,
            entity_type,
        } => {
            let (entity_type_filter, entity_type_bind) = match entity_type {
                Some(et) => (
                    "AND ep_group.entity_type = $10".to_string(),
                    Some(et.clone()),
                ),
                None => (String::new(), None),
            };

            Some(GroupJoinClause {
                sql: format!(
                    "LEFT JOIN entity_properties ep_group ON ep_group.entity_id = t.id::text AND ep_group.property_definition_id = '{}' {}",
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
