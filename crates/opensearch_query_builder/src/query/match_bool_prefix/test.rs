use super::*;

#[test]
fn serializes_field_and_query() {
    let query = MatchBoolPrefixQuery::new("content", "agencyt");

    assert_eq!(
        query.to_json(),
        serde_json::json!({
            "match_bool_prefix": {
                "content": {
                    "query": "agencyt"
                }
            }
        })
    );
}

#[test]
fn serializes_the_operator_when_set() {
    let query = MatchBoolPrefixQuery::new("content", "ann d").operator("and");

    assert_eq!(
        query.to_owned().to_json(),
        serde_json::json!({
            "match_bool_prefix": {
                "content": {
                    "query": "ann d",
                    "operator": "and"
                }
            }
        })
    );
}
