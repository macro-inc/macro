use crate::{
    Result, delegate_methods,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::{NameIndex, SearchGotoContent, SearchGotoEmail, SearchHit, parse_highlight_hit},
        query::Keys,
        utils::should_wildcard_field_query_builder,
    },
};

use crate::SearchOn;
use models_opensearch::{SearchEntityType, SearchIndex};
use opensearch_query_builder::{
    BoolQuery, BoolQueryBuilder, QueryType, SearchRequest, ToOpenSearchJson,
};

use crate::search::model::DefaultSearchResponse;
use serde_json::Value;

pub(crate) struct EmailSearchConfig;

impl SearchQueryConfig for EmailSearchConfig {
    const USER_ID_KEY: &'static str = "user_id";
    const TITLE_KEY: &'static str = "name";
    const ENTITY_INDEX: SearchEntityType = SearchEntityType::Emails;
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
    /// Labels to include (emails must have at least one)
    include_labels: Vec<String>,
    /// Labels to exclude (emails must not have any)
    exclude_labels: Vec<String>,
    /// Filter by importance. All filters (importance, include_labels, exclude_labels) are
    /// ANDed together. Contradictory combinations (e.g. importance=true with
    /// include_labels=["CATEGORY_PROMOTIONS"]) will return no results.
    importance: Option<bool>,
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
            include_labels: Vec::new(),
            exclude_labels: Vec::new(),
            importance: None,
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

    pub fn include_labels(mut self, include_labels: Vec<String>) -> Self {
        self.include_labels = include_labels;
        self
    }

    pub fn exclude_labels(mut self, exclude_labels: Vec<String>) -> Self {
        self.exclude_labels = exclude_labels;
        self
    }

    pub fn importance(mut self, importance: Option<bool>) -> Self {
        self.importance = importance;
        self
    }

    pub fn build_bool_query<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        let mut content_bool_query = self.inner.build_content_bool_query()?;

        // CUSTOM ATTRIBUTES SECTION
        // If link_ids are provided, add them to the query
        if !self.link_ids.is_empty() {
            content_bool_query.filter(QueryType::terms("link_id", self.link_ids.clone()));
        }

        if !self.sender.is_empty() {
            // Create new query for senders
            let senders_query = should_wildcard_field_query_builder("sender", &self.sender);
            content_bool_query.filter(senders_query);
        }

        if !self.cc.is_empty() {
            let ccs_query = should_wildcard_field_query_builder("cc", &self.cc);
            content_bool_query.filter(ccs_query);
        }

        if !self.bcc.is_empty() {
            // Create new query for bccs
            let bccs_query = should_wildcard_field_query_builder("bcc", &self.bcc);
            content_bool_query.filter(bccs_query);
        }

        if !self.recipients.is_empty() {
            let recipients_query =
                should_wildcard_field_query_builder("recipients", &self.recipients);
            content_bool_query.filter(recipients_query);
        }

        if !self.include_labels.is_empty() {
            content_bool_query.filter(QueryType::terms("labels", self.include_labels.clone()));
        }

        for label in &self.exclude_labels {
            content_bool_query.must_not(QueryType::term("labels", label.clone()));
        }

        // Importance filter. Source of truth for the label logic is in
        // email/src/outbound/email_pg_repo/dynamic.rs (EmailLiteral::Importance).
        match self.importance {
            Some(true) => {
                // Exclude emails that have depriority labels UNLESS they also have a priority label.
                let importance_exclude = BoolQuery::new()
                    .filter(QueryType::terms(
                        "labels",
                        [
                            "CATEGORY_UPDATES",
                            "CATEGORY_PROMOTIONS",
                            "CATEGORY_SOCIAL",
                            "CATEGORY_FORUMS",
                        ],
                    ))
                    .must_not(QueryType::terms(
                        "labels",
                        ["CATEGORY_PERSONAL", "SENT", "DRAFT"],
                    ));
                content_bool_query.must_not(QueryType::Bool(importance_exclude));
            }
            Some(false) => {
                // Only show deprioritized emails: must have a depriority label
                // AND must not have a priority label.
                let depriority_filter = BoolQuery::new()
                    .filter(QueryType::terms(
                        "labels",
                        [
                            "CATEGORY_UPDATES",
                            "CATEGORY_PROMOTIONS",
                            "CATEGORY_SOCIAL",
                            "CATEGORY_FORUMS",
                        ],
                    ))
                    .must_not(QueryType::terms(
                        "labels",
                        ["CATEGORY_PERSONAL", "SENT", "DRAFT"],
                    ));
                content_bool_query.filter(QueryType::Bool(depriority_filter));
            }
            None => {}
        }
        // END CUSTOM ATTRIBUTES SECTION

        Ok(content_bool_query)
    }

    fn build_search_request<'a>(&'a self) -> Result<SearchRequest<'a>> {
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
    pub entity_id: uuid::Uuid,
    /// The id of the email message
    pub message_id: uuid::Uuid,
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
    /// The subject of the email message
    pub subject: Option<String>,
    /// The sent at time of the email message
    pub sent_at_seconds: Option<i64>,
    /// The content of the email message
    pub content: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub(crate) enum EmailNameIndex {
    Email(Box<EmailIndex>),
    Name(NameIndex),
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
    pub include_labels: Vec<String>,
    pub exclude_labels: Vec<String>,
    pub importance: Option<bool>,
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
            .include_labels(args.include_labels)
            .exclude_labels(args.exclude_labels)
            .importance(args.importance)
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
) -> Result<Vec<SearchHit>> {
    let query_body = args.build()?;

    tracing::trace!("query: {}", query_body);

    let response = client
        .search(opensearch::SearchParts::Index(&[
            SearchIndex::Emails.as_ref()
        ]))
        .body(query_body)
        .send()
        .await
        .map_client_error()
        .await?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| OpensearchClientError::HttpBytesError {
            details: e.to_string(),
        })?;

    let result: DefaultSearchResponse<EmailNameIndex> =
        serde_json::from_slice(&bytes).map_err(|e| {
            OpensearchClientError::SearchDeserializationFailed {
                details: e.to_string(),
                raw_body: String::from_utf8_lossy(&bytes).to_string(),
            }
        })?;

    Ok(result
        .hits
        .hits
        .into_iter()
        .map(|hit| {
            let highlight = hit
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
                .unwrap_or_default();

            match hit.source {
                EmailNameIndex::Name(a) => SearchHit {
                    entity_id: a.entity_id,
                    entity_type: a.entity_type,
                    goto: None,
                    score: hit.score,
                    highlight,
                    updated_at: None,
                },
                EmailNameIndex::Email(a) => SearchHit {
                    entity_id: a.entity_id,
                    entity_type: SearchEntityType::Emails,
                    score: hit.score,
                    highlight,
                    goto: Some(SearchGotoContent::Emails(SearchGotoEmail {
                        email_message_id: a.message_id,
                        bcc: a.bcc,
                        cc: a.cc,
                        labels: a.labels,
                        sent_at: a
                            .sent_at_seconds
                            .and_then(|ts| chrono::DateTime::from_timestamp(ts, 0)),
                        sender: a.sender,
                        recipients: a.recipients,
                    })),
                    updated_at: a
                        .sent_at_seconds
                        .and_then(|s| chrono::DateTime::from_timestamp(s, 0)),
                },
            }
        })
        .collect())
}

#[cfg(test)]
mod test;
