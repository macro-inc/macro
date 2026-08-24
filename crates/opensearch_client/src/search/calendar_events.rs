use crate::{
    Result, delegate_methods,
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        properties::build_tag_filter,
    },
};

use models_opensearch::OpenSearchEntityType;
use opensearch_query_builder::{BoolQueryBuilder, QueryType};

#[derive(Clone)]
pub(crate) struct CalendarEventSearchConfig;

impl SearchQueryConfig for CalendarEventSearchConfig {
    const USER_ID_KEY: Option<&'static str> = Some("owner_id");
    const TITLE_KEY: &'static str = "name";
    const ENTITY_INDEX: OpenSearchEntityType = OpenSearchEntityType::CalendarEvents;
}

/// Query builder for the flat calendar events index.
///
/// One doc per **series master**: recurring instances are query projections
/// materialized only inside a rolling window, so indexing them individually
/// would bound a recurring event's searchability to that slice and flood
/// results with near-identical rows. The relevant occurrence is resolved at
/// enrichment time instead.
///
/// Calendar events carry no indexed content, so every mode matches terms
/// against `name` alone. Access mirrors the soup predicate: `owner_id ==
/// caller` or the event's `source_link_id` is one of the caller's delegated
/// inbox links.
pub(crate) struct CalendarEventQueryBuilder {
    inner: SearchQueryBuilder<CalendarEventSearchConfig>,
    link_ids: Vec<String>,
    statuses: Vec<String>,
    organizer_emails: Vec<String>,
    attendee_emails: Vec<String>,
    tag_option_ids: Vec<String>,
    match_all_tags: bool,
}

impl CalendarEventQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
            link_ids: Vec::new(),
            statuses: Vec::new(),
            organizer_emails: Vec::new(),
            attendee_emails: Vec::new(),
            tag_option_ids: Vec::new(),
            match_all_tags: false,
        }
    }

    /// Inbox links the caller may read through delegation. Combined with
    /// `owner_id` as an OR, so a delegate finds events on inboxes they were
    /// granted without owning the projection row.
    pub fn link_ids(mut self, link_ids: Vec<String>) -> Self {
        self.link_ids = link_ids;
        self
    }

    pub fn statuses(mut self, statuses: Vec<String>) -> Self {
        self.statuses = statuses;
        self
    }

    pub fn organizer_emails(mut self, organizer_emails: Vec<String>) -> Self {
        self.organizer_emails = organizer_emails;
        self
    }

    pub fn attendee_emails(mut self, attendee_emails: Vec<String>) -> Self {
        self.attendee_emails = attendee_emails;
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

    pub fn build_bool_query<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        let mut bool_query = BoolQueryBuilder::new();

        // Only search on the calendar events alias.
        bool_query.filter(QueryType::term(
            "_index",
            CalendarEventSearchConfig::ENTITY_INDEX
                .index_name()
                .to_string(),
        ));

        // Access control. `ids_only` means the caller already resolved an
        // explicit id set, so the shared builder's id filter is authoritative
        // and the link/owner clause would only narrow it further.
        if self.inner.ids_only {
            bool_query.filter(
                self.inner
                    .build_filter_query(CalendarEventSearchConfig::USER_ID_KEY)?,
            );
        } else {
            // An event is visible when the caller owns the projection or the
            // event's source link is delegated to them. Two disjoint fields,
            // so this cannot go through `build_filter_query` — that ORs a
            // single user-id field against an entity-id list.
            let mut access = BoolQueryBuilder::new();
            access.minimum_should_match(1);
            access.should(QueryType::term(
                CalendarEventSearchConfig::USER_ID_KEY
                    .expect("calendar events declare a user id key")
                    .to_string(),
                self.inner.user_id.clone(),
            ));
            if !self.link_ids.is_empty() {
                access.should(QueryType::terms("source_link_id", self.link_ids.clone()));
            }
            bool_query.filter(access.build().into());

            // An explicit id list narrows within what the caller can see.
            if !self.inner.ids.is_empty() {
                bool_query.filter(QueryType::terms("entity_id", self.inner.ids.clone()));
            }
        }

        if !self.statuses.is_empty() {
            bool_query.filter(QueryType::terms("status", self.statuses.clone()));
        }

        if !self.organizer_emails.is_empty() {
            bool_query.filter(QueryType::terms(
                "organizer_email",
                self.organizer_emails.clone(),
            ));
        }

        if !self.attendee_emails.is_empty() {
            bool_query.filter(QueryType::terms(
                "attendee_emails",
                self.attendee_emails.clone(),
            ));
        }

        // Tag filter: nested clause(s) matching the option ids in
        // `properties.values`, with no definition_id constraint.
        if let Some(nested) = build_tag_filter(&self.tag_option_ids, self.match_all_tags) {
            bool_query.filter(nested);
        }

        // Title match: every term must match the event title.
        bool_query.must(self.inner.build_title_term_query()?);

        Ok(bool_query)
    }
}

/// The `_source` fields of a calendar event doc as returned by search.
///
/// `source_link_id` and `ical_uid` are deliberately required, not optional.
/// [`super::unified::UnifiedSearchIndex`] is an untagged enum, so a variant
/// matches on doc shape alone; both fields are NOT NULL in Postgres and
/// unique to calendar docs, which keeps this variant from swallowing another
/// index's hits regardless of where it sits in the variant order.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct CalendarEventIndex {
    pub entity_id: uuid::Uuid,
    /// The series title, indexed as `name` so it sits in the shared unified
    /// highlight field list alongside every other entity's title field.
    pub name: String,
    pub owner_id: String,
    pub source_link_id: String,
    pub ical_uid: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub is_recurring: bool,
    #[serde(default)]
    pub starts_at_millis: Option<i64>,
    #[serde(default)]
    pub ends_at_millis: Option<i64>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub updated_at_millis: Option<i64>,
}

#[derive(Debug, Default)]
pub struct CalendarEventSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub calendar_event_ids: Vec<String>,
    pub link_ids: Vec<String>,
    pub statuses: Vec<String>,
    pub organizer_emails: Vec<String>,
    pub attendee_emails: Vec<String>,
    pub page: u32,
    pub page_size: u32,
    pub match_type: String,
    pub collapse: bool,
    pub ids_only: bool,
    pub tag_option_ids: Vec<String>,
    pub match_all_tags: bool,
}

impl From<CalendarEventSearchArgs> for CalendarEventQueryBuilder {
    fn from(args: CalendarEventSearchArgs) -> Self {
        CalendarEventQueryBuilder::new(args.terms)
            .match_type(&args.match_type)
            .page_size(args.page_size)
            .page(args.page)
            .user_id(&args.user_id)
            .ids(args.calendar_event_ids)
            .link_ids(args.link_ids)
            .statuses(args.statuses)
            .organizer_emails(args.organizer_emails)
            .attendee_emails(args.attendee_emails)
            .collapse(args.collapse)
            .ids_only(args.ids_only)
            .tag_option_ids(args.tag_option_ids)
            .match_all_tags(args.match_all_tags)
    }
}

#[cfg(test)]
mod test;
