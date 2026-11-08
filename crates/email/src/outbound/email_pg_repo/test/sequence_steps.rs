//! Sequence steps: ordinary scheduled sends a sequence creates and withdraws.

use super::*;
use crate::domain::{
    models::{ContactInfo, EmailErr, ScheduledSendStatus},
    sequence_steps::{CancelOutcome, NewStep, SequenceStepStore, StepState},
};
use chrono::{DateTime, SubsecRound as _, Utc};

// From the `email_draft` fixture.
const LINK: Uuid = uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
/// A sent message in `SENT_THREAD`.
const SENT: Uuid = uuid::uuid!("ee000001-0000-0000-0000-000000000001");
const SENT_THREAD: Uuid = uuid::uuid!("11111111-1111-1111-1111-111111111111");
/// A local draft that is the only message in its thread.
const DRAFT: Uuid = uuid::uuid!("ee000004-0000-0000-0000-000000000004");

/// Create a step through the sequence port, in its own transaction.
async fn create_step(
    pool: &Pool<Postgres>,
    reply_to: Option<Uuid>,
    send_time: DateTime<Utc>,
) -> Result<Uuid, EmailErr> {
    let steps = PgSequenceSteps;
    let mut conn = pool.acquire().await.map_err(anyhow::Error::from)?;
    let from = ContactInfo {
        email: "owner@example.com".to_owned(),
        name: None,
        photo_url: None,
    };
    let to = ContactInfo {
        email: "bob@example.com".to_owned(),
        name: Some("Bob".to_owned()),
        photo_url: None,
    };
    let contacts = steps.upsert_contacts(&mut conn, LINK, &from, &to).await?;
    let mut tx = pool.begin().await.map_err(anyhow::Error::from)?;
    let message = steps
        .create_step(
            &mut tx,
            &NewStep {
                link_id: LINK,
                actor: "macro|owner@example.com",
                contacts: &contacts,
                to: &to,
                subject: "Hello",
                body_text: "Hi Bob",
                reply_to,
                send_time,
                list_unsubscribe_url: "https://example.com/u/token",
            },
        )
        .await?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(message)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn a_step_is_a_scheduled_send_until_withdrawn(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let send_time = (Utc::now() + chrono::Duration::seconds(80)).trunc_subsecs(6);
    let step = create_step(&pool, None, send_time).await?;
    let mut conn = pool.acquire().await?;
    let steps = PgSequenceSteps;

    assert_eq!(
        steps.step_state(&mut conn, step).await?,
        StepState::Scheduled {
            send_time,
            status: ScheduledSendStatus::Pending
        }
    );
    let unsubscribe = sqlx::query_scalar!(
        "SELECT list_unsubscribe_url FROM email_scheduled_messages WHERE message_id = $1",
        step
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(unsubscribe.as_deref(), Some("https://example.com/u/token"));
    // Spacing reads the inbox's sends in the window only.
    let now = Utc::now();
    assert_eq!(
        steps
            .latest_send_until(&mut conn, LINK, now + chrono::Duration::seconds(90))
            .await?,
        Some(send_time)
    );
    assert_eq!(
        steps
            .latest_send_until(&mut conn, LINK, now + chrono::Duration::seconds(30))
            .await?,
        None
    );

    assert_eq!(
        steps.cancel_step(&mut conn, step).await?,
        CancelOutcome::Cancelled
    );
    assert_eq!(steps.step_state(&mut conn, step).await?, StepState::Gone);
    assert_eq!(
        steps.cancel_step(&mut conn, step).await?,
        CancelOutcome::Gone
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn reply_step_threads_under_a_sent_parent_only(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let send_time = Utc::now() + chrono::Duration::hours(1);
    assert!(matches!(
        create_step(&pool, Some(DRAFT), send_time).await,
        Err(EmailErr::MessageNotFound(id)) if id == DRAFT
    ));

    let step = create_step(&pool, Some(SENT), send_time).await?;
    let row = sqlx::query!(
        "SELECT thread_id, replying_to_id, headers_jsonb FROM email_messages WHERE id = $1",
        step
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(row.thread_id, SENT_THREAD);
    assert_eq!(row.replying_to_id, Some(SENT));
    assert_eq!(
        row.headers_jsonb,
        Some(serde_json::json!([{ "Macro-In-Reply-To": SENT.to_string() }]))
    );

    let mut conn = pool.acquire().await?;
    assert_eq!(
        PgSequenceSteps.sent_subject(&mut conn, LINK, SENT).await?,
        Some("Hello World".to_owned())
    );
    assert_eq!(
        PgSequenceSteps.sent_subject(&mut conn, LINK, step).await?,
        None
    );
    Ok(())
}
