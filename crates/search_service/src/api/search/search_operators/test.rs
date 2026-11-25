use item_filters::CallStatus;
use models_search::MatchType;
use models_search::unified::SearchEntityFilters;
use system_properties::{PriorityOption, StatusOption, SystemPropertyKey};
use uuid::Uuid;

use super::{
    MAX_CHANNEL_NAMES, SearchOperators, TagFilter, TypedConditions, apply_names,
    apply_search_operators, reaches_beyond_email, read_search_operators,
};
use crate::api::search::simple::SearchError;
use crate::api::search::terms::split_search_terms;
use crate::domain::operator_names::{NamedIds, TypedNames};

const VIEWER: &str = "macro|viewer@example.com";

fn terms(query: &str) -> Vec<String> {
    split_search_terms(&[query.to_string()])
}

/// What a search of every kind sends, agent sessions included.
fn every_kind() -> SearchEntityFilters {
    SearchEntityFilters::from(item_filters::EntityFilters {
        agent_session_filters: item_filters::AgentSessionFilters {
            include: true,
            ..Default::default()
        },
        ..Default::default()
    })
}

fn apply_to(
    filters: &mut SearchEntityFilters,
    query: &str,
) -> (SearchOperators, TypedConditions) {
    apply_search_operators(filters, terms(query), MatchType::Partial, VIEWER).unwrap()
}

fn apply(query: &str) -> (SearchEntityFilters, SearchOperators, TypedConditions) {
    let mut filters = every_kind();
    let (read, conditions) = apply_to(&mut filters, query);
    (filters, read, conditions)
}

/// The kinds `filters` still search, in a fixed order.
fn kinds(filters: &SearchEntityFilters) -> Vec<&'static str> {
    [
        ("documents", filters.should_include_documents),
        ("chats", filters.should_include_chats),
        ("agent_sessions", filters.should_include_agent_sessions),
        ("emails", filters.should_include_emails),
        ("channels", filters.should_include_channels),
        ("calls", filters.should_include_call_records),
        ("folders", filters.should_include_projects),
        ("calendar", filters.should_include_calendar_events),
    ]
    .into_iter()
    .filter_map(|(kind, included)| included.then_some(kind))
    .collect()
}

fn filter_values(conditions: &TypedConditions, definition: Uuid) -> Vec<Vec<String>> {
    conditions
        .property_filters
        .iter()
        .filter(|filter| filter.definition_id == definition.to_string())
        .map(|filter| filter.values.clone())
        .collect()
}

#[derive(serde::Deserialize)]
struct TypedQuery {
    typed: String,
    operators: usize,
}

/// The queries the Search view's field draws operators in, which its web
/// tests read too: each is read as the operators listed, and the rest of
/// its terms stay words.
#[test]
fn search_field_draws_exactly_the_operators_the_service_reads() {
    let cases: Vec<TypedQuery> = serde_json::from_str(include_str!("typed_operators.json"))
        .expect("typed_operators.json lists queries and how many operators each holds");

    let wrong: Vec<String> = cases
        .iter()
        .filter_map(|case| {
            let read = read_search_operators(terms(&case.typed));
            (read.operators != case.operators)
                .then(|| format!("{} read {} operators", case.typed, read.operators))
        })
        .collect();

    assert!(wrong.is_empty(), "read otherwise than listed: {wrong:?}");
}

#[test]
fn the_words_around_operators_are_left_in_order() {
    let read = read_search_operators(terms("launch type:task OR notes tag:a OR"));

    assert_eq!(read.terms, ["launch", "OR", "notes", "OR"]);
    assert_eq!(read.operators, 2);
}

#[test]
fn type_names_the_kinds_searched() {
    let (filters, _, conditions) = apply("type:task launch");
    assert_eq!(kinds(&filters), ["documents"]);
    assert_eq!(filters.document_filters.sub_types, ["task"]);
    assert!(!conditions.exclude_tasks);

    let (filters, _, conditions) = apply("type:doc launch");
    assert_eq!(kinds(&filters), ["documents"]);
    assert!(filters.document_filters.sub_types.is_empty());
    assert!(conditions.exclude_tasks, "documents alone leave tasks out");

    let (filters, _, _) = apply("type:agent OR type:email launch");
    assert_eq!(kinds(&filters), ["chats", "agent_sessions", "emails"]);

    let (filters, _, _) = apply("type:folder launch");
    assert_eq!(kinds(&filters), ["folders"]);
}

#[test]
fn types_repeated_without_or_must_all_hold() {
    let (filters, read, _) = apply("type:task type:email launch");

    assert!(kinds(&filters).is_empty(), "no item is both: {:?}", kinds(&filters));
    assert_eq!(read.terms, ["launch"]);
}

#[test]
fn task_operators_narrow_the_search_to_tasks() {
    let (filters, _, conditions) = apply("status:in_progress priority:urgent launch");

    assert_eq!(kinds(&filters), ["documents"]);
    assert_eq!(filters.document_filters.sub_types, ["task"]);
    assert_eq!(
        filter_values(&conditions, SystemPropertyKey::STATUS_UUID),
        [vec![StatusOption::InProgress.uuid().to_string()]]
    );
    assert_eq!(
        filter_values(&conditions, SystemPropertyKey::PRIORITY_UUID),
        [vec![PriorityOption::Urgent.uuid().to_string()]]
    );
}

#[test]
fn or_joins_values_and_repeating_requires_each() {
    let (_, _, joined) = apply("assignee:me OR assignee:bo@example.com launch");
    assert_eq!(
        filter_values(&joined, SystemPropertyKey::ASSIGNEES_UUID),
        [vec![VIEWER.to_string(), "macro|bo@example.com".to_string()]]
    );

    let (_, _, both) = apply("assignee:me assignee:Bo@Example.com launch");
    assert_eq!(
        filter_values(&both, SystemPropertyKey::ASSIGNEES_UUID),
        [
            vec![VIEWER.to_string()],
            vec!["macro|bo@example.com".to_string()]
        ]
    );
}

#[test]
fn a_status_joined_across_tasks_and_calls_filters_each() {
    let (filters, _, conditions) = apply("status:completed OR status:missed launch");

    assert_eq!(kinds(&filters), ["documents", "calls"]);
    assert_eq!(filters.document_filters.sub_types, ["task"]);
    assert_eq!(
        filter_values(&conditions, SystemPropertyKey::STATUS_UUID),
        [vec![StatusOption::Completed.uuid().to_string()]]
    );
    assert_eq!(filters.call_filters.status, Some(CallStatus::Missed));
}

#[test]
fn a_call_status_the_request_contradicts_leaves_calls_out() {
    let mut filters = every_kind();
    filters.call_filters.attended = Some(true);

    apply_to(&mut filters, "status:missed launch");

    assert!(kinds(&filters).is_empty());
}

#[test]
fn author_means_a_task_creator_unless_type_names_documents() {
    let (filters, _, _) = apply("author:me launch");
    assert_eq!(kinds(&filters), ["documents"]);
    assert_eq!(filters.document_filters.sub_types, ["task"]);
    assert_eq!(filters.document_filters.owners, [VIEWER]);

    let (filters, _, conditions) = apply("type:doc author:ana@example.com launch");
    assert_eq!(kinds(&filters), ["documents"]);
    assert!(conditions.exclude_tasks);
    assert_eq!(filters.document_filters.owners, ["macro|ana@example.com"]);
}

#[test]
fn an_author_the_request_leaves_out_matches_nothing() {
    let mut filters = every_kind();
    filters.document_filters.owners = vec!["macro|bo@example.com".to_string()];

    apply_to(&mut filters, "author:me launch");

    assert!(kinds(&filters).is_empty());
}

#[test]
fn from_names_senders_and_speakers_only_without_email() {
    let (filters, read, _) = apply("type:channel OR type:call from:me launch");
    assert_eq!(kinds(&filters), ["channels", "calls"]);
    assert_eq!(filters.channel_filters.sender_ids, [VIEWER]);
    assert_eq!(filters.call_filters.speaker_ids, [VIEWER]);
    assert_eq!(read.terms, ["launch"]);

    let (filters, read, _) = apply("from:me launch");
    assert_eq!(read.operators, 0);
    assert_eq!(read.terms, ["from:me", "launch"], "the email operator reads it");
    assert!(filters.channel_filters.sender_ids.is_empty());
}

#[test]
fn named_operators_narrow_to_the_kinds_they_apply_to() {
    let (filters, read, _) = apply("tag:finance launch");
    assert_eq!(
        kinds(&filters),
        ["documents", "chats", "agent_sessions", "emails", "calls", "folders", "calendar"],
        "channels carry no tags"
    );
    assert_eq!(
        read.names(),
        TypedNames {
            tags: vec!["finance".to_string()],
            ..TypedNames::default()
        }
    );

    let (filters, _, _) = apply("inbox:ana@example.com launch");
    assert_eq!(kinds(&filters), ["emails"]);

    let (filters, read, _) = apply("in:#Launch notes");
    assert_eq!(kinds(&filters), ["channels", "calls"]);
    assert_eq!(read.names().channels, ["Launch"]);
}

#[test]
fn a_search_that_does_not_read_words_reads_no_operators() {
    let mut filters = every_kind();
    let (read, _) =
        apply_search_operators(&mut filters, terms("type:task"), MatchType::Regexp, VIEWER)
            .unwrap();

    assert_eq!(read.operators, 0);
    assert_eq!(read.terms, ["type:task"]);
    assert_eq!(kinds(&filters), kinds(&every_kind()));
}

#[test]
fn too_many_channel_names_are_refused() {
    let query = (0..=MAX_CHANNEL_NAMES)
        .map(|n| format!("in:#c{n}"))
        .collect::<Vec<_>>()
        .join(" ");

    let refused = apply_search_operators(&mut every_kind(), terms(&query), MatchType::Partial, VIEWER);

    assert!(matches!(refused, Err(SearchError::TooManyChannelNames(MAX_CHANNEL_NAMES))));
}

#[test]
fn operators_alone_search_email_alone() {
    let (filters, read, _) = apply("inbox:ana@example.com");
    assert!(read.terms.is_empty());
    assert!(!reaches_beyond_email(&filters, false));

    let (filters, read, _) = apply("type:task status:in_progress");
    assert!(read.terms.is_empty());
    assert!(reaches_beyond_email(&filters, false), "tasks match words");
}

/// Names as a lookup resolved them for these tests.
fn named(tags: &[(&str, &[u128])], inboxes: &[(&str, u128)], channels: &[(&str, u128)]) -> NamedIds {
    NamedIds::from_parts(
        tags.iter()
            .map(|(name, ids)| (name.to_string(), ids.iter().map(|id| Uuid::from_u128(*id)).collect()))
            .collect(),
        inboxes
            .iter()
            .map(|(name, id)| (name.to_string(), vec![Uuid::from_u128(*id)]))
            .collect(),
        channels
            .iter()
            .map(|(name, id)| (name.to_string(), vec![Uuid::from_u128(*id)]))
            .collect(),
    )
}

fn id(n: u128) -> String {
    Uuid::from_u128(n).to_string()
}

fn tags_for(query: &str, named: &NamedIds, requested: TagFilter) -> Result<TagFilter, SearchError> {
    let (mut filters, read, _) = apply(&format!("{query} launch"));
    apply_names(&read, named, &mut filters, requested)
}

#[test]
fn tags_join_with_or_and_require_each_otherwise() {
    let names = named(&[("finance", &[1]), ("legal", &[2]), ("q3", &[3])], &[], &[]);

    assert_eq!(
        tags_for("tag:finance OR tag:legal", &names, TagFilter::default()).unwrap(),
        TagFilter {
            option_ids: vec![id(1), id(2)],
            match_all: false
        }
    );
    assert_eq!(
        tags_for("tag:finance tag:legal", &names, TagFilter::default()).unwrap(),
        TagFilter {
            option_ids: vec![id(1), id(2)],
            match_all: true
        }
    );
    assert!(matches!(
        tags_for("tag:finance OR tag:legal tag:q3", &names, TagFilter::default()),
        Err(SearchError::TagConditionsDontCombine)
    ));
}

#[test]
fn typed_tags_are_required_beside_the_requests_own() {
    let names = named(&[("finance", &[1])], &[], &[]);
    let requested = TagFilter {
        option_ids: vec![id(9)],
        match_all: false,
    };

    assert_eq!(
        tags_for("tag:finance", &names, requested).unwrap(),
        TagFilter {
            option_ids: vec![id(9), id(1)],
            match_all: true
        }
    );
}

#[test]
fn a_tag_name_that_reaches_nothing_matches_nothing() {
    let names = named(&[("finance", &[])], &[], &[]);
    let (mut filters, read, _) = apply("tag:finance launch");

    let tags = apply_names(&read, &names, &mut filters, TagFilter::default()).unwrap();

    assert!(kinds(&filters).is_empty());
    assert_eq!(tags, TagFilter::default());
}

#[test]
fn inbox_and_channel_names_narrow_to_what_they_reach() {
    let names = named(&[], &[("ana@example.com", 10)], &[("launch", 20)]);

    let (mut filters, read, _) = apply("inbox:ana@example.com launch");
    apply_names(&read, &names, &mut filters, TagFilter::default()).unwrap();
    assert_eq!(kinds(&filters), ["emails"]);
    assert_eq!(filters.email_filters.link_ids, [id(10)]);

    let (mut filters, read, _) = apply("in:#Launch notes");
    apply_names(&read, &names, &mut filters, TagFilter::default()).unwrap();
    assert_eq!(kinds(&filters), ["channels", "calls"]);
    assert_eq!(filters.channel_filters.channel_ids, [id(20)]);
    assert_eq!(filters.call_filters.channel_ids, [id(20)]);

    let (mut filters, read, _) = apply("inbox:bo@example.com launch");
    apply_names(&read, &names, &mut filters, TagFilter::default()).unwrap();
    assert!(kinds(&filters).is_empty(), "an inbox the caller doesn't read");

    let (mut filters, read, _) = apply("in:#ops launch");
    apply_names(&read, &names, &mut filters, TagFilter::default()).unwrap();
    assert!(kinds(&filters).is_empty(), "a channel the caller isn't in");
}
