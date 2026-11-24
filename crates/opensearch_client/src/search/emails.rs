use crate::{
    Result, delegate_methods,
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        properties::build_tag_filter,
        query::{CreateQueryParams, QueryKey, create_query},
        utils::should_wildcard_field_query_builder,
    },
};

use models_opensearch::OpenSearchEntityType;
use opensearch_query_builder::{
    BoolQuery, BoolQueryBuilder, QueryType, Script, ScriptQuery, SimpleQueryStringQuery,
    WildcardQuery,
};
use unicode_segmentation::UnicodeSegmentation;

pub(crate) struct EmailSearchConfig;

impl SearchQueryConfig for EmailSearchConfig {
    const USER_ID_KEY: Option<&'static str> = Some("user_id");
    const TITLE_KEY: &'static str = "subject";
    const ENTITY_INDEX: OpenSearchEntityType = OpenSearchEntityType::Emails;
}

/// Email-address fields matched explicitly, never as a character prefix.
/// The raw keyword-indexed addresses plus their `.parts` sub-fields, which
/// the `email_parts` analyzer splits into positioned segment tokens
/// (`jane.doe@mail.foo.com` indexes `jane`, `doe`, `mail`, `foo`, `com`).
/// A bare word matches only a whole segment, so `ali` won't match
/// `alice@example.com` and `immipart` won't match `immipartner.com`.
/// Dotted terms like `foo.com` are quoted into phrases and match any
/// in-order adjacent run of segments.
const EMAIL_KEYWORD_FIELDS: &[&str] = &[
    "sender",
    "reply_to",
    "recipients",
    "cc",
    "bcc",
    "sender.parts",
    "reply_to.parts",
    "recipients.parts",
    "cc.parts",
    "bcc.parts",
];

/// Domain Macro's own notification/digest emails are sent from. Those are
/// never signal, mirroring the Postgres `is_signal` heuristic. Kept in sync
/// with `email_utils::MACRO_NOTIFICATION_SENDER_DOMAIN`, which is not imported
/// so this crate stays free of the email HTML tooling that crate pulls in.
const MACRO_NOTIFICATION_SENDER_DOMAIN: &str = "notification.macro.com";

/// Matches messages whose `sender` is any address at
/// [`MACRO_NOTIFICATION_SENDER_DOMAIN`].
fn macro_notification_sender_query<'a>() -> QueryType<'a> {
    QueryType::WildCard(WildcardQuery::new(
        "sender",
        format!("*@{MACRO_NOTIFICATION_SENDER_DOMAIN}"),
        true,
        None,
    ))
}

/// Text-analyzed fields. Matched as a prefix so `scri` matches `script`.
const EMAIL_TEXT_FIELDS: &[&str] = &[
    "subject",
    "content",
    "sender_name",
    "recipient_names",
    "cc_names",
    "bcc_names",
];

/// The part of a message an [`EmailTextCondition`] matches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmailTextFields {
    /// Every field a search term matches.
    Any,
    Subject,
    /// The sender's name or address.
    From,
    /// The names and addresses of every recipient: To, Cc and Bcc.
    To,
    Cc,
    Bcc,
}

impl EmailTextFields {
    /// The address fields, matched by segment as [`build_keyword_query_string`]
    /// does, and the text fields, matched by prefix as [`text_terms_query`]
    /// does.
    fn fields(self) -> (&'static [&'static str], &'static [&'static str]) {
        match self {
            Self::Any => (EMAIL_KEYWORD_FIELDS, EMAIL_TEXT_FIELDS),
            Self::Subject => (&[], &["subject"]),
            Self::From => (&["sender", "sender.parts"], &["sender_name"]),
            Self::To => (
                &[
                    "recipients",
                    "cc",
                    "bcc",
                    "recipients.parts",
                    "cc.parts",
                    "bcc.parts",
                ],
                &["recipient_names", "cc_names", "bcc_names"],
            ),
            Self::Cc => (&["cc", "cc.parts"], &["cc_names"]),
            Self::Bcc => (&["bcc", "bcc.parts"], &["bcc_names"]),
        }
    }
}

/// A word or phrase every hit must, or must not, match in one part of the
/// message, by the same rules as a search term.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailTextCondition {
    pub fields: EmailTextFields,
    pub text: String,
    pub exclude: bool,
}

/// A tag or provider label every hit's thread must, or must not, carry: any
/// of `labels` or of the tag options `tag_option_ids`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailLabelCondition {
    pub labels: Vec<String>,
    pub tag_option_ids: Vec<String>,
    pub exclude: bool,
}

/// A message's sent time, read as the unified sort reads it.
const SENT_AT_MILLIS: &str = "doc['sent_at_millis'].value.toInstant().toEpochMilli()";

/// Messages sent at or after `after_millis` and before `before_millis`; mail
/// with no sent time never matches. A range query on a date field fails the
/// whole request under the plain highlighter unified search uses (OpenSearch
/// 3.5), indexed or not, so the bounds are a script over the doc values.
fn sent_between_query<'a>(
    after_millis: Option<i64>,
    before_millis: Option<i64>,
) -> Option<QueryType<'a>> {
    if after_millis.is_none() && before_millis.is_none() {
        return None;
    }
    let mut conditions = vec!["doc['sent_at_millis'].size() > 0".to_string()];
    let mut params = serde_json::Map::new();
    if let Some(after) = after_millis {
        conditions.push(format!("{SENT_AT_MILLIS} >= params.after"));
        params.insert("after".to_string(), after.into());
    }
    if let Some(before) = before_millis {
        conditions.push(format!("{SENT_AT_MILLIS} < params.before"));
        params.insert("before".to_string(), before.into());
    }
    let script = Script::new(conditions.join(" && ")).params(serde_json::Value::Object(params));
    Some(ScriptQuery::new(script).into())
}

/// Matches `terms`, all of them, against the address fields by segment or
/// the text fields by prefix.
fn terms_query<'a>(
    terms: &'a [String],
    match_type: &str,
    keyword_fields: &'static [&'static str],
    text_fields: &'static [&'static str],
) -> QueryType<'a> {
    let mut combined = BoolQueryBuilder::new();
    combined.minimum_should_match(1);
    if !keyword_fields.is_empty() {
        combined.should(
            SimpleQueryStringQuery::new(
                build_keyword_query_string(terms, match_type),
                keyword_fields.iter().copied(),
            )
            .default_operator("AND")
            .into(),
        );
    }
    combined.should(text_terms_query(terms, match_type, text_fields));
    combined.build().into()
}

/// Matches `terms`, all of them, against the text fields. A partial term the
/// analyzer reads as several words (`follow-up`, `e-mail`) matches them
/// adjacent in one field, the last as a prefix, as the shared term builder
/// matches it ([`create_query`]): a `term*` prefix is not analyzed, so it
/// would look for one token `follow-up` the index never holds. Every other
/// term goes in the simple_query_string [`build_text_query_string`] builds.
fn text_terms_query<'a>(
    terms: &'a [String],
    match_type: &str,
    text_fields: &'static [&'static str],
) -> QueryType<'a> {
    let (several_words, others): (Vec<&String>, Vec<&String>) = terms
        .iter()
        .partition(|term| reads_as_several_words(term, match_type));
    let others = (!others.is_empty()).then(|| {
        let others: Vec<String> = others.into_iter().cloned().collect();
        QueryType::from(
            SimpleQueryStringQuery::new(
                build_text_query_string(&others, match_type),
                text_fields.iter().copied(),
            )
            .default_operator("AND"),
        )
    });
    if several_words.is_empty()
        && let Some(others) = others
    {
        return others;
    }

    let mut all = BoolQueryBuilder::new();
    if let Some(others) = others {
        all.must(others);
    }
    for term in several_words {
        let mut any_field = BoolQueryBuilder::new();
        any_field.minimum_should_match(1);
        for field in text_fields {
            any_field.should(create_query(CreateQueryParams {
                query_key: QueryKey::MatchPhrasePrefix,
                field,
                term,
            }));
        }
        all.must(any_field.build().into());
    }
    all.build().into()
}

/// Whether a partial `term` long enough to match as a prefix holds several
/// Unicode (UAX #29) words (`follow-up`, `AT&T`, `東京都`, and a Thai run,
/// which the tokenizer keeps as one token), as the shared term builder
/// decides. A phrase in quotes or an address already matches as a phrase in
/// [`build_text_query_string`], and a short term as its analyzed words. A
/// word UAX #29 keeps whole stays an uncapped prefix, even one the shared
/// term builder does not count as one, such as a Devanagari word with a
/// virama.
fn reads_as_several_words(term: &str, match_type: &str) -> bool {
    match_type == "partial"
        && !term.contains('@')
        && !term.contains(' ')
        && term.chars().count() >= MIN_PREFIX_LEN
        && term.unicode_words().nth(1).is_some()
}

/// Builds the simple_query_string over the email-address fields.
/// Single-word terms become `(term | term@*)` — an exact segment-token match
/// on the `.parts` sub-fields OR an exact-local-part match on the raw
/// address. The `term@*` pattern is redundant with `.parts` once the index
/// carries the sub-fields but keeps the query compatible with an index that
/// predates them. This deliberately does NOT use a trailing `*` on the bare
/// term, so partial segments don't leak across addresses (e.g. `ali` won't
/// match `alice@example.com` via this group).
/// Terms containing `@`, `.`, or spaces (quoted phrases from
/// `split_search_terms`) are wrapped in quotes to force phrase matching. On
/// the `.parts` sub-fields the `email_parts` analyzer splits such terms into
/// segment tokens, so the phrase requires an in-order adjacent run —
/// `mail.foo.com`, `foo.com`, and full addresses all match `x@mail.foo.com`,
/// but reordered or gapped segments don't. Without the quotes,
/// `default_operator: "AND"` would match each segment independently anywhere
/// in the field.
/// A term of one word with punctuation around it (`-lunch`) matches by that
/// word alone ([`one_word`]).
/// The email pattern is lowercased because email addresses are case-insensitive.
/// Terms are ANDed together with `+`.
fn build_keyword_query_string(terms: &[String], match_type: &str) -> String {
    terms
        .iter()
        .map(|term| {
            if term.contains('@') || term.contains('.') || term.contains(' ') {
                return format!("\"{}\"", escape_syntax(term, match_type));
            }
            let word = escape_syntax(one_word(term, match_type), match_type);
            format!("({} | {}@*)", word, word.to_lowercase())
        })
        .collect::<Vec<_>>()
        .join(" + ")
}

/// The word of a term that holds a single Unicode (UAX #29) word, without the
/// characters around it (`-lunch`, `(lunch`, `Re:`), or the whole term. A
/// prefix is not analyzed, so with them it would look for a token the index
/// never holds. Regexp input stays whole.
fn one_word<'a>(term: &'a str, match_type: &str) -> &'a str {
    let mut words = term.unicode_words();
    match (words.next(), words.next()) {
        (Some(word), None) if match_type != "regexp" => word,
        _ => term,
    }
}

/// `term` as literal text for a simple_query_string, which otherwise reads
/// punctuation in it as syntax: a leading `-` as NOT, so `-lunch` matched
/// every message whose addresses lack `lunch`, `|` as OR, `(` as a group and
/// `~2` as a fuzzy match. Regexp input keeps its punctuation, which is syntax
/// there.
fn escape_syntax(term: &str, match_type: &str) -> String {
    if match_type == "regexp" {
        return term.to_string();
    }
    let mut escaped = String::with_capacity(term.len());
    for c in term.chars() {
        if matches!(c, '+' | '|' | '-' | '"' | '*' | '(' | ')' | '~' | '\\') {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
}

/// Minimum prefix length before we emit a `term*` wildcard. Shorter prefixes
/// expand to too many unique tokens in the index and risk blowing past
/// `max_clause_count`. Under this threshold we fall back to exact token match.
const MIN_PREFIX_LEN: usize = 3;

/// Builds the simple_query_string over the text-analyzed fields.
/// Single-word terms become `term*` so a prefix like `scri` matches the
/// token `script` in subject/content/display-name fields. Terms shorter than
/// `MIN_PREFIX_LEN` fall back to a grouped exact-token match to keep term
/// expansion bounded. In `exact` match mode the prefix wildcard is dropped so
/// every single-word term is an exact-token match. Multi-word terms (quoted
/// phrases from `split_search_terms`) and `@`-containing terms are wrapped in
/// quotes to
/// force phrase matching — otherwise `default_operator: "AND"` would turn
/// `(reply test)` into `reply AND test` and match each token independently
/// anywhere in the field instead of as an adjacent phrase.
///
/// A term that is one word with punctuation around it (`follow-`, `Re:`,
/// `-lunch`) matches by that word alone ([`one_word`]), as
/// [`child_content_query`](super::query::child_content_query) does.
fn build_text_query_string(terms: &[String], match_type: &str) -> String {
    let exact = match_type == "exact";
    terms
        .iter()
        .map(|term| {
            if term.contains('@') || term.contains(' ') {
                return format!("\"{}\"", escape_syntax(term, match_type));
            }
            let word = one_word(term, match_type);
            let literal = escape_syntax(word, match_type);
            if exact || word.chars().count() < MIN_PREFIX_LEN {
                format!("({})", literal)
            } else {
                format!("{}*", literal)
            }
        })
        .collect::<Vec<_>>()
        .join(" + ")
}

pub(crate) struct EmailQueryBuilder {
    inner: SearchQueryBuilder<EmailSearchConfig>,
    /// Threads every hit must belong to, on top of the access filter
    required_thread_ids: Vec<String>,
    /// link ids to query over
    link_ids: Vec<String>,
    /// Links whose mail never matches, such as a mailbox being disconnected
    /// whose documents are not deleted yet
    exclude_link_ids: Vec<String>,
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
    /// Tag option ids the thread must carry (definition-agnostic)
    tag_option_ids: Vec<String>,
    /// Whether the thread must carry every tag option id instead of any
    match_all_tags: bool,
    /// Words or phrases matched against one part of each message
    text_conditions: Vec<EmailTextCondition>,
    /// Tags or labels each hit's thread must, or must not, carry
    label_conditions: Vec<EmailLabelCondition>,
    /// Threads no hit may belong to
    exclude_thread_ids: Vec<String>,
    /// Only messages sent at or after this time, in epoch milliseconds
    sent_after_millis: Option<i64>,
    /// Only messages sent before this time, in epoch milliseconds
    sent_before_millis: Option<i64>,
}

impl EmailQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
            required_thread_ids: Vec::new(),
            link_ids: Vec::new(),
            exclude_link_ids: Vec::new(),
            sender: Vec::new(),
            cc: Vec::new(),
            bcc: Vec::new(),
            recipients: Vec::new(),
            include_labels: Vec::new(),
            exclude_labels: Vec::new(),
            importance: None,
            subject_only: false,
            tag_option_ids: Vec::new(),
            match_all_tags: false,
            text_conditions: Vec::new(),
            label_conditions: Vec::new(),
            exclude_thread_ids: Vec::new(),
            sent_after_millis: None,
            sent_before_millis: None,
        }
    }

    // Copy function signature from SearchQueryBuilder
    delegate_methods! {
        fn match_type(match_type: &str) -> Self;
        fn page(page: u32) -> Self;
        fn page_size(page_size: u32) -> Self;
        fn user_id(user_id: &str) -> Self;
        fn user_ids(user_ids: Vec<String>) -> Self;
        fn collapse(collapse: bool) -> Self;
        fn ids(ids: Vec<String>) -> Self;
        fn ids_only(ids_only: bool) -> Self;
    }

    pub fn required_thread_ids(mut self, required_thread_ids: Vec<String>) -> Self {
        self.required_thread_ids = required_thread_ids;
        self
    }

    pub fn link_ids(mut self, link_ids: Vec<String>) -> Self {
        self.link_ids = link_ids;
        self
    }

    pub fn exclude_link_ids(mut self, exclude_link_ids: Vec<String>) -> Self {
        self.exclude_link_ids = exclude_link_ids;
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

    pub fn tag_option_ids(mut self, tag_option_ids: Vec<String>) -> Self {
        self.tag_option_ids = tag_option_ids;
        self
    }

    pub fn match_all_tags(mut self, match_all_tags: bool) -> Self {
        self.match_all_tags = match_all_tags;
        self
    }

    pub fn text_conditions(mut self, text_conditions: Vec<EmailTextCondition>) -> Self {
        self.text_conditions = text_conditions;
        self
    }

    pub fn label_conditions(mut self, label_conditions: Vec<EmailLabelCondition>) -> Self {
        self.label_conditions = label_conditions;
        self
    }

    pub fn exclude_thread_ids(mut self, exclude_thread_ids: Vec<String>) -> Self {
        self.exclude_thread_ids = exclude_thread_ids;
        self
    }

    pub fn sent_between(mut self, after_millis: Option<i64>, before_millis: Option<i64>) -> Self {
        self.sent_after_millis = after_millis;
        self.sent_before_millis = before_millis;
        self
    }

    pub fn build_bool_query<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        // A search of typed conditions alone (`is:unread`, `from:ana`) has no
        // terms, so it carries only the filters below.
        let mut content_bool_query = if self.inner.terms.is_empty() {
            self.inner.build_access_bool_query()?
        } else {
            self.inner.build_content_bool_query()?
        };

        // In subject_only mode (name search), replace with a match on TITLE_KEY (subject).
        // Otherwise replace with simple_query_string across all email fields.
        if self.subject_only && !self.inner.terms.is_empty() {
            let title_query = self.inner.build_title_term_query()?;
            let mut inner = BoolQueryBuilder::new();
            inner.minimum_should_match(1);
            inner.should(title_query);
            content_bool_query.set_must(inner.build().into());
        } else if !self.inner.terms.is_empty() {
            content_bool_query.set_must(terms_query(
                &self.inner.terms,
                &self.inner.match_type,
                EMAIL_KEYWORD_FIELDS,
                EMAIL_TEXT_FIELDS,
            ));
        }

        // A condition that must match scores and highlights like a term; one
        // that must not leaves its messages out.
        for condition in &self.text_conditions {
            let (keyword_fields, text_fields) = condition.fields.fields();
            let query = terms_query(
                std::slice::from_ref(&condition.text),
                &self.inner.match_type,
                keyword_fields,
                text_fields,
            );
            if condition.exclude {
                content_bool_query.must_not(query);
            } else {
                content_bool_query.must(query);
            }
        }

        for condition in &self.label_conditions {
            let mut carries = BoolQueryBuilder::new();
            carries.minimum_should_match(1);
            if !condition.labels.is_empty() {
                carries.should(QueryType::terms("labels", condition.labels.clone()));
            }
            if let Some(tags) = build_tag_filter(&condition.tag_option_ids, false) {
                carries.should(tags);
            }
            if condition.exclude {
                if !condition.labels.is_empty() || !condition.tag_option_ids.is_empty() {
                    content_bool_query.must_not(QueryType::Bool(carries.build()));
                }
            } else {
                content_bool_query.filter(QueryType::Bool(carries.build()));
            }
        }

        if !self.exclude_thread_ids.is_empty() {
            content_bool_query.must_not(QueryType::terms(
                "entity_id",
                self.exclude_thread_ids.clone(),
            ));
        }

        if let Some(sent) = sent_between_query(self.sent_after_millis, self.sent_before_millis) {
            content_bool_query.filter(sent);
        }

        // CUSTOM ATTRIBUTES SECTION
        if !self.required_thread_ids.is_empty() {
            content_bool_query.filter(QueryType::terms(
                "entity_id",
                self.required_thread_ids.clone(),
            ));
        }

        // If link_ids are provided, add them to the query
        if !self.link_ids.is_empty() {
            content_bool_query.filter(QueryType::terms("link_id", self.link_ids.clone()));
        }

        if !self.exclude_link_ids.is_empty() {
            content_bool_query.must_not(QueryType::terms("link_id", self.exclude_link_ids.clone()));
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

        // Tag filter: nested clause(s) matching the option ids in
        // `properties.values`. Thread-level properties are denormalized onto
        // every message doc, so filtering per doc filters the thread.
        if let Some(nested) = build_tag_filter(&self.tag_option_ids, self.match_all_tags) {
            content_bool_query.filter(nested);
        }

        for label in &self.exclude_labels {
            content_bool_query.must_not(QueryType::term("labels", label.clone()));
        }

        // Importance filter. Source of truth for the label logic is in
        // email/src/outbound/email_pg_repo/dynamic.rs (EmailLiteral::Importance).
        // Macro's own notification emails are always noise on top of that.
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
                content_bool_query.must_not(macro_notification_sender_query());
            }
            Some(false) => {
                // Only show deprioritized emails: must have a depriority label
                // AND must not have a priority label, or come from Macro's
                // own notification sender.
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
                let noise_filter = BoolQuery::new()
                    .should(QueryType::Bool(depriority_filter))
                    .should(macro_notification_sender_query())
                    .minimum_should_match(1);
                content_bool_query.filter(QueryType::Bool(noise_filter));
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
    /// The sent at time of the email message, in milliseconds
    #[serde(default)]
    pub sent_at_millis: Option<i64>,
}

pub struct EmailSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub user_ids: Vec<String>,
    pub thread_ids: Vec<String>,
    pub required_thread_ids: Vec<String>,
    pub link_ids: Vec<String>,
    pub exclude_link_ids: Vec<String>,
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
    pub tag_option_ids: Vec<String>,
    pub match_all_tags: bool,
    pub text_conditions: Vec<EmailTextCondition>,
    pub label_conditions: Vec<EmailLabelCondition>,
    pub exclude_thread_ids: Vec<String>,
    pub sent_after_millis: Option<i64>,
    pub sent_before_millis: Option<i64>,
}

impl From<EmailSearchArgs> for EmailQueryBuilder {
    fn from(args: EmailSearchArgs) -> Self {
        EmailQueryBuilder::new(args.terms)
            .match_type(&args.match_type)
            .page_size(args.page_size)
            .page(args.page)
            .user_id(&args.user_id)
            .user_ids(args.user_ids)
            .ids(args.thread_ids)
            .required_thread_ids(args.required_thread_ids)
            .link_ids(args.link_ids)
            .exclude_link_ids(args.exclude_link_ids)
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
            .tag_option_ids(args.tag_option_ids)
            .match_all_tags(args.match_all_tags)
            .text_conditions(args.text_conditions)
            .label_conditions(args.label_conditions)
            .exclude_thread_ids(args.exclude_thread_ids)
            .sent_between(args.sent_after_millis, args.sent_before_millis)
    }
}

#[cfg(test)]
mod test;
