use crate::{
    CHANNEL_INDEX, Result, delegate_methods,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::DefaultSearchResponse,
    },
};

use crate::SearchOn;
use opensearch_query_builder::{BoolQueryBuilder, QueryType};
use serde_json::Value;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct ChannelMessageIndex {
    pub channel_id: String,
    pub channel_name: Option<String>,
    pub channel_type: String,
    pub org_id: Option<i64>,
    pub message_id: String,
    pub thread_id: Option<String>,
    pub sender_id: String,
    pub mentions: Vec<String>,
    pub content: String,
    pub created_at_seconds: i64,
    pub updated_at_seconds: i64,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ChannelMessageSearchResponse {
    pub channel_id: String,
    pub channel_name: Option<String>,
    pub channel_type: String,
    pub org_id: Option<i64>,
    pub message_id: String,
    pub thread_id: Option<String>,
    pub sender_id: String,
    pub mentions: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub content: Option<Vec<String>>,
}

#[derive(Default)]
struct ChannelMessageSearchConfig;

impl SearchQueryConfig for ChannelMessageSearchConfig {
    const ID_KEY: &'static str = "channel_id";
    const INDEX: &'static str = CHANNEL_INDEX;
    const USER_ID_KEY: &'static str = "sender_id";
    const TITLE_KEY: &'static str = "channel_name";

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
                "message_id": {
                    "order": "asc"
                }
            },
        ])
    }
}

#[derive(Default)]
struct ChannelMessageQueryBuilder {
    inner: SearchQueryBuilder<ChannelMessageSearchConfig>,
    org_id: Option<i64>,
    thread_ids: Vec<String>,
    mentions: Vec<String>,
    channel_ids: Vec<String>,
    sender_ids: Vec<String>,
}

impl ChannelMessageQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
            ..Default::default()
        }
    }

    pub fn org_id(mut self, org_id: i64) -> Self {
        self.org_id = Some(org_id);
        self
    }

    pub fn thread_ids(mut self, thread_ids: Vec<String>) -> Self {
        self.thread_ids = thread_ids;
        self
    }

    pub fn mentions(mut self, mentions: Vec<String>) -> Self {
        self.mentions = mentions;
        self
    }

    pub fn sender_ids(mut self, sender_ids: Vec<String>) -> Self {
        self.sender_ids = sender_ids;
        self
    }

    pub fn ids(mut self, ids: Vec<String>) -> Self {
        self.channel_ids = ids.clone();
        self.inner = self.inner.ids(ids);
        self
    }

    // Copy function signature from SearchQueryBuilder
    delegate_methods! {
        fn match_type(match_type: &str) -> Self;
        fn page(page: i64) -> Self;
        fn page_size(page_size: i64) -> Self;
        fn user_id(user_id: &str) -> Self;
        fn search_on(search_on: SearchOn) -> Self;
        fn ids_only(ids_only: bool) -> Self;
        fn collapse(collapse: bool) -> Self;
    }

    fn query_builder(
        self,
    ) -> Result<(
        SearchQueryBuilder<ChannelMessageSearchConfig>,
        BoolQueryBuilder,
    )> {
        let mut query_object = self.inner.query_builder()?;

        // Add org_id to must clause if provided
        if let Some(org_id) = self.org_id {
            query_object.must(QueryType::term("org_id", org_id));
        }

        // Add thread_ids to must clause if provided
        if !self.thread_ids.is_empty() {
            query_object.must(QueryType::terms("thread_id", self.thread_ids));
        }

        // Add mentions to must clause if provided
        if !self.mentions.is_empty() {
            query_object.must(QueryType::terms("mentions", self.mentions));
        }

        if !self.channel_ids.is_empty() {
            query_object.must(QueryType::terms("channel_id", self.channel_ids));
        }

        // Add sender_ids to must clause if provided
        if !self.sender_ids.is_empty() {
            query_object.must(QueryType::terms("sender_id", self.sender_ids));
        }

        Ok((self.inner, query_object))
    }

    pub fn build(self) -> Result<Value> {
        let (builder, query_object) = self.query_builder()?;
        let base_query = builder.build_with_query(query_object.build().into())?;

        Ok(base_query)
    }
}

#[derive(Debug, Default)]
pub struct ChannelMessageSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub channel_ids: Vec<String>,
    pub page: i64,
    pub page_size: i64,
    pub match_type: String,
    pub org_id: Option<i64>,
    pub thread_ids: Vec<String>,
    pub mentions: Vec<String>,
    pub sender_ids: Vec<String>,
    pub search_on: SearchOn,
    pub collapse: bool,
    pub ids_only: bool,
}

impl ChannelMessageSearchArgs {
    pub fn build(self) -> Result<Value> {
        let mut builder = ChannelMessageQueryBuilder::new(self.terms)
            .match_type(&self.match_type)
            .page_size(self.page_size)
            .page(self.page)
            .user_id(&self.user_id)
            .thread_ids(self.thread_ids)
            .mentions(self.mentions)
            .ids(self.channel_ids)
            .search_on(self.search_on)
            .collapse(self.collapse)
            .ids_only(self.ids_only)
            .sender_ids(self.sender_ids);

        // Only add org_id if there is a value provided
        if let Some(org_id) = self.org_id {
            builder = builder.org_id(org_id);
        }

        builder.build()
    }
}

pub(crate) async fn search_channel_messages(
    client: &opensearch::OpenSearch,
    args: ChannelMessageSearchArgs,
) -> Result<Vec<ChannelMessageSearchResponse>> {
    let query_body = args.build()?;

    let response = client
        .search(opensearch::SearchParts::Index(&[CHANNEL_INDEX]))
        .body(query_body)
        .send()
        .await
        .map_client_error()
        .await?;

    let result = response
        .json::<DefaultSearchResponse<ChannelMessageIndex>>()
        .await
        .map_err(|e| OpensearchClientError::DeserializationFailed {
            details: e.to_string(),
            method: Some("search_channel".to_string()),
        })?;

    Ok(result
        .hits
        .hits
        .into_iter()
        .map(|hit| ChannelMessageSearchResponse {
            channel_id: hit._source.channel_id,
            channel_name: hit._source.channel_name,
            channel_type: hit._source.channel_type,
            org_id: hit._source.org_id,
            message_id: hit._source.message_id,
            thread_id: hit._source.thread_id,
            sender_id: hit._source.sender_id,
            mentions: hit._source.mentions,
            created_at: hit._source.created_at_seconds,
            updated_at: hit._source.updated_at_seconds,
            content: hit.highlight.map(|h| h.content),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_with_additional_fields() {
        let query_key = "match_phrase";
        let channel_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
        let user_id = "user";
        let page = 1;
        let page_size = 2;
        let from = page * page_size;
        let query = "test";
        let thread_ids = vec!["T1".to_string(), "T2".to_string()];
        let mentions = vec!["M1".to_string(), "M2".to_string()];
        let org_id = 1;
        let reference = serde_json::json!({
            "query": {
                "bool": {
                    "should": [
                        {
                            "term": {
                                "sender_id": user_id
                            }
                        },
                        {
                            "terms": {
                                "channel_id": channel_ids
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
                        {
                            "term": {
                                "org_id": org_id
                            }
                        },
                        {
                            "terms": {
                                "thread_id": thread_ids
                            }
                        },
                        {
                            "terms": {
                                "mentions": mentions
                            }
                        },
                        {
                            "terms": {
                                "channel_id": channel_ids
                            }
                        }
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
                    "channel_id": {
                        "order": "asc"
                    }
                },
                {
                    "message_id": {
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
                    }
                },
                "require_field_match": true, // Default is true, but good to be explicit
            },
        });

        let generated = ChannelMessageQueryBuilder::new(vec![query.to_string()])
            .mentions(mentions)
            .thread_ids(thread_ids)
            .org_id(org_id)
            .match_type("exact")
            .page_size(page_size)
            .page(page)
            .user_id(user_id)
            .ids(channel_ids)
            .build()
            .unwrap();

        assert_eq!(&generated, &reference);
    }

    #[test]
    fn test_sanity() {
        let query_key = "match_phrase";
        let channel_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
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
                                "sender_id": user_id
                            }
                        },
                        {
                            "terms": {
                                "channel_id": channel_ids
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
                        {
                            "terms": {
                                "channel_id": channel_ids
                            }
                        }
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
                    "channel_id": {
                        "order": "asc"
                    }
                },
                {
                    "message_id": {
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
                    }
                },
                "require_field_match": true, // Default is true, but good to be explicit
            },
        });

        let generated = ChannelMessageQueryBuilder::new(vec![query.to_string()])
            .match_type("exact")
            .page_size(page_size)
            .page(page)
            .user_id(user_id)
            .ids(channel_ids)
            .build()
            .unwrap();

        assert_eq!(&generated, &reference);
    }

    #[test]
    fn test_ids_only() {
        let query_key = "match_phrase";
        let channel_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
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
                                "channel_id": channel_ids
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
                        {
                            "terms": {
                                "channel_id": channel_ids
                            }
                        }
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
                    "channel_id": {
                        "order": "asc"
                    }
                },
                {
                    "message_id": {
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
                    }
                },
                "require_field_match": true, // Default is true, but good to be explicit
            },
        });

        let generated = ChannelMessageQueryBuilder::new(vec![query.to_string()])
            .match_type("exact")
            .page_size(page_size)
            .page(page)
            .user_id(user_id)
            .ids(channel_ids)
            .ids_only(true)
            .build()
            .unwrap();

        assert_eq!(&generated, &reference);
    }

    #[test]
    fn test_sender_ids() {
        let channel_ids = vec!["CH1".to_string(), "CH2".to_string()];
        let user_id = "user123";
        let terms = vec!["search".to_string()];
        let sender_ids: Vec<String> = vec!["paul", "ringo", "john", "george"]
            .into_iter()
            .map(String::from)
            .collect();

        let (_, builder) = ChannelMessageQueryBuilder::new(terms)
            .match_type("exact")
            .page(0)
            .page_size(10)
            .user_id(user_id)
            .ids(channel_ids.clone())
            .sender_ids(sender_ids.clone())
            .query_builder()
            .unwrap();

        let must = if let QueryType::Bool(bool) = builder.build().into() {
            bool.must
        } else {
            panic!("Could not extract MUST field from bool because type was not a bool");
        };

        // Check that sender_ids are in the must field as a terms query
        let sender_ids_constraint_found = must.iter().any(|item| {
            if let QueryType::Terms(terms_query) = item {
                // Check if this is a terms query for "sender_id" field with all expected values
                terms_query.field == "sender_id"
                    && terms_query.values.len() == sender_ids.len()
                    && sender_ids
                        .iter()
                        .all(|id| terms_query.values.iter().any(|v| v.as_str() == Some(id)))
            } else {
                false
            }
        });

        assert!(
            sender_ids_constraint_found,
            "sender_ids should be present in must clause as terms query for sender_id field"
        );

        // Also verify that we have the expected number of must clauses
        // Should include: search terms, channel_id (from channel_search=true), and sender_id
        assert!(
            must.len() >= 3,
            "Must clause should contain at least 3 items: search terms, channel_id, and sender_id"
        );
    }
}
