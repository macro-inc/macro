//! Real backfill handlers with Postgres and fake Gmail/SQS. No progress mocks.
use super::world::{THREADS, World};
use crate::pubsub::backfill::{backfill_thread, update_metadata};
use email_db_client::backfill::progress::{self, ListingPage};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::service::backfill::{
    BackfillOperation, BackfillPubsubMessage, BackfillThreadPayload, JobScopedPayload,
};
use models_email::service::pubsub::ProcessingError;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stored_thread_resumes_failed_metadata_publication_and_counts_once(pool: PgPool) {
    let world = World::new(pool, 9880, false).await;
    let ctx = &world.sync;
    let link = email_db_client::links::get::fetch_link_by_id(&ctx.db, world.link_id)
        .await
        .unwrap()
        .unwrap();
    let job = Uuid::now_v7();
    sqlx::query!("INSERT INTO email_backfill_jobs (id, link_id, fusionauth_user_id, status, completed_threads) VALUES ($1, $2, 'fa-backfill-failure', 'InProgress', 0)", job, link.id).execute(&ctx.db).await.unwrap();
    progress::register_page(
        &ctx.db,
        job,
        false,
        "",
        ListingPage {
            thread_provider_ids: vec![THREADS[0].into(), THREADS[1].into()],
            next_page_token: None,
        },
    )
    .await
    .unwrap();
    progress::finish_listing(&ctx.db, job).await.unwrap();
    let scope = JobScopedPayload {
        link_id: link.id,
        job_id: job,
        payload: BackfillThreadPayload {
            thread_provider_id: THREADS[0].into(),
            refresh_existing: false,
        },
    };
    world.sqs.lock().fail_body_containing = Some("update_thread_metadata".into());
    assert!(matches!(
        backfill_thread::backfill_thread(ctx, &scope, &link).await,
        Err(ProcessingError::Retryable(_))
    ));
    assert!(
        !progress::thread_completed(&ctx.db, job, THREADS[0])
            .await
            .unwrap()
    );
    assert!(
        world
            .sqs
            .lock()
            .failed_sends
            .iter()
            .any(|send| send.body.contains("update_thread_metadata"))
    );
    world.sqs.lock().fail_body_containing = None;
    backfill_thread::backfill_thread(ctx, &scope, &link)
        .await
        .unwrap();
    let (sent, _) = world.sqs.take();
    let metadata = sent
        .iter()
        .filter_map(|send| serde_json::from_str::<BackfillPubsubMessage>(&send.body).ok())
        .find_map(|message| match message.backfill_operation {
            BackfillOperation::UpdateThreadMetadata(scope) => Some(scope),
            _ => None,
        })
        .expect("retry must publish the missing metadata work");
    let (a, b) = tokio::join!(
        update_metadata::update_thread_metadata(ctx, &metadata, &link),
        update_metadata::update_thread_metadata(ctx, &metadata, &link),
    );
    a.unwrap();
    b.unwrap();
    let job_state = sqlx::query!(
        "SELECT completed_threads, status::text AS status FROM email_backfill_jobs WHERE id = $1",
        job
    )
    .fetch_one(&ctx.db)
    .await
    .unwrap();
    assert_eq!(job_state.completed_threads, Some(1));
    assert_eq!(job_state.status.as_deref(), Some("InProgress"));
    // Redelivery after the thread receipt is durable avoids provider/effect
    // work and still leaves the other registered thread outstanding.
    world.sqs.set_outage(true);
    backfill_thread::backfill_thread(ctx, &scope, &link)
        .await
        .unwrap();
    assert!(
        !progress::thread_completed(&ctx.db, job, THREADS[1])
            .await
            .unwrap()
    );
}
