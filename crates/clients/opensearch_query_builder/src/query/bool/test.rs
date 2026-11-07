use crate::TermQuery;

use super::*;

#[test]
fn test_bool_query_builder() {
    let mut builder = BoolQueryBuilder::new();

    builder
        .must(QueryType::Term(TermQuery::new("a", "a")))
        .must_not(QueryType::Term(TermQuery::new("c", "c")));

    builder.must(QueryType::Term(TermQuery::new("b", "b")));

    builder.should(QueryType::Term(TermQuery::new("d", "d")));

    builder.minimum_should_match(1);

    let result = builder.build().to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "bool": {
                "must": [
                    {
                        "term": {
                            "a": "a"
                        }
                    },
                    {
                        "term": {
                            "b": "b"
                        }
                    }
                ],
                "must_not": [
                    {
                        "term": {
                            "c": "c"
                        }
                    }
                ],
                "should": [
                    {
                        "term": {
                            "d": "d"
                        }
                    }
                ],
                "minimum_should_match": 1
            }
        })
    );
}
