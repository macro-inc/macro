use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn session_allowlist_matches_grants_and_respects_requested_ids(pool: PgPool) {
    let session = uuid::Uuid::now_v7();
    let unrelated = uuid::Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'agent_session', 'owner', 'user', 'owner'),
               ($1, 'agent_session', 'channel', 'channel', 'view'),
               ($2, 'chat', 'channel', 'channel', 'view')
        "#,
        session,
        unrelated,
    )
    .execute(&pool)
    .await
    .unwrap();
    for sources in [
        vec!["owner".into()],
        vec!["channel".into()],
        vec!["owner".into(), "channel".into()],
    ] {
        assert_eq!(
            accessible_session_ids(&pool, &SourceIds(sources), &[])
                .await
                .unwrap(),
            vec![session]
        );
    }
    assert!(
        accessible_session_ids(&pool, &SourceIds(vec!["outsider".into()]), &[])
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        accessible_session_ids(&pool, &SourceIds(vec![]), &[])
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        accessible_session_ids(&pool, &SourceIds(vec!["channel".into()]), &[unrelated])
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        accessible_session_ids(&pool, &SourceIds(vec!["channel".into()]), &[session])
            .await
            .unwrap(),
        vec![session]
    );
    // Revocation must be reflected by the next allowlist query.
    sqlx::query!(
        "DELETE FROM entity_access WHERE entity_id = $1 AND source_id = 'channel'",
        session
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        accessible_session_ids(&pool, &SourceIds(vec!["channel".into()]), &[])
            .await
            .unwrap()
            .is_empty()
    );
}
