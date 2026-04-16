use crate::{
    Result, delegate_methods,
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        utils::should_wildcard_field_query_builder,
    },
};

use models_opensearch::SearchEntityType;
use opensearch_query_builder::{BoolQuery, BoolQueryBuilder, QueryType, SimpleQueryStringQuery};

pub(crate) struct EmailSearchConfig;

impl SearchQueryConfig for EmailSearchConfig {
    const USER_ID_KEY: &'static str = "user_id";
    const TITLE_KEY: &'static str = "subject";
    const ENTITY_INDEX: SearchEntityType = SearchEntityType::Emails;
}

/// The fields to search across with simple_query_string for email search.
const EMAIL_SIMPLE_QUERY_FIELDS: &[&str] = &[
    "sender",
    "reply_to",
    "recipients",
    "cc",
    "bcc",
    "subject",
    "content",
    "sender_name",
    "recipient_names",
    "cc_names",
    "bcc_names",
];

/// Transforms search terms into a simple_query_string query string.
/// Single-word terms become `(term | term@*)` so they match both text fields
/// and keyword email-address fields. Multi-word terms (containing spaces) skip
/// the `@*` pattern since email addresses never contain spaces.
/// Email-like terms (containing `@`) are wrapped in quotes to force phrase
/// matching on analyzed text fields — otherwise the standard analyzer tokenizes
/// `hutch@macro.com` into `[hutch, macro, com]`, causing `macro.com` to be
/// highlighted inside unrelated addresses like `gab@macro.com`.
/// The email pattern is lowercased because email addresses are case-insensitive.
/// Terms are ANDed together with `+`.
fn build_simple_query_string(terms: &[String]) -> String {
    terms
        .iter()
        .map(|term| {
            if term.contains('@') {
                format!("\"{}\"", term)
            } else if term.contains(' ') {
                format!("({})", term)
            } else {
                format!("({} | {}@*)", term, term.to_lowercase())
            }
        })
        .collect::<Vec<_>>()
        .join(" + ")
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
    /// When true, only search the subject field (for name-only search mode)
    subject_only: bool,
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
            subject_only: false,
        }
    }

    // Copy function signature from SearchQueryBuilder
    delegate_methods! {
        fn match_type(match_type: &str) -> Self;
        fn page(page: u32) -> Self;
        fn page_size(page_size: u32) -> Self;
        fn user_id(user_id: &str) -> Self;
        fn collapse(collapse: bool) -> Self;
        fn ids(ids: Vec<String>) -> Self;
        fn ids_only(ids_only: bool) -> Self;
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

    pub fn subject_only(mut self, subject_only: bool) -> Self {
        self.subject_only = subject_only;
        self
    }

    pub fn build_bool_query<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        let mut content_bool_query = self.inner.build_content_bool_query()?;

        // In subject_only mode (name search), replace with a match on TITLE_KEY (subject).
        // Otherwise replace with simple_query_string across all email fields.
        if self.subject_only {
            let title_query = self.inner.build_title_term_query()?;
            let mut inner = BoolQueryBuilder::new();
            inner.minimum_should_match(1);
            inner.should(title_query);
            content_bool_query.set_must(inner.build().into());
        } else {
            let query_string = build_simple_query_string(&self.inner.terms);
            let sqs = SimpleQueryStringQuery::new(
                query_string,
                EMAIL_SIMPLE_QUERY_FIELDS.iter().copied(),
            )
            .default_operator("AND");
            content_bool_query.set_must(sqs.into());
        }

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
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct EmailIndex {
    /// The id of the email thread
    pub entity_id: uuid::Uuid,
    /// The id of the email message
    pub message_id: uuid::Uuid,
    /// The sender of the email message
    pub sender: String,
    /// The display name of the sender
    #[serde(default)]
    pub sender_name: Option<String>,
    /// The reply-to address of the email message
    #[serde(default)]
    pub reply_to: Option<String>,
    /// The recipients of the email message
    pub recipients: Vec<String>,
    /// The display names of the recipients
    #[serde(default)]
    pub recipient_names: Vec<String>,
    /// The cc of the email message
    pub cc: Vec<String>,
    /// The display names of the cc contacts
    #[serde(default)]
    pub cc_names: Vec<String>,
    /// The bcc of the email message
    pub bcc: Vec<String>,
    /// The display names of the bcc contacts
    #[serde(default)]
    pub bcc_names: Vec<String>,
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
    pub collapse: bool,
    pub ids_only: bool,
    pub subject_only: bool,
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
            .recipients(args.recipients)
            .include_labels(args.include_labels)
            .exclude_labels(args.exclude_labels)
            .importance(args.importance)
            .collapse(args.collapse)
            .ids_only(args.ids_only)
            .subject_only(args.subject_only)
    }
}

#[cfg(test)]
mod test;
