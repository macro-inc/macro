//! The lanes each pass runs, in load order ("Load order" in
//! `docs/architecture/streamed-cache-sync.md`), with their queries and first
//! inputs. A lane's id names its saved state in the client's cache, and its
//! operation name is what the cache's projections check (a `SoupBackfill…`
//! page must carry complete rows), so keep both when changing a lane.

#[cfg(test)]
mod test;

use chrono::{DateTime, TimeDelta, Utc};
use graphql_soup_filter_input::{
    GraphqlCalendarEventLiteral, GraphqlCallLiteral, GraphqlChannelLiteral,
    GraphqlChannelThreadLiteral, GraphqlChatExpr, GraphqlChatLiteral, GraphqlCrmCompanyLiteral,
    GraphqlCrmContactExpr, GraphqlCrmContactLiteral, GraphqlDateLiteral, GraphqlDocumentExpr,
    GraphqlDocumentLiteral, GraphqlDocumentSubType, GraphqlEmailExpr, GraphqlEmailFilterAst,
    GraphqlEmailLiteral, GraphqlEntityFilterAst as Filters, GraphqlForeignEntityLiteral,
    GraphqlInitiativeLiteral, GraphqlProjectExpr, GraphqlProjectLiteral, GraphqlSharedEmailFilter,
};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::calendar::iso_instant;
use crate::lane::PageBudget;

/// Items per hydrate page: Soup's maximum, as streaming has no round trip
/// per page.
const HYDRATE_PAGE: u32 = 500;
/// Threads per email-content page, each with its first
/// [`EMAIL_CONTENT_MESSAGES`]. 200 threads keep a page near half a second of
/// server time for large mailboxes.
const EMAIL_CONTENT_PAGE: u32 = 200;
/// Messages per thread the email-content lane's document asks for.
const EMAIL_CONTENT_MESSAGES: u32 = 20;
/// Items per ID-list page.
const MEMBERSHIP_PAGE: u32 = 500;
/// Occurrences per calendar page.
pub(crate) const CALENDAR_PAGE: u32 = 2_000;
const DOCUMENTS_RECENT_MAX_ITEMS: u32 = 1_000;
const EMAIL_OLDER_MAX_ITEMS: u32 = 10_000;
const EMAIL_RECENT_DAYS: i64 = 60;
const EMAIL_OLDER_DAYS: i64 = 365;
const EMAIL_CONTENT_DAYS: i64 = 30;
/// Shared threads: important ones from 90 days, the rest from 30.
const SHARED_EMAIL_WINDOWS: [EmailWindow; 2] = [
    EmailWindow {
        important: Some(true),
        days: 90,
    },
    EmailWindow {
        important: Some(false),
        days: 30,
    },
];
const CALENDAR_NEAR_MONTHS: u32 = 2;
const CALENDAR_FAR_MONTHS: u32 = 12;
/// The id no entity has: a filter on it leaves its Soup branch out.
const EXCLUDED_ENTITY_ID: &str = "00000000-0000-0000-0000-000000000000";

/// One of the sync's passes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, strum::IntoStaticStr)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum Pass {
    /// What the app needs to filter and show lists locally, in one stream.
    First,
    /// Everything else, in streams of limited size.
    Second,
}

/// A lane of a pass.
pub(crate) enum LaneSpec {
    Soup(SoupLaneSpec),
    /// Calendar windows from the client's coverage gaps, nearest month first.
    Calendar {
        id_prefix: &'static str,
        months: u32,
    },
}

/// A Soup-paged lane before saved state picks its variables.
pub(crate) struct SoupLaneSpec {
    pub(crate) id: &'static str,
    pub(crate) query: &'static LaneQuery,
    /// The first page's `initial` input of a pass started at the given time.
    pub(crate) input: fn(DateTime<Utc>) -> LaneInput,
    pub(crate) kind: SoupLaneKind,
    /// A full pass every run: never resumed, never narrowed to changes.
    pub(crate) restart_on_run: bool,
    pub(crate) max_items: Option<u32>,
    /// What each page may load.
    pub(crate) budget: PageBudget,
}

/// What the cache does with a Soup lane's pages.
pub(crate) enum SoupLaneKind {
    Hydrate,
    /// An ID listing authoritative for these lanes' members.
    Membership(&'static [&'static str]),
}

/// Email threads updated within `days`, of one importance or any.
struct EmailWindow {
    important: Option<bool>,
    days: i64,
}

/// A lane query: the operation a lane runs and what the client's cache
/// requires of its pages.
///
/// The client sends the operation's document with the request (its own
/// field selection, which its cache schema knows); the server picks the
/// lanes, their inputs and their order. The cache chooses its requirements
/// by operation name (`soup_filter_cache_adapter::backfill_requirements`),
/// native apps already shipped included, so an operation keeps its name once
/// a lane runs it. The adapter's tests compare every query here with what the
/// cache does.
#[derive(Debug)]
pub struct LaneQuery {
    /// The operation the lane runs.
    pub operation: &'static str,
    /// The cache refuses a page with a row lacking a required projection.
    pub complete_projections: bool,
    /// The cache refuses a page with an incomplete property projection.
    pub complete_properties: bool,
}

impl LaneQuery {
    const fn new(operation: &'static str) -> Self {
        Self {
            operation,
            complete_projections: false,
            complete_properties: false,
        }
    }

    /// Rows with every projection the cache's local filtering needs.
    const fn complete_rows(self) -> Self {
        Self {
            complete_projections: true,
            ..self
        }
    }

    /// Complete property projections too.
    const fn complete_properties(self) -> Self {
        Self {
            complete_properties: true,
            ..self
        }
    }
}

const CHANNELS_QUERY: LaneQuery = LaneQuery::new("SoupBackfillSyncChannels").complete_rows();
const CHANNEL_IDS_QUERY: LaneQuery = LaneQuery::new("SoupSyncChannelIds");
const MINIMAL_TASKS_QUERY: LaneQuery = LaneQuery::new("SoupBackfillSyncTasks").complete_rows();
const MINIMAL_DOCUMENTS_QUERY: LaneQuery =
    LaneQuery::new("SoupBackfillSyncDocuments").complete_rows();
const SOUP_BACKFILL_QUERY: LaneQuery = LaneQuery::new("SoupBackfill")
    .complete_rows()
    .complete_properties();
const SOUP_MAIL_BACKFILL_QUERY: LaneQuery =
    LaneQuery::new("SoupMailBackfill").complete_properties();
const CRM_CONTACTS_QUERY: LaneQuery = LaneQuery::new("CrmContacts");
const TASK_IDS_QUERY: LaneQuery = LaneQuery::new("SoupSyncTaskIds");
const TASK_PROJECT_IDS_QUERY: LaneQuery = LaneQuery::new("SoupSyncTaskProjectIds");
const DOCUMENT_IDS_QUERY: LaneQuery = LaneQuery::new("SoupSyncDocumentIds");
const SHARED_EMAIL_IDS_QUERY: LaneQuery = LaneQuery::new("SoupSyncSharedEmailIds");
/// Calendar windows' query.
pub(crate) const CALENDAR_QUERY: LaneQuery = LaneQuery::new("CalendarOccurrences");

/// Every query a lane runs.
pub const LANE_QUERIES: &[&LaneQuery] = &[
    &CHANNELS_QUERY,
    &CHANNEL_IDS_QUERY,
    &MINIMAL_TASKS_QUERY,
    &MINIMAL_DOCUMENTS_QUERY,
    &SOUP_BACKFILL_QUERY,
    &SOUP_MAIL_BACKFILL_QUERY,
    &CRM_CONTACTS_QUERY,
    &TASK_IDS_QUERY,
    &TASK_PROJECT_IDS_QUERY,
    &DOCUMENT_IDS_QUERY,
    &SHARED_EMAIL_IDS_QUERY,
    &CALENDAR_QUERY,
];

const TASKS: &str = "tasks";
const TASK_PROJECTS: &str = "task-projects";
const CHANNELS: &str = "channels";
const DOCUMENTS_RECENT: &str = "documents-recent";
const DOCUMENTS_REST: &str = "documents-rest";
const EMAIL_SHARED: &str = "email-shared";

/// The pass's lanes, in load order.
pub(crate) fn lane_specs(pass: Pass) -> Vec<LaneSpec> {
    match pass {
        Pass::First => first_pass(),
        Pass::Second => second_pass(),
    }
}

fn first_pass() -> Vec<LaneSpec> {
    vec![
        // The small, app-wide channel list (mentions, sharing, names) comes
        // first. It has no "changed since" filter, and joining a channel need
        // not change a timestamp, so it is listed in full every run. Contacts
        // are not a lane: the app's contact directory backfill keeps them.
        LaneSpec::Soup(SoupLaneSpec {
            id: CHANNELS,
            query: &CHANNELS_QUERY,
            input: |_| channels_input(),
            kind: SoupLaneKind::Hydrate,
            restart_on_run: true,
            max_items: None,
            budget: PageBudget::Operation,
        }),
        LaneSpec::Soup(SoupLaneSpec {
            id: TASKS,
            query: &MINIMAL_TASKS_QUERY,
            input: |_| rows(task_filters(), "UPDATED_AT", HYDRATE_PAGE),
            kind: SoupLaneKind::Hydrate,
            restart_on_run: false,
            max_items: None,
            budget: PageBudget::Operation,
        }),
        // Project chips answer from these records once the lane completed.
        LaneSpec::Soup(SoupLaneSpec {
            id: TASK_PROJECTS,
            query: &SOUP_BACKFILL_QUERY,
            input: |_| rows(task_project_filters(), "VIEWED_UPDATED", HYDRATE_PAGE),
            kind: SoupLaneKind::Hydrate,
            restart_on_run: false,
            max_items: None,
            budget: PageBudget::Operation,
        }),
        LaneSpec::Soup(SoupLaneSpec {
            id: "email-recent",
            query: &SOUP_MAIL_BACKFILL_QUERY,
            input: |now| mail_rows(EMAIL_RECENT_DAYS, HYDRATE_PAGE, now),
            kind: SoupLaneKind::Hydrate,
            restart_on_run: false,
            max_items: None,
            budget: PageBudget::Operation,
        }),
        // Shared threads, both windows, refreshed in full every run;
        // `email-shared-ids` reconciles the scope.
        LaneSpec::Soup(SoupLaneSpec {
            id: EMAIL_SHARED,
            query: &SOUP_MAIL_BACKFILL_QUERY,
            input: |now| {
                with_email_recency(
                    email_rows(shared_email_filters(), HYDRATE_PAGE),
                    &SHARED_EMAIL_WINDOWS,
                    now,
                )
            },
            kind: SoupLaneKind::Hydrate,
            restart_on_run: true,
            max_items: None,
            budget: PageBudget::Operation,
        }),
        LaneSpec::Soup(SoupLaneSpec {
            id: DOCUMENTS_RECENT,
            query: &MINIMAL_DOCUMENTS_QUERY,
            input: |_| rows(document_filters(), "VIEWED_UPDATED", HYDRATE_PAGE),
            kind: SoupLaneKind::Hydrate,
            restart_on_run: false,
            max_items: Some(DOCUMENTS_RECENT_MAX_ITEMS),
            budget: PageBudget::Operation,
        }),
        LaneSpec::Calendar {
            id_prefix: "calendar-near",
            months: CALENDAR_NEAR_MONTHS,
        },
        // ID scans sort by creation, which never changes mid-scan, so a
        // moving row cannot be missed and then deleted.
        ids_lane(
            "tasks-ids",
            &TASK_IDS_QUERY,
            |_| rows(task_filters(), "CREATED_AT", MEMBERSHIP_PAGE),
            &[TASKS],
        ),
        // A project deleted or no longer shared leaves the cache, so a chip
        // answered from it cannot outlive the viewer's access.
        ids_lane(
            "task-projects-ids",
            &TASK_PROJECT_IDS_QUERY,
            |_| rows(task_project_filters(), "CREATED_AT", MEMBERSHIP_PAGE),
            &[TASK_PROJECTS],
        ),
        ids_lane(
            "channels-ids",
            &CHANNEL_IDS_QUERY,
            |_| rows(channel_filters(), "CREATED_AT", MEMBERSHIP_PAGE),
            &[CHANNELS],
        ),
        ids_lane(
            "documents-ids",
            &DOCUMENT_IDS_QUERY,
            |_| rows(document_filters(), "CREATED_AT", MEMBERSHIP_PAGE),
            &[DOCUMENTS_RECENT, DOCUMENTS_REST],
        ),
        // Every shared thread, not only the windows: a delivered thread is
        // deleted only once it is no longer shared with the viewer.
        ids_lane(
            "email-shared-ids",
            &SHARED_EMAIL_IDS_QUERY,
            |_| rows(shared_email_filters(), "CREATED_AT", MEMBERSHIP_PAGE),
            &[EMAIL_SHARED],
        ),
    ]
}

fn second_pass() -> Vec<LaneSpec> {
    vec![
        hydrate_lane("crm-contacts", &CRM_CONTACTS_QUERY, |_| {
            crm_contacts_input()
        }),
        // Core entities except documents and tasks (their own lanes), plus
        // CRM companies and foreign entities.
        hydrate_lane("core-rest", &SOUP_BACKFILL_QUERY, |_| {
            rows(core_rest_filters(), "VIEWED_UPDATED", HYDRATE_PAGE)
        }),
        hydrate_lane(DOCUMENTS_REST, &MINIMAL_DOCUMENTS_QUERY, |_| {
            rows(document_filters(), "VIEWED_UPDATED", HYDRATE_PAGE)
        }),
        LaneSpec::Calendar {
            id_prefix: "calendar-far",
            months: CALENDAR_FAR_MONTHS,
        },
        LaneSpec::Soup(SoupLaneSpec {
            max_items: Some(EMAIL_OLDER_MAX_ITEMS),
            ..soup_hydrate("email-older", &SOUP_MAIL_BACKFILL_QUERY, |now| {
                mail_rows(EMAIL_OLDER_DAYS, HYDRATE_PAGE, now)
            })
        }),
        hydrate_lane("tasks-details", &SOUP_BACKFILL_QUERY, |_| {
            rows(task_filters(), "UPDATED_AT", HYDRATE_PAGE)
        }),
        LaneSpec::Soup(SoupLaneSpec {
            max_items: Some(DOCUMENTS_RECENT_MAX_ITEMS),
            ..soup_hydrate("documents-details", &SOUP_BACKFILL_QUERY, |_| {
                rows(document_filters(), "VIEWED_UPDATED", HYDRATE_PAGE)
            })
        }),
        // Threads with their first message page, the one lane whose pages
        // load more email content than one GraphQL operation may.
        LaneSpec::Soup(SoupLaneSpec {
            budget: PageBudget::EmailContent {
                threads: EMAIL_CONTENT_PAGE,
                messages: EMAIL_CONTENT_PAGE * EMAIL_CONTENT_MESSAGES,
            },
            ..soup_hydrate("email-content", &SOUP_BACKFILL_QUERY, |now| {
                mail_rows(EMAIL_CONTENT_DAYS, EMAIL_CONTENT_PAGE, now)
            })
        }),
    ]
}

fn soup_hydrate(
    id: &'static str,
    query: &'static LaneQuery,
    input: fn(DateTime<Utc>) -> LaneInput,
) -> SoupLaneSpec {
    SoupLaneSpec {
        id,
        query,
        input,
        kind: SoupLaneKind::Hydrate,
        restart_on_run: false,
        max_items: None,
        budget: PageBudget::Operation,
    }
}

fn hydrate_lane(
    id: &'static str,
    query: &'static LaneQuery,
    input: fn(DateTime<Utc>) -> LaneInput,
) -> LaneSpec {
    LaneSpec::Soup(soup_hydrate(id, query, input))
}

fn ids_lane(
    id: &'static str,
    query: &'static LaneQuery,
    input: fn(DateTime<Utc>) -> LaneInput,
    scopes: &'static [&'static str],
) -> LaneSpec {
    LaneSpec::Soup(SoupLaneSpec {
        kind: SoupLaneKind::Membership(scopes),
        ..soup_hydrate(id, query, input)
    })
}

/// A Soup lane's first input (GraphQL `SoupInput`). Its filters are the
/// GraphQL filter input types the server parses
/// (`graphql_soup_filter_input`), so a lane can only name filter fields and
/// values that exist.
pub(crate) struct LaneInput {
    limit: u32,
    expand: Option<bool>,
    sort_method: &'static str,
    email_view: Option<&'static str>,
    filters: Filters,
}

impl LaneInput {
    /// The input as the lane's `initial` variable: absent fields left out,
    /// as GraphQL clients send them.
    pub(crate) fn to_json(&self) -> Result<Map<String, Value>, serde_json::Error> {
        let mut input = Map::new();
        input.insert("limit".to_owned(), Value::from(self.limit));
        if let Some(expand) = self.expand {
            input.insert("expand".to_owned(), Value::Bool(expand));
        }
        input.insert(
            "sortMethod".to_owned(),
            Value::String(self.sort_method.to_owned()),
        );
        if let Some(view) = self.email_view {
            input.insert("emailView".to_owned(), Value::String(view.to_owned()));
        }
        input.insert(
            "filters".to_owned(),
            without_nulls(serde_json::to_value(&self.filters)?),
        );
        Ok(input)
    }
}

/// `value` without object fields whose value is null: the filter input types
/// serialize an absent option as null.
fn without_nulls(value: Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .filter(|(_, value)| !value.is_null())
                .map(|(key, value)| (key, without_nulls(value)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(without_nulls).collect()),
        other => other,
    }
}

/// The id no entity has, as whichever id type the filter input uses.
fn excluded_id<I: From<&'static str>>() -> I {
    I::from(EXCLUDED_ENTITY_ID)
}

/// The email filter with this thread tree.
fn email_tree(tree: GraphqlEmailExpr) -> GraphqlEmailFilterAst {
    GraphqlEmailFilterAst {
        tree: Some(tree),
        ..GraphqlEmailFilterAst::default()
    }
}

fn excluded_email() -> GraphqlEmailFilterAst {
    email_tree(GraphqlEmailLiteral::ThreadId(excluded_id()).into())
}

/// The Soup branches other than email, each excluded.
fn non_email_excluded() -> Filters {
    Filters {
        calendar_event_filter: Some(GraphqlCalendarEventLiteral::Id(excluded_id()).into()),
        document_filter: Some(GraphqlDocumentLiteral::Id(excluded_id()).into()),
        project_filter: Some(GraphqlProjectLiteral::ProjectIdSelf(excluded_id()).into()),
        chat_filter: Some(GraphqlChatLiteral::ChatId(excluded_id()).into()),
        channel_filter: Some(GraphqlChannelLiteral::ChannelId(excluded_id()).into()),
        channel_thread_filter: Some(GraphqlChannelThreadLiteral::ThreadId(excluded_id()).into()),
        call_filter: Some(GraphqlCallLiteral::CallId(excluded_id()).into()),
        crm_company_filter: Some(GraphqlCrmCompanyLiteral::Id(excluded_id()).into()),
        foreign_entity_filter: Some(GraphqlForeignEntityLiteral::Id(excluded_id()).into()),
        ..Filters::default()
    }
}

/// Every Soup branch excluded; a lane's filter then includes its own.
fn excluded_filters() -> Filters {
    Filters {
        email_filter: Some(excluded_email()),
        ..non_email_excluded()
    }
}

fn task_subtype() -> GraphqlDocumentExpr {
    GraphqlDocumentLiteral::SubType(GraphqlDocumentSubType::Task).into()
}

fn task_filters() -> Filters {
    Filters {
        document_filter: Some(task_subtype()),
        ..excluded_filters()
    }
}

fn document_filters() -> Filters {
    Filters {
        document_filter: Some(!task_subtype()),
        ..excluded_filters()
    }
}

/// Every task project the viewer can read.
fn task_project_filters() -> Filters {
    Filters {
        initiative_filter: Some(GraphqlInitiativeLiteral::Include(true).into()),
        ..excluded_filters()
    }
}

/// Channels with no channel filter: Soup then lists the channels the viewer
/// actively takes part in.
fn channel_filters() -> Filters {
    Filters {
        channel_filter: None,
        ..excluded_filters()
    }
}

/// Every thread shared with the viewer, outside the owned and delegated inboxes.
fn shared_email_filters() -> Filters {
    Filters {
        email_filter: Some(email_tree(
            GraphqlEmailLiteral::Shared(GraphqlSharedEmailFilter::Only).into(),
        )),
        ..non_email_excluded()
    }
}

/// Visible CRM contacts.
fn crm_contact_filters() -> Filters {
    Filters {
        crm_contact_filter: Some(GraphqlCrmContactExpr::and(
            GraphqlCrmContactLiteral::Hidden(false).into(),
            GraphqlCrmContactLiteral::Include(true).into(),
        )),
        ..excluded_filters()
    }
}

fn core_rest_filters() -> Filters {
    Filters {
        calendar_event_filter: Some(GraphqlCalendarEventLiteral::Id(excluded_id()).into()),
        email_filter: Some(excluded_email()),
        channel_thread_filter: Some(GraphqlChannelThreadLiteral::ThreadId(excluded_id()).into()),
        call_filter: Some(GraphqlCallLiteral::CallId(excluded_id()).into()),
        document_filter: Some(GraphqlDocumentLiteral::Id(excluded_id()).into()),
        ..Filters::default()
    }
}

fn rows(filters: Filters, sort_method: &'static str, limit: u32) -> LaneInput {
    LaneInput {
        limit,
        expand: Some(true),
        sort_method,
        email_view: Some("ALL"),
        filters,
    }
}

/// Creation order never changes mid-scan, so a channel cannot be skipped.
fn channels_input() -> LaneInput {
    LaneInput {
        limit: HYDRATE_PAGE,
        expand: Some(true),
        sort_method: "CREATED_AT",
        email_view: None,
        filters: channel_filters(),
    }
}

fn crm_contacts_input() -> LaneInput {
    LaneInput {
        limit: HYDRATE_PAGE,
        expand: None,
        sort_method: "UPDATED_AT",
        email_view: None,
        filters: crm_contact_filters(),
    }
}

/// Email threads, newest message first, so each page is an ordered index
/// range ending at the recency cutoff.
fn email_rows(filters: Filters, limit: u32) -> LaneInput {
    rows(filters, "UPDATED_AT", limit)
}

/// Threads of every owned and delegated inbox updated within `days`.
fn mail_rows(days: i64, limit: u32, now: DateTime<Utc>) -> LaneInput {
    with_email_recency(
        email_rows(non_email_excluded(), limit),
        &[EmailWindow {
            important: None,
            days,
        }],
        now,
    )
}

/// `existing` and `narrowing` both, or `narrowing` alone.
fn and_with<E>(existing: Option<E>, narrowing: E, and: fn(E, E) -> E) -> E {
    match existing {
        Some(existing) => and(existing, narrowing),
        None => narrowing,
    }
}

/// `filters` with the email tree narrowed by `tree`.
fn and_email_tree(filters: &mut Filters, tree: GraphqlEmailExpr) {
    let email = filters
        .email_filter
        .get_or_insert_with(GraphqlEmailFilterAst::default);
    email.tree = Some(and_with(email.tree.take(), tree, GraphqlEmailExpr::and));
}

fn since(at: DateTime<Utc>) -> GraphqlDateLiteral {
    GraphqlDateLiteral::Gte(iso_instant(at))
}

/// Restricts email threads to those matching any window. In the ALL view an
/// email's `updatedAt` is its latest non-spam message's time.
fn with_email_recency(
    mut input: LaneInput,
    windows: &[EmailWindow],
    now: DateTime<Utc>,
) -> LaneInput {
    let recency = windows
        .iter()
        .map(|window| {
            let updated: GraphqlEmailExpr =
                GraphqlEmailLiteral::UpdatedAt(since(now - TimeDelta::days(window.days))).into();
            match window.important {
                None => updated,
                Some(important) => GraphqlEmailExpr::and(
                    GraphqlEmailLiteral::Importance(important).into(),
                    updated,
                ),
            }
        })
        .reduce(GraphqlEmailExpr::or);
    if let Some(recency) = recency {
        and_email_tree(&mut input.filters, recency);
    }
    input
}

/// Narrows the entity types that filter on `updatedAt` to changes since
/// `at`; the others are fetched in full.
pub(crate) fn with_updated_since(mut input: LaneInput, at: DateTime<Utc>) -> LaneInput {
    let filters = &mut input.filters;
    filters.document_filter = Some(and_with(
        filters.document_filter.take(),
        GraphqlDocumentLiteral::UpdatedAt(since(at)).into(),
        GraphqlDocumentExpr::and,
    ));
    filters.project_filter = Some(and_with(
        filters.project_filter.take(),
        GraphqlProjectLiteral::UpdatedAt(since(at)).into(),
        GraphqlProjectExpr::and,
    ));
    filters.chat_filter = Some(and_with(
        filters.chat_filter.take(),
        GraphqlChatLiteral::UpdatedAt(since(at)).into(),
        GraphqlChatExpr::and,
    ));
    // A cached email row changes through either the thread's time or this
    // viewer's history time, and VIEWED_UPDATED sorts on both.
    and_email_tree(
        filters,
        GraphqlEmailExpr::or(
            GraphqlEmailLiteral::UpdatedAt(since(at)).into(),
            GraphqlEmailLiteral::ViewedAt(since(at)).into(),
        ),
    );
    input
}
