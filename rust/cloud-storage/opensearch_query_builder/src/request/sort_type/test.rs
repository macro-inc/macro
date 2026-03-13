use super::*;
use crate::ToOpenSearchJson;

#[test]
fn test_field_sort_simplified_format() {
    // When neither missing nor unmapped_type is set, should use simplified format
    let sort = FieldSort::new("timestamp", SortOrder::Desc);
    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "timestamp": "desc"
        })
    );
}

#[test]
fn test_field_sort_with_missing() {
    // When only missing is set, should use object format
    let sort = FieldSort::new("price", SortOrder::Asc).missing("_last");
    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "price": {
                "order": "asc",
                "missing": "_last"
            }
        })
    );
}

#[test]
fn test_field_sort_with_unmapped_type() {
    // When only unmapped_type is set, should use object format
    let sort = FieldSort::new("user_count", SortOrder::Desc).unmapped_type("long");
    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "user_count": {
                "order": "desc",
                "unmapped_type": "long"
            }
        })
    );
}

#[test]
fn test_field_sort_with_both_parameters() {
    // When both missing and unmapped_type are set, should include both
    let sort = FieldSort::new("score", SortOrder::Asc)
        .missing("_first")
        .unmapped_type("double");
    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "score": {
                "order": "asc",
                "missing": "_first",
                "unmapped_type": "double"
            }
        })
    );
}

#[test]
fn test_score_sort() {
    // Basic score sort
    let sort = SortType::Score;
    let result = sort.to_json();

    assert_eq!(result, serde_json::json!("_score"));
}

#[test]
fn test_score_with_order_asc() {
    // Score sort with ascending order
    let sort = ScoreWithOrderSort::new(SortOrder::Asc);
    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_score": "asc"
        })
    );
}

#[test]
fn test_score_with_order_desc() {
    // Score sort with descending order
    let sort = ScoreWithOrderSort::new(SortOrder::Desc);
    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_score": "desc"
        })
    );
}

#[test]
fn test_sort_type_field_variant() {
    // Test SortType enum with Field variant
    let field_sort = FieldSort::new("category", SortOrder::Asc);
    let sort_type = SortType::Field(field_sort);
    let result = sort_type.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "category": "asc"
        })
    );
}

#[test]
fn test_sort_type_score_with_order_variant() {
    // Test SortType enum with ScoreWithOrder variant
    let score_sort = ScoreWithOrderSort::new(SortOrder::Desc);
    let sort_type = SortType::ScoreWithOrder(score_sort);
    let result = sort_type.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_score": "desc"
        })
    );
}

#[test]
fn test_field_sort_with_cow_str() {
    // Test that Cow<str> works correctly with both borrowed and owned strings
    let borrowed_sort = FieldSort::new("field1", SortOrder::Asc);
    let owned_sort = FieldSort::new("field2".to_string(), SortOrder::Desc);

    let result1 = borrowed_sort.to_json();
    let result2 = owned_sort.to_json();

    assert_eq!(result1, serde_json::json!({"field1": "asc"}));
    assert_eq!(result2, serde_json::json!({"field2": "desc"}));
}
