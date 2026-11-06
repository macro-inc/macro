use super::*;

#[tokio::test]
async fn version_guards_reach_the_atomic_write_when_the_table_changes_after_catalog_read() {
    let world = world();
    {
        let mut world = world.lock().unwrap();
        world.current_write_versions.insert(GUESTS, TableVersion(2));
        world.op_answers.push_back(Ok(vec![OpResult::Rows {
            table: GUESTS,
            table_version: TableVersion(3),
            change: RowsResult::Updated { affected: 1 },
        }]));
    }
    let error = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "UPDATE Offsite.Guests SET Status = 'Going' WHERE Name = 'Sam'".into(),
                scope: Some(OFFSITE),
                base_versions: HashMap::from([(GUESTS, TableVersion(1)), (HALLS, TableVersion(1))]),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(error, SqlError::VersionConflict { table_id } if table_id == GUESTS));
    let world = world.lock().unwrap();
    assert_eq!(
        world.guarded,
        vec![HashMap::from([(GUESTS, TableVersion(1))])]
    );
    assert!(world.applied.is_empty());
}

#[tokio::test]
async fn empty_reads_keep_the_source_table_but_aggregates_and_platform_rows_do_not() {
    let world = world();
    let empty = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "SELECT Name FROM Offsite.Guests WHERE Name = 'Nobody'".into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .unwrap();
    assert_eq!(empty.result.as_ref().unwrap().source_table, Some(GUESTS));
    assert_eq!(empty.table_databases.get(&GUESTS), Some(&OFFSITE));
    let aggregate = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "SELECT COUNT(*) FROM Offsite.Guests".into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .unwrap();
    assert_eq!(aggregate.result.unwrap().source_table, None);
    let empty_aggregate = sql(&world).execute(agent_for(OWNER), SqlRequest {
        sql: "SELECT Status, COUNT(*) FROM Offsite.Guests WHERE Name = 'Nobody' GROUP BY Status".into(), scope: None, base_versions: HashMap::new(),
    }).await.unwrap();
    assert_eq!(empty_aggregate.result.unwrap().source_table, None);
    let people = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "SELECT * FROM macro.people".into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .unwrap();
    assert_eq!(people.result.unwrap().source_table, None);
}

#[tokio::test]
async fn joins_return_the_owning_database_for_each_read_table() {
    let world = world();
    let outcome = sql(&world).execute(agent_for(OWNER), SqlRequest {
        sql: "SELECT g.Name, h.Name FROM Offsite.Guests g JOIN Venues.Halls h ON g.Hall = h.row_id".into(),
        scope: None, base_versions: HashMap::new(),
    }).await.unwrap();
    assert_eq!(outcome.table_databases.get(&GUESTS), Some(&OFFSITE));
    assert_eq!(outcome.table_databases.get(&HALLS), Some(&VENUES));
    assert_eq!(outcome.result.unwrap().source_table, Some(GUESTS));
}

#[tokio::test]
async fn zero_match_writes_keep_target_ownership_without_applying_ops() {
    let world = world();
    for statement in [
        "UPDATE Offsite.Guests SET Status = 'Going' WHERE Name = 'Nobody'",
        "DELETE FROM Offsite.Guests WHERE Name = 'Nobody'",
    ] {
        let outcome = sql(&world)
            .execute(
                agent_for(OWNER),
                SqlRequest {
                    sql: statement.into(),
                    scope: None,
                    base_versions: HashMap::new(),
                },
            )
            .await
            .unwrap();
        assert_eq!(outcome.changes_applied, 0);
        assert_eq!(outcome.table_databases.get(&GUESTS), Some(&OFFSITE));
    }
    assert!(world.lock().unwrap().applied.is_empty());
}
