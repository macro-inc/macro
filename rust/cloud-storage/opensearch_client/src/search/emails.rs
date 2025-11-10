use crate::{
    EMAIL_INDEX, Result, delegate_methods,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        utils::should_wildcard_field_query_builder,
    },
};

use crate::SearchOn;
use opensearch_query_builder::{BoolQueryBuilder, FieldSort, QueryType, SortOrder, SortType};

use crate::search::model::DefaultSearchResponse;
use serde_json::Value;

struct EmailSearchConfig;

impl SearchQueryConfig for EmailSearchConfig {
    const ID_KEY: &'static str = "message_id";
    const INDEX: &'static str = EMAIL_INDEX;
    const USER_ID_KEY: &'static str = "user_id";
    const TITLE_KEY: &'static str = "subject";

    fn default_sort_types() -> Vec<SortType> {
        vec![
            SortType::Field(FieldSort::new("updated_at_seconds", SortOrder::Desc)),
            SortType::Field(FieldSort::new(Self::ID_KEY, SortOrder::Asc)),
            SortType::Field(FieldSort::new("thread_id", SortOrder::Asc)),
        ]
    }
}

struct EmailQueryBuilder {
    inner: SearchQueryBuilder<EmailSearchConfig>,
    /// thread ids to query over
    thread_ids: Vec<String>,
    /// link ids to query over
    link_ids: Vec<String>,
    /// The sender of the email message
    sender: Vec<String>,
    /// The cc of the email message
    cc: Vec<String>,
    /// The bcc of the email message
    bcc: Vec<String>,
    /// The recipients of the email message
    recipients: Vec<String>,
}

impl EmailQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
            thread_ids: Vec::new(),
            link_ids: Vec::new(),
            sender: Vec::new(),
            cc: Vec::new(),
            bcc: Vec::new(),
            recipients: Vec::new(),
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

    pub fn thread_ids(mut self, thread_ids: Vec<String>) -> Self {
        self.thread_ids = thread_ids;
        self
    }

    pub fn link_ids(mut self, link_ids: Vec<String>) -> Self {
        self.link_ids = link_ids;
        self
    }

    pub fn sender(mut self, sender: Vec<String>) -> Self {
        self.sender = sender;
        self
    }

    pub fn cc(mut self, cc: Vec<String>) -> Self {
        self.cc = cc;
        self
    }

    pub fn bcc(mut self, bcc: Vec<String>) -> Self {
        self.bcc = bcc;
        self
    }

    pub fn recipients(mut self, recipients: Vec<String>) -> Self {
        self.recipients = recipients;
        self
    }

    fn query_builder(self) -> Result<(SearchQueryBuilder<EmailSearchConfig>, BoolQueryBuilder)> {
        let mut query_object = self.inner.query_builder()?;

        // If thread_ids are provided, add them to the query
        if !self.thread_ids.is_empty() {
            query_object.must(QueryType::terms("thread_id", self.thread_ids));
        }

        // If link_ids are provided, add them to the query
        if !self.link_ids.is_empty() {
            query_object.must(QueryType::terms("link_id", self.link_ids));
        }

        if !self.sender.is_empty() {
            // Create new query for senders
            let senders_query = should_wildcard_field_query_builder("sender", &self.sender);
            query_object.must(senders_query);
        }

        if !self.cc.is_empty() {
            let ccs_query = should_wildcard_field_query_builder("cc", &self.cc);
            query_object.must(ccs_query);
        }

        if !self.bcc.is_empty() {
            // Create new query for bccs
            let bccs_query = should_wildcard_field_query_builder("bcc", &self.bcc);
            query_object.must(bccs_query);
        }

        if !self.recipients.is_empty() {
            // Create new query for recipients
            let recipients_query =
                should_wildcard_field_query_builder("recipients", &self.recipients);
            query_object.must(recipients_query);
        }

        Ok((self.inner, query_object))
    }

    pub fn build(self) -> Result<Value> {
        let (builder, query_object) = self.query_builder()?;
        let base_query = builder.build_with_query(query_object.build().into())?;

        Ok(base_query)
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
    pub content: Option<Vec<String>>,
}

pub struct EmailSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub message_ids: Vec<String>,
    pub thread_ids: Vec<String>,
    pub link_ids: Vec<String>,
    pub sender: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub recipients: Vec<String>,
    pub page: i64,
    pub page_size: i64,
    pub match_type: String,
    pub search_on: SearchOn,
    pub collapse: bool,
    pub ids_only: bool,
}

impl EmailSearchArgs {
    pub fn build(self) -> Result<Value> {
        EmailQueryBuilder::new(self.terms)
            .match_type(&self.match_type)
            .page_size(self.page_size)
            .page(self.page)
            .user_id(&self.user_id)
            .ids(self.message_ids)
            .thread_ids(self.thread_ids) // Now using the thread_ids parameter
            .link_ids(self.link_ids)
            .sender(self.sender)
            .cc(self.cc)
            .bcc(self.bcc)
            .search_on(self.search_on)
            .recipients(self.recipients)
            .collapse(self.collapse)
            .ids_only(self.ids_only)
            .build()
    }
}

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
            content: hit
                .highlight
                .map(|h| h.content)
                .or(Some(vec![hit._source.content])),
        })
        .collect())
}

#[cfg(test)]
mod test;
