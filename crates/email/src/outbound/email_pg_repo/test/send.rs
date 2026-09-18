//! Durability of the undo-window send path.
//!
//! `send_message_impl` commits the message as a non-draft with a pending
//! scheduled row and only then enqueues the delivery, so these tests run the
//! domain service against the real repo with an enqueuer that fails, and pin
//! down what the database is left holding.

use super::*;
use crate::domain::models::{ContactInfo, CreateDraftInput};
use crate::domain::ports::EmailMessageEnqueuer;
use crate::domain::service::EmailServiceImpl;
use crm::domain::service::NoOpCrmService;
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_event_broker::NoopMacroEventBroker;
use macro_user_id::email::EmailStr;

const LINK_ID: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SENT_MESSAGE_ID: &str = "ee000001-0000-0000-0000-000000000001";
const DRAFT_MESSAGE_ID: &str = "ee000002-0000-0000-0000-000000000002";
/// The draft that is the only message in its thread, so thread metadata swings
/// entirely on whether it counts as a draft.
const LONE_DRAFT_MESSAGE_ID: &str = "ee000004-0000-0000-0000-000000000004";
const LONE_DRAFT_THREAD_ID: &str = "33333333-3333-3333-3333-333333333333";

/// Stands in for SQS being unreachable — the shape of the outage that stranded
/// sends in production.
#[derive(Clone)]
struct FailingEnqueuer;

impl EmailMessageEnqueuer for FailingEnqueuer {
    type Err = anyhow::Error;

    async fn enqueue_scheduled_message(
        &self,
        _link_id: Uuid,
        _message_id: Uuid,
        _delay_seconds: Option<i32>,
    ) -> Result<(), Self::Err> {
        Err(anyhow::anyhow!("queue unavailable"))
    }

    async fn enqueue_gmail_ops_modify_labels_batch(
        &self,
        _link_id: Uuid,
        _messages: Vec<(Uuid, String)>,
        _labels_to_add: Vec<String>,
        _labels_to_remove: Vec<String>,
    ) -> Result<(), Self::Err> {
        Err(anyhow::anyhow!("queue unavailable"))
    }

    async fn enqueue_gmail_ops_block_sender(
        &self,
        _link_id: Uuid,
        _email_address: String,
    ) -> Result<(), Self::Err> {
        Err(anyhow::anyhow!("queue unavailable"))
    }

    async fn enqueue_gmail_ops_unblock_sender(
        &self,
        _link_id: Uuid,
        _email_address: String,
    ) -> Result<(), Self::Err> {
        Err(anyhow::anyhow!("queue unavailable"))
    }
}

/// The send path touches neither frecency nor CRM nor the event broker, so
/// those collaborators are no-ops; the repo is the real thing.
type TestService<E> = EmailServiceImpl<
    EmailPgRepo,
    FrecencyQueryServiceImpl<FrecencyPgStorage>,
    E,
    NoOpCrmService,
    (),
    NoopMacroEventBroker,
>;

fn service<E: EmailMessageEnqueuer>(pool: Pool<Postgres>, enqueuer: E) -> TestService<E> {
    EmailServiceImpl {
        email_repo: EmailPgRepo::new(pool.clone()),
        frecency_service: FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(pool)),
        enqueuer,
        crm_service: NoOpCrmService,
        entity_access_management_service: (),
        macro_event_broker: NoopMacroEventBroker,
        sent_undo_delay_secs: 10,
    }
}

fn link() -> anyhow::Result<Link> {
    Ok(Link {
        id: Uuid::parse_str(LINK_ID)?,
        macro_id: MacroUserIdStr::try_from_email("user1@test.com")?,
        fusionauth_user_id: "fa-user-1".to_owned(),
        email_address: EmailStr::try_from("user1@test.com".to_owned())?,
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: true,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}

fn send_input(db_id: Option<Uuid>) -> CreateDraftInput {
    CreateDraftInput {
        db_id,
        provider_id: None,
        replying_to_id: None,
        provider_thread_id: None,
        thread_db_id: None,
        subject: "Quarterly update".to_owned(),
        to: vec![ContactInfo {
            email: "bob@example.com".to_owned(),
            name: None,
            photo_url: None,
        }],
        cc: vec![],
        bcc: vec![],
        body_text: Some("Numbers attached.".to_owned()),
        body_html: None,
        body_macro: None,
        headers_json: None,
        send_time: None,
        include_signature: Some(false),
        actor: None,
    }
}

/// `(is_draft, is_sent)` for a message row.
async fn message_flags(pool: &Pool<Postgres>, message_id: Uuid) -> anyhow::Result<(bool, bool)> {
    let row = sqlx::query!(
        "SELECT is_draft, is_sent FROM email_messages WHERE id = $1",
        message_id,
    )
    .fetch_one(pool)
    .await?;
    Ok((row.is_draft, row.is_sent))
}

async fn scheduled_row_count(pool: &Pool<Postgres>, message_id: Uuid) -> anyhow::Result<i64> {
    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM email_scheduled_messages WHERE message_id = $1"#,
        message_id,
    )
    .fetch_one(pool)
    .await?;
    Ok(count)
}

struct ThreadInboxState {
    inbox_visible: bool,
    latest_inbound_message_ts: Option<chrono::DateTime<Utc>>,
}

async fn thread_inbox_state(
    pool: &Pool<Postgres>,
    thread_id: Uuid,
) -> anyhow::Result<ThreadInboxState> {
    let row = sqlx::query!(
        "SELECT inbox_visible, latest_inbound_message_ts FROM email_threads WHERE id = $1",
        thread_id,
    )
    .fetch_one(pool)
    .await?;

    Ok(ThreadInboxState {
        inbox_visible: row.inbox_visible,
        latest_inbound_message_ts: row.latest_inbound_message_ts,
    })
}

// ── send_message_impl ─────────────────────────────────────────────

/// The regression: a failed enqueue used to leave the message flipped to
/// non-draft with a scheduled row and nothing in the queue to deliver it, so
/// the draft vanished from the UI and no mail ever went out. The sweep could
/// not rescue it either, because it only looked at drafts.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn failed_enqueue_leaves_the_message_as_an_unsent_draft(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link = link()?;
    let draft_id = Uuid::parse_str(DRAFT_MESSAGE_ID)?;
    let service = service(pool.clone(), FailingEnqueuer);

    let err = service
        .send_message_impl(&link, &[link.clone()], send_input(Some(draft_id)))
        .await
        .expect_err("enqueue failed, so the send must fail");

    assert!(
        matches!(err, EmailErr::EnqueueErr(_)),
        "expected EnqueueErr, got {err:?}"
    );

    let (is_draft, is_sent) = message_flags(&pool, draft_id).await?;
    assert!(is_draft, "the draft must survive a failed send");
    assert!(!is_sent);
    assert_eq!(
        scheduled_row_count(&pool, draft_id).await?,
        0,
        "no scheduled row should be left pointing at a send that will never happen"
    );

    Ok(())
}

/// The agent/AI path sends without an existing draft (`db_id: None`), so the
/// revert has to leave the freshly composed body behind as a draft rather than
/// losing it.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn failed_enqueue_keeps_a_brand_new_send_as_a_draft(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link = link()?;
    let service = service(pool.clone(), FailingEnqueuer);

    let err = service
        .send_message_impl(&link, &[link.clone()], send_input(None))
        .await
        .expect_err("enqueue failed, so the send must fail");
    assert!(
        matches!(err, EmailErr::EnqueueErr(_)),
        "expected EnqueueErr, got {err:?}"
    );

    let new_message_id: Uuid = sqlx::query_scalar!(
        r#"
        SELECT id FROM email_messages
        WHERE link_id = $1 AND subject = 'Quarterly update'
        "#,
        link.id,
    )
    .fetch_one(&pool)
    .await?;

    let (is_draft, is_sent) = message_flags(&pool, new_message_id).await?;
    assert!(is_draft, "the composed body must survive as a draft");
    assert!(!is_sent);
    assert_eq!(scheduled_row_count(&pool, new_message_id).await?, 0);

    Ok(())
}

/// The happy path still commits the message as outgoing with a pending
/// scheduled row — the revert must not fire when the enqueue succeeds.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn successful_enqueue_commits_the_send(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link = link()?;
    let draft_id = Uuid::parse_str(DRAFT_MESSAGE_ID)?;
    let service = service(pool.clone(), crate::domain::ports::NoOpEnqueuer);

    let created = service
        .send_message_impl(&link, &[link.clone()], send_input(Some(draft_id)))
        .await?;
    assert_eq!(created.db_id, draft_id);

    let (is_draft, is_sent) = message_flags(&pool, draft_id).await?;
    assert!(!is_draft, "an enqueued send is no longer a draft");
    assert!(
        !is_sent,
        "the worker marks it sent once Gmail accepts it, not here"
    );
    assert_eq!(scheduled_row_count(&pool, draft_id).await?, 1);

    Ok(())
}

// ── revert_sent_message_to_draft ──────────────────────────────────

/// Drafts count toward a thread's denormalized `inbox_visible` and
/// latest-message timestamps, so the metadata the insert computed for an
/// outgoing message has to be recomputed on the way back.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn revert_recomputes_thread_metadata(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link = link()?;
    let draft_id = Uuid::parse_str(LONE_DRAFT_MESSAGE_ID)?;
    let thread_id = Uuid::parse_str(LONE_DRAFT_THREAD_ID)?;
    let repo = EmailPgRepo::new(pool.clone());
    let service = service(pool.clone(), crate::domain::ports::NoOpEnqueuer);

    service
        .send_message_impl(&link, &[link.clone()], send_input(Some(draft_id)))
        .await?;

    let sent = thread_inbox_state(&pool, thread_id).await?;
    assert!(
        !sent.inbox_visible && sent.latest_inbound_message_ts.is_none(),
        "the thread's only message is outgoing, so nothing keeps it in the inbox"
    );

    repo.revert_sent_message_to_draft(draft_id, link.id).await?;

    let reverted = thread_inbox_state(&pool, thread_id).await?;
    assert!(
        reverted.inbox_visible,
        "a thread holding a draft again belongs back in the inbox"
    );
    assert!(reverted.latest_inbound_message_ts.is_some());

    Ok(())
}

/// Losing a queue message must never be able to un-send mail that Gmail has
/// already accepted, so the revert is a no-op once the worker has marked the
/// message sent.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn revert_leaves_an_already_delivered_message_alone(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str(LINK_ID)?;
    let sent_id = Uuid::parse_str(SENT_MESSAGE_ID)?;
    let repo = EmailPgRepo::new(pool.clone());

    sqlx::query!(
        r#"
        INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, created_at, updated_at)
        VALUES ($1, $2, NOW(), false, NOW(), NOW())
        "#,
        link_id,
        sent_id,
    )
    .execute(&pool)
    .await?;

    repo.revert_sent_message_to_draft(sent_id, link_id).await?;

    let (is_draft, is_sent) = message_flags(&pool, sent_id).await?;
    assert!(!is_draft, "a delivered message must not become a draft");
    assert!(is_sent);
    assert_eq!(
        scheduled_row_count(&pool, sent_id).await?,
        1,
        "the revert bails before touching the scheduled row"
    );

    Ok(())
}

/// A worker that has claimed the scheduled row will deliver the mail whether or
/// not this revert runs (`get_message_to_send` does not re-check `is_draft`), so
/// reverting underneath it would send the email and leave a live draft behind.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn revert_leaves_a_message_a_worker_is_delivering_alone(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link = link()?;
    let draft_id = Uuid::parse_str(DRAFT_MESSAGE_ID)?;
    let repo = EmailPgRepo::new(pool.clone());
    let service = service(pool.clone(), crate::domain::ports::NoOpEnqueuer);

    service
        .send_message_impl(&link, &[link.clone()], send_input(Some(draft_id)))
        .await?;

    sqlx::query!(
        r#"
        UPDATE email_scheduled_messages SET processing = true
        WHERE link_id = $1 AND message_id = $2
        "#,
        link.id,
        draft_id,
    )
    .execute(&pool)
    .await?;

    repo.revert_sent_message_to_draft(draft_id, link.id).await?;

    let (is_draft, is_sent) = message_flags(&pool, draft_id).await?;
    assert!(
        !is_draft,
        "a send in flight must not become a draft that can be sent again"
    );
    assert!(!is_sent);
    assert_eq!(
        scheduled_row_count(&pool, draft_id).await?,
        1,
        "the worker still needs its row to mark the send as sent"
    );

    Ok(())
}

/// The guard has to be a lock, not a read. A worker's claim is one committed
/// statement, so a revert that merely *read* `processing` could have a claim
/// land between that read and its DELETE, delete the row the worker just
/// claimed, and leave the worker to send from the data it already holds.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn revert_waits_for_a_claim_racing_it(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link = link()?;
    let draft_id = Uuid::parse_str(DRAFT_MESSAGE_ID)?;
    let repo = EmailPgRepo::new(pool.clone());
    let service = service(pool.clone(), crate::domain::ports::NoOpEnqueuer);

    service
        .send_message_impl(&link, &[link.clone()], send_input(Some(draft_id)))
        .await?;

    // A worker claims the row exactly the way the scheduled consumer does, but
    // holds the transaction open so the claim is in flight, not settled.
    let mut claim = pool.begin().await?;
    sqlx::query!(
        r#"
        UPDATE email_scheduled_messages SET processing = true, updated_at = NOW()
        WHERE link_id = $1 AND message_id = $2
        "#,
        link.id,
        draft_id,
    )
    .execute(&mut *claim)
    .await?;

    let mut revert = tokio::spawn({
        let repo = repo.clone();
        let link_id = link.id;
        async move { repo.revert_sent_message_to_draft(draft_id, link_id).await }
    });

    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(500), &mut revert)
            .await
            .is_err(),
        "the revert must wait on the in-flight claim"
    );

    // What the claim lands on is the point. Testing `processing` with an
    // unlocked read lets the revert flip the message to a draft first and only
    // then wait — on the DELETE's row lock — so once the claim commits it
    // deletes the row that claim just took and leaves a live draft behind.
    claim.commit().await?;
    revert.await??;

    let (is_draft, is_sent) = message_flags(&pool, draft_id).await?;
    assert!(
        !is_draft,
        "once the claim lands the revert must see it and leave the send alone"
    );
    assert!(!is_sent);
    assert_eq!(
        scheduled_row_count(&pool, draft_id).await?,
        1,
        "the claimed row must survive for the worker to mark the send as sent"
    );

    Ok(())
}

/// A message that was never inserted (or belongs to another inbox) must not
/// make the revert fail — it runs on a path that is already handling an error.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn revert_is_a_no_op_for_an_unknown_message(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    repo.revert_sent_message_to_draft(Uuid::from_u128(999), Uuid::parse_str(LINK_ID)?)
        .await?;

    Ok(())
}
