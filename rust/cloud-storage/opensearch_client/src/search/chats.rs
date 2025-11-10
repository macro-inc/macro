use crate::{
    CHAT_INDEX, Result, delegate_methods,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::DefaultSearchResponse,
        utils::should_wildcard_field_query_builder,
    },
};

use crate::SearchOn;
use opensearch_query_builder::BoolQueryBuilder;
use serde_json::Value;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct ChatIndex {
    pub chat_id: String,
    pub chat_message_id: String,
    pub user_id: String,
    pub role: String,
    pub updated_at_seconds: i64,
    pub title: String,
    pub content: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ChatSearchResponse {
    pub chat_id: String,
    pub chat_message_id: String,
    pub user_id: String,
    pub role: String,
    pub updated_at: i64,
    pub title: String,
    pub content: Option<Vec<String>>,
}

struct ChatSearchConfig;

impl SearchQueryConfig for ChatSearchConfig {
    const ID_KEY: &'static str = "chat_id";
    const INDEX: &'static str = CHAT_INDEX;
    const USER_ID_KEY: &'static str = "user_id";
    const TITLE_KEY: &'static str = "title";

    fn default_sort() -> Value {
        serde_json::json!([
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
            {
                Self::ID_KEY: {
                    "order": "asc"
                }
            },
            {
                "chat_message_id": {
                    "order": "asc"
                }
            },
        ])
    }
}

struct ChatQueryBuilder {
    inner: SearchQueryBuilder<ChatSearchConfig>,
    /// The role of the chat message
    role: Vec<String>,
}

impl ChatQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
            role: Vec::new(),
        }
    }

    // Copy function signature from SearchQueryBuilder
    delegate_methods! {
        fn match_type(match_type: &str) -> Self;
        fn page(page: i64) -> Self;
        fn page_size(page_size: i64) -> Self;
        fn user_id(user_id: &str) -> Self;
        fn search_on(search_on: SearchOn) -> Self;
        fn collapse(collapse: bool) -> Self;
        fn ids(ids: Vec<String>) -> Self;
        fn ids_only(ids_only: bool) -> Self;
    }

    pub fn role(mut self, role: Vec<String>) -> Self {
        self.role = role;
        self
    }

    fn query_builder(self) -> Result<(SearchQueryBuilder<ChatSearchConfig>, BoolQueryBuilder)> {
        let mut query_object = self.inner.query_builder()?;
        if !self.role.is_empty() {
            let should_query = should_wildcard_field_query_builder("role", &self.role);
            query_object.must(should_query);
        }
        Ok((self.inner, query_object))
    }

    pub fn build(self) -> Result<Value> {
        let (builder, query_object) = self.query_builder()?;
        let base_query = builder.build_with_query(query_object.build().into())?;
        Ok(base_query)
    }
}

#[derive(Debug)]
pub struct ChatSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub chat_ids: Vec<String>,
    pub page: i64,
    pub page_size: i64,
    pub match_type: String,
    pub role: Vec<String>,
    pub search_on: SearchOn,
    pub collapse: bool,
    pub ids_only: bool,
}

impl ChatSearchArgs {
    pub fn build(self) -> Result<Value> {
        ChatQueryBuilder::new(self.terms)
            .match_type(&self.match_type)
            .page_size(self.page_size)
            .page(self.page)
            .user_id(&self.user_id)
            .ids(self.chat_ids)
            .role(self.role)
            .search_on(self.search_on)
            .collapse(self.collapse)
            .ids_only(self.ids_only)
            .build()
    }
}

pub(crate) async fn search_chats(
    client: &opensearch::OpenSearch,
    args: ChatSearchArgs,
) -> Result<Vec<ChatSearchResponse>> {
    let query_body = args.build()?;

    let response = client
        .search(opensearch::SearchParts::Index(&[CHAT_INDEX]))
        .body(query_body)
        .send()
        .await
        .map_client_error()
        .await?;

    let result = response
        .json::<DefaultSearchResponse<ChatIndex>>()
        .await
        .map_err(|e| OpensearchClientError::DeserializationFailed {
            details: e.to_string(),
            method: Some("search_chats".to_string()),
        })?;

    Ok(result
        .hits
        .hits
        .into_iter()
        .map(|hit| ChatSearchResponse {
            chat_id: hit._source.chat_id,
            chat_message_id: hit._source.chat_message_id,
            user_id: hit._source.user_id,
            role: hit._source.role,
            title: hit._source.title,
            content: hit.highlight.map(|h| h.content),
            updated_at: hit._source.updated_at_seconds,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_sanity() {
        let query_key = "match_phrase";
        let chat_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
        let user_id = "user";
        let page = 1;
        let page_size = 2;
        let from = page * page_size;
        let query = "test";
        let reference = serde_json::json!({
            "query": {
                "bool": {
                    "should": [
                        {
                            "term": {
                                "user_id": user_id
                            }
                        },
                        {
                            "terms": {
                                "chat_id": chat_ids
                            }
                        }
                    ],
                    "minimum_should_match": 1,
                   "must": [
                        {
                            "bool": {
                                "should": [
                                    {
                                        query_key: {
                                            "content": query
                                        }
                                    },
                                ],
                                "minimum_should_match": 1
                            }
                        },
                    ],
                }
            },
            "from": from,
            "size": page_size,
            "sort":  [
                {
                    "updated_at_seconds": {
                        "order": "desc"
                    }
                },
                {
                    "chat_id": {
                        "order": "asc"
                    }
                },
                {
                    "chat_message_id": {
                        "order": "asc"
                    }
                },
            ],
            "highlight": {
                "fields": {
                    "content": {
                        "type": "unified", // The way the highlight is done
                        "number_of_fragments": 500, // Breaks up the "content" field into said
                        "pre_tags": ["<macro_em>"], // HTML tag before highlight
                        "post_tags": ["</macro_em>"], // HTML tag after highlight
                        "require_field_match": true, // Default is true, but good to be explicit
                    }
                }
            },
        });

        let generated = ChatQueryBuilder::new(vec![query.to_string()])
            .match_type("exact")
            .page_size(page_size)
            .page(page)
            .user_id(user_id)
            .ids(chat_ids)
            .build()
            .unwrap();

        assert_eq!(&generated, &reference);
    }

    #[test]
    fn test_build_with_single_role() {
        let query = "test";
        let user_id = "user1";
        let role = vec!["user".to_string()];
        let page_size = 10;
        let page = 0;

        let reference = serde_json::json!({
            "query": {
                "bool": {
                    "should": [
                        {
                            "term": {
                                "user_id": user_id
                            }
                        },
                        {
                            "terms": {
                                "chat_id": []
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
                                            "content": query
                                        }
                                    },
                                ],
                                "minimum_should_match": 1
                            }
                        },
                        {
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
                        }
                    ],
                }
            },
            "from": 0,
            "size": page_size,
            "sort": [
                {
                    "updated_at_seconds": {
                        "order": "desc"
                    }
                },
                {
                    "chat_id": {
                        "order": "asc"
                    }
                },
                {
                    "chat_message_id": {
                        "order": "asc"
                    }
                },
            ],
            "highlight": {
                "fields": {
                    "content": {
                        "type": "unified",
                        "number_of_fragments": 500,
                        "pre_tags": ["<macro_em>"],
                        "post_tags": ["</macro_em>"],
                        "require_field_match": true,
                    }
                }
            },
        });

        let generated = ChatQueryBuilder::new(vec![query.to_string()])
            .match_type("exact")
            .page_size(page_size)
            .page(page)
            .user_id(user_id)
            .role(role)
            .build()
            .unwrap();

        assert_eq!(&generated, &reference);
    }

    #[test]
    fn test_build_with_multiple_roles() {
        let query = "test";
        let user_id = "user1";
        let roles = vec!["user".to_string(), "assistant".to_string()];
        let page_size = 10;
        let page = 0;

        let reference = serde_json::json!({
            "query": {
                "bool": {
                    "should": [
                        {
                            "term": {
                                "user_id": user_id
                            }
                        },
                        {
                            "terms": {
                                "chat_id": []
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
                                            "content": query
                                        }
                                    },
                                ],
                                "minimum_should_match": 1
                            }
                        },
                        {
                            "bool": {
                                "should": [
                                    {
                                        "wildcard": {
                                            "role": {
                                                "value": "*user*",
                                                "case_insensitive": true
                                            }
                                        }
                                    },
                                    {
                                        "wildcard": {
                                            "role": {
                                                "value": "*assistant*",
                                                "case_insensitive": true
                                            }
                                        }
                                    }
                                ],
                                "minimum_should_match": 1
                            }
                        }
                    ],
                }
            },
            "from": 0,
            "size": page_size,
            "sort": [
                {
                    "updated_at_seconds": {
                        "order": "desc"
                    }
                },
                {
                    "chat_id": {
                        "order": "asc"
                    }
                },
                {
                    "chat_message_id": {
                        "order": "asc"
                    }
                },
            ],
            "highlight": {
                "fields": {
                    "content": {
                        "type": "unified",
                        "number_of_fragments": 500,
                        "pre_tags": ["<macro_em>"],
                        "post_tags": ["</macro_em>"],
                        "require_field_match": true,
                    }
                }
            },
        });

        let generated = ChatQueryBuilder::new(vec![query.to_string()])
            .match_type("exact")
            .page_size(page_size)
            .page(page)
            .user_id(user_id)
            .role(roles)
            .build()
            .unwrap();

        assert_eq!(&generated, &reference);
    }

    #[test]
    fn test_build_with_role_and_chat_ids() {
        let query = "test";
        let user_id = "user1";
        let chat_ids = vec!["chat1".to_string(), "chat2".to_string()];
        let roles = vec!["user".to_string()];
        let page_size = 5;
        let page = 1;
        let from = page * page_size;

        let reference = serde_json::json!({
            "query": {
                "bool": {
                    "should": [
                        {
                            "term": {
                                "user_id": user_id
                            }
                        },
                        {
                            "terms": {
                                "chat_id": chat_ids
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
                                            "content": query
                                        }
                                    },
                                ],
                                "minimum_should_match": 1
                            }
                        },
                        {
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
                        }
                    ],
                }
            },
            "from": from,
            "size": page_size,
            "sort": [
                {
                    "updated_at_seconds": {
                        "order": "desc"
                    }
                },
                {
                    "chat_id": {
                        "order": "asc"
                    }
                },
                {
                    "chat_message_id": {
                        "order": "asc"
                    }
                },
            ],
            "highlight": {
                "fields": {
                    "content": {
                        "type": "unified",
                        "number_of_fragments": 500,
                        "pre_tags": ["<macro_em>"],
                        "post_tags": ["</macro_em>"],
                        "require_field_match": true,
                    }
                }
            },
        });

        let generated = ChatQueryBuilder::new(vec![query.to_string()])
            .match_type("exact")
            .page_size(page_size)
            .page(page)
            .user_id(user_id)
            .ids(chat_ids)
            .role(roles)
            .build()
            .unwrap();

        assert_eq!(&generated, &reference);
    }

    #[test]
    fn test_build_with_empty_role_filter() {
        let query = "test";
        let user_id = "user1";
        let empty_roles = vec![];
        let page_size = 10;
        let page = 0;

        let reference = serde_json::json!({
            "query": {
                "bool": {
                    "should": [
                        {
                            "term": {
                                "user_id": user_id
                            }
                        },
                        {
                            "terms": {
                                "chat_id": []
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
                                            "content": query
                                        }
                                    },
                                ],
                                "minimum_should_match": 1
                            }
                        }
                    ],
                }
            },
            "from": 0,
            "size": page_size,
            "sort": [
                {
                    "updated_at_seconds": {
                        "order": "desc"
                    }
                },
                {
                    "chat_id": {
                        "order": "asc"
                    }
                },
                {
                    "chat_message_id": {
                        "order": "asc"
                    }
                },
            ],
            "highlight": {
                "fields": {
                    "content": {
                        "type": "unified",
                        "number_of_fragments": 500,
                        "pre_tags": ["<macro_em>"],
                        "post_tags": ["</macro_em>"],
                        "require_field_match": true,
                    }
                }
            },
        });

        let generated = ChatQueryBuilder::new(vec![query.to_string()])
            .match_type("exact")
            .page_size(page_size)
            .page(page)
            .user_id(user_id)
            .role(empty_roles)
            .build()
            .unwrap();

        assert_eq!(&generated, &reference);
    }

    #[test]
    fn test_ids_only() {
        let query_key = "match_phrase";
        let chat_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
        let user_id = "user";
        let page = 1;
        let page_size = 2;
        let from = page * page_size;
        let query = "test";
        let reference = serde_json::json!({
            "query": {
                "bool": {
                    "should": [
                        {
                            "terms": {
                                "chat_id": chat_ids
                            }
                        }
                    ],
                    "minimum_should_match": 1,
                   "must": [
                        {
                            "bool": {
                                "should": [
                                    {
                                        query_key: {
                                            "content": query
                                        }
                                    },
                                ],
                                "minimum_should_match": 1
                            }
                        },
                    ],
                }
            },
            "from": from,
            "size": page_size,
            "sort":  [
                {
                    "updated_at_seconds": {
                        "order": "desc"
                    }
                },
                {
                    "chat_id": {
                        "order": "asc"
                    }
                },
                {
                    "chat_message_id": {
                        "order": "asc"
                    }
                },
            ],
            "highlight": {
                "fields": {
                    "content": {
                        "type": "unified", // The way the highlight is done
                        "number_of_fragments": 500, // Breaks up the "content" field into said
                        "pre_tags": ["<macro_em>"], // HTML tag before highlight
                        "post_tags": ["</macro_em>"], // HTML tag after highlight
                        "require_field_match": true, // Default is true, but good to be explicit
                    }
                }
            },
        });

        let generated = ChatQueryBuilder::new(vec![query.to_string()])
            .match_type("exact")
            .page_size(page_size)
            .page(page)
            .user_id(user_id)
            .ids(chat_ids)
            .ids_only(true)
            .build()
            .unwrap();

        assert_eq!(&generated, &reference);
    }

    #[test]
    fn test_build_with_role_and_search_on_name() {
        let query = "test";
        let user_id = "user1";
        let roles = vec!["user".to_string()];
        let page_size = 10;
        let page = 0;

        let reference = serde_json::json!({
            "collapse": {
                "field": "chat_id"
            },
            "from": 0,
            "highlight": {
                "fields": {
                    "content": {
                        "number_of_fragments": 500,
                        "post_tags": ["</macro_em>"],
                        "pre_tags": ["<macro_em>"],
                        "require_field_match": true,
                        "type": "unified"
                    }
                }
            },
            "query": {
                "bool": {
                    "minimum_should_match": 1,
                    "must": [
                        {
                            "bool": {
                                "minimum_should_match": 1,
                                "should": [
                                    {
                                        "match_phrase": {
                                            "title": query
                                        }
                                    }
                                ]
                            }
                        },
                        {
                            "bool": {
                                "minimum_should_match": 1,
                                "should": [
                                    {
                                        "wildcard": {
                                            "role": {
                                                "case_insensitive": true,
                                                "value": "*user*"
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    ],
                    "should": [
                        {
                            "term": {
                                "user_id": "user1"
                            }
                        },
                        {
                            "terms": {
                                "chat_id": []
                            }
                        }
                    ]
                }
            },
            "size": 10,
            "sort": [
                {
                    "updated_at_seconds": {
                        "order": "desc"
                    }
                },
                {
                    "chat_id": {
                        "order": "asc"
                    }
                },
                {
                    "chat_message_id": {
                        "order": "asc"
                    }
                }
            ]
        });
        let generated = ChatQueryBuilder::new(vec![query.to_string()])
            .page_size(page_size)
            .page(page)
            .user_id(user_id)
            .role(roles)
            .search_on(SearchOn::Name)
            .build()
            .unwrap();

        assert_eq!(&generated, &reference);
    }
}
