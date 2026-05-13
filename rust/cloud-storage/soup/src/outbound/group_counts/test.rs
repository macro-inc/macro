use super::*;

#[test]
fn test_is_valid_bucket_key_date() {
    assert!(is_valid_bucket_key("future", &GroupByField::Date));
    assert!(is_valid_bucket_key("today", &GroupByField::Date));
    assert!(is_valid_bucket_key("yesterday", &GroupByField::Date));
    assert!(is_valid_bucket_key("this_week", &GroupByField::Date));
    assert!(is_valid_bucket_key("older", &GroupByField::Date));
    assert!(!is_valid_bucket_key("invalid", &GroupByField::Date));
    assert!(!is_valid_bucket_key("", &GroupByField::Date));
}

#[test]
fn test_is_valid_bucket_key_entity_type() {
    assert!(is_valid_bucket_key("document", &GroupByField::EntityType));
    assert!(is_valid_bucket_key("chat", &GroupByField::EntityType));
    assert!(is_valid_bucket_key("project", &GroupByField::EntityType));
    assert!(is_valid_bucket_key(
        "email_thread",
        &GroupByField::EntityType
    ));
    assert!(is_valid_bucket_key("channel", &GroupByField::EntityType));
    assert!(is_valid_bucket_key("call", &GroupByField::EntityType));
    assert!(!is_valid_bucket_key("invalid", &GroupByField::EntityType));
}

#[test]
fn test_is_valid_bucket_key_project() {
    assert!(is_valid_bucket_key("", &GroupByField::Project));
    assert!(is_valid_bucket_key(
        "550e8400-e29b-41d4-a716-446655440000",
        &GroupByField::Project
    ));
}
