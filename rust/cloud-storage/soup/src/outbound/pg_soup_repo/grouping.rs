//! SQL grouping expressions for soup queries.

use models_grouping::GroupByField;

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
pub fn group_select_expr(field: &GroupByField) -> String {
    match field {
        GroupByField::Date => date_bucket_select_expr(),
        GroupByField::EntityType => "item_type".to_string(),
        GroupByField::Project => "COALESCE(project_id::text, '')".to_string(),
        GroupByField::Property { .. } => {
            // For select options, value is an array of UUIDs like ["uuid1", "uuid2"]
            // Extract the first element as text
            "COALESCE(ep_group.values->'value'->>0, '')".to_string()
        }
    }
}

/// Build the group order expression for a field.
pub fn group_order_expr(field: &GroupByField) -> String {
    match field {
        GroupByField::Date => date_bucket_order_expr(),
        GroupByField::EntityType => "item_type".to_string(),
        GroupByField::Project => "project_id NULLS LAST".to_string(),
        GroupByField::Property { .. } => {
            // values->'value' is an array of UUID strings, extract first and lookup display_order
            "COALESCE((SELECT po.display_order FROM property_options po WHERE po.id::text = (ep_group.values->'value'->>0)), 999999)".to_string()
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
mod test {
    use super::*;

    #[test]
    fn date_bucket_select_contains_all_keys() {
        let expr = date_bucket_select_expr();
        assert!(expr.contains("'today'"));
        assert!(expr.contains("'yesterday'"));
        assert!(expr.contains("'this_week'"));
        assert!(expr.contains("'last_week'"));
        assert!(expr.contains("'this_month'"));
        assert!(expr.contains("'last_month'"));
        assert!(expr.contains("'older'"));
    }

    #[test]
    fn date_bucket_order_matches_display_order() {
        assert_eq!(date_bucket_display_order("today"), 0);
        assert_eq!(date_bucket_display_order("yesterday"), 1);
        assert_eq!(date_bucket_display_order("this_week"), 2);
        assert_eq!(date_bucket_display_order("older"), 6);
        assert_eq!(date_bucket_display_order("unknown"), 6);
    }

    #[test]
    fn entity_type_expr() {
        let expr = group_select_expr(&GroupByField::EntityType);
        assert_eq!(expr, "item_type");
    }

    #[test]
    fn project_expr() {
        let expr = group_select_expr(&GroupByField::Project);
        assert!(expr.contains("project_id"));
        assert!(expr.contains("COALESCE"));
    }

    #[test]
    fn property_join_includes_definition_id() {
        let field = GroupByField::Property {
            property_definition_id: uuid::Uuid::nil(),
            entity_type: None,
        };
        let join = group_join_clause(&field).unwrap();
        assert!(join.contains("ep_group"));
        assert!(join.contains(&uuid::Uuid::nil().to_string()));
    }
}
