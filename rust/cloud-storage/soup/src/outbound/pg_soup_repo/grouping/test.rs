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
    assert_eq!(&*expr, "item_type");
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
    assert!(join.sql.contains("ep_group"));
    assert!(join.sql.contains(&uuid::Uuid::nil().to_string()));
}
