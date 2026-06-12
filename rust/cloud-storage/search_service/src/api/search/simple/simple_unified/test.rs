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
fn test_compute_next_cursor_search_is_done_returns_done() {
    // When search returned Done, always return Done regardless of other params
    let result = compute_next_cursor(
        &SearchCursorOption::Done,
        5,  // included_count
        10, // original_count (more than included)
        Some(&make_tagged_hit(
            Uuid::new_v4(),
            Some(ts(1000)),
            SearchSource::DocumentName,
        )),
        &SearchCursorOption::NotDone(None),
    );

    assert!(result.is_done());
}

#[test]
fn test_compute_next_cursor_excluded_results_with_included_generates_cursor() {
    // When some results were excluded (included < original) and we have included results,
    // generate cursor from the last included hit
    let entity_id = Uuid::new_v4();
    let timestamp = ts(1000);
    let last_hit = make_tagged_hit(entity_id, Some(timestamp), SearchSource::DocumentName);

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

// ==================== Tests for find_last_of_source ====================

#[test]
fn test_find_last_of_source_finds_correct_source() {
    let doc_id = Uuid::new_v4();
    let chat_id = Uuid::new_v4();
    let doc2_id = Uuid::new_v4();

    let results = vec![
        make_tagged_hit(doc_id, Some(ts(1000)), SearchSource::DocumentName),
        make_tagged_hit(chat_id, Some(ts(2000)), SearchSource::ChatName),
        make_tagged_hit(doc2_id, Some(ts(3000)), SearchSource::DocumentName),
    ];

    let last_doc = find_last_of_source(&results, SearchSource::DocumentName);
    assert!(last_doc.is_some());
    assert_eq!(last_doc.unwrap().hit.entity_id, doc2_id);

    let last_chat = find_last_of_source(&results, SearchSource::ChatName);
    assert!(last_chat.is_some());
    assert_eq!(last_chat.unwrap().hit.entity_id, chat_id);
}

#[test]
fn test_find_last_of_source_returns_none_when_not_found() {
    let results = vec![
        make_tagged_hit(Uuid::new_v4(), Some(ts(1000)), SearchSource::DocumentName),
        make_tagged_hit(Uuid::new_v4(), Some(ts(2000)), SearchSource::ChatName),
    ];

    let last_email = find_last_of_source(&results, SearchSource::Content);
    assert!(last_email.is_none());
}

#[test]
fn test_find_last_of_source_empty_results() {
    let results: Vec<TaggedSearchHit> = vec![];
    let result = find_last_of_source(&results, SearchSource::DocumentName);
    assert!(result.is_none());
}

// ==================== Tests for cursor_from_tagged ====================

#[test]
fn test_cursor_from_tagged_with_timestamp() {
    let entity_id = Uuid::new_v4();
    let timestamp = ts(1000);
    let hit = make_tagged_hit(entity_id, Some(timestamp), SearchSource::DocumentName);

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
    // - Search returned 10 documents
    // - Only 3 made it into the final page (others had newer timestamps from other sources)
    // - The cursor should point to the last included document

    let doc_ids: Vec<Uuid> = (0..10).map(|_| Uuid::new_v4()).collect();
    let timestamps: Vec<chrono::DateTime<Utc>> = (0..10).map(|i| ts(1000 + i * 100)).collect();

    // Create the final tagged results (simulating merged & sorted output)
    let final_tagged: Vec<TaggedSearchHit> = vec![
        make_tagged_hit(Uuid::new_v4(), Some(ts(5000)), SearchSource::ChatName),
        make_tagged_hit(doc_ids[9], Some(timestamps[9]), SearchSource::DocumentName),
        make_tagged_hit(Uuid::new_v4(), Some(ts(4000)), SearchSource::Content),
        make_tagged_hit(doc_ids[8], Some(timestamps[8]), SearchSource::DocumentName),
        make_tagged_hit(doc_ids[7], Some(timestamps[7]), SearchSource::DocumentName),
    ];

    let doc_next_cursor = SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
        entity_id: doc_ids[6],
        updated_at: timestamps[6],
    }));

    let included_doc_names = final_tagged
        .iter()
        .filter(|h| h.source == SearchSource::DocumentName)
        .count();
    let doc_name_count = 10; // Original fetch returned 10

    let new_doc_cursor = compute_next_cursor(
        &doc_next_cursor,
        included_doc_names,
        doc_name_count,
        find_last_of_source(&final_tagged, SearchSource::DocumentName),
        &SearchCursorOption::NotDone(None),
    );

    // Should generate cursor from last included doc (doc_ids[7])
    match new_doc_cursor {
        SearchCursorOption::NotDone(Some(cursor)) => {
            let (id, ts) = cursor.as_updated_at().expect("expected UpdatedAt cursor");
            assert_eq!(id, doc_ids[7]);
            assert_eq!(ts, timestamps[7]);
        }
        _ => panic!(
            "Expected cursor from last included doc, got {:?}",
            new_doc_cursor
        ),
    }
}

#[test]
fn test_cursor_logic_source_exhausted_scenario() {
    // Simulate when a source is exhausted (returned fewer than requested)
    // - Search returned 3 documents (less than page_size of 10)
    // - All 3 made it into the final page
    // - Cursor should be Done since source is exhausted

    let final_tagged: Vec<TaggedSearchHit> = vec![
        make_tagged_hit(Uuid::new_v4(), Some(ts(3000)), SearchSource::DocumentName),
        make_tagged_hit(Uuid::new_v4(), Some(ts(2000)), SearchSource::DocumentName),
        make_tagged_hit(Uuid::new_v4(), Some(ts(1000)), SearchSource::DocumentName),
    ];

    let doc_next_cursor = SearchCursorOption::Done; // Search says done

    let new_doc_cursor = compute_next_cursor(
        &doc_next_cursor,
        3, // all included
        3, // all returned
        find_last_of_source(&final_tagged, SearchSource::DocumentName),
        &SearchCursorOption::NotDone(None),
    );

    assert!(new_doc_cursor.is_done());
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
        make_tagged_hit(Uuid::new_v4(), Some(ts(9000)), SearchSource::DocumentName),
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
        make_tagged_hit(Uuid::new_v4(), Some(ts(9000)), SearchSource::DocumentName),
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
