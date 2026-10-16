//! An explicitly selected database must remain visible before SQL resolves.

use super::*;

#[tokio::test]
async fn an_unavailable_scope_does_not_read_another_accessible_database() {
    for scope in [DatabaseId::new(), SECRET] {
        let world = world();
        let result = sql(&world)
            .execute(
                agent_for(OWNER),
                SqlRequest {
                    sql: "SELECT \"Name\" FROM \"Guests\"".into(),
                    scope: Some(scope),
                    base_versions: HashMap::new(),
                },
            )
            .await;

        assert!(matches!(result, Err(SqlError::NotFound)), "{result:?}");
        assert!(world.lock().unwrap().soup_reads.is_empty());
    }
}

#[tokio::test]
async fn an_unavailable_scope_does_not_update_another_accessible_database() {
    for scope in [DatabaseId::new(), SECRET] {
        let world = world();
        world
            .lock()
            .unwrap()
            .op_answers
            .push_back(Ok(vec![OpResult::Rows {
                table: GUESTS,
                table_version: TableVersion(2),
                change: RowsResult::Updated { affected: 1 },
            }]));
        let result = sql(&world)
            .execute(
                agent_for(OWNER),
                SqlRequest {
                    sql:
                        "UPDATE \"Guests\" SET \"Name\" = 'Wrong database' WHERE \"Name\" = 'Maria'"
                            .into(),
                    scope: Some(scope),
                    base_versions: HashMap::new(),
                },
            )
            .await;

        assert!(matches!(result, Err(SqlError::NotFound)), "{result:?}");
        let world = world.lock().unwrap();
        assert!(world.applied.is_empty());
        assert!(world.soup_reads.is_empty());
    }
}

#[tokio::test]
async fn an_unavailable_scope_does_not_rename_another_accessible_database() {
    for scope in [DatabaseId::new(), SECRET] {
        let world = world();
        let result = sql(&world)
            .execute(
                agent_for(OWNER),
                SqlRequest {
                    sql: "ALTER DATABASE Offsite RENAME TO Wrong".into(),
                    scope: Some(scope),
                    base_versions: HashMap::new(),
                },
            )
            .await;

        assert!(matches!(result, Err(SqlError::NotFound)), "{result:?}");
        assert_eq!(world.lock().unwrap().databases[0].database.name, "Offsite");
    }
}

#[tokio::test]
async fn an_available_scope_keeps_other_accessible_databases_available_for_joins() {
    let world = world();
    let outcome = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "SELECT g.\"Name\", h.\"Name\" AS hall FROM \"Guests\" g \
                      JOIN \"Venues\".\"Halls\" h ON g.\"Hall\" = h.row_id"
                    .into(),
                scope: Some(OFFSITE),
                base_versions: HashMap::new(),
            },
        )
        .await
        .unwrap();

    assert_eq!(
        outcome.result.unwrap().rows,
        vec![vec![
            Some(Cell::Text("Maria".into())),
            Some(Cell::Text("Ballroom".into())),
        ]]
    );
}
