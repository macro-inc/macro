use super::*;
use models_databases::MAX_STATEMENT_LENGTH;

#[test]
fn a_query_definition_is_stored_as_versioned_json() {
    let definition = QueryDefinition::V1 {
        query: "SELECT COUNT(*) FROM \"Guests\"".into(),
    };
    assert_eq!(
        serde_json::to_value(&definition).unwrap(),
        serde_json::json!({"version": 1, "query": "SELECT COUNT(*) FROM \"Guests\""})
    );
    assert_eq!(
        serde_json::from_value::<QueryDefinition>(
            serde_json::json!({"version": 1, "query": "SELECT 1"})
        )
        .unwrap(),
        QueryDefinition::V1 {
            query: "SELECT 1".into()
        }
    );
    let unknown = serde_json::from_value::<QueryDefinition>(
        serde_json::json!({"version": 2, "query": "SELECT 1"}),
    )
    .unwrap_err();
    assert!(
        unknown
            .to_string()
            .contains("unsupported query definition version 2"),
        "{unknown}"
    );
}

#[tokio::test]
async fn a_viewer_of_its_database_reads_a_saved_query() {
    let seeded = seeded().await;
    let (world, svc, db) = (seeded.world, seeded.service, seeded.database_id);
    let saved = svc
        .save_query(
            viewer(OWNER),
            Some(db),
            QueryDefinition::V1 {
                query: "SELECT COUNT(*) AS guests FROM \"Guests\"".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(saved.database_id, Some(db));
    assert_eq!(saved.created_by.as_deref(), Some(OWNER));
    assert_eq!(
        saved.definition,
        QueryDefinition::V1 {
            query: "SELECT COUNT(*) AS guests FROM \"Guests\"".into()
        }
    );
    assert_eq!(world.lock().unwrap().queries, vec![saved.clone()]);

    assert_eq!(
        svc.get_query(viewer(VIEWER), saved.id).await.unwrap(),
        saved
    );
}

#[tokio::test]
async fn a_stranger_cannot_tell_a_saved_query_exists() {
    let seeded = seeded().await;
    let (svc, db) = (seeded.service, seeded.database_id);
    let saved = svc
        .save_query(
            viewer(OWNER),
            Some(db),
            QueryDefinition::V1 {
                query: "SELECT COUNT(*) AS guests FROM \"Guests\"".into(),
            },
        )
        .await
        .unwrap();

    let read = svc.get_query(viewer(STRANGER), saved.id).await.unwrap_err();
    assert!(matches!(read, SavedQueryError::NotFound), "{read:?}");
}

#[tokio::test]
async fn an_unscoped_saved_query_is_its_creators_alone() {
    let seeded = seeded().await;
    let svc = seeded.service;
    let saved = svc
        .save_query(
            viewer(VIEWER),
            None,
            QueryDefinition::V1 {
                query: "SELECT COUNT(*) AS guests FROM \"Guests\"".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(saved.database_id, None);

    assert_eq!(
        svc.get_query(viewer(VIEWER), saved.id).await.unwrap(),
        saved
    );
    // The database's owner can see the table, but not this viewer's query.
    let read = svc.get_query(viewer(OWNER), saved.id).await.unwrap_err();
    assert!(matches!(read, SavedQueryError::NotFound), "{read:?}");
}

#[tokio::test]
async fn a_saved_query_scoped_to_a_trashed_database_reads_only_for_its_creator() {
    let seeded = seeded().await;
    let (world, svc, db) = (seeded.world, seeded.service, seeded.database_id);
    let saved = svc
        .save_query(
            viewer(OWNER),
            Some(db),
            QueryDefinition::V1 {
                query: "SELECT COUNT(*) AS guests FROM \"Guests\"".into(),
            },
        )
        .await
        .unwrap();
    world.lock().unwrap().databases[0].trashed_at = Some(Utc::now());

    assert_eq!(svc.get_query(viewer(OWNER), saved.id).await.unwrap(), saved);
    let read = svc.get_query(viewer(VIEWER), saved.id).await.unwrap_err();
    assert!(matches!(read, SavedQueryError::NotFound), "{read:?}");
}

/// Whether the SQL compiles is the SQL adapter's to check: the domain keeps
/// what it is given, even a statement no engine would run.
#[tokio::test]
async fn a_saved_query_is_stored_as_given() {
    let seeded = seeded().await;
    let (world, svc, db) = (seeded.world, seeded.service, seeded.database_id);

    let saved = svc
        .save_query(
            viewer(OWNER),
            Some(db),
            QueryDefinition::V1 {
                query: "SELECT statuz FROM nowhere WHERE".into(),
            },
        )
        .await
        .unwrap();

    assert_eq!(
        saved.definition,
        QueryDefinition::V1 {
            query: "SELECT statuz FROM nowhere WHERE".into()
        }
    );
    assert_eq!(world.lock().unwrap().queries, vec![saved]);
}

#[tokio::test]
async fn a_query_longer_than_the_limit_is_refused() {
    let seeded = seeded().await;
    let (world, svc) = (seeded.world, seeded.service);

    let longest = svc
        .save_query(
            viewer(OWNER),
            None,
            QueryDefinition::V1 {
                query: "x".repeat(MAX_STATEMENT_LENGTH),
            },
        )
        .await;
    assert!(longest.is_ok(), "{longest:?}");
    let too_long = svc
        .save_query(
            viewer(OWNER),
            None,
            QueryDefinition::V1 {
                query: "x".repeat(MAX_STATEMENT_LENGTH + 1),
            },
        )
        .await
        .unwrap_err();

    assert!(matches!(too_long, SavedQueryError::TooLong), "{too_long:?}");
    assert_eq!(world.lock().unwrap().queries.len(), 1);
}

#[tokio::test]
async fn a_query_is_saved_only_into_a_visible_live_database() {
    let seeded = seeded().await;
    let (world, svc, db) = (seeded.world, seeded.service, seeded.database_id);

    let invisible = svc
        .save_query(
            viewer(STRANGER),
            Some(db),
            QueryDefinition::V1 {
                query: "SELECT COUNT(*) FROM \"Guests\"".into(),
            },
        )
        .await
        .unwrap_err();
    assert!(
        matches!(invisible, SavedQueryError::NotFound),
        "{invisible:?}"
    );

    let missing = svc
        .save_query(
            viewer(OWNER),
            Some(DatabaseId::new()),
            QueryDefinition::V1 {
                query: "SELECT COUNT(*) FROM \"Guests\"".into(),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(missing, SavedQueryError::NotFound), "{missing:?}");

    world.lock().unwrap().databases[0].trashed_at = Some(Utc::now());
    let trashed = svc
        .save_query(
            viewer(OWNER),
            Some(db),
            QueryDefinition::V1 {
                query: "SELECT COUNT(*) FROM \"Guests\"".into(),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(trashed, SavedQueryError::NotFound), "{trashed:?}");

    assert!(world.lock().unwrap().queries.is_empty());
}

#[tokio::test]
async fn reading_an_unknown_saved_query_is_not_found() {
    let seeded = seeded().await;
    let missing = seeded
        .service
        .get_query(viewer(OWNER), QueryId::from_uuid(Uuid::nil()))
        .await
        .unwrap_err();
    assert!(matches!(missing, SavedQueryError::NotFound), "{missing:?}");
}
