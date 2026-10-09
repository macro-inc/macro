use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn channel(pool: &PgPool) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!("INSERT INTO comms_channels (id, channel_type, owner_id) VALUES ($1, 'direct_message', 'macro|dm@example.com')", id)
        .execute(pool).await.unwrap();
    id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn simultaneous_first_posts_reserve_the_same_session_before_it_exists(pool: PgPool) {
    let channel = channel(&pool).await;
    let repo = super::super::test::test_repo(&pool);
    assert_eq!(repo.current(channel).await.unwrap(), None);
    let (a, b) = tokio::join!(
        repo.current_or_create(channel),
        repo.current_or_create(channel)
    );
    let id = a.unwrap();
    assert_eq!(b.unwrap(), id);
    assert_eq!(repo.current(channel).await.unwrap(), Some(id));
    assert_eq!(repo.channel_for_session(id).await.unwrap(), Some(channel));
    assert!(matches!(
        AgentSessionRepo::get(&repo, id).await,
        Err(AgentSessionError::NotFound(_))
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn start_fresh_preserves_previous_segments_and_isolates_other_channels(pool: PgPool) {
    let first_channel = channel(&pool).await;
    let second_channel = channel(&pool).await;
    let repo = super::super::test::test_repo(&pool);
    let first = repo.current_or_create(first_channel).await.unwrap();
    let second = repo.current_or_create(second_channel).await.unwrap();
    let fresh = repo.start_fresh(first_channel).await.unwrap();
    assert_ne!(fresh, first);
    assert_eq!(repo.current_or_create(first_channel).await.unwrap(), fresh);
    assert_eq!(repo.current(second_channel).await.unwrap(), Some(second));
    assert_eq!(
        repo.channel_for_session(first).await.unwrap(),
        Some(first_channel)
    );
    assert_eq!(
        repo.channel_for_session(fresh).await.unwrap(),
        Some(first_channel)
    );
}
