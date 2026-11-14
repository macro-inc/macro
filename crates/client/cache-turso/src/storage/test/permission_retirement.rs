use super::*;

#[test]
fn orphan_projection_pages_are_bounded_and_seek_by_type_and_id() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("permission-projections").unwrap();
        storage
            .put_batch_with_projections(
                Vec::new(),
                (0..1001)
                    .map(|n| {
                        ProjectionMutation::Replace(authoritative_projection(
                            &format!("GraphqlSoupCrmCompany:{n:04}"),
                            "viewer",
                        ))
                    })
                    .chain([ProjectionMutation::Replace(authoritative_projection(
                        "GraphqlSoupDocument:kept",
                        "viewer",
                    ))])
                    .collect(),
            )
            .await
            .unwrap();
        assert_eq!(
            storage
                .projection_keys("GraphqlSoupCrmCompany", None, 900)
                .await
                .unwrap()
                .len(),
            500
        );
        assert_eq!(
            storage
                .projection_keys("GraphqlSoupCrmCompany", Some("0998"), 900)
                .await
                .unwrap(),
            vec![
                key("GraphqlSoupCrmCompany:0999"),
                key("GraphqlSoupCrmCompany:1000")
            ]
        );
        assert!(
            storage
                .record_keys("GraphqlSoupCrmCompany", None, 500)
                .await
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
#[ignore = "explicit 100k-record local query-plan measurement"]
fn permission_pages_at_one_hundred_thousand_records() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("permission-page-cost").unwrap();
        for start in (0..100_000).step_by(500) {
            let keys = (start..start + 500)
                .map(|n| format!("GraphqlSoupCrmContact:{n:06}"))
                .collect::<Vec<_>>();
            storage
                .put_batch_with_projections(
                    keys.iter()
                        .map(|key| (super::key(key), record("snapshot")))
                        .collect(),
                    keys.iter()
                        .map(|key| {
                            ProjectionMutation::Replace(authoritative_projection(key, "viewer"))
                        })
                        .collect(),
                )
                .await
                .unwrap();
        }
        for (kind, sql, params) in [
            (
                "records",
                "SELECT id FROM records WHERE __typename = ?1 AND id > ?2 ORDER BY id LIMIT ?3",
                vec![
                    text("GraphqlSoupCrmContact"),
                    text("098999"),
                    Value::from_i64(500),
                ],
            ),
            (
                "projections",
                "SELECT record_key FROM index_documents WHERE record_key > ?1 AND record_key < ?2 ORDER BY record_key LIMIT ?3",
                vec![
                    text("GraphqlSoupCrmContact:098999"),
                    text("GraphqlSoupCrmContact;"),
                    Value::from_i64(500),
                ],
            ),
        ] {
            let plan = driver::query(
                &storage.connection(),
                &format!("EXPLAIN QUERY PLAN {sql}"),
                params.clone(),
            )
            .unwrap();
            let details = plan
                .iter()
                .map(|row| required_text(row, 3).unwrap())
                .collect::<Vec<_>>()
                .join("; ");
            let mut statement = driver::prepare(&storage.connection(), sql).unwrap();
            let started = std::time::Instant::now();
            let rows = driver::query_prepared(&mut statement, params).unwrap();
            let elapsed = started.elapsed();
            let steps = statement.metrics().vm_steps;
            eprintln!(
                "permission {kind}: seed=100000, page=500, after=98999; plan={details}; rows={}; steps={steps}; elapsed={elapsed:?}",
                rows.len()
            );
            assert_eq!(rows.len(), 500);
            assert!(
                details.contains("SEARCH")
                    && !details.contains("SCAN ")
                    && !details.contains("TEMP B-TREE"),
                "{details}"
            );
            assert!(steps < 10_000, "late page must seek: {steps}");
        }
    });
}
