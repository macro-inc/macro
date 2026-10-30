use cache_core::engine::Engine;
use cache_core::search::{
    SearchDocument, SearchProfile, SearchQuery, SearchRequest, compare_recent,
    fuzzy_freshness_score, project_search_documents,
};
use cache_core::store::Storage;
use cache_core::value::{CacheNumber, CacheValue, EntityKey, Record};

pub fn entry(index: u64, name: &str, dm: bool) -> (EntityKey<'static>, Record) {
    let typename = if dm {
        "GraphqlSoupChannel"
    } else {
        "GraphqlSoupDocument"
    };
    let mut fields: std::collections::BTreeMap<String, CacheValue> = [
        ("__typename".into(), CacheValue::String(typename.into())),
        ("name".into(), CacheValue::String(name.into())),
        (
            "updatedAt".into(),
            CacheValue::Number(CacheNumber::PosInt(index % 23)),
        ),
    ]
    .into();
    if dm {
        fields.insert(
            "channelType".into(),
            CacheValue::String("direct_message".into()),
        );
    }
    (
        EntityKey::entity(typename, &[&format!("{index:06}")]),
        Record { fields },
    )
}

pub async fn assert_search_contract<S: Storage>(mut storage: S) -> S {
    let mut corpus: Vec<SearchDocument> = Vec::new();
    // More matches than the result cap, with the best match late in storage order.
    let names = [
        "alpha x beta plan",
        "aéxb plan",
        "CAFÉ 🐢",
        "计划",
        "100% _ done \\path",
        "100x y done xpath",
        "emoji 👩‍💻 plan",
        "İSTANBUL",
        "a\0beta tail",
        "\0tail",
    ];
    let entries: Vec<_> = (0..1_001)
        .map(|index| {
            let name = if index == 1_000 {
                "alpha beta"
            } else {
                names[index as usize % names.len()]
            };
            entry(index, name, index % 7 == 0)
        })
        .collect();
    for (key, record) in &entries {
        corpus.extend(project_search_documents(key, record));
    }
    storage.put_batch(entries).await.unwrap();
    // Filtering happens before the visitor, not just in the final ranker.
    let query = SearchQuery::new("café 🐢");
    let mut visited = 0;
    storage
        .visit_search_documents(
            SearchProfile::QuickAccessV1,
            "document",
            &query,
            |document| {
                assert!(
                    query.matches(&document.search_text) || document.search_text.contains('\0')
                );
                visited += 1;
            },
        )
        .await
        .unwrap();
    assert!(visited > 0 && visited < corpus.len());

    let mut engine = Engine::new(storage);
    for query in [
        "alpha beta",
        "ALPHA   plan",
        "ab",
        "CAFÉ",
        "🐢",
        "计划",
        "%",
        "_",
        "\\",
        "100% _",
        "👩‍💻",
        "İSTANBUL",
        "tail",
        "a\0b",
        "\0tail",
        "' OR 1=1 --",
        "unmatched",
    ] {
        for limit in [1, 7, 500] {
            let mut expected: Vec<_> = corpus
                .iter()
                .filter_map(|document| {
                    fuzzy_freshness_score(document, query, 2_000).map(|score| (document, score))
                })
                .collect();
            expected.sort_by(|(left, left_score), (right, right_score)| {
                right_score
                    .total_cmp(left_score)
                    .then_with(|| compare_recent(left, right))
            });
            let expected: Vec<_> = expected
                .into_iter()
                .take(limit)
                .map(|(document, _)| document.clone())
                .collect();
            let actual = engine
                .search(&SearchRequest {
                    profile: SearchProfile::QuickAccessV1,
                    buckets: vec!["document".into(), "dm".into()],
                    query: query.into(),
                    cursor: None,
                    limit,
                    now_ms: 2_000,
                })
                .await
                .unwrap();
            assert_eq!(actual.documents, expected, "query={query:?}, limit={limit}");
            assert!(actual.next_cursor.is_none());
        }
    }
    engine.into_storage()
}
