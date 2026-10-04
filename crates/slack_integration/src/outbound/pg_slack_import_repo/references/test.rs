use super::super::lifecycle::test::{claim, expire, fixture};
use super::*;
use crate::domain::{
    ports::{ExecutionRepo, ImportRepo},
    slack::{mrkdwn::MrkdwnConverter, users::UserDirectory},
};
use std::collections::BTreeMap;

async fn intent(pool: &PgPool, context: &ClaimedConversation) -> HistoricalMessage {
    let channel = Uuid::now_v7();
    sqlx::query!("INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, 'source', 'private', 'macro|lifecycle@example.com')", channel).execute(pool).await.unwrap();
    let text = MrkdwnConverter {
        users: &UserDirectory::default(),
        channels: &BTreeMap::new(),
    }
    .convert_with_references("<#C1|source>", false)
    .unwrap();
    let message = HistoricalMessage {
        id: Uuid::now_v7(),
        source: SourceMessageId {
            team_id: context.team_id,
            slack_channel_id: context.metadata.slack_channel_id.clone(),
            ts: "1.000001".parse().unwrap(),
        },
        channel_id: channel,
        parent_id: None,
        orphaned_thread_ts: None,
        sender: HistoricalSender::SystemBot,
        imported_author: Some("source".into()),
        content: text.body,
        user_mentions: text.user_mentions,
        body_references: text.references,
        import_order: 0,
        reactions: vec![],
    };
    let mut tx = pool.begin().await.unwrap();
    batches::bind_target(&mut tx, &context.lease, channel)
        .await
        .unwrap();
    insert_in(&mut tx, &context.lease, &message).await.unwrap();
    tx.commit().await.unwrap();
    message
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn settlement_waits_for_atomic_references_then_required_search(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, None).await;
    let context = claim(&repo, &event).await;
    intent(&pool, &context).await;
    repo.finalize(team, event.job_id).await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    assert!(next_in(&mut tx).await.unwrap().is_none());
    tx.rollback().await.unwrap();
    repo.settle(&context.lease, ConversationStatus::Completed, None)
        .await
        .unwrap();
    assert_eq!(
        repo.progress(team, event.job_id)
            .await
            .unwrap()
            .unwrap()
            .status,
        JobStatus::Processing
    );
    let mut tx = pool.begin().await.unwrap();
    let fenced = next_in(&mut tx).await.unwrap().unwrap();
    let mut concurrent = pool.begin().await.unwrap();
    assert!(
        next_in(&mut concurrent).await.unwrap().is_none(),
        "job lock fences competing maintenance"
    );
    concurrent.rollback().await.unwrap();
    fenced.finish(true).await.unwrap();
    tx.rollback().await.unwrap(); // crash after patch/intent/search writes
    assert!(repo.pending_search(50).await.unwrap().is_empty());
    let mut restarted = pool.begin().await.unwrap();
    let fenced = next_in(&mut restarted).await.unwrap().unwrap();
    fenced.finish(true).await.unwrap();
    restarted.commit().await.unwrap();
    assert_eq!(
        repo.progress(team, event.job_id)
            .await
            .unwrap()
            .unwrap()
            .status,
        JobStatus::Processing
    );
    let request = repo.pending_search(50).await.unwrap().pop().unwrap();
    repo.record_search(&request, SearchState::Completed)
        .await
        .unwrap();
    assert_eq!(
        repo.progress(team, event.job_id)
            .await
            .unwrap()
            .unwrap()
            .status,
        JobStatus::Completed
    );
    let mut replay = pool.begin().await.unwrap();
    assert!(next_in(&mut replay).await.unwrap().is_none());
    replay.rollback().await.unwrap();
    repo.record_search(&request, SearchState::Failed)
        .await
        .unwrap();
    assert_eq!(
        repo.progress(team, event.job_id)
            .await
            .unwrap()
            .unwrap()
            .status,
        JobStatus::Completed
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn expired_abandoned_job_retains_resolution_opportunity_without_staging(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, None).await;
    let context = claim(&repo, &event).await;
    intent(&pool, &context).await;
    sqlx::query!("UPDATE slack_import_job SET staging_expires_at = clock_timestamp() + interval '12 hours' WHERE id = $1", Uuid::from(event.job_id)).execute(&pool).await.unwrap();
    expire(&pool, &event).await;
    repo.reconcile(50).await.unwrap();
    assert_eq!(
        repo.progress(team, event.job_id)
            .await
            .unwrap()
            .unwrap()
            .status,
        JobStatus::Processing
    );
    let mut tx = pool.begin().await.unwrap();
    next_in(&mut tx)
        .await
        .unwrap()
        .unwrap()
        .finish(false)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(
        repo.progress(team, event.job_id)
            .await
            .unwrap()
            .unwrap()
            .status,
        JobStatus::Failed
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn cancellation_expiry_stale_lease_and_cleanup_close_without_reclaim(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, None).await;
    let context = claim(&repo, &event).await;
    let message = intent(&pool, &context).await;
    repo.cancel(team, event.job_id).await.unwrap();
    expire(&pool, &event).await;
    let mut tx = pool.begin().await.unwrap();
    assert_eq!(
        *insert_in(&mut tx, &context.lease, &message)
            .await
            .unwrap_err()
            .current_context(),
        ImportError::LeaseLost
    );
    tx.rollback().await.unwrap();
    repo.reconcile(50).await.unwrap();
    assert_eq!(
        repo.progress(team, event.job_id)
            .await
            .unwrap()
            .unwrap()
            .status,
        JobStatus::Cancelling
    );
    // Reserve a separate maintenance connection before the obsolete delivery.
    // Reusing the claim's connection could flush a drop-queued rollback and mask
    // a lingering job lock from SKIP LOCKED.
    let mut tx = pool.begin().await.unwrap();
    assert!(matches!(
        repo.claim(&event, Uuid::now_v7().try_into().unwrap())
            .await
            .unwrap(),
        ClaimOutcome::Obsolete
    ));
    next_in(&mut tx)
        .await
        .unwrap()
        .expect("obsolete claim must release its job lock before returning")
        .finish(false)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(
        repo.progress(team, event.job_id)
            .await
            .unwrap()
            .unwrap()
            .status,
        JobStatus::Cancelled
    );
    let cleared = sqlx::query_scalar!("SELECT template IS NULL AS \"cleared!\" FROM slack_import_message_reference WHERE job_id = $1", Uuid::from(event.job_id)).fetch_one(&pool).await.unwrap();
    assert!(cleared);
    sqlx::query!(
        "DELETE FROM slack_import_job WHERE id = $1",
        Uuid::from(event.job_id)
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM slack_import_message_reference")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}
