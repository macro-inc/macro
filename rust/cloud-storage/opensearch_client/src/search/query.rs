use crate::{Result, error::OpensearchClientError};

use crate::SearchOn;
use opensearch_query_builder::*;
use unicode_segmentation::UnicodeSegmentation;

pub struct Keys<'a> {
    pub id_key: &'a str,
    pub user_id_key: &'a str,
    pub title_key: &'a str,
    pub content_key: &'a str,
}

#[derive(Debug, Clone, Copy)]
pub enum QueryKey {
    MatchPhrase,
    MatchPhrasePrefix,
    Regexp,
}

/// Validates that the last term lenght is >= 3 graphemes
fn validate_last_term_length(term: &str) -> bool {
    UnicodeSegmentation::graphemes(term, true).count() >= 3
}

impl QueryKey {
    /// Creates a query key given a match type
    pub fn from_match_type(match_type: &str) -> Result<Self> {
        match match_type {
            "exact" => Ok(Self::MatchPhrase),
            "partial" => Ok(Self::MatchPhrasePrefix),
            "regexp" => Ok(Self::Regexp),
            _ => Err(OpensearchClientError::InvalidMatchType {
                match_type: match_type.to_string(),
            }),
        }
    }

    /// Creates a query given a field and term
    fn create_query(&self, field: &str, term: &str) -> QueryType {
        // Fixes https://linear.app/macro-eng/issue/M-5094/unified-search-match-prefix-on-phrase-should-not-constrain-terms
        // We need to create a more complex combo query if the last word in a term is less than 3 characters.
        let mut terms = term.split(' ').collect::<Vec<_>>();
        let last_term = terms.last().unwrap_or(&"");
        let is_last_term_long_enough = validate_last_term_length(last_term);

        // TODO: we need type validation that the term is not an empty string
        // As a workaround, we will check if last_term is empty before entering into this block
        if !last_term.is_empty() && !is_last_term_long_enough && terms.len() > 1 {
            tracing::trace!("last value in term has length less than 3, building combo query");

            let last_part_of_term = terms.pop().unwrap();
            let first_part_of_term = terms.join(" ");

            // build the first term query
            let first_term_query = match self {
                Self::MatchPhrase => {
                    QueryType::MatchPhrase(MatchPhraseQuery::new(field, &first_part_of_term))
                }
                Self::MatchPhrasePrefix => QueryType::MatchPhrasePrefix(
                    MatchPhrasePrefixQuery::new(field, &first_part_of_term),
                ),
                Self::Regexp => QueryType::Regexp(RegexpQuery::new(field, &first_part_of_term)),
            };

            let second_term_query =
                QueryType::WildCard(WildcardQuery::new(field, &format!("*{}*", last_part_of_term.to_lowercase()), true));

            let mut bool_query = QueryType::bool_query();

            bool_query.must(first_term_query);
            bool_query.must(second_term_query);

            return bool_query.build().into();
        }

        match self {
            Self::MatchPhrase => QueryType::MatchPhrase(MatchPhraseQuery::new(field, term)),
            Self::MatchPhrasePrefix => {
                QueryType::MatchPhrasePrefix(MatchPhrasePrefixQuery::new(field, term))
            }
            Self::Regexp => QueryType::Regexp(RegexpQuery::new(field, term)),
        }
    }
}

/// Generate the terms for the "must" query
fn generate_terms_must_query(query_key: QueryKey, fields: &[&str], terms: &[String]) -> QueryType {
    let mut terms_must_query = BoolQueryBuilder::new();

    terms_must_query.minimum_should_match(1);

    // Map terms to queries
    let queries: Vec<_> = fields
        .iter()
        .flat_map(|field| terms.iter().map(|term| query_key.create_query(field, term)))
        .collect();

    // populate in in "should" field
    for query in queries {
        terms_must_query.should(query);
    }

    terms_must_query.build().into()
}

/// Builds the basic query object that can be used to search any index
/// This is meant to be expanded upon by specific search functions
pub(crate) fn build_top_level_bool(
    terms: &[String],
    match_type: &str,
    keys: Keys,
    ids: &[String],
    user_id: &str,
    search_on: SearchOn,
    ids_only: bool,
) -> Result<BoolQueryBuilder> {
    let query_key = QueryKey::from_match_type(match_type)?;

    // Only populate must array if there are terms, otherwise leave it empty
    let mut must_array = Vec::new();
    // TODO: we should error herer if terms is empty
    if !terms.is_empty() {
        // Determine which fields to search based on search_on parameter
        let search_fields: Vec<&str> = match search_on {
            SearchOn::Name => vec![keys.title_key],
            SearchOn::Content => vec![keys.content_key],
            SearchOn::NameContent => {
                todo!("search on name content not implemented yet");
            }
        };

        let terms_must_query = generate_terms_must_query(query_key, &search_fields, terms);
        // NOTE: this array is always going to be a length of one
        must_array.push(terms_must_query);
    }

    let mut query_object = BoolQueryBuilder::new();

    query_object.minimum_should_match(1);

    if !ids_only {
        query_object.should(QueryType::term(keys.user_id_key, user_id));
    }
    query_object.should(QueryType::terms(keys.id_key, ids.to_vec()));

    for item in must_array {
        query_object.must(item);
    }

    Ok(query_object)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_basic_query_object(
        terms: &[String],
        match_type: &str,
        keys: Keys,
        ids: &[String],
        user_id: &str,
        search_on: SearchOn,
        ids_only: bool,
    ) -> Result<QueryType> {
        let query_object =
            build_top_level_bool(terms, match_type, keys, ids, user_id, search_on, ids_only)?;
        let query_object = query_object.build();
        Ok(query_object.into())
    }

    #[test]
    fn test_generate_terms_must_query_single_field_single_term() {
        let terms = vec!["test".to_string()];

        let result = generate_terms_must_query(QueryKey::MatchPhrase, &["content"], &terms);

        let expected = serde_json::json!({
            "bool": {
                "should": [
                    {
                        "match_phrase": {
                            "content": "test"
                        }
                    },
                ],
                "minimum_should_match": 1
            }
        });

        assert_eq!(result.to_json(), expected);
    }

    #[test]
    fn test_generate_terms_must_query_single_field_multiple_terms() {
        let terms = vec!["test".to_string(), "test2".to_string()];

        let result = generate_terms_must_query(QueryKey::MatchPhrase, &["content"], &terms);

        let expected = serde_json::json!({
            "bool": {
                "should": [
                    {
                        "match_phrase": {
                            "content": "test"
                        }
                    },
                    {
                        "match_phrase": {
                            "content": "test2"
                        }
                    },
                ],
                "minimum_should_match": 1
            }
        });

        assert_eq!(result.to_json(), expected);
    }

    #[test]
    fn test_generate_terms_must_query_multiple_field() {
        let terms = vec!["test".to_string()];

        let result =
            generate_terms_must_query(QueryKey::MatchPhrase, &["content", "subject"], &terms);

        let expected = serde_json::json!({
            "bool": {
                "should": [
                    {
                        "match_phrase": {
                            "content": "test"
                        }
                    },
                    {
                        "match_phrase": {
                            "subject": "test"
                        }
                    },
                ],
                "minimum_should_match": 1
            }
        });

        assert_eq!(result.to_json(), expected);
    }

    #[test]
    fn test_generate_terms_must_query_multiple_field_multiple_terms() {
        let terms = vec!["test".to_string(), "test2".to_string()];

        let result =
            generate_terms_must_query(QueryKey::MatchPhrase, &["content", "subject"], &terms);

        let expected = serde_json::json!({
            "bool": {
                "should": [
                    {
                        "match_phrase": {
                            "content": "test"
                        }
                    },
                    {
                        "match_phrase": {
                            "content": "test2"
                        }
                    },
                    {
                        "match_phrase": {
                            "subject": "test"
                        }
                    },
                    {
                        "match_phrase": {
                            "subject": "test2"
                        }
                    },
                ],
                "minimum_should_match": 1
            }
        });

        assert_eq!(result.to_json(), expected);
    }

    #[test]
    fn test_build_simple_query() {
        let document_ids = ["A".to_string(), "B".to_string(), "C".to_string()];
        let user_id = "user";
        let terms = vec!["test".to_string()];
        let reference = serde_json::json!({
            "bool": {
                "should": [
                    {
                        "term": {
                            "owner_id": user_id
                        }
                    },
                    {
                        "terms": {
                            "document_id": document_ids
                        }
                    }
                ],
                "minimum_should_match": 1,
                "must": [
                    {
                        "bool": {
                            "should": [
                                {
                                    "match_phrase": {
                                        "content": terms[0],
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                ],
            }
        });

        let keys = Keys {
            id_key: "document_id",
            user_id_key: "owner_id",
            title_key: "document_name",
            content_key: "content",
        };

        let generated = build_basic_query_object(
            &terms,
            "exact",
            keys,
            &document_ids,
            user_id,
            SearchOn::Content,
            false,
        )
        .unwrap();

        assert_eq!(&generated.to_json(), &reference);
    }

    #[test]
    fn test_build_simple_query_multiple_terms() {
        let document_ids = ["A".to_string(), "B".to_string(), "C".to_string()];
        let user_id = "user";
        let terms = vec!["test".to_string(), "test2".to_string()];
        let reference = serde_json::json!({
            "bool": {
                "should": [
                    {
                        "term": {
                            "owner_id": user_id
                        }
                    },
                    {
                        "terms": {
                            "document_id": document_ids
                        }
                    }
                ],
                "minimum_should_match": 1,
                "must": [
                    {
                        "bool": {
                            "should": [
                                {
                                    "match_phrase": {
                                        "content": terms[0],
                                    }
                                },
                                {
                                    "match_phrase": {
                                        "content": terms[1],
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                ],
            }
        });

        let keys = Keys {
            id_key: "document_id",
            user_id_key: "owner_id",
            title_key: "document_name",
            content_key: "content",
        };

        let generated = build_basic_query_object(
            &terms,
            "exact",
            keys,
            &document_ids,
            user_id,
            SearchOn::Content,
            false,
        )
        .unwrap();

        assert_eq!(&generated.to_json(), &reference);
    }

    #[test]
    fn test_build_regexp_query_multiple_terms() {
        let document_ids = ["A".to_string(), "B".to_string(), "C".to_string()];
        let user_id = "user";
        let terms = vec!["test".to_string(), "test2".to_string()];
        let reference = serde_json::json!({
            "bool": {
                "should": [
                    {
                        "term": {
                            "owner_id": user_id
                        }
                    },
                    {
                        "terms": {
                            "document_id": document_ids
                        }
                    }
                ],
                "minimum_should_match": 1,
                "must": [
                    {
                        "bool": {
                            "should": [
                                {
                                    "regexp": {
                                        "content": {
                                            "value": terms[0],
                                        }
                                    }
                                },
                                {
                                    "regexp": {
                                        "content": {
                                            "value": terms[1],
                                        }
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                ],
            }
        });

        let keys = Keys {
            id_key: "document_id",
            user_id_key: "owner_id",
            title_key: "document_name",
            content_key: "content",
        };

        let generated = build_basic_query_object(
            &terms,
            "regexp",
            keys,
            &document_ids,
            user_id,
            SearchOn::Content,
            false,
        )
        .unwrap();

        assert_eq!(&generated.to_json(), &reference);
    }

    #[test]
    fn test_build_with_ids_only() {
        let document_ids = ["A".to_string(), "B".to_string(), "C".to_string()];
        let user_id = "user";
        let terms = vec!["test".to_string(), "test2".to_string()];
        let reference = serde_json::json!({
            "bool": {
                "should": [
                    {
                        "terms": {
                            "document_id": document_ids
                        }
                    }
                ],
                "minimum_should_match": 1,
                "must": [
                    {
                        "bool": {
                            "should": [
                                {
                                    "regexp": {
                                        "content": {
                                            "value": terms[0],
                                        }
                                    }
                                },
                                {
                                    "regexp": {
                                        "content": {
                                            "value": terms[1],
                                        }
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                ],
            }
        });

        let keys = Keys {
            id_key: "document_id",
            user_id_key: "owner_id",
            title_key: "document_name",
            content_key: "content",
        };

        let generated = build_basic_query_object(
            &terms,
            "regexp",
            keys,
            &document_ids,
            user_id,
            SearchOn::Content,
            true,
        )
        .unwrap();

        assert_eq!(&generated.to_json(), &reference);
    }

    #[test]
    fn test_build_name_search_query() {
        let document_ids = ["A".to_string(), "B".to_string(), "C".to_string()];
        let user_id = "user";
        let terms = vec!["test".to_string(), "test2".to_string()];
        let reference = serde_json::json!({
            "bool": {
                "should": [
                    {
                        "term": {
                            "owner_id": user_id
                        }
                    },
                    {
                        "terms": {
                            "document_id": document_ids
                        }
                    }
                ],
                "minimum_should_match": 1,
                "must": [
                    {
                        "bool": {
                            "should": [
                                {
                                    "match_phrase": {
                                        "document_name": terms[0],
                                    }
                                },
                                {
                                    "match_phrase": {
                                        "document_name": terms[1],
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                ],
            }
        });

        let keys = Keys {
            id_key: "document_id",
            user_id_key: "owner_id",
            title_key: "document_name",
            content_key: "content",
        };

        let generated = build_basic_query_object(
            &terms,
            "exact",
            keys,
            &document_ids,
            user_id,
            SearchOn::Name,
            false,
        )
        .unwrap();

        assert_eq!(&generated.to_json(), &reference);
    }

    /// Validates fix for https://linear.app/macro-eng/issue/M-5094/unified-search-match-prefix-on-phrase-should-not-constrain-terms
    #[test]
    fn test_create_query_with_short_last_term() {
        let query_key = QueryKey::from_match_type("partial").unwrap();

        let result = QueryKey::create_query(&query_key, "subject", "person one re").to_json();

        assert_eq!(
            result,
            serde_json::json!({
                "bool": {
                    "must": [
                        {
                            "match_phrase_prefix": {
                                "subject": {
                                    "query": "person one"
                                }
                            }
                        },
                        {
                            "wildcard": {
                                "subject": {
                                    "value": "*re*",
                                    "case_insensitive": true
                                }
                            }
                        }
                    ]
                }
            })
        );

        let result = QueryKey::create_query(&query_key, "subject", "person one 🦀").to_json();
        assert_eq!(
            result,
            serde_json::json!({
                "bool": {
                    "must": [
                        {
                            "match_phrase_prefix": {
                                "subject": {
                                    "query": "person one"
                                }
                            }
                        },
                        {
                            "wildcard": {
                                "subject": {
                                    "value": "*🦀*",
                                    "case_insensitive": true
                                }
                            }
                        }
                    ]
                }
            })
        );

        let result = QueryKey::create_query(&query_key, "subject", "person one").to_json();
        assert_eq!(
            result,
            serde_json::json!({
                "match_phrase_prefix": {
                    "subject": {
                        "query": "person one"
                    }
                }
            })
        );

        let result = QueryKey::create_query(&query_key, "subject", "person one ").to_json();
        assert_eq!(
            result,
            serde_json::json!({
                "match_phrase_prefix": {
                    "subject": {
                        "query": "person one "
                    }
                }
            })
        );
    }
}
