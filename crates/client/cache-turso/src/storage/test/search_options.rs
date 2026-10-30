//! Isolates SQL preparation and table lookups from matching/row materialization.
use super::*;
use std::time::{Duration, Instant};

const COVERING_INDEX: &str = "CREATE INDEX search_covering ON search_documents(profile, bucket, timestamp_ms DESC, __typename, id, search_text, source_hash)";

#[test]
#[ignore = "100k-row SQL optimization comparison; run in release with --ignored --nocapture"]
fn compare_search_scan_options() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("search.turso")).unwrap();
        let mut storage = database.open("scope").unwrap();
        for batch in 0..400 {
            storage
                .put_batch(
                    (0..250)
                        .map(|offset| {
                            let index = batch * 250 + offset;
                            (
                                key(&format!("GraphqlSoupDocument:{index:06}")),
                                quick_access_document(
                                    &format!("contact {index:06} user{index}@example.com"),
                                    index,
                                ),
                            )
                        })
                        .collect(),
                )
                .await
                .unwrap();
        }
        let connection = storage.connection();
        let start = Instant::now();
        driver::execute(&connection, COVERING_INDEX, vec![]).unwrap();
        eprintln!("covering build: {:?}", start.elapsed());
        for query in ["contact", "99999", "no-match"] {
            let (sql, parameters) = search::statement(
                SearchProfile::QuickAccessV1,
                "document",
                &SearchQuery::new(query),
            );
            let covering = sql.replace("search_documents_browse_idx", "search_covering");
            let plan = driver::query(
                &connection,
                &format!("EXPLAIN QUERY PLAN {covering}"),
                parameters.clone(),
            )
            .unwrap();
            eprintln!("covering plan: {plan:?}");
            let mut baseline = driver::prepare(&connection, &sql).unwrap();
            let mut indexed = driver::prepare(&connection, &covering).unwrap();
            let mut times: [Vec<Duration>; 6] = std::array::from_fn(|_| Vec::new());
            let mut prepare_time = Duration::ZERO;
            for round in 0..9 {
                // Alternate order, discarding the first two rounds for cache warming.
                for mode in (0..6).map(|n| (n + round) % 6) {
                    let started = Instant::now();
                    let text = if matches!(mode, 2 | 3 | 5) {
                        &covering
                    } else {
                        &sql
                    };
                    let mut prepared;
                    let statement = if !matches!(mode, 1 | 3) {
                        let prepare_start = Instant::now();
                        prepared = driver::prepare(&connection, text).unwrap();
                        prepare_time += prepare_start.elapsed();
                        &mut prepared
                    } else if mode >= 2 {
                        &mut indexed
                    } else {
                        &mut baseline
                    };
                    let mut rows = 0;
                    let mut key_buffer = String::new();
                    driver::query_each_prepared(statement, parameters.clone(), |row| {
                        if mode >= 4 {
                            search::visit_row(
                                row,
                                SearchProfile::QuickAccessV1,
                                &mut key_buffer,
                                &mut |document| {
                                    std::hint::black_box(document);
                                },
                            )?;
                        } else {
                            std::hint::black_box(parse_search_document(
                                &row.get_values().cloned().collect::<Vec<_>>(),
                                SearchProfile::QuickAccessV1,
                            )?);
                        }
                        rows += 1;
                        Ok(())
                    })
                    .unwrap();
                    if round >= 2 {
                        times[mode].push(started.elapsed());
                    }
                    assert_eq!(rows == 0, query == "no-match");
                }
            }
            let medians = times.map(|mut values| {
                values.sort();
                values[values.len() / 2]
            });
            eprintln!(
                "query={query:?}: [baseline, reused, covering, covering+reused, borrowed, covering+borrowed]={medians:?}; mean prepare={:?}",
                prepare_time / 36
            );
        }
    });
}
