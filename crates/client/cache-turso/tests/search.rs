#![cfg(not(target_arch = "wasm32"))]

#[path = "common/search.rs"]
mod search_streaming;

use cache_core::engine::Engine;
use cache_core::search::{SearchProfile, SearchQuery, SearchRequest};
use cache_core::store::Storage;
use cache_turso::{TursoFileDatabase, TursoStorage};
use pollster::block_on;
use std::time::Instant;

#[test]
fn streaming_sql_search_matches_reference_ranking() {
    block_on(search_streaming::assert_search_contract(
        TursoStorage::open_in_memory("search-contract").unwrap(),
    ));
}

#[test]
#[ignore = "100k-row search latency measurement; run explicitly with --ignored --nocapture"]
fn search_100k_rows() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("search.turso")).unwrap();
        let mut storage = database.open("search-100k").unwrap();
        search_streaming::seed_100k(&mut storage).await;
        let mut engine = Engine::new(storage);
        // Broad, selective, and missing queries, repeated without a retained catalog.
        for query in ["contact", "99999", "no-match", "contact", "99999"] {
            let started = Instant::now();
            let result = engine
                .search(&SearchRequest {
                    profile: SearchProfile::QuickAccessV1,
                    buckets: vec!["document".into()],
                    query: query.into(),
                    cursor: None,
                    limit: 50,
                    now_ms: 2_000,
                })
                .await
                .unwrap();
            eprintln!(
                "100k search: query={query:?}, elapsed={:?}, results={}",
                started.elapsed(),
                result.documents.len()
            );
            assert!(result.documents.len() <= 50);
            assert_eq!(result.documents.is_empty(), query == "no-match");
        }
        let storage = engine.into_storage();
        let mut visited = 0;
        storage
            .visit_search_documents(
                SearchProfile::QuickAccessV1,
                "document",
                &SearchQuery::new("99999"),
                |_| visited += 1,
            )
            .await
            .unwrap();
        assert_eq!(visited, 1, "SQL must filter before materializing rows");
    });
}
