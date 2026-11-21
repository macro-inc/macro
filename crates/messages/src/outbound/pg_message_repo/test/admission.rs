//! A queued parent write retains no database connection or partial message.

use super::*;
use std::time::Duration;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn parent_admission_rejects_without_a_connection_and_client_id_retry_is_unique(pool: PgPool) {
    setup(&pool).await;
    let channel = super::sequences::channel_fixture(&pool).await;
    let parent = MessageParent::Channel(channel);
    let options = pool.connect_options().as_ref().clone();
    let writer_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    let repo = PgMessageRepository::new(writer_pool.clone());
    let mut permits = Vec::new();
    for _ in 0..4 {
        permits.push(PgMessageRepository::admit_parent(&parent).await.unwrap());
    }
    let id = macro_uuid::generate_uuid_v7();
    let mut input = command("message-doc-a", None, "retry exactly once");
    input.parent = parent.clone();
    input.input.id = Some(id);
    input.input.nonce = Some("stable-client-nonce".into());
    let mut pending = Box::pin(repo.create(input.clone()));
    // Poll the write first, so it reaches admission before testing the pool.
    let connection = tokio::select! {
        biased;
        result = &mut pending => panic!("the held gate must queue the write: {result:?}"),
        connection = tokio::time::timeout(Duration::from_millis(500), writer_pool.acquire()) => {
            connection.expect("a queued write must leave the sole connection available").unwrap()
        }
    };
    drop(connection);
    let error = pending.await.unwrap_err();
    let MessageError::Contended(cause) = error else {
        panic!("parent admission should return retryable contention");
    };
    assert!(
        cause
            .downcast_current_context::<message_write_gate::AdmissionTimeout>()
            .is_some()
    );
    assert!(repo.get(&parent, id).await.unwrap().is_none());
    assert_eq!(
        channel_change_db_utils::current_seq(&writer_pool, channel)
            .await
            .unwrap(),
        0
    );
    drop(permits);
    let (message, seq) = repo.create(input.clone()).await.unwrap();
    assert_eq!(message.id, id);
    assert_eq!(seq, Some(1));
    assert!(matches!(
        repo.create(input).await,
        Err(MessageError::Conflict)
    ));
    let count = sqlx::query_scalar!("SELECT count(*) FROM comms_messages WHERE id = $1", id)
        .fetch_one(&writer_pool)
        .await
        .unwrap();
    assert_eq!(count, Some(1));
    assert_eq!(
        channel_change_db_utils::current_seq(&writer_pool, channel)
            .await
            .unwrap(),
        1
    );
    writer_pool.close().await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn retry_after_admission_rejection_without_client_id_creates_one_message(pool: PgPool) {
    setup(&pool).await;
    let channel = super::sequences::channel_fixture(&pool).await;
    let parent = MessageParent::Channel(channel);
    let repo = PgMessageRepository::new(pool);
    let mut input = command("message-doc-a", None, "webhook retry");
    input.parent = parent.clone();
    assert!(input.input.id.is_none());
    assert!(input.input.nonce.is_none());
    let mut permits = Vec::new();
    for _ in 0..4 {
        permits.push(PgMessageRepository::admit_parent(&parent).await.unwrap());
    }

    assert!(matches!(
        repo.create(input.clone()).await,
        Err(MessageError::Contended(_))
    ));
    assert!(
        repo.timeline(&parent, MessageTimelineQuery::default())
            .await
            .unwrap()
            .items
            .is_empty()
    );
    assert_eq!(repo.channel_seq(channel).await.unwrap(), 0);

    drop(permits);
    let (message, seq) = repo.create(input).await.unwrap();
    assert_eq!(seq, Some(1));
    let page = repo
        .timeline(&parent, MessageTimelineQuery::default())
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].message.id, message.id);
    assert_eq!(repo.channel_seq(channel).await.unwrap(), 1);
}
