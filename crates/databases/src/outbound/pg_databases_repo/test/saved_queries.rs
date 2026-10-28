use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_saved_query_round_trips_and_outlives_its_database(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    let definition = QueryDefinition::V1 {
        query: "SELECT COUNT(*) FROM \"Guests\"".into(),
    };

    let scoped = repo
        .save_query(Some(table.database_id), &definition, &user())
        .await
        .unwrap();
    assert_eq!(scoped.database_id, Some(table.database_id));
    assert_eq!(scoped.definition, definition);
    assert_eq!(scoped.created_by.as_deref(), Some(USER));
    assert_eq!(
        repo.get_query(scoped.id).await.unwrap(),
        Some(scoped.clone())
    );
    let stored = sqlx::query_scalar!(
        "SELECT definition FROM database_queries WHERE id = $1",
        scoped.id.into_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        stored,
        serde_json::json!({"version": 1, "query": "SELECT COUNT(*) FROM \"Guests\""})
    );

    let unscoped = repo.save_query(None, &definition, &user()).await.unwrap();
    assert_eq!(unscoped.database_id, None);
    assert_ne!(unscoped.id, scoped.id);

    repo.delete_database(table.database_id).await.unwrap();
    assert_eq!(
        repo.get_query(scoped.id).await.unwrap(),
        Some(SavedQuery {
            database_id: None,
            ..scoped
        })
    );
    assert_eq!(
        repo.get_query(QueryId::from_uuid(Uuid::nil()))
            .await
            .unwrap(),
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_definition_without_its_version_and_query_is_rejected(pool: PgPool) {
    let rejected = sqlx::query!(
        "INSERT INTO database_queries (id, definition, created_by) VALUES ($1, $2, $3)",
        macro_uuid::generate_uuid_v7(),
        serde_json::json!({"query": "SELECT 1"}),
        USER,
    )
    .execute(&pool)
    .await
    .unwrap_err();
    assert!(
        rejected
            .to_string()
            .contains("database_queries_definition_check"),
        "{rejected}"
    );
}
