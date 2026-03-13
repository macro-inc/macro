use super::*;

#[test]
fn test_wildcard_query_without_boost() {
    let query = WildcardQuery::new("name", "*john*", true, None);
    let result = query.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "wildcard": {
                "name": {
                    "value": "*john*",
                    "case_insensitive": true
                }
            }
        })
    );
}

#[test]
fn test_wildcard_query_with_boost() {
    let query = WildcardQuery::new("name", "*john*", false, Some(2.0));
    let result = query.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "wildcard": {
                "name": {
                    "value": "*john*",
                    "case_insensitive": false,
                    "boost": 2.0
                }
            }
        })
    );
}
