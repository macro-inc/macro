use super::*;
use chrono::{TimeZone, Utc};
use models_opensearch::SearchEntityType;
use opensearch_client::search::model::Highlight;
use sqlx::types::Uuid;

/// Helper to create a TaggedSearchHit for testing
fn make_tagged_hit(
    entity_id: Uuid,
    updated_at: Option<chrono::DateTime<Utc>>,
    source: SearchSource,
) -> TaggedSearchHit {
    TaggedSearchHit {
        hit: SearchHit {
            entity_id,
            entity_type: SearchEntityType::Documents,
            updated_at,
            score: Some(1.0),
            highlight: Highlight::default(),
            goto: None,
        },
        source,
    }
}

/// Helper to create a timestamp for testing
fn ts(secs: i64) -> chrono::DateTime<Utc> {
    Utc.timestamp_opt(secs, 0).unwrap()
}

// ==================== Tests for compute_next_cursor ====================

#[test]
fn test_compute_next_cursor_search_done_but_truncated_in_merge_continues() {
    // The sub-search reported Done, but the cross-source merge dropped some of
    // this source's entities (included < original). Those must resurface next
    // page, so the cursor continues from the last included hit rather than ending
    // — returning Done here would silently lose the bumped entities.
    let entity_id = Uuid::new_v4();
    let timestamp = ts(1000);
    let last_hit = make_tagged_hit(entity_id, Some(timestamp), SearchSource::Content);

    let result = compute_next_cursor(
        &SearchCursorOption::Done,
        5,  // included_count
        10, // original_count (more than included — truncated in merge)
        Some(&last_hit),
        &SearchCursorOption::NotDone(None),
    );

    match result {
        SearchCursorOption::NotDone(Some(cursor)) => {
            let (id, got_ts) = cursor.as_updated_at().expect("expected UpdatedAt cursor");
            assert_eq!(id, entity_id);
            assert_eq!(got_ts, timestamp);
        }
        _ => panic!("Expected NotDone with cursor, got {:?}", result),
    }
}

#[test]
fn test_compute_next_cursor_excluded_results_with_included_generates_cursor() {
    // When some results were excluded (included < original) and we have included results,
    // generate cursor from the last included hit
    let entity_id = Uuid::new_v4();
    let timestamp = ts(1000);
    let last_hit = make_tagged_hit(entity_id, Some(timestamp), SearchSource::Content);

    let result = compute_next_cursor(
        &SearchCursorOption::NotDone(None), // search says not done
        3,                                  // included_count
        5,                                  // original_count (more results were fetched)
        Some(&last_hit),
        &SearchCursorOption::NotDone(None),
    );

    match result {
        SearchCursorOption::NotDone(Some(cursor)) => {
            let (id, ts) = cursor.as_updated_at().expect("expected UpdatedAt cursor");
            assert_eq!(id, entity_id);
            assert_eq!(ts, timestamp);
        }
        _ => panic!("Expected NotDone with cursor, got {:?}", result),
    }
}

#[test]
fn test_compute_next_cursor_search_has_more_with_included_generates_cursor() {
    // When search indicates more results (has_more) and we have included results,
    // generate cursor from the last included hit
    let entity_id = Uuid::new_v4();
    let timestamp = ts(2000);
    let last_hit = make_tagged_hit(entity_id, Some(timestamp), SearchSource::ChatName);

    let result = compute_next_cursor(
        &SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
            entity_id: Uuid::new_v4(),
            updated_at: ts(500),
        })), // search has more
        5, // included_count
        5, // original_count (all included)
        Some(&last_hit),
        &SearchCursorOption::NotDone(None),
    );

    match result {
        SearchCursorOption::NotDone(Some(cursor)) => {
            let (id, ts) = cursor.as_updated_at().expect("expected UpdatedAt cursor");
            assert_eq!(id, entity_id);
            assert_eq!(ts, timestamp);
        }
        _ => panic!("Expected NotDone with cursor, got {:?}", result),
    }
}

#[test]
fn test_compute_next_cursor_excluded_results_no_included_carries_forward() {
    // When results were excluded but none were included in final page,
    // carry forward the original cursor
    let original_entity_id = Uuid::new_v4();
    let original_timestamp = ts(500);
    let original_cursor = SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
        entity_id: original_entity_id,
        updated_at: original_timestamp,
    }));

    let result = compute_next_cursor(
        &SearchCursorOption::NotDone(None), // search not done
        0,                                  // included_count (none included)
        5,                                  // original_count (had results)
        None,                               // no last hit
        &original_cursor,
    );

    match result {
        SearchCursorOption::NotDone(Some(cursor)) => {
            let (id, ts) = cursor.as_updated_at().expect("expected UpdatedAt cursor");
            assert_eq!(id, original_entity_id);
            assert_eq!(ts, original_timestamp);
        }
        _ => panic!("Expected original cursor carried forward, got {:?}", result),
    }
}

#[test]
fn test_compute_next_cursor_all_included_search_done_returns_done() {
    // When all results were included and search indicates it's done,
    // return Done
    let result = compute_next_cursor(
        &SearchCursorOption::Done, // search is done
        5,                         // included_count
        5,                         // original_count (all included)
        Some(&make_tagged_hit(
            Uuid::new_v4(),
            Some(ts(1000)),
            SearchSource::Content,
        )),
        &SearchCursorOption::NotDone(None),
    );

    assert!(result.is_done());
}

#[test]
fn test_compute_next_cursor_all_included_but_search_not_done_continues() {
    // When all fetched results were included but search indicates more exist,
    // generate cursor from last included (search may have more pages)
    let entity_id = Uuid::new_v4();
    let timestamp = ts(1000);
    let last_hit = make_tagged_hit(entity_id, Some(timestamp), SearchSource::Content);

    let result = compute_next_cursor(
        &SearchCursorOption::NotDone(None), // search says not done (more exists)
        5,                                  // included_count
        5,                                  // original_count (all fetched were included)
        Some(&last_hit),
        &SearchCursorOption::NotDone(None),
    );

    // Since search says not done, we should continue pagination
    match result {
        SearchCursorOption::NotDone(Some(cursor)) => {
            let (id, ts) = cursor.as_updated_at().expect("expected UpdatedAt cursor");
            assert_eq!(id, entity_id);
            assert_eq!(ts, timestamp);
        }
        _ => panic!("Expected NotDone with cursor, got {:?}", result),
    }
}

#[test]
fn test_compute_next_cursor_hit_without_timestamp_returns_none_cursor() {
    // When the last included hit has no timestamp, cursor should be NotDone(None)
    let entity_id = Uuid::new_v4();
    let last_hit = make_tagged_hit(entity_id, None, SearchSource::Content);

    let result = compute_next_cursor(
        &SearchCursorOption::NotDone(None),
        3,
        5,
        Some(&last_hit),
        &SearchCursorOption::NotDone(None),
    );

    match result {
        SearchCursorOption::NotDone(None) => {}
        _ => panic!("Expected NotDone(None), got {:?}", result),
    }
}

// ==================== Tests for take_first_n_entities ====================

#[test]
fn take_first_n_entities_budgets_distinct_entities_keeping_all_hits() {
    let e1 = Uuid::new_v4();
    let e2 = Uuid::new_v4();
    let e3 = Uuid::new_v4();
    // e1 contributes 3 hits (e.g. three matching content chunks), e2 and e3 one
    // each. The budget is 2 entities.
    let combined = vec![
        make_tagged_hit(e1, Some(ts(3000)), SearchSource::Content),
        make_tagged_hit(e1, Some(ts(3000)), SearchSource::Content),
        make_tagged_hit(e1, Some(ts(3000)), SearchSource::Content),
        make_tagged_hit(e2, Some(ts(2000)), SearchSource::Content),
        make_tagged_hit(e3, Some(ts(1000)), SearchSource::Content),
    ];

    let result = take_first_n_entities(combined, 2);

    // All three of e1's hits plus e2's single hit; e3 dropped entirely.
    assert_eq!(result.len(), 4);
    assert_eq!(
        result.iter().filter(|t| t.hit.entity_id == e1).count(),
        3,
        "every hit of an included entity is kept together"
    );
    assert!(
        result
            .iter()
            .all(|t| t.hit.entity_id == e1 || t.hit.entity_id == e2),
        "the third entity must not appear once the budget is full"
    );
}

#[test]
fn take_first_n_entities_keeps_all_when_under_budget() {
    let e1 = Uuid::new_v4();
    let e2 = Uuid::new_v4();
    let combined = vec![
        make_tagged_hit(e1, Some(ts(2000)), SearchSource::Content),
        make_tagged_hit(e1, Some(ts(2000)), SearchSource::Content),
        make_tagged_hit(e2, Some(ts(1000)), SearchSource::ChatName),
    ];

    let result = take_first_n_entities(combined, 10);

    assert_eq!(result.len(), 3, "nothing is dropped when under the budget");
}

// ==================== Tests for find_last_of_source ====================

#[test]
fn test_find_last_of_source_finds_correct_source() {
    let doc_id = Uuid::new_v4();
    let chat_id = Uuid::new_v4();
    let doc2_id = Uuid::new_v4();

    let results = vec![
        make_tagged_hit(doc_id, Some(ts(1000)), SearchSource::Content),
        make_tagged_hit(chat_id, Some(ts(2000)), SearchSource::ChatName),
        make_tagged_hit(doc2_id, Some(ts(3000)), SearchSource::Content),
    ];

    let last_doc = find_last_of_source(&results, SearchSource::Content);
    assert!(last_doc.is_some());
    assert_eq!(last_doc.unwrap().hit.entity_id, doc2_id);

    let last_chat = find_last_of_source(&results, SearchSource::ChatName);
    assert!(last_chat.is_some());
    assert_eq!(last_chat.unwrap().hit.entity_id, chat_id);
}

#[test]
fn test_find_last_of_source_returns_none_when_not_found() {
    let results = vec![
        make_tagged_hit(Uuid::new_v4(), Some(ts(1000)), SearchSource::ChatName),
        make_tagged_hit(Uuid::new_v4(), Some(ts(2000)), SearchSource::ChatName),
    ];

    let last_email = find_last_of_source(&results, SearchSource::Content);
    assert!(last_email.is_none());
}

#[test]
fn test_find_last_of_source_empty_results() {
    let results: Vec<TaggedSearchHit> = vec![];
    let result = find_last_of_source(&results, SearchSource::Content);
    assert!(result.is_none());
}

// ==================== Tests for cursor_from_tagged ====================

#[test]
fn test_cursor_from_tagged_with_timestamp() {
    let entity_id = Uuid::new_v4();
    let timestamp = ts(1000);
    let hit = make_tagged_hit(entity_id, Some(timestamp), SearchSource::Content);

    let cursor = cursor_from_tagged(&hit);
    assert!(cursor.is_some());
    let (id, ts) = cursor
        .unwrap()
        .as_updated_at()
        .expect("expected UpdatedAt cursor");
    assert_eq!(id, entity_id);
    assert_eq!(ts, timestamp);
}

#[test]
fn test_cursor_from_tagged_without_timestamp() {
    let entity_id = Uuid::new_v4();
    let hit = make_tagged_hit(entity_id, None, SearchSource::ChatName);

    let cursor = cursor_from_tagged(&hit);
    assert!(cursor.is_none());
}

// ==================== Integration-style tests ====================

#[test]
fn test_cursor_logic_pagination_scenario() {
    // Simulate a pagination scenario where:
    // - Search returned 10 content entities
    // - Only 3 made it into the final page (others had newer timestamps from other sources)
    // - The cursor should point to the last included content entity

    let content_ids: Vec<Uuid> = (0..10).map(|_| Uuid::new_v4()).collect();
    let timestamps: Vec<chrono::DateTime<Utc>> = (0..10).map(|i| ts(1000 + i * 100)).collect();

    // Create the final tagged results (simulating merged & sorted output)
    let final_tagged: Vec<TaggedSearchHit> = vec![
        make_tagged_hit(Uuid::new_v4(), Some(ts(5000)), SearchSource::ChatName),
        make_tagged_hit(content_ids[9], Some(timestamps[9]), SearchSource::Content),
        make_tagged_hit(Uuid::new_v4(), Some(ts(4000)), SearchSource::CrmCompany),
        make_tagged_hit(content_ids[8], Some(timestamps[8]), SearchSource::Content),
        make_tagged_hit(content_ids[7], Some(timestamps[7]), SearchSource::Content),
    ];

    let content_next_cursor = SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
        entity_id: content_ids[6],
        updated_at: timestamps[6],
    }));

    let included_content = final_tagged
        .iter()
        .filter(|h| h.source == SearchSource::Content)
        .count();
    let content_count = 10; // Original fetch returned 10

    let new_content_cursor = compute_next_cursor(
        &content_next_cursor,
        included_content,
        content_count,
        find_last_of_source(&final_tagged, SearchSource::Content),
        &SearchCursorOption::NotDone(None),
    );

    // Should generate cursor from last included content entity (content_ids[7])
    match new_content_cursor {
        SearchCursorOption::NotDone(Some(cursor)) => {
            let (id, ts) = cursor.as_updated_at().expect("expected UpdatedAt cursor");
            assert_eq!(id, content_ids[7]);
            assert_eq!(ts, timestamps[7]);
        }
        _ => panic!(
            "Expected cursor from last included content entity, got {:?}",
            new_content_cursor
        ),
    }
}

#[test]
fn test_cursor_logic_source_exhausted_scenario() {
    // Simulate when a source is exhausted (returned fewer than requested)
    // - Search returned 3 content entities (less than page_size of 10)
    // - All 3 made it into the final page
    // - Cursor should be Done since source is exhausted

    let final_tagged: Vec<TaggedSearchHit> = vec![
        make_tagged_hit(Uuid::new_v4(), Some(ts(3000)), SearchSource::Content),
        make_tagged_hit(Uuid::new_v4(), Some(ts(2000)), SearchSource::Content),
        make_tagged_hit(Uuid::new_v4(), Some(ts(1000)), SearchSource::Content),
    ];

    let content_next_cursor = SearchCursorOption::Done; // Search says done

    let new_content_cursor = compute_next_cursor(
        &content_next_cursor,
        3, // all included
        3, // all returned
        find_last_of_source(&final_tagged, SearchSource::Content),
        &SearchCursorOption::NotDone(None),
    );

    assert!(new_content_cursor.is_done());
}

// ==================== CRM source cursor scenarios ====================

#[test]
fn test_cursor_logic_crm_starved_preserves_cursor() {
    // The regression-prone case for the newly-added CRM source: CRM returned
    // a page of hits and reported more available, but the global merge/sort
    // put only newer non-CRM hits on this page. The CRM cursor must be carried
    // forward unchanged — advancing it (or marking it Done) would skip the CRM
    // hits that never made it onto a page. This mirrors the exact arguments
    // `perform_unified_search` passes for the CRM source.
    let incoming_crm_id = Uuid::new_v4();
    let incoming_crm_ts = ts(500);
    let incoming_crm_cursor = SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
        entity_id: incoming_crm_id,
        updated_at: incoming_crm_ts,
    }));

    // Final page: all non-CRM (CRM starved out by newer doc/chat hits).
    let final_tagged: Vec<TaggedSearchHit> = vec![
        make_tagged_hit(Uuid::new_v4(), Some(ts(9000)), SearchSource::Content),
        make_tagged_hit(Uuid::new_v4(), Some(ts(8000)), SearchSource::ChatName),
    ];

    // CRM returned hits this round and reported more available.
    let crm_next_cursor = SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
        entity_id: Uuid::new_v4(),
        updated_at: ts(100),
    }));
    let included_crm = final_tagged
        .iter()
        .filter(|h| h.source == SearchSource::CrmCompany)
        .count();
    assert_eq!(included_crm, 0, "precondition: no CRM hit made the page");

    let new_crm_cursor = compute_next_cursor(
        &crm_next_cursor,
        included_crm,
        5, // CRM originally returned a full page of hits
        find_last_of_source(&final_tagged, SearchSource::CrmCompany),
        &incoming_crm_cursor,
    );

    match new_crm_cursor {
        SearchCursorOption::NotDone(Some(cursor)) => {
            let (id, t) = cursor.as_updated_at().expect("expected UpdatedAt cursor");
            assert_eq!(id, incoming_crm_id, "CRM cursor must not advance");
            assert_eq!(t, incoming_crm_ts, "CRM cursor must not advance");
        }
        other => panic!(
            "expected the incoming CRM cursor preserved, got {:?}",
            other
        ),
    }
}

#[test]
fn test_cursor_logic_crm_included_advances_cursor() {
    // The companion case: when a CRM hit does make the page, the CRM cursor
    // advances to the last included CRM hit (keyset position for the next page).
    let crm_id = Uuid::new_v4();
    let crm_ts = ts(7000);
    let final_tagged: Vec<TaggedSearchHit> = vec![
        make_tagged_hit(Uuid::new_v4(), Some(ts(9000)), SearchSource::Content),
        make_tagged_hit(crm_id, Some(crm_ts), SearchSource::CrmCompany),
    ];

    let crm_next_cursor = SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
        entity_id: Uuid::new_v4(),
        updated_at: ts(100),
    }));
    let included_crm = final_tagged
        .iter()
        .filter(|h| h.source == SearchSource::CrmCompany)
        .count();

    let new_crm_cursor = compute_next_cursor(
        &crm_next_cursor,
        included_crm,
        5,
        find_last_of_source(&final_tagged, SearchSource::CrmCompany),
        &SearchCursorOption::NotDone(None),
    );

    match new_crm_cursor {
        SearchCursorOption::NotDone(Some(cursor)) => {
            let (id, t) = cursor.as_updated_at().expect("expected UpdatedAt cursor");
            assert_eq!(id, crm_id);
            assert_eq!(t, crm_ts);
        }
        other => panic!(
            "expected cursor at the last included CRM hit, got {:?}",
            other
        ),
    }
}

#[test]
fn enforce_term_limits_accepts_at_max() {
    let terms: Vec<String> = (0..MAX_SEARCH_TERMS).map(|i| format!("t{i}")).collect();
    let out = enforce_term_limits(terms.clone()).expect("at-limit term count should pass");
    assert_eq!(out, terms);
}

#[test]
fn enforce_term_limits_rejects_over_max() {
    let terms: Vec<String> = (0..=MAX_SEARCH_TERMS).map(|i| format!("t{i}")).collect();
    assert_eq!(terms.len(), MAX_SEARCH_TERMS + 1);
    assert!(matches!(
        enforce_term_limits(terms),
        Err(SearchError::TooManyTerms)
    ));
}

#[test]
fn enforce_term_limits_truncates_long_term() {
    let long = "a".repeat(MAX_TERM_CHARS + 25);
    let out = enforce_term_limits(vec![long]).expect("single term is under the count cap");
    assert_eq!(out[0].chars().count(), MAX_TERM_CHARS);
}

#[test]
fn enforce_term_limits_leaves_short_terms_untouched() {
    let terms = vec!["hello".to_string(), "world".to_string()];
    let out = enforce_term_limits(terms.clone()).expect("short terms pass");
    assert_eq!(out, terms);
}

#[test]
fn enforce_term_limits_truncates_on_char_boundary() {
    let long = "é".repeat(MAX_TERM_CHARS + 10);
    let out = enforce_term_limits(vec![long]).expect("single term is under the count cap");
    assert_eq!(out[0].chars().count(), MAX_TERM_CHARS);
}

/// The flag is the only thing keeping calendar events out of a deployed
/// environment's search results, so the override direction matters: a request
/// that asks for them must still get nothing while the flag is off.
#[test]
fn the_calendar_flag_overrides_what_the_request_asked_for() {
    assert!(
        calendar_events_searchable(true, true),
        "requested and enabled is the only combination that searches calendar"
    );
    assert!(
        !calendar_events_searchable(true, false),
        "an explicit request must not defeat a disabled environment"
    );
    assert!(
        !calendar_events_searchable(false, true),
        "an enabled environment must still honour a NIL-excluded request"
    );
    assert!(!calendar_events_searchable(false, false));
}

#[test]
fn channel_name_cursor_round_trips_through_the_unified_cursor() {
    let entity_id = Uuid::now_v7();
    let cursor = SearchCursor {
        chat_name_cursor: SearchCursorOption::Done,
        content_cursor: SearchCursorOption::Done,
        project_name_cursor: SearchCursorOption::Done,
        crm_company_cursor: SearchCursorOption::Done,
        channel_name_cursor: SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
            entity_id,
            updated_at: ts(1000),
        })),
        document_term_matching: None,
    };

    let decoded = SearchCursor::decode(&cursor.encode().expect("encode")).expect("decode");

    assert!(
        !decoded.is_exhausted(),
        "a pending channel name cursor keeps the page alive"
    );
    let SearchCursorOption::NotDone(Some(channel_cursor)) = decoded.channel_name_cursor else {
        panic!("expected the channel name cursor to survive the round trip");
    };
    assert_eq!(channel_cursor.as_updated_at(), Some((entity_id, ts(1000))));
}

fn caller(origin: macro_authorization::CredentialOrigin) -> MacroUserAuthentication {
    let user_id = "macro|user@example.com";
    MacroUserAuthentication {
        origin,
        agent_id: None,
        agent_via: None,
        routine_id: None,
        macro_user_id: macro_user_id::user_id::MacroUserIdStr::try_from(user_id.to_string())
            .expect("valid user id"),
        user_context: UserContext {
            user_id: user_id.to_string(),
            fusion_user_id: "fusion-user-id".to_string(),
            permissions: None,
            organization_id: None,
        },
    }
}

/// The span is what production traces keep of a search, so it holds the mode,
/// the sizes and the caller, and nothing the user typed or picked.
#[test]
fn the_unified_search_span_carries_the_mode_and_not_the_request() {
    use crate::api::search::span_capture::SpanFields;

    let (fields, _guard) = SpanFields::install();
    let chat_id = "0191b9a2-7c7e-7c3a-9d53-6f1f8b0d2a11";
    let mut req = UnifiedSearchRequest {
        query: "severance offer letter".to_string(),
        match_type: MatchType::Partial,
        filters: Default::default(),
        filter_expression: None,
        search_on: SearchOn::NameContent,
        include_crm: false,
        calendar_event_scope: Default::default(),
        term_matching: Default::default(),
        collapse: None,
    };
    req.filters.chat_filters.chat_ids = vec![chat_id.to_string()];
    let query_params = SearchPaginationParams {
        page: None,
        page_size: Some(25),
        cursor: None,
    };

    let span = unified_search_span(
        &caller(macro_authorization::CredentialOrigin::Internal),
        &query_params,
        &req,
    );
    span.in_scope(|| {
        record_term_counts(&tracing::Span::current(), 3, 0);
        tracing::Span::current().record(
            "search.entity_types",
            searched_entity_types(
                &[
                    models_opensearch::OpenSearchEntityType::Emails,
                    models_opensearch::OpenSearchEntityType::Chats,
                ]
                .into(),
                &[
                    ("chats", true),
                    ("channels", false),
                    ("crm_companies", true),
                ],
            ),
        );
    });

    let span = fields.of("perform_unified_search");
    assert_eq!(span["search.caller"], "internal");
    assert_eq!(span["search.caller_agent"], "false");
    assert_eq!(span["search.search_on"], "name_content");
    assert_eq!(span["search.match_type"], "partial");
    assert_eq!(span["search.page_size"], "25");
    assert_eq!(span["search.entity_types"], "chats,crm_companies,emails");
    assert_eq!(span["search.terms"], "3");
    assert_eq!(span["search.dropped_terms"], "0");
    assert_eq!(
        span.keys().copied().collect::<Vec<_>>(),
        [
            "search.caller",
            "search.caller_agent",
            "search.dropped_terms",
            "search.entity_types",
            "search.match_type",
            "search.page_size",
            "search.search_on",
            "search.terms",
            "user_id",
        ]
    );
    for value in span.values() {
        assert!(!value.contains("severance"), "the query reached the span");
        assert!(!value.contains(chat_id), "a filter value reached the span");
    }
}

#[test]
fn the_unified_search_span_defaults_the_page_size() {
    use crate::api::search::span_capture::SpanFields;

    let (fields, _guard) = SpanFields::install();
    let req = UnifiedSearchRequest {
        query: "quarterly plan".to_string(),
        match_type: MatchType::Exact,
        filters: Default::default(),
        filter_expression: None,
        search_on: SearchOn::Content,
        include_crm: false,
        calendar_event_scope: Default::default(),
        term_matching: Default::default(),
        collapse: None,
    };
    let query_params = SearchPaginationParams {
        page: None,
        page_size: None,
        cursor: None,
    };

    let _span = unified_search_span(
        &caller(macro_authorization::CredentialOrigin::Session),
        &query_params,
        &req,
    );

    let span = fields.of("perform_unified_search");
    assert_eq!(span["search.caller"], "session");
    assert_eq!(span["search.page_size"], "10");
}

// ============ Tests for read_until_page_kept (email thread states) ============

/// A mailbox of `total` email threads, newest first, one hit each.
fn mailbox(total: u128) -> Vec<SearchHit> {
    (0..total)
        .map(|n| SearchHit {
            entity_id: Uuid::from_u128(n + 1),
            entity_type: SearchEntityType::Emails,
            updated_at: Some(ts(1_000_000 - n as i64)),
            score: None,
            highlight: Highlight::default(),
            goto: None,
        })
        .collect()
}

/// Pages through `hits` the way OpenSearch does: `page_size` hits after the
/// cursor's anchor, and a cursor on the last one while more remain.
fn page_after(
    hits: &[SearchHit],
    cursor: &SearchCursorOption,
    page_size: usize,
) -> (Vec<SearchHit>, SearchCursorOption) {
    let start = match cursor {
        SearchCursorOption::NotDone(Some(cursor)) => {
            let (anchor, _) = cursor.as_updated_at().unwrap();
            hits.iter().position(|hit| hit.entity_id == anchor).unwrap() + 1
        }
        _ => 0,
    };
    let page: Vec<SearchHit> = hits.iter().skip(start).take(page_size).cloned().collect();
    let more = start + page.len() < hits.len();
    let cursor = match page.last() {
        Some(last) if more => SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
            entity_id: last.entity_id,
            updated_at: last.updated_at.unwrap(),
        })),
        _ => SearchCursorOption::Done,
    };
    (page, cursor)
}

fn anchor(cursor: &SearchCursorOption) -> Uuid {
    match cursor {
        SearchCursorOption::NotDone(Some(cursor)) => cursor.as_updated_at().unwrap().0,
        other => panic!("expected a cursor, got {other:?}"),
    }
}

fn page_args(page_size: u32) -> UnifiedSearchArgs {
    UnifiedSearchArgs {
        page_size,
        ..Default::default()
    }
}

async fn read_with_matching(
    hits: &[SearchHit],
    page_size: u32,
    matches: impl Fn(Uuid) -> bool,
    cursor: SearchCursorOption,
) -> (ContentHits, StateCheckRounds) {
    let mut args = page_args(page_size);
    args.cursor = cursor;
    read_until_page_kept(
        args,
        |args| std::future::ready(Ok(page_after(hits, &args.cursor, args.page_size as usize))),
        |ids: Vec<Uuid>| {
            std::future::ready(Ok(ids.into_iter().filter(|id| matches(*id)).collect()))
        },
    )
    .await
    .unwrap()
}

fn ids(content: &ContentHits) -> Vec<u128> {
    content
        .hits
        .iter()
        .map(|hit| hit.entity_id.as_u128())
        .collect()
}

#[tokio::test]
async fn matching_threads_behind_a_first_page_that_all_fails_are_returned() {
    // The first 100 hits fail the filter; the matching threads come after.
    let hits = mailbox(400);
    let matches = |id: Uuid| id.as_u128() > 100 && id.as_u128().is_multiple_of(2);

    let (content, rounds) =
        read_with_matching(&hits, 100, matches, SearchCursorOption::NotDone(None)).await;

    assert_eq!(content.hits.len(), 100);
    assert_eq!(ids(&content)[0], 102);
    assert_eq!(*ids(&content).last().unwrap(), 300);
    assert!(content.hits.iter().all(|hit| matches(hit.entity_id)));
    assert_eq!(rounds.rounds, 3);
    assert!(!rounds.bound_reached);
    // The next page starts after the last hit read, past the ones dropped.
    assert_eq!(anchor(&content.cursor).as_u128(), 300);
}

#[tokio::test]
async fn a_short_mailbox_ends_with_what_matched() {
    let hits = mailbox(150);
    let matches = |id: Uuid| id.as_u128() > 140;

    let (content, rounds) =
        read_with_matching(&hits, 100, matches, SearchCursorOption::NotDone(None)).await;

    assert_eq!(ids(&content), (141..=150).collect::<Vec<_>>());
    assert!(content.cursor.is_done());
    assert_eq!(rounds.rounds, 2);
    assert!(!rounds.bound_reached);
}

#[tokio::test]
async fn reading_stops_at_the_bound_and_resumes_past_every_hit_read() {
    // One match, far beyond what one request reads.
    let page_size = 100u128;
    let read_per_request = page_size * u128::from(MAX_EMAIL_STATE_ROUNDS);
    let hits = mailbox(read_per_request * 3);
    let target = read_per_request * 2 + 7;
    let matches = |id: Uuid| id.as_u128() == target;

    let (first, rounds) =
        read_with_matching(&hits, 100, matches, SearchCursorOption::NotDone(None)).await;

    assert!(first.hits.is_empty());
    assert_eq!(rounds.rounds, MAX_EMAIL_STATE_ROUNDS);
    assert!(rounds.bound_reached);
    assert_eq!(rounds.threads_checked, read_per_request as usize);

    // Each request moves the cursor a full bound on, so the match is reached.
    let (second, _) = read_with_matching(&hits, 100, matches, first.cursor).await;
    assert!(second.hits.is_empty());
    let (third, rounds) = read_with_matching(&hits, 100, matches, second.cursor).await;
    assert_eq!(ids(&third), vec![target]);
    assert!(third.cursor.is_done());
    assert!(!rounds.bound_reached);
}

#[tokio::test]
async fn other_entity_types_are_kept_without_a_check() {
    let mut hits = mailbox(10);
    hits[3].entity_type = SearchEntityType::Documents;
    let checked = std::sync::Mutex::new(Vec::new());

    let (content, _) = read_until_page_kept(
        page_args(100),
        |args| std::future::ready(Ok(page_after(&hits, &args.cursor, args.page_size as usize))),
        |ids: Vec<Uuid>| {
            checked.lock().unwrap().extend(ids);
            std::future::ready(Ok(HashSet::new()))
        },
    )
    .await
    .unwrap();

    assert_eq!(ids(&content), vec![4]);
    assert!(!checked.lock().unwrap().contains(&Uuid::from_u128(4)));
}

#[test]
fn a_checked_page_that_kept_nothing_still_moves_on() {
    let read_past = SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
        entity_id: Uuid::from_u128(500),
        updated_at: ts(500),
    }));
    let original = SearchCursorOption::NotDone(None);

    let next = next_content_cursor(true, &read_past, 0, 0, None, &original);

    assert_eq!(anchor(&next), Uuid::from_u128(500));
}

#[test]
fn a_checked_page_resumes_after_the_last_hit_read_not_the_last_kept() {
    let read_past = SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
        entity_id: Uuid::from_u128(500),
        updated_at: ts(500),
    }));
    let last_kept = make_tagged_hit(Uuid::from_u128(20), Some(ts(980)), SearchSource::Content);

    let next = next_content_cursor(
        true,
        &read_past,
        3,
        3,
        Some(&last_kept),
        &SearchCursorOption::NotDone(None),
    );

    assert_eq!(anchor(&next), Uuid::from_u128(500));
}

#[test]
fn a_checked_page_truncated_by_the_merge_resumes_after_the_last_hit_shown() {
    let read_past = SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
        entity_id: Uuid::from_u128(500),
        updated_at: ts(500),
    }));
    let last_kept = make_tagged_hit(Uuid::from_u128(20), Some(ts(980)), SearchSource::Content);

    let next = next_content_cursor(
        true,
        &read_past,
        2,
        3,
        Some(&last_kept),
        &SearchCursorOption::NotDone(None),
    );

    assert_eq!(anchor(&next), Uuid::from_u128(20));
}

#[tokio::test]
async fn a_checked_page_counts_hits_as_an_unfiltered_page_does() {
    // Two messages per thread: a page of 100 hits holds 50 threads.
    let hits: Vec<SearchHit> = mailbox(400)
        .into_iter()
        .map(|mut hit| {
            hit.entity_id = Uuid::from_u128(hit.entity_id.as_u128().div_ceil(2));
            hit
        })
        .collect();

    let (content, rounds) =
        read_with_matching(&hits, 100, |_| true, SearchCursorOption::NotDone(None)).await;

    assert_eq!(content.hits.len(), 100);
    assert_eq!(rounds.rounds, 1);
}

// ============ Tests for the caller's turn (search lanes) ============

fn agent_of_caller() -> MacroUserAuthentication {
    MacroUserAuthentication {
        agent_id: Some(bot_id::BotId::new_from_uuid(Uuid::from_u128(0xA9E7))),
        ..caller(macro_authorization::CredentialOrigin::MacroApiJwt)
    }
}

fn one_at_a_time() -> SearchLanes {
    SearchLanes::new(crate::domain::search_lanes::LanePolicy {
        app_concurrency: 1,
        concurrency: 1,
        max_wait: std::time::Duration::from_secs(20),
    })
}

fn search_request(query: &str) -> UnifiedSearchRequest {
    UnifiedSearchRequest {
        query: query.to_string(),
        match_type: MatchType::Partial,
        filters: Default::default(),
        filter_expression: None,
        search_on: SearchOn::NameContent,
        include_crm: false,
        calendar_event_scope: Default::default(),
        term_matching: Default::default(),
        collapse: None,
    }
}

fn no_paging() -> SearchPaginationParams {
    SearchPaginationParams {
        page: None,
        page_size: None,
        cursor: None,
    }
}

fn search_span() -> tracing::Span {
    unified_search_span(
        &agent_of_caller(),
        &no_paging(),
        &search_request("quarterly plan"),
    )
}

struct NoSessions;

impl agent_session::domain::search::AgentSessionSearchMetadataService for NoSessions {
    fn search_metadata(
        &self,
        _ids: Vec<Uuid>,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = agent_session::domain::error::Result<
                        Vec<agent_session::domain::search::AgentSessionSearchMetadata>,
                    >,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async { Ok(Vec::new()) })
    }
}

struct NoLabels;

impl calendar_events::domain::ports::CalendarEventLabelReader for NoLabels {
    fn event_labels<'a>(
        &'a self,
        _requester_id: &'a str,
        _event_ids: &'a [Uuid],
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<
                        std::collections::HashMap<
                            Uuid,
                            calendar_events::domain::labels::EventLabels,
                        >,
                        rootcause::Report,
                    >,
                > + Send
                + 'a,
        >,
    > {
        Box::pin(async { Ok(std::collections::HashMap::new()) })
    }
}

/// Handler state whose database and OpenSearch cannot be reached, so a
/// search that gets past its turn waits 25 s for a connection, longer than a
/// turn's longest wait, and then fails.
fn unreachable_state(lanes: SearchLanes) -> SearchHandlerState {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .acquire_timeout(std::time::Duration::from_secs(25))
        .connect_lazy("postgres://user:password@127.0.0.1:1/unreachable")
        .unwrap();
    SearchHandlerState {
        db: readonly_pool::ReadOnlyPool(pool.clone()),
        crm_db: pool.clone(),
        opensearch_client: std::sync::Arc::new(
            opensearch_client::OpensearchClient::new(
                "http://127.0.0.1:1".to_string(),
                String::new(),
                String::new(),
            )
            .unwrap(),
        ),
        entity_access_service: std::sync::Arc::new(
            entity_access::domain::service::EntityAccessServiceImpl::new(
                entity_access::outbound::PgAccessRepository::new(pool),
            ),
        ),
        authorization_state: macro_authorization::MacroAuthorizationState::new(
            std::sync::Arc::new(macro_authorization::MacroAuthorizationServiceImpl::new(
                macro_authorization::MacroAuthJwtValidator::new(
                    macro_auth::middleware::decode_jwt::JwtValidationArgs::new_testing(),
                ),
                macro_authorization::InternalAuthConfig {
                    api_key: "test-internal-key".to_string(),
                    default_user_id: None,
                },
                macro_authorization::NoBotAuthorizer,
                macro_authorization::NoUserApiKeyAuthorizer,
            )),
        ),
        agent_session_search_metadata: std::sync::Arc::new(NoSessions),
        calendar_search_enabled: false,
        calendar_event_labels: std::sync::Arc::new(NoLabels),
        term_matching_rollout: std::sync::Arc::new(crate::LocalTermMatching),
        search_lanes: std::sync::Arc::new(lanes),
        api_key_search_buckets: std::sync::Arc::new(FixedBucket::answering(Some(
            rate_limit::TokenBucketResult::Taken { remaining: 200 },
        ))),
    }
}

/// A unified search waits for its caller's turn before it reads anything,
/// and one still waiting at the deadline is refused as busy.
#[tokio::test(start_paused = true)]
async fn a_unified_search_waits_for_its_callers_turn_before_reading_anything() {
    let ctx = unreachable_state(one_at_a_time());
    let _running = ctx
        .search_lanes
        .take_turn(search_caller(&agent_of_caller()))
        .await
        .unwrap();

    let started = tokio::time::Instant::now();
    let refused = perform_unified_search(
        &ctx,
        &agent_of_caller(),
        true,
        no_paging(),
        search_request("quarterly plan"),
    )
    .await
    .map(|_| ());

    assert!(matches!(refused, Err(SearchError::Busy)), "{refused:?}");
    assert_eq!(started.elapsed(), std::time::Duration::from_secs(20));
}

/// A search holds its caller's turn while it reads, so the caller's next
/// search waits for it, here until the deadline.
#[tokio::test(start_paused = true)]
async fn a_search_holds_its_callers_turn_while_it_reads() {
    let ctx = std::sync::Arc::new(unreachable_state(one_at_a_time()));
    let mut reading = tokio::spawn({
        let ctx = std::sync::Arc::clone(&ctx);
        async move {
            perform_unified_search(
                &ctx,
                &agent_of_caller(),
                false,
                no_paging(),
                search_request("quarterly plan"),
            )
            .await
            .map(|_| ())
        }
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(1), &mut reading)
            .await
            .is_err()
    );

    let next = perform_unified_search(
        &ctx,
        &agent_of_caller(),
        false,
        no_paging(),
        search_request("quarterly plan"),
    )
    .await
    .map(|_| ());

    assert!(matches!(next, Err(SearchError::Busy)), "{next:?}");
    assert!(!matches!(reading.await.unwrap(), Err(SearchError::Busy)));
}

/// A request that cannot be searched fails at once, even while its caller's
/// lane is full, rather than waiting its turn to be told so.
#[tokio::test(start_paused = true)]
async fn a_malformed_search_fails_at_once_while_its_callers_lane_is_full() {
    let ctx = unreachable_state(one_at_a_time());
    let _running = ctx
        .search_lanes
        .take_turn(search_caller(&agent_of_caller()))
        .await
        .unwrap();

    let started = tokio::time::Instant::now();
    let refused = perform_unified_search(
        &ctx,
        &agent_of_caller(),
        false,
        no_paging(),
        search_request("  "),
    )
    .await
    .map(|_| ());

    assert!(
        matches!(refused, Err(SearchError::EmptyQuery)),
        "{refused:?}"
    );
    assert_eq!(started.elapsed(), std::time::Duration::ZERO);

    let mut crm_filtered = search_request("quarterly plan");
    crm_filtered.filters.email_filters.crm_domains = vec!["example.com".to_string()];
    let refused =
        perform_unified_search(&ctx, &agent_of_caller(), false, no_paging(), crm_filtered)
            .await
            .map(|_| ());
    assert!(
        matches!(
            refused,
            Err(SearchError::UnsupportedEmailFilter("crm_domains"))
        ),
        "{refused:?}"
    );
    assert_eq!(started.elapsed(), std::time::Duration::ZERO);
}

/// A search records on its span which lane it waited in, how long, and how
/// the wait ended, so a queued search can be told apart from a slow one.
#[tokio::test(start_paused = true)]
async fn a_search_records_its_wait_for_the_callers_turn_on_its_span() {
    use crate::api::search::span_capture::SpanFields;

    let (fields, _guard) = SpanFields::install();
    let lanes = one_at_a_time();

    let running = take_search_turn(&lanes, search_caller(&agent_of_caller()))
        .instrument(search_span())
        .await
        .unwrap();
    let span = fields.of("perform_unified_search");
    assert_eq!(span["search.lane"], "agent");
    assert_eq!(span["search.lane_outcome"], "immediate");
    assert_eq!(span["search.lane_wait_ms"], "0");

    let refused = take_search_turn(&lanes, search_caller(&agent_of_caller()))
        .instrument(search_span())
        .await;
    assert!(matches!(refused, Err(SearchError::Busy)));
    let span = fields.of("perform_unified_search");
    assert_eq!(span["search.lane_outcome"], "refused");
    assert_eq!(span["search.lane_wait_ms"], "20000");

    let mut waiting = tokio::spawn({
        let lanes = std::sync::Arc::new(lanes);
        async move {
            take_search_turn(&lanes, search_caller(&agent_of_caller()))
                .instrument(search_span())
                .await
                .map(|turn| turn.waited)
        }
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(3), &mut waiting)
            .await
            .is_err()
    );
    drop(running);
    assert_eq!(
        waiting.await.unwrap().unwrap(),
        std::time::Duration::from_secs(3)
    );
    let span = fields.of("perform_unified_search");
    assert_eq!(span["search.lane_outcome"], "queued");
    assert_eq!(span["search.lane_wait_ms"], "3000");
}

/// The person's own app search never waits behind anything searching for
/// them: their agent, their routine, a service such as an agent's native
/// search tools, or their API key, each of which has a lane of its own.
#[tokio::test(start_paused = true)]
async fn a_persons_app_search_never_waits_behind_what_searches_for_them() {
    use macro_authorization::CredentialOrigin;

    let lanes = one_at_a_time();
    let routine = MacroUserAuthentication {
        routine_id: Some(Uuid::from_u128(0x2007)),
        ..caller(CredentialOrigin::MacroApiJwt)
    };
    let mut held = Vec::new();
    for program in [
        agent_of_caller(),
        routine,
        caller(CredentialOrigin::Internal),
        caller(CredentialOrigin::UserApiKey),
    ] {
        let turn = take_search_turn(&lanes, search_caller(&program))
            .await
            .unwrap();
        assert!(!turn.queued, "{:?} shares a lane", program.origin);
        held.push(turn);
    }

    let own = take_search_turn(&lanes, search_caller(&caller(CredentialOrigin::Session)))
        .await
        .unwrap();
    assert!(!own.queued);
}

/// A refused search is a 429 the caller can pace on, not a failure.
#[test]
fn a_refused_search_is_answered_too_many_requests_with_retry_after() {
    let response = axum::response::IntoResponse::into_response(SearchError::Busy);
    assert_eq!(response.status(), axum::http::StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.headers()[axum::http::header::RETRY_AFTER], "1");
}

// ============ Tests for the API-key search allowance ============

/// A bucket that always answers the same, or fails as Redis down would, and
/// counts how often it was asked.
struct FixedBucket {
    answer: Option<rate_limit::TokenBucketResult>,
    takes: std::sync::atomic::AtomicUsize,
}

impl FixedBucket {
    fn answering(answer: Option<rate_limit::TokenBucketResult>) -> Self {
        FixedBucket {
            answer,
            takes: std::sync::atomic::AtomicUsize::new(0),
        }
    }
}

impl rate_limit::TokenBucketPort for FixedBucket {
    async fn take(
        &self,
        _key: rate_limit::RateLimitKey,
        _config: rate_limit::TokenBucketConfig,
    ) -> Result<rate_limit::TokenBucketResult, rootcause::Report> {
        self.takes.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.answer.ok_or_else(|| {
            rootcause::Report::new(std::io::Error::other("connection refused")).into_dynamic()
        })
    }
}

/// An API key whose account used its allowance is refused at once, not after
/// waiting for its turn, and told when to retry.
#[tokio::test(start_paused = true)]
async fn an_api_key_search_past_its_accounts_allowance_is_refused_before_it_waits() {
    use macro_authorization::CredentialOrigin;

    let ctx = SearchHandlerState {
        api_key_search_buckets: std::sync::Arc::new(FixedBucket::answering(Some(
            rate_limit::TokenBucketResult::Empty {
                retry_after: std::time::Duration::from_millis(300),
            },
        ))),
        ..unreachable_state(one_at_a_time())
    };
    let api_key = caller(CredentialOrigin::UserApiKey);
    let _running = ctx
        .search_lanes
        .take_turn(search_caller(&api_key))
        .await
        .unwrap();

    let started = tokio::time::Instant::now();
    let refused = perform_unified_search(
        &ctx,
        &api_key,
        false,
        no_paging(),
        search_request("quarterly plan"),
    )
    .await
    .map(|_| ());

    assert!(
        matches!(
            refused,
            Err(SearchError::RateLimited {
                retry_after_seconds: 1
            })
        ),
        "{refused:?}"
    );
    assert_eq!(started.elapsed(), std::time::Duration::ZERO);
}

/// When the allowance cannot be read the API key searches anyway: here it
/// gets as far as waiting for its turn.
#[tokio::test(start_paused = true)]
async fn an_api_key_search_runs_when_its_allowance_cannot_be_read() {
    use macro_authorization::CredentialOrigin;

    let ctx = SearchHandlerState {
        api_key_search_buckets: std::sync::Arc::new(FixedBucket::answering(None)),
        ..unreachable_state(one_at_a_time())
    };
    let api_key = caller(CredentialOrigin::UserApiKey);
    let _running = ctx
        .search_lanes
        .take_turn(search_caller(&api_key))
        .await
        .unwrap();

    let refused = perform_unified_search(
        &ctx,
        &api_key,
        false,
        no_paging(),
        search_request("quarterly plan"),
    )
    .await
    .map(|_| ());

    assert!(matches!(refused, Err(SearchError::Busy)), "{refused:?}");
}

/// Only a user API key draws on the allowance: the app, agents, routines,
/// services, Macro API tokens and account managers never ask the bucket.
#[tokio::test(start_paused = true)]
async fn only_user_api_key_searches_draw_on_the_allowance() {
    use macro_authorization::{AccountManagerCredential, CredentialOrigin};

    let bucket = std::sync::Arc::new(FixedBucket::answering(Some(
        rate_limit::TokenBucketResult::Empty {
            retry_after: std::time::Duration::from_secs(1),
        },
    )));
    let ctx = SearchHandlerState {
        api_key_search_buckets: bucket.clone(),
        ..unreachable_state(one_at_a_time())
    };
    let routine = MacroUserAuthentication {
        routine_id: Some(Uuid::from_u128(0x2007)),
        ..caller(CredentialOrigin::MacroApiJwt)
    };
    let account_manager = caller(CredentialOrigin::AccountManager(AccountManagerCredential {
        grant_id: Uuid::from_u128(0x6A47),
        manager_user_id: macro_user_id::user_id::MacroUserIdStr::try_from(
            "macro|manager@example.com".to_string(),
        )
        .unwrap(),
    }));

    for searcher in [
        caller(CredentialOrigin::Session),
        agent_of_caller(),
        routine,
        caller(CredentialOrigin::Internal),
        caller(CredentialOrigin::MacroApiJwt),
        account_manager,
    ] {
        let _running = ctx
            .search_lanes
            .take_turn(search_caller(&searcher))
            .await
            .unwrap();
        let result = perform_unified_search(
            &ctx,
            &searcher,
            false,
            no_paging(),
            search_request("quarterly plan"),
        )
        .await
        .map(|_| ());
        assert!(
            matches!(result, Err(SearchError::Busy)),
            "{:?}: {result:?}",
            searcher.origin
        );
    }

    assert_eq!(bucket.takes.load(std::sync::atomic::Ordering::SeqCst), 0);
}

/// An API-key search records on its span whether it was limited, how many
/// searches its account had left and how long the bucket took, so limited
/// callers and a slow bucket can be found.
#[tokio::test(start_paused = true)]
async fn an_api_key_search_records_its_allowance_on_its_span() {
    use crate::api::search::span_capture::SpanFields;

    let (fields, _guard) = SpanFields::install();

    let unreadable = SearchHandlerState {
        api_key_search_buckets: std::sync::Arc::new(FixedBucket::answering(None)),
        ..unreachable_state(one_at_a_time())
    };
    let account = MacroUserId::parse_from_str("macro|user@example.com")
        .unwrap()
        .lowercase();
    draw_search_allowance(&unreadable, &account)
        .instrument(search_span())
        .await
        .unwrap();
    let span = fields.of("perform_unified_search");
    assert_eq!(span["search.rate_limit"], "unavailable");
    assert!(!span.contains_key("search.rate_limit_remaining"));
    assert_eq!(span["search.rate_limit_wait_ms"], "0");

    let allowed = SearchHandlerState {
        api_key_search_buckets: std::sync::Arc::new(FixedBucket::answering(Some(
            rate_limit::TokenBucketResult::Taken { remaining: 199 },
        ))),
        ..unreachable_state(one_at_a_time())
    };
    draw_search_allowance(&allowed, &account)
        .instrument(search_span())
        .await
        .unwrap();
    let span = fields.of("perform_unified_search");
    assert_eq!(span["search.rate_limit"], "allowed");
    assert_eq!(span["search.rate_limit_remaining"], "199");
    assert_eq!(span["search.rate_limit_wait_ms"], "0");

    let limited = SearchHandlerState {
        api_key_search_buckets: std::sync::Arc::new(FixedBucket::answering(Some(
            rate_limit::TokenBucketResult::Empty {
                retry_after: std::time::Duration::from_millis(1500),
            },
        ))),
        ..unreachable_state(one_at_a_time())
    };
    let refused = draw_search_allowance(&limited, &account)
        .instrument(search_span())
        .await;
    assert!(
        matches!(
            refused,
            Err(SearchError::RateLimited {
                retry_after_seconds: 2
            })
        ),
        "{refused:?}"
    );
    let span = fields.of("perform_unified_search");
    assert_eq!(span["search.rate_limit"], "limited");
    assert_eq!(span["search.rate_limit_remaining"], "0");
}

/// A limited search is a 429 that says when the account may search again.
#[test]
fn a_limited_search_is_answered_too_many_requests_with_its_retry_after() {
    let response = axum::response::IntoResponse::into_response(SearchError::RateLimited {
        retry_after_seconds: 3,
    });
    assert_eq!(response.status(), axum::http::StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.headers()[axum::http::header::RETRY_AFTER], "3");
}
