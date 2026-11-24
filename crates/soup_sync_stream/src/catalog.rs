//! The lanes each pass runs, in load order ("Load order" in
//! `docs/architecture/streamed-cache-sync.md`), with their queries and first
//! inputs. A lane's id names its saved state in the client's cache, and its
//! operation name is what the cache's projections check (a `SoupBackfill…`
//! page must carry complete rows), so keep both when changing a lane.

#[cfg(test)]
mod test;

use chrono::{DateTime, TimeDelta, Utc};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::calendar::iso_instant;

/// Items per hydrate page: Soup's maximum, as streaming has no round trip
/// per page.
const HYDRATE_PAGE: u32 = 500;
/// Threads per email-content page, each with its first 20 messages. The
/// stream's email-content budget is 500 threads and 10,000 messages per page;
/// 200 threads keep a page near half a second of server time for large
/// mailboxes.
const EMAIL_CONTENT_PAGE: u32 = 200;
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
    pub(crate) input: fn(DateTime<Utc>) -> Map<String, Value>,
    pub(crate) kind: SoupLaneKind,
    /// A full pass every run: never resumed, never narrowed to changes.
    pub(crate) restart_on_run: bool,
    pub(crate) max_items: Option<u32>,
    /// Stored by the cache once the lane completes: what it proves complete.
    pub(crate) coverage: Option<Coverage>,
}

/// What the cache does with a Soup lane's pages.
pub(crate) enum SoupLaneKind {
    Hydrate,
    /// An ID listing authoritative for these lanes' members.
    Membership(&'static [&'static str]),
}

/// "Every record of this entity is cached", stored when a lane completes.
#[derive(Clone, Copy)]
pub(crate) struct Coverage(&'static str);

impl Coverage {
    pub(crate) fn to_json(self) -> Value {
        json!({ "entity": self.0, "scope": "all" })
    }
}

/// Email threads updated within `days`, of one importance or any.
struct EmailWindow {
    important: Option<bool>,
    days: i64,
}

/// A lane query: its document, its operation, and what the client's cache
/// requires of that operation's pages.
///
/// The cache chooses those requirements by operation name
/// (`soup_filter_cache_adapter::backfill_requirements`), native apps already
/// shipped included, so an operation keeps its name once a lane runs it. The
/// adapter's tests compare every query here with what the cache does.
#[derive(Debug)]
pub struct LaneQuery {
    /// The query document, generated from the app's GraphQL documents by
    /// `apps/web/scripts/generate-sync-lane-queries.ts`.
    pub document: &'static str,
    /// The operation the lane runs.
    pub operation: &'static str,
    /// The cache refuses a page with a row lacking a required projection.
    pub complete_projections: bool,
    /// The cache refuses a page with an incomplete property projection.
    pub complete_properties: bool,
}

impl LaneQuery {
    const fn new(document: &'static str, operation: &'static str) -> Self {
        Self {
            document,
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

const CHANNELS_QUERY: LaneQuery = LaneQuery::new(
    include_str!("catalog/channels.graphql"),
    "SoupBackfillSyncChannels",
)
.complete_rows();
const CHANNEL_IDS_QUERY: LaneQuery = LaneQuery::new(
    include_str!("catalog/channel_ids.graphql"),
    "SoupSyncChannelIds",
);
const MINIMAL_TASKS_QUERY: LaneQuery = LaneQuery::new(
    include_str!("catalog/minimal_tasks.graphql"),
    "SoupBackfillSyncTasks",
)
.complete_rows();
const MINIMAL_DOCUMENTS_QUERY: LaneQuery = LaneQuery::new(
    include_str!("catalog/minimal_documents.graphql"),
    "SoupBackfillSyncDocuments",
)
.complete_rows();
const SOUP_BACKFILL_QUERY: LaneQuery = LaneQuery::new(
    include_str!("catalog/soup_backfill.graphql"),
    "SoupBackfill",
)
.complete_rows()
.complete_properties();
const SOUP_MAIL_BACKFILL_QUERY: LaneQuery = LaneQuery::new(
    include_str!("catalog/soup_mail_backfill.graphql"),
    "SoupMailBackfill",
)
.complete_properties();
const CRM_CONTACTS_QUERY: LaneQuery =
    LaneQuery::new(include_str!("catalog/crm_contacts.graphql"), "CrmContacts");
const TASK_IDS_QUERY: LaneQuery =
    LaneQuery::new(include_str!("catalog/task_ids.graphql"), "SoupSyncTaskIds");
const TASK_PROJECT_IDS_QUERY: LaneQuery = LaneQuery::new(
    include_str!("catalog/task_project_ids.graphql"),
    "SoupSyncTaskProjectIds",
);
const DOCUMENT_IDS_QUERY: LaneQuery = LaneQuery::new(
    include_str!("catalog/document_ids.graphql"),
    "SoupSyncDocumentIds",
);
const SHARED_EMAIL_IDS_QUERY: LaneQuery = LaneQuery::new(
    include_str!("catalog/shared_email_ids.graphql"),
    "SoupSyncSharedEmailIds",
);
/// Calendar windows' query.
pub(crate) const CALENDAR_QUERY: LaneQuery = LaneQuery::new(
    include_str!("catalog/calendar_occurrences.graphql"),
    "CalendarOccurrences",
);

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
            coverage: Some(Coverage("channel")),
        }),
        LaneSpec::Soup(SoupLaneSpec {
            id: TASKS,
            query: &MINIMAL_TASKS_QUERY,
            input: |_| rows(task_filters(), "UPDATED_AT", HYDRATE_PAGE),
            kind: SoupLaneKind::Hydrate,
            restart_on_run: false,
            max_items: None,
            coverage: Some(Coverage("task")),
        }),
        // Project chips answer from these records once the lane completed.
        LaneSpec::Soup(SoupLaneSpec {
            id: TASK_PROJECTS,
            query: &SOUP_BACKFILL_QUERY,
            input: |_| rows(task_project_filters(), "VIEWED_UPDATED", HYDRATE_PAGE),
            kind: SoupLaneKind::Hydrate,
            restart_on_run: false,
            max_items: None,
            coverage: Some(Coverage("initiative")),
        }),
        LaneSpec::Soup(SoupLaneSpec {
            id: "email-recent",
            query: &SOUP_MAIL_BACKFILL_QUERY,
            input: |now| mail_rows(EMAIL_RECENT_DAYS, HYDRATE_PAGE, now),
            kind: SoupLaneKind::Hydrate,
            restart_on_run: false,
            max_items: None,
            coverage: None,
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
            coverage: None,
        }),
        LaneSpec::Soup(SoupLaneSpec {
            id: DOCUMENTS_RECENT,
            query: &MINIMAL_DOCUMENTS_QUERY,
            input: |_| rows(document_filters(), "VIEWED_UPDATED", HYDRATE_PAGE),
            kind: SoupLaneKind::Hydrate,
            restart_on_run: false,
            max_items: Some(DOCUMENTS_RECENT_MAX_ITEMS),
            coverage: None,
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
            let mut filters = excluded_filters();
            filters.insert(
                "crmContactFilter".to_owned(),
                json!({ "and": {
                    "left": { "literal": { "hidden": false } },
                    "right": { "literal": { "include": true } },
                } }),
            );
            object(json!({ "limit": HYDRATE_PAGE, "sortMethod": "UPDATED_AT", "filters": filters }))
        }),
        // Core entities except documents and tasks (their own lanes), plus
        // CRM companies and foreign entities.
        hydrate_lane("core-rest", &SOUP_BACKFILL_QUERY, |_| {
            rows(core_rest_filters(), "VIEWED_UPDATED", HYDRATE_PAGE)
        }),
        LaneSpec::Soup(SoupLaneSpec {
            coverage: Some(Coverage("document")),
            ..soup_hydrate(DOCUMENTS_REST, &MINIMAL_DOCUMENTS_QUERY, |_| {
                rows(document_filters(), "VIEWED_UPDATED", HYDRATE_PAGE)
            })
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
        // Threads with their first message page.
        hydrate_lane("email-content", &SOUP_BACKFILL_QUERY, |now| {
            mail_rows(EMAIL_CONTENT_DAYS, EMAIL_CONTENT_PAGE, now)
        }),
    ]
}

fn soup_hydrate(
    id: &'static str,
    query: &'static LaneQuery,
    input: fn(DateTime<Utc>) -> Map<String, Value>,
) -> SoupLaneSpec {
    SoupLaneSpec {
        id,
        query,
        input,
        kind: SoupLaneKind::Hydrate,
        restart_on_run: false,
        max_items: None,
        coverage: None,
    }
}

fn hydrate_lane(
    id: &'static str,
    query: &'static LaneQuery,
    input: fn(DateTime<Utc>) -> Map<String, Value>,
) -> LaneSpec {
    LaneSpec::Soup(soup_hydrate(id, query, input))
}

fn ids_lane(
    id: &'static str,
    query: &'static LaneQuery,
    input: fn(DateTime<Utc>) -> Map<String, Value>,
    scopes: &'static [&'static str],
) -> LaneSpec {
    LaneSpec::Soup(SoupLaneSpec {
        kind: SoupLaneKind::Membership(scopes),
        ..soup_hydrate(id, query, input)
    })
}

fn object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

fn excluded(field: &str) -> Value {
    json!({ "literal": { field: EXCLUDED_ENTITY_ID } })
}

/// The Soup branches other than email, each excluded.
fn non_email_excluded() -> Map<String, Value> {
    Map::from_iter([
        ("calendarEventFilter".to_owned(), excluded("id")),
        ("documentFilter".to_owned(), excluded("id")),
        ("projectFilter".to_owned(), excluded("projectIdSelf")),
        ("chatFilter".to_owned(), excluded("chatId")),
        ("channelFilter".to_owned(), excluded("channelId")),
        ("channelThreadFilter".to_owned(), excluded("threadId")),
        ("callFilter".to_owned(), excluded("callId")),
        ("crmCompanyFilter".to_owned(), excluded("id")),
        ("foreignEntityFilter".to_owned(), excluded("id")),
    ])
}

/// Every Soup branch excluded; a lane's filter then includes its own.
fn excluded_filters() -> Map<String, Value> {
    let mut filters = non_email_excluded();
    filters.insert(
        "emailFilter".to_owned(),
        json!({ "tree": excluded("threadId") }),
    );
    filters
}

fn with_filter(mut filters: Map<String, Value>, key: &str, filter: Value) -> Map<String, Value> {
    filters.insert(key.to_owned(), filter);
    filters
}

fn task_filters() -> Map<String, Value> {
    with_filter(
        excluded_filters(),
        "documentFilter",
        json!({ "literal": { "subType": "TASK" } }),
    )
}

fn document_filters() -> Map<String, Value> {
    with_filter(
        excluded_filters(),
        "documentFilter",
        json!({ "not": { "literal": { "subType": "TASK" } } }),
    )
}

/// Every task project the viewer can read.
fn task_project_filters() -> Map<String, Value> {
    with_filter(
        excluded_filters(),
        "initiativeFilter",
        json!({ "literal": { "include": true } }),
    )
}

/// Channels with no channel filter: Soup then lists the channels the viewer
/// actively takes part in.
fn channel_filters() -> Map<String, Value> {
    let mut filters = excluded_filters();
    filters.remove("channelFilter");
    filters
}

/// Every thread shared with the viewer, outside the owned and delegated inboxes.
fn shared_email_filters() -> Map<String, Value> {
    with_filter(
        non_email_excluded(),
        "emailFilter",
        json!({ "tree": { "literal": { "shared": "ONLY" } } }),
    )
}

fn core_rest_filters() -> Map<String, Value> {
    Map::from_iter([
        ("calendarEventFilter".to_owned(), excluded("id")),
        (
            "emailFilter".to_owned(),
            json!({ "tree": excluded("threadId") }),
        ),
        ("channelThreadFilter".to_owned(), excluded("threadId")),
        ("callFilter".to_owned(), excluded("callId")),
        ("documentFilter".to_owned(), excluded("id")),
    ])
}

fn rows(filters: Map<String, Value>, sort_method: &str, limit: u32) -> Map<String, Value> {
    object(json!({
        "limit": limit,
        "expand": true,
        "sortMethod": sort_method,
        "emailView": "ALL",
        "filters": filters,
    }))
}

/// Creation order never changes mid-scan, so a channel cannot be skipped.
fn channels_input() -> Map<String, Value> {
    object(json!({
        "limit": HYDRATE_PAGE,
        "expand": true,
        "sortMethod": "CREATED_AT",
        "filters": channel_filters(),
    }))
}

/// Email threads, newest message first, so each page is an ordered index
/// range ending at the recency cutoff.
fn email_rows(filters: Map<String, Value>, limit: u32) -> Map<String, Value> {
    rows(filters, "UPDATED_AT", limit)
}

/// Threads of every owned and delegated inbox updated within `days`.
fn mail_rows(days: i64, limit: u32, now: DateTime<Utc>) -> Map<String, Value> {
    with_email_recency(
        email_rows(non_email_excluded(), limit),
        &[EmailWindow {
            important: None,
            days,
        }],
        now,
    )
}

fn and(left: Option<Value>, right: Value) -> Value {
    match left {
        Some(left) if !left.is_null() => json!({ "and": { "left": left, "right": right } }),
        _ => right,
    }
}

/// `filters` with the email tree narrowed by `tree`.
fn and_email_tree(filters: &mut Map<String, Value>, tree: Value) {
    let mut email = match filters.remove("emailFilter") {
        Some(Value::Object(email)) => email,
        _ => Map::new(),
    };
    let narrowed = and(email.remove("tree"), tree);
    email.insert("tree".to_owned(), narrowed);
    filters.insert("emailFilter".to_owned(), Value::Object(email));
}

/// Runs `update` on the input's `filters` object, created when missing.
fn update_filters(input: &mut Map<String, Value>, update: impl FnOnce(&mut Map<String, Value>)) {
    let mut filters = match input.remove("filters") {
        Some(Value::Object(filters)) => filters,
        _ => Map::new(),
    };
    update(&mut filters);
    input.insert("filters".to_owned(), Value::Object(filters));
}

/// Restricts email threads to those matching any window. In the ALL view an
/// email's `updatedAt` is its latest non-spam message's time.
fn with_email_recency(
    mut input: Map<String, Value>,
    windows: &[EmailWindow],
    now: DateTime<Utc>,
) -> Map<String, Value> {
    let recency = windows
        .iter()
        .map(|window| {
            let cutoff = now - TimeDelta::days(window.days);
            let updated = json!({ "literal": { "updatedAt": { "gte": iso_instant(cutoff) } } });
            match window.important {
                None => updated,
                Some(important) => json!({ "and": {
                    "left": { "literal": { "importance": important } },
                    "right": updated,
                } }),
            }
        })
        .reduce(|left, right| json!({ "or": { "left": left, "right": right } }));
    if let Some(recency) = recency {
        update_filters(&mut input, |filters| and_email_tree(filters, recency));
    }
    input
}

/// Narrows the entity types that filter on `updatedAt` to changes since
/// `since`; the others are fetched in full.
pub(crate) fn with_updated_since(
    mut input: Map<String, Value>,
    since: DateTime<Utc>,
) -> Map<String, Value> {
    let since = iso_instant(since);
    let updated = json!({ "literal": { "updatedAt": { "gte": since } } });
    update_filters(&mut input, |filters| {
        for key in ["documentFilter", "projectFilter", "chatFilter"] {
            let narrowed = and(filters.remove(key), updated.clone());
            filters.insert(key.to_owned(), narrowed);
        }
        // A cached email row changes through either the thread's time or this
        // viewer's history time, and VIEWED_UPDATED sorts on both.
        and_email_tree(
            filters,
            json!({ "or": {
                "left": updated,
                "right": { "literal": { "viewedAt": { "gte": since } } },
            } }),
        );
    });
    input
}
