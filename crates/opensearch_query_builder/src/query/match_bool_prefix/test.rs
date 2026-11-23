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
