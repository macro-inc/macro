use opensearch_query_builder::{BoolQueryBuilder, QueryType, WildcardQuery};

pub fn should_wildcard_field_query_builder(field: &str, values: &[String]) -> QueryType {
    let mut should_query = BoolQueryBuilder::new();
    should_query.minimum_should_match(1);
    let wildcard_queries: Vec<WildcardQuery> = values
        .iter()
        .map(|value| WildcardQuery::new(field, &format!("*{}*", value.to_lowercase()), true))
        .collect();
    for query in wildcard_queries {
        should_query.should(QueryType::WildCard(query));
    }

    should_query.build().into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use opensearch_query_builder::ToOpenSearchJson;

    #[test]
    fn test_should_wildcard_field_query_builder_single_value() {
        let field = "role";
        let values = vec!["user".to_string()];

        let expected = serde_json::json!({
            "bool": {
                "should": [
                    {
                        "wildcard": {
                            "role": {
                                "value": "*user*",
                                "case_insensitive": true
                            }
                        }
                    }
                ],
                "minimum_should_match": 1
            }
        });

        let result = should_wildcard_field_query_builder(field, &values).to_json();
        assert_eq!(result, expected);
    }

    #[test]
    fn test_should_wildcard_field_query_builder() {
        // Test multiple values with mixed case and empty array
        let field = "sender";
        let values = vec!["User".to_string(), "ADMIN".to_string()];

        let expected = serde_json::json!({
            "bool": {
                "should": [
                    {
                        "wildcard": {
                            "sender": {
                                "value": "*user*",
                                "case_insensitive": true
                            }
                        }
                    },
                    {
                        "wildcard": {
                            "sender": {
                                "value": "*admin*",
                                "case_insensitive": true
                            }
                        }
                    }
                ],
                "minimum_should_match": 1
            }
        });

        let result = should_wildcard_field_query_builder(field, &values).to_json();
        assert_eq!(result, expected);
    }
}
