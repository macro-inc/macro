use super::*;
use crate::search::{SearchProfile, fuzzy_freshness_score};
use crate::value::EntityKey;

fn documents() -> Vec<SearchDocument> {
    (0..2_000)
        .map(|index| SearchDocument {
            profile: SearchProfile::QuickAccessV1,
            record_key: EntityKey(format!("Type{}:{index:04}", index % 3).into()),
            bucket: if index % 7 == 0 { "dm" } else { "document" }.into(),
            search_text: [
                "alpha plan",
                "aéxb plan",
                "café 🐢",
                "alpha beta",
                "",
                "计划",
            ][index % 6]
                .into(),
            timestamp_ms: if index % 11 == 0 {
                0
            } else {
                1_000 + (index % 23) as i64
            },
            source_hash: index.to_string(),
        })
        .collect()
}

#[test]
fn bounded_heap_matches_full_sort_for_text_browse_unicode_ties_and_dm_boost() {
    let mut corpus = documents();
    for backwards in [false, true] {
        if backwards {
            corpus.reverse();
        }
        for query in [
            "",
            "  ",
            "alpha",
            "ALPHA   plan",
            "ab",
            "café",
            "🐢",
            "计划",
            "unmatched",
        ] {
            for limit in [1, 7, 50, 500] {
                let request = SearchRequest {
                    profile: SearchProfile::QuickAccessV1,
                    buckets: vec![],
                    query: query.into(),
                    cursor: None,
                    limit,
                    now_ms: 2_000,
                };
                let mut full: Vec<_> = corpus
                    .iter()
                    .filter_map(|document| {
                        let score = if query.trim().is_empty() {
                            Some(0.0)
                        } else {
                            fuzzy_freshness_score(document, query, request.now_ms)
                        }?;
                        Some((document, score))
                    })
                    .collect();
                full.sort_by(|(left, left_score), (right, right_score)| {
                    right_score
                        .total_cmp(left_score)
                        .then_with(|| compare_recent(left, right))
                });
                let has_more = full.len() > limit;
                let expected: Vec<_> = full
                    .into_iter()
                    .take(limit)
                    .map(|(document, _)| document.clone())
                    .collect();
                let actual = rank_documents(&request, &corpus);
                assert_eq!(
                    actual.documents, expected,
                    "query={query:?}, limit={limit}, backwards={backwards}"
                );
                let cursor = (query.trim().is_empty() && has_more).then(|| {
                    let last = expected.last().unwrap();
                    SearchCursor {
                        timestamp_ms: last.timestamp_ms,
                        record_key: last.record_key.clone(),
                    }
                });
                assert_eq!(actual.next_cursor, cursor);
            }
        }
    }
}
