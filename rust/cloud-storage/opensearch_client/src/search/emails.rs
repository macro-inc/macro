use crate::{
    EMAIL_INDEX, Result, delegate_methods,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::{Highlight, parse_highlight_hit},
        query::Keys,
        utils::should_wildcard_field_query_builder,
    },
};

use crate::SearchOn;
use opensearch_query_builder::{
    BoolQueryBuilder, FieldSort, QueryType, ScoreWithOrderSort, SearchRequest, SortOrder, SortType,
    ToOpenSearchJson,
};

use crate::search::model::DefaultSearchResponse;
use serde_json::Value;

pub(crate) struct EmailSearchConfig;

impl SearchQueryConfig for EmailSearchConfig {
    const INDEX: &'static str = EMAIL_INDEX;
    const USER_ID_KEY: &'static str = "user_id";
    const TITLE_KEY: &'static str = "subject";

    fn default_sort_types() -> Vec<SortType<'static>> {
        vec![
            SortType::ScoreWithOrder(ScoreWithOrderSort::new(SortOrder::Desc)),
            SortType::Field(FieldSort::new(Self::ID_KEY, SortOrder::Asc)),
        ]
    }
}

pub(crate) struct EmailQueryBuilder {
    inner: SearchQueryBuilder<EmailSearchConfig>,
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
        fn page(page: u32) -> Self;
        fn page_size(page_size: u32) -> Self;
        fn user_id(user_id: &str) -> Self;
        fn search_on(search_on: SearchOn) -> Self;
        fn collapse(collapse: bool) -> Self;
        fn ids(ids: Vec<String>) -> Self;
        fn ids_only(ids_only: bool) -> Self;
        fn disable_recency(disable_recency: bool) -> Self;
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

    pub fn build_bool_query(&self) -> Result<BoolQueryBuilder<'static>> {
        // Build the main bool query containing all terms and any other filters
        let mut bool_query = self.inner.build_bool_query()?;

        // CUSTOM ATTRIBUTES SECTION

        // If link_ids are provided, add them to the query
        if !self.link_ids.is_empty() {
            bool_query.must(QueryType::terms(
                "link_id".to_string(),
                self.link_ids.clone(),
            ));
        }

        if !self.sender.is_empty() {
            // Create new query for senders
            let senders_query = should_wildcard_field_query_builder("sender", &self.sender);
            bool_query.must(senders_query);
        }

        if !self.cc.is_empty() {
            let ccs_query = should_wildcard_field_query_builder("cc", &self.cc);
            bool_query.must(ccs_query);
        }

        if !self.bcc.is_empty() {
            // Create new query for bccs
            let bccs_query = should_wildcard_field_query_builder("bcc", &self.bcc);
            bool_query.must(bccs_query);
        }

        if !self.recipients.is_empty() {
            // Create new query for recipients
            let recipients_query =
                should_wildcard_field_query_builder("recipients", &self.recipients);
            bool_query.must(recipients_query);
        }

        // END CUSTOM ATTRIBUTES SECTION
        Ok(bool_query)
    }

    fn build_search_request(&self) -> Result<SearchRequest<'static>> {
        // Build the search request with the bool query
        // This will automatically wrap the bool query in a function score if
        // SearchOn::NameContent is used
        let search_request = self
            .inner
            .build_search_request(self.build_bool_query()?.build())?;

        Ok(search_request)
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct EmailIndex {
    /// The id of the email thread
    pub entity_id: String,
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

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
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
    pub score: Option<f64>,
    pub highlight: Highlight,
}

pub struct EmailSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub thread_ids: Vec<String>,
    pub link_ids: Vec<String>,
    pub sender: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub recipients: Vec<String>,
    pub page: u32,
    pub page_size: u32,
    pub match_type: String,
    pub search_on: SearchOn,
    pub collapse: bool,
    pub ids_only: bool,
    pub disable_recency: bool,
}

impl From<EmailSearchArgs> for EmailQueryBuilder {
    fn from(args: EmailSearchArgs) -> Self {
        EmailQueryBuilder::new(args.terms)
            .match_type(&args.match_type)
            .page_size(args.page_size)
            .page(args.page)
            .user_id(&args.user_id)
            .ids(args.thread_ids)
            .link_ids(args.link_ids)
            .sender(args.sender)
            .cc(args.cc)
            .bcc(args.bcc)
            .search_on(args.search_on)
            .recipients(args.recipients)
            .collapse(args.collapse)
            .ids_only(args.ids_only)
            .disable_recency(args.disable_recency)
    }
}

impl EmailSearchArgs {
    pub fn build(self) -> Result<Value> {
        let builder: EmailQueryBuilder = self.into();
        Ok(builder.build_search_request()?.to_json())
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
            thread_id: hit.source.entity_id,
            message_id: hit.source.message_id,
            subject: hit.source.subject,
            sender: hit.source.sender,
            recipients: hit.source.recipients,
            cc: hit.source.cc,
            bcc: hit.source.bcc,
            labels: hit.source.labels,
            link_id: hit.source.link_id,
            user_id: hit.source.user_id,
            updated_at: hit.source.updated_at_seconds,
            sent_at: hit.source.sent_at_seconds,
            score: hit.score,
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
