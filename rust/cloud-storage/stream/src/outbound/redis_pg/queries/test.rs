use super::*;
use sqlx::PgPool;

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_insert_and_get(pool: PgPool) {
    insert_active_stream(&pool, "entity_1", "stream_a")
        .await
        .unwrap();
    insert_active_stream(&pool, "entity_1", "stream_b")
        .await
        .unwrap();

    let keys = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert_eq!(keys.len(), 2);
    assert!(keys.contains(&"stream_a".to_string()));
    assert!(keys.contains(&"stream_b".to_string()));
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_insert_conflict_is_noop(pool: PgPool) {
    insert_active_stream(&pool, "entity_1", "stream_a")
        .await
        .unwrap();
    // Duplicate insert should succeed (ON CONFLICT DO NOTHING)
    insert_active_stream(&pool, "entity_1", "stream_a")
        .await
        .unwrap();

    let keys = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert_eq!(keys.len(), 1);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_delete(pool: PgPool) {
    insert_active_stream(&pool, "entity_1", "stream_a")
        .await
        .unwrap();
    insert_active_stream(&pool, "entity_1", "stream_b")
        .await
        .unwrap();

    delete_active_stream(&pool, "entity_1", "stream_a")
        .await
        .unwrap();

    let keys = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert_eq!(keys, vec!["stream_b".to_string()]);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_delete_nonexistent_is_noop(pool: PgPool) {
    delete_active_stream(&pool, "entity_1", "does_not_exist")
        .await
        .unwrap();
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_get_empty(pool: PgPool) {
    let keys = get_active_stream_keys(&pool, "no_such_entity")
        .await
        .unwrap();
    assert!(keys.is_empty());
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_get_filters_by_entity(pool: PgPool) {
    insert_active_stream(&pool, "entity_1", "stream_a")
        .await
        .unwrap();
    insert_active_stream(&pool, "entity_2", "stream_b")
        .await
        .unwrap();

    let keys_1 = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert_eq!(keys_1, vec!["stream_a".to_string()]);

    let keys_2 = get_active_stream_keys(&pool, "entity_2").await.unwrap();
    assert_eq!(keys_2, vec!["stream_b".to_string()]);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn test_full_lifecycle(pool: PgPool) {
    // Start empty
    let keys = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert!(keys.is_empty());

    // Insert two streams
    insert_active_stream(&pool, "entity_1", "stream_a")
        .await
        .unwrap();
    insert_active_stream(&pool, "entity_1", "stream_b")
        .await
        .unwrap();

    let keys = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert_eq!(keys.len(), 2);

    // Close one stream
    delete_active_stream(&pool, "entity_1", "stream_a")
        .await
        .unwrap();

    let keys = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert_eq!(keys, vec!["stream_b".to_string()]);

    // Close the other
    delete_active_stream(&pool, "entity_1", "stream_b")
        .await
        .unwrap();

    let keys = get_active_stream_keys(&pool, "entity_1").await.unwrap();
    assert!(keys.is_empty());
}
