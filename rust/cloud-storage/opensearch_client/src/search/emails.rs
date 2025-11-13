use crate::{
    EMAIL_INDEX, Result, delegate_methods,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::{Highlight, parse_highlight_hit},
        query::Keys,
    },
};

use crate::SearchOn;
use opensearch_query_builder::{
    FieldSort, ScoreWithOrderSort, SearchRequest, SortOrder, SortType, ToOpenSearchJson,
};

use crate::search::model::DefaultSearchResponse;
use serde_json::Value;

struct EmailSearchConfig;

impl SearchQueryConfig for EmailSearchConfig {
    const ID_KEY: &'static str = "thread_id";
    const INDEX: &'static str = EMAIL_INDEX;
    const USER_ID_KEY: &'static str = "user_id";
    const TITLE_KEY: &'static str = "subject";

    fn default_sort_types() -> Vec<SortType> {
        vec![
            SortType::ScoreWithOrder(ScoreWithOrderSort::new(SortOrder::Desc)),
            SortType::Field(FieldSort::new(Self::ID_KEY, SortOrder::Asc)),
            SortType::Field(FieldSort::new("thread_id", SortOrder::Asc)),
        ]
    }
}

struct EmailQueryBuilder {
    inner: SearchQueryBuilder<EmailSearchConfig>,
}

impl EmailQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
        }
    }

    // Copy function signature from SearchQueryBuilder
    delegate_methods! {
        fn match_type(match_type: &str) -> Self;
        fn page(page: u32) -> Self;
        fn page_size(page_size: u32) -> Self;
        fn user_id(user_id: &str) -> Self;
        fn search_on(search_on: SearchOn) -> Self;
        fn collapse(collapse: bool) -> Self;
        fn ids(ids: Vec<String>) -> Self;
        fn ids_only(ids_only: bool) -> Self;
    }

    fn build_search_request(self) -> Result<SearchRequest> {
        // Build the main bool query containing all terms and any other filters
        let bool_query = self.inner.build_bool_query()?;

        // Build the search request with the bool query
        // This will automatically wrap the bool query in a function score if
        // SearchOn::NameContent is used
        let search_request = self.inner.build_search_request(bool_query.build())?;

        Ok(search_request)
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct EmailIndex {
    /// The id of the email thread
    pub thread_id: String,
    /// The id of the email message
    pub message_id: String,
    /// The sender of the email message
    pub sender: String,
    /// The recipients of the email message
    pub recipients: Vec<String>,
    /// The cc of the email message
    pub cc: Vec<String>,
    /// The bcc of the email message
    pub bcc: Vec<String>,
    /// The labels of the email message
    pub labels: Vec<String>,
    /// The link id of the email message
    pub link_id: String,
    /// The user id of the email message
    pub user_id: String,
    /// The updated at time of the email message
    pub updated_at_seconds: i64,
    /// The subject of the email message
    pub subject: Option<String>,
    /// The sent at time of the email message
    pub sent_at_seconds: Option<i64>,
    /// The content of the email message
    pub content: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct EmailSearchResponse {
    pub thread_id: String,
    pub message_id: String,
    pub sender: String,
    pub recipients: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub labels: Vec<String>,
    pub link_id: String,
    pub user_id: String,
    pub updated_at: i64,
    pub sent_at: Option<i64>,
    pub subject: Option<String>,
    pub highlight: Highlight,
}

pub struct EmailSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub thread_ids: Vec<String>,
    pub page: u32,
    pub page_size: u32,
    pub match_type: String,
    pub search_on: SearchOn,
    pub collapse: bool,
    pub ids_only: bool,
}

impl EmailSearchArgs {
    pub fn build(self) -> Result<Value> {
        Ok(EmailQueryBuilder::new(self.terms)
            .match_type(&self.match_type)
            .page_size(self.page_size)
            .page(self.page)
            .user_id(&self.user_id)
            .ids(self.thread_ids)
            .search_on(self.search_on)
            .collapse(self.collapse)
            .ids_only(self.ids_only)
            .build_search_request()?
            .to_json())
    }
}

#[tracing::instrument(skip(client, args), err)]
pub(crate) async fn search_emails(
    client: &opensearch::OpenSearch,
    args: EmailSearchArgs,
) -> Result<Vec<EmailSearchResponse>> {
    let query_body = args.build()?;

    let response = client
        .search(opensearch::SearchParts::Index(&[EMAIL_INDEX]))
        .body(query_body)
        .send()
        .await
        .map_client_error()
        .await?;

    let result = response
        .json::<DefaultSearchResponse<EmailIndex>>()
        .await
        .map_err(|e| OpensearchClientError::DeserializationFailed {
            details: e.to_string(),
            method: Some("search_emails".to_string()),
        })?;

    Ok(result
        .hits
        .hits
        .into_iter()
        .map(|hit| EmailSearchResponse {
            thread_id: hit._source.thread_id,
            message_id: hit._source.message_id,
            subject: hit._source.subject,
            sender: hit._source.sender,
            recipients: hit._source.recipients,
            cc: hit._source.cc,
            bcc: hit._source.bcc,
            labels: hit._source.labels,
            link_id: hit._source.link_id,
            user_id: hit._source.user_id,
            updated_at: hit._source.updated_at_seconds,
            sent_at: hit._source.sent_at_seconds,
            highlight: hit
                .highlight
                .map(|h| {
                    parse_highlight_hit(
                        h,
                        Keys {
                            title_key: EmailSearchConfig::TITLE_KEY,
                            content_key: EmailSearchConfig::CONTENT_KEY,
                        },
                    )
                })
                .unwrap_or_default(),
        })
        .collect())
}

#[cfg(test)]
mod test;
