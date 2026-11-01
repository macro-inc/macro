//! Sequence steps: scheduled drafts that stay out of the user's mail lists
//! until they are sent or fail.

use super::*;
use crate::domain::{
    models::{ContactInfo, CreateDraftInput, EmailErr, ScheduledSendSource, ScheduledSendStatus},
    ports::NoOpEnqueuer,
    scheduled::{EmailSchedulingRepo, ScheduleChange},
    sequence_steps::{CancelExpectation, CancelOutcome, NewStep, SequenceStepStore},
    service::EmailServiceImpl,
};
use crm::domain::service::NoOpCrmService;
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_event_broker::NoopMacroEventBroker;
use macro_user_id::cowlike::CowLike as _;

// From the `email_draft` fixture.
const LINK: Uuid = uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
/// A sent message in `SENT_THREAD`; `REPLY_DRAFT` is the user's unsent reply to it.
const SENT: Uuid = uuid::uuid!("ee000001-0000-0000-0000-000000000001");
const SENT_THREAD: Uuid = uuid::uuid!("11111111-1111-1111-1111-111111111111");
const REPLY_DRAFT: Uuid = uuid::uuid!("ee000002-0000-0000-0000-000000000002");
/// A local draft that is the only message in its thread.
const DRAFT: Uuid = uuid::uuid!("ee000004-0000-0000-0000-000000000004");
/// A thread holding one received message in the inbox.
const RECEIVED_THREAD: Uuid = uuid::uuid!("22222222-2222-2222-2222-222222222222");
const STEP_THREAD: Uuid = uuid::uuid!("33333333-3333-3333-3333-333333333333");
/// The fixture's sender of `SENT` and of every local draft.
const ALICE: Uuid = uuid::uuid!("c0000001-0000-0000-0000-000000000001");
/// The lists a local draft shows in when its thread has no received mail.
const DRAFT_LISTS: [&str; 5] = [
    "drafts",
    "drafts_dynamic",
    "all",
    "important",
    "important_dynamic",
];

fn actor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap()
}

fn service(
    pool: Pool<Postgres>,
) -> EmailServiceImpl<
    EmailPgRepo,
    FrecencyQueryServiceImpl<FrecencyPgStorage>,
    NoOpEnqueuer,
    NoOpCrmService,
    (),
> {
    EmailServiceImpl {
        email_repo: EmailPgRepo::new(pool.clone()),
        frecency_service: FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(pool)),
        enqueuer: NoOpEnqueuer,
        crm_service: NoOpCrmService,
        entity_access_management_service: (),
        macro_event_broker: NoopMacroEventBroker,
        sent_undo_delay_secs: 0,
        sender_provider: std::sync::Arc::new(
            crate::domain::senders::UnavailableEmailSenderProvider,
        ),
    }
}

/// Thread IDs each mail list shows, through both the static views and the
/// dynamic builder (which also serves GraphQL Soup).
#[derive(Debug)]
struct Lists {
    drafts: Vec<Uuid>,
    drafts_dynamic: Vec<Uuid>,
    all: Vec<Uuid>,
    important: Vec<Uuid>,
    important_dynamic: Vec<Uuid>,
    sent_dynamic: Vec<Uuid>,
}

impl Lists {
    fn showing(&self, thread: Uuid) -> Vec<&'static str> {
        [
            ("drafts", &self.drafts),
            ("drafts_dynamic", &self.drafts_dynamic),
            ("all", &self.all),
            ("important", &self.important),
            ("important_dynamic", &self.important_dynamic),
            ("sent_dynamic", &self.sent_dynamic),
        ]
        .into_iter()
        .filter(|(_, ids)| ids.contains(&thread))
        .map(|(name, _)| name)
        .collect()
    }
}

async fn lists(pool: &Pool<Postgres>) -> anyhow::Result<Lists> {
    let query = || Query::new(None, SimpleSortMethod::UpdatedAt, ());
    let ids = |rows: Vec<super::super::db_types::ThreadPreviewCursorDbRow>| {
        rows.into_iter().map(|row| row.id).collect::<Vec<_>>()
    };
    let dynamic = |label| async move {
        let rows = dynamic::dynamic_email_thread_cursor(
            pool,
            &[LINK],
            50,
            &PreviewView::StandardLabel(label),
            Query::new(
                None,
                SimpleSortMethod::UpdatedAt,
                Arc::new(Expr::Literal(EmailLiteral::CalendarOnly(false))),
            ),
            actor().as_ref(),
            None,
        )
        .await?;
        Ok::<_, anyhow::Error>(rows.into_iter().map(|row| row.id).collect::<Vec<_>>())
    };
    use super::super::preview_views::{draft, important};
    Ok(Lists {
        drafts: ids(draft::drafts_preview_cursor(pool, &[LINK], 50, &query()).await?),
        drafts_dynamic: dynamic(PreviewViewStandardLabel::Drafts).await?,
        all: dynamic(PreviewViewStandardLabel::All).await?,
        important: ids(important::important_preview_cursor(pool, &[LINK], 50, &query()).await?),
        important_dynamic: dynamic(PreviewViewStandardLabel::Important).await?,
        sent_dynamic: dynamic(PreviewViewStandardLabel::Sent).await?,
    })
}

async fn recompute(pool: &Pool<Postgres>, thread: Uuid) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    email_db_client::threads::update::recompute_thread_metadata(&mut tx, thread, LINK).await?;
    tx.commit().await?;
    Ok(())
}

async fn fail_delivery(pool: &Pool<Postgres>, message: Uuid) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_scheduled_messages SET delivery_status = 'failed', processing = true WHERE message_id = $1",
        message,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Create a step through the sequence port, in its own transaction.
async fn create_step(pool: &Pool<Postgres>, reply_to: Option<Uuid>) -> Result<Uuid, EmailErr> {
    let steps = PgSequenceSteps;
    let mut conn = pool.acquire().await.map_err(anyhow::Error::from)?;
    let from = ContactInfo {
        email: "user1@test.com".to_owned(),
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
                actor: actor().as_ref(),
                contacts: &contacts,
                to: &to,
                subject: "Hello",
                body_text: "Hi Bob",
                reply_to,
                send_time: Utc::now() + chrono::Duration::hours(1),
                list_unsubscribe_url: "https://example.com/u/token",
            },
        )
        .await?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(message)
}

async fn thread_of(pool: &Pool<Postgres>, message: Uuid) -> anyhow::Result<Uuid> {
    Ok(sqlx::query_scalar!(
        "SELECT thread_id FROM email_messages WHERE id = $1",
        message
    )
    .fetch_one(pool)
    .await?)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn pending_step_stays_out_of_mail_lists(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let step = create_step(&pool, None).await?;
    let thread = thread_of(&pool, step).await?;
    assert_eq!(lists(&pool).await?.showing(thread), Vec::<&str>::new());
    let projection = repo
        .thread_mail_projections_by_ids(actor(), &[thread])
        .await?
        .remove(0);
    assert!(projection.previews.draft.is_none());
    assert!(projection.previews.all.is_none());
    assert!(
        projection
            .draft_state
            .is_none_or(|state| state.drafts.is_empty()),
        "the normalized cache must not project the step into Drafts"
    );
    let schedule = sqlx::query!(
        "SELECT source, list_unsubscribe_url FROM email_scheduled_messages WHERE message_id = $1",
        step
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(schedule.source.as_deref(), Some("sequence"));
    assert_eq!(
        schedule.list_unsubscribe_url.as_deref(),
        Some("https://example.com/u/token")
    );

    // Unscheduling it in the composer returns the draft to the user's lists.
    repo.change_schedule(LINK, step, &actor(), ScheduleChange::Cancel, None, 0)
        .await?;
    assert_eq!(lists(&pool).await?.showing(thread), DRAFT_LISTS);

    // Withdrawing it leaves nothing behind.
    let mut conn = pool.acquire().await?;
    assert_eq!(
        PgSequenceSteps
            .cancel_step(&mut conn, step, CancelExpectation::Any)
            .await?,
        CancelOutcome::Cancelled
    );
    assert_eq!(lists(&pool).await?.showing(thread), Vec::<&str>::new());
    assert_eq!(
        PgSequenceSteps
            .cancel_step(&mut conn, step, CancelExpectation::Any)
            .await?,
        CancelOutcome::Gone
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn failed_step_shows_again(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let step = create_step(&pool, None).await?;
    let thread = thread_of(&pool, step).await?;
    fail_delivery(&pool, step).await?;
    recompute(&pool, thread).await?;
    assert_eq!(lists(&pool).await?.showing(thread), DRAFT_LISTS);
    Ok(())
}

fn users_reply(replying_to_id: Uuid) -> CreateDraftInput {
    CreateDraftInput {
        frozen_signature_html: None,
        draft_generation: 0,
        db_id: None,
        provider_id: None,
        replying_to_id: Some(replying_to_id),
        provider_thread_id: None,
        thread_db_id: None,
        subject: "Re: Hello World".to_owned(),
        sender_email: None,
        to: vec![ContactInfo {
            email: "bob@example.com".to_owned(),
            name: None,
            photo_url: None,
        }],
        cc: vec![],
        bcc: vec![],
        body_text: Some("My own reply".to_owned()),
        body_html: None,
        body_macro: None,
        headers_json: None,
        send_time: None,
        include_signature: Some(false),
        actor: Some(actor()),
        draft_client_binding: None,
        thread_client_binding: None,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn reply_step_threads_under_a_sent_parent_only(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // Without the user's own reply draft, the thread holds only sent mail.
    sqlx::query!("DELETE FROM email_messages WHERE id = $1", REPLY_DRAFT)
        .execute(&pool)
        .await?;
    recompute(&pool, SENT_THREAD).await?;
    assert!(matches!(
        create_step(&pool, Some(DRAFT)).await,
        Err(EmailErr::MessageNotFound(id)) if id == DRAFT
    ));

    let step = create_step(&pool, Some(SENT)).await?;
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

    let lists = lists(&pool).await?;
    assert!(!lists.drafts.contains(&SENT_THREAD));
    assert!(!lists.drafts_dynamic.contains(&SENT_THREAD));
    assert!(lists.sent_dynamic.contains(&SENT_THREAD));
    assert_eq!(
        all_mail_preview_names(&pool).await?,
        vec![Some("Hello World".to_owned())],
        "the thread previews its sent message, not the pending step"
    );

    // The user's own reply starts a draft of its own; it never adopts the step.
    let service = service(pool.clone());
    let inboxes = service.email_repo.inboxes_for_macro_id(actor()).await?;
    let link = inboxes.iter().find(|link| link.id == LINK).unwrap();
    let reply = service
        .create_draft_impl(link, &inboxes, users_reply(SENT))
        .await?;
    assert_ne!(reply.db_id, step);
    Ok(())
}

async fn all_mail_preview_names(pool: &Pool<Postgres>) -> anyhow::Result<Vec<Option<String>>> {
    let rows = dynamic::dynamic_email_thread_cursor(
        pool,
        &[LINK],
        50,
        &PreviewView::StandardLabel(PreviewViewStandardLabel::All),
        Query::new(
            None,
            SimpleSortMethod::UpdatedAt,
            Arc::new(Expr::Literal(EmailLiteral::CalendarOnly(false))),
        ),
        actor().as_ref(),
        None,
    )
    .await?;
    Ok(rows
        .into_iter()
        .filter(|row| row.id == SENT_THREAD)
        .map(|row| row.name)
        .collect())
}

/// A thread holding only a pending sequence step, as an enrollment's first step
/// leaves it: the projection gives it no message time, so it sorts first.
async fn insert_step_thread(pool: &Pool<Postgres>) -> anyhow::Result<Uuid> {
    let thread = Uuid::now_v7();
    let message = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id, is_read) VALUES ($1, $2, true)",
        thread,
        LINK,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, subject, is_read, is_draft)
           VALUES ($1, $2, $3, $4, 'Step one', true, true)"#,
        message,
        thread,
        LINK,
        ALICE,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO email_scheduled_messages (link_id, message_id, send_time, source)
           VALUES ($1, $2, NOW() + INTERVAL '1 day', 'sequence')"#,
        LINK,
        message,
    )
    .execute(pool)
    .await?;
    recompute(pool, thread).await?;
    Ok(thread)
}

/// Pages through the dynamic All Mail view, stopping at a short page as the
/// API does when it returns no next cursor.
async fn dynamic_all_mail_pages(
    pool: &Pool<Postgres>,
    filter: Expr<EmailLiteral>,
) -> anyhow::Result<Vec<Uuid>> {
    const PAGE: u32 = 2;
    let filter = Arc::new(filter);
    let mut ids = Vec::new();
    let mut cursor = None;
    loop {
        let page = dynamic::dynamic_email_thread_cursor(
            pool,
            &[LINK],
            PAGE,
            &PreviewView::StandardLabel(PreviewViewStandardLabel::All),
            Query::new(cursor, SimpleSortMethod::UpdatedAt, filter.clone()),
            actor().as_ref(),
            None,
        )
        .await?;
        ids.extend(page.iter().map(|row| row.id));
        let Some(last) = page.last().filter(|_| page.len() == PAGE as usize) else {
            return Ok(ids);
        };
        cursor = Some(Cursor {
            id: last.id,
            limit: PAGE as usize,
            val: CursorVal {
                sort_type: SimpleSortMethod::UpdatedAt,
                last_val: last.sort_ts,
            },
            filter: filter.clone(),
        });
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn pending_step_threads_do_not_cut_dynamic_all_mail_short(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    for thread in [SENT_THREAD, RECEIVED_THREAD, STEP_THREAD] {
        recompute(&pool, thread).await?;
    }
    // More step-only threads than a page holds, all sorting ahead of the mail.
    for _ in 0..3 {
        insert_step_thread(&pool).await?;
    }

    let alice = Email::Complete(EmailStr::parse_from_str("alice@example.com")?.into_owned());
    for (name, filter, expected) in [
        (
            "all",
            Expr::Literal(EmailLiteral::CalendarOnly(false)),
            vec![STEP_THREAD, RECEIVED_THREAD, SENT_THREAD],
        ),
        (
            "archived",
            Expr::Literal(EmailLiteral::InboxVisible(false)),
            vec![STEP_THREAD, SENT_THREAD],
        ),
        (
            "address view",
            Expr::Literal(EmailLiteral::Sender(alice)),
            vec![STEP_THREAD, SENT_THREAD],
        ),
    ] {
        assert_eq!(
            dynamic_all_mail_pages(&pool, filter).await?,
            expected,
            "{name}"
        );
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn thread_messages_carry_their_schedule_source(pool: Pool<Postgres>) -> anyhow::Result<()> {
    use entity_access::domain::models::{
        AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    };
    let service = service(pool.clone());
    let step = create_step(&pool, Some(SENT)).await?;
    let receipt = EntityAccessReceipt::try_new(
        EntityAccessAuth::Authenticated(actor()),
        Entity {
            entity_type: EntityType::EmailThread,
            entity_id: SENT_THREAD.to_string(),
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap();
    let message = service
        .get_thread_with_messages_impl(receipt, 0, 20)
        .await?
        .unwrap()
        .messages
        .into_iter()
        .find(|message| message.db_id == step)
        .unwrap();
    // The thread still returns a pending step, marked as one.
    assert_eq!(
        (message.scheduled_send_status, message.scheduled_send_source),
        (
            Some(ScheduledSendStatus::Pending),
            Some(ScheduledSendSource::Sequence)
        )
    );
    Ok(())
}
