//! SQL grouping expressions for soup queries.

use models_grouping::GroupByField;
use std::borrow::Cow;

/// A single date bucket definition - source of truth for both SQL and Rust.
struct DateBucket {
    key: &'static str,
    condition: &'static str,
    order: i32,
}

/// Single source of truth for date buckets.
/// Order matters: first match wins in the CASE expression.
const DATE_BUCKETS: &[DateBucket] = &[
    DateBucket {
        key: "today",
        condition: "sort_ts::date = CURRENT_DATE",
        order: 0,
    },
    DateBucket {
        key: "yesterday",
        condition: "sort_ts::date = CURRENT_DATE - 1",
        order: 1,
    },
    DateBucket {
        key: "this_week",
        condition: "sort_ts >= CURRENT_DATE - 6",
        order: 2,
    },
    DateBucket {
        key: "last_week",
        condition: "sort_ts >= CURRENT_DATE - 13",
        order: 3,
    },
    DateBucket {
        key: "this_month",
        condition: "sort_ts >= CURRENT_DATE - 30",
        order: 4,
    },
    DateBucket {
        key: "last_month",
        condition: "sort_ts >= CURRENT_DATE - 60",
        order: 5,
    },
];

const OLDER_KEY: &str = "older";
const OLDER_ORDER: i32 = 6;

/// Generate SQL CASE expression that returns the bucket key.
pub fn date_bucket_select_expr() -> String {
    let mut sql = String::from("CASE ");
    for bucket in DATE_BUCKETS {
        sql.push_str(&format!("WHEN {} THEN '{}' ", bucket.condition, bucket.key));
    }
    sql.push_str(&format!("ELSE '{}' END", OLDER_KEY));
    sql
}

/// Generate SQL CASE expression that returns the bucket order.
pub fn date_bucket_order_expr() -> String {
    let mut sql = String::from("CASE ");
    for bucket in DATE_BUCKETS {
        sql.push_str(&format!("WHEN {} THEN {} ", bucket.condition, bucket.order));
    }
    sql.push_str(&format!("ELSE {} END", OLDER_ORDER));
    sql
}

/// Get display order for a date bucket key (for Rust-side sorting).
pub fn date_bucket_display_order(key: &str) -> i32 {
    DATE_BUCKETS
        .iter()
        .find(|b| b.key == key)
        .map(|b| b.order)
        .unwrap_or(OLDER_ORDER)
}

/// Build the group select expression for a field.
pub fn group_select_expr(field: &GroupByField) -> Cow<'static, str> {
    match field {
        GroupByField::Date => Cow::Owned(date_bucket_select_expr()),
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
        GroupByField::Date => Cow::Owned(date_bucket_order_expr()),
        GroupByField::EntityType => Cow::Borrowed("item_type"),
        GroupByField::Project => Cow::Borrowed("project_id NULLS LAST"),
        GroupByField::Property { .. } => {
            // values->'value' is an array of UUID strings, extract first and lookup display_order
            Cow::Borrowed("COALESCE((SELECT po.display_order FROM property_options po WHERE po.id::text = (ep_group.values->'value'->>0)), 999999)")
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
