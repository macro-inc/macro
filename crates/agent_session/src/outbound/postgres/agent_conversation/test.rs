use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn channel(pool: &PgPool) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!("INSERT INTO comms_channels (id, channel_type, owner_id) VALUES ($1, 'direct_message', 'macro|dm@example.com')", id)
        .execute(pool).await.unwrap();
    id
}

fn with(channel_id: Uuid, bot_id: BotId) -> AgentConversation {
    AgentConversation { channel_id, bot_id }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn simultaneous_first_posts_reserve_the_same_session_before_it_exists(pool: PgPool) {
    let conversation = with(channel(&pool).await, bot_id::MACRO_NEW_BOT_ID);
    let repo = super::super::test::test_repo(&pool);
    assert_eq!(repo.current(conversation).await.unwrap(), None);
    let (a, b) = tokio::join!(
        repo.current_or_create(conversation),
        repo.current_or_create(conversation)
    );
    let id = a.unwrap();
    assert_eq!(b.unwrap(), id);
    assert_eq!(repo.current(conversation).await.unwrap(), Some(id));
    assert_eq!(
        repo.conversation_for_session(id).await.unwrap(),
        Some(conversation)
    );
    assert!(matches!(
        AgentSessionRepo::get(&repo, id).await,
        Err(AgentSessionError::NotFound(_))
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn start_fresh_preserves_earlier_sessions_and_isolates_other_conversations(pool: PgPool) {
    let first_conversation = with(channel(&pool).await, bot_id::MACRO_NEW_BOT_ID);
    let second_conversation = with(channel(&pool).await, bot_id::MACRO_NEW_BOT_ID);
    let repo = super::super::test::test_repo(&pool);
    let first = repo.current_or_create(first_conversation).await.unwrap();
    let second = repo.current_or_create(second_conversation).await.unwrap();
    let fresh = repo.start_fresh(first_conversation).await.unwrap();
    assert_ne!(fresh, first);
    assert_eq!(
        repo.current_or_create(first_conversation).await.unwrap(),
        fresh
    );
    assert_eq!(
        repo.current(second_conversation).await.unwrap(),
        Some(second)
    );
    assert_eq!(
        repo.conversation_for_session(first).await.unwrap(),
        Some(first_conversation)
    );
    assert_eq!(
        repo.conversation_for_session(fresh).await.unwrap(),
        Some(first_conversation)
    );
    let sessions = repo.sessions(first_conversation).await.unwrap();
    assert_eq!(
        sessions
            .iter()
            .map(|session| (session.session_id, session.is_current))
            .collect::<Vec<_>>(),
        [(first, false), (fresh, true)]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn two_agents_in_one_channel_run_on_separate_sessions(pool: PgPool) {
    let channel = channel(&pool).await;
    let first = with(channel, bot_id::MACRO_NEW_BOT_ID);
    let second = with(channel, bot_id::MACRO_CODER_BOT_ID);
    let repo = super::super::test::test_repo(&pool);
    let first_session = repo.current_or_create(first).await.unwrap();
    let second_session = repo.current_or_create(second).await.unwrap();
    assert_ne!(first_session, second_session);
    let fresh = repo.start_fresh(first).await.unwrap();
    assert_eq!(repo.current(second).await.unwrap(), Some(second_session));
    assert_eq!(repo.current(first).await.unwrap(), Some(fresh));
}
