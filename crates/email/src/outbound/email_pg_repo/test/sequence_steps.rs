//! Sequence steps: scheduled drafts that stay out of the user's mail lists
//! until they are sent or fail, and replies that chain one step to the next.

use super::*;
use crate::domain::{
    models::{CreateDraftInput, EmailErr, ScheduledSendSource},
    ports::NoOpEnqueuer,
    scheduled::{EmailSchedulingRepo, EmailSchedulingService, ScheduleChange},
    service::EmailServiceImpl,
};
use crm::domain::service::NoOpCrmService;
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_event_broker::NoopMacroEventBroker;

// From the `email_draft` fixture.
const LINK: Uuid = uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const OTHER_LINK: Uuid = uuid::uuid!("cccccccc-cccc-cccc-cccc-cccccccccccc");
/// A sent message in `SENT_THREAD`; `REPLY_DRAFT` is the user's unsent reply to it.
const SENT: Uuid = uuid::uuid!("ee000001-0000-0000-0000-000000000001");
const SENT_THREAD: Uuid = uuid::uuid!("11111111-1111-1111-1111-111111111111");
const REPLY_DRAFT: Uuid = uuid::uuid!("ee000002-0000-0000-0000-000000000002");
/// A local draft that is the only message in its thread: a first step.
const STEP: Uuid = uuid::uuid!("ee000004-0000-0000-0000-000000000004");
const STEP_THREAD: Uuid = uuid::uuid!("33333333-3333-3333-3333-333333333333");
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

fn schedule(source: Option<ScheduledSendSource>) -> ScheduleChange {
    ScheduleChange::Set {
        send_time: Utc::now() + chrono::Duration::hours(1),
        source,
    }
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
    inbox: Vec<Uuid>,
    inbox_dynamic: Vec<Uuid>,
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
            ("inbox", &self.inbox),
            ("inbox_dynamic", &self.inbox_dynamic),
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
    use super::super::preview_views::{all_mail, draft, important, new_inbox};
    Ok(Lists {
        drafts: ids(draft::drafts_preview_cursor(pool, &[LINK], 50, &query()).await?),
        drafts_dynamic: dynamic(PreviewViewStandardLabel::Drafts).await?,
        inbox: ids(new_inbox::new_inbox_preview_cursor(pool, &[LINK], 50, &query()).await?),
        inbox_dynamic: dynamic(PreviewViewStandardLabel::Inbox).await?,
        all: ids(all_mail::all_mail_preview_cursor(pool, &[LINK], 50, &query()).await?),
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

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn pending_sequence_step_stays_out_of_mail_lists(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    recompute(&pool, STEP_THREAD).await?;
    assert_eq!(lists(&pool).await?.showing(STEP_THREAD), DRAFT_LISTS);

    repo.change_schedule(
        LINK,
        STEP,
        &actor(),
        schedule(Some(ScheduledSendSource::Sequence)),
        None,
        0,
    )
    .await?;
    assert_eq!(lists(&pool).await?.showing(STEP_THREAD), Vec::<&str>::new());
    let projection = repo
        .thread_mail_projections_by_ids(actor(), &[STEP_THREAD])
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

    // A time change without a source keeps the step hidden.
    repo.change_schedule(LINK, STEP, &actor(), schedule(None), None, 0)
        .await?;
    let source = sqlx::query_scalar!(
        "SELECT source FROM email_scheduled_messages WHERE message_id = $1",
        STEP
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(source.as_deref(), Some("sequence"));
    assert_eq!(lists(&pool).await?.showing(STEP_THREAD), Vec::<&str>::new());

    // Unscheduling returns the draft to the user's lists for cleanup.
    repo.change_schedule(LINK, STEP, &actor(), ScheduleChange::Cancel, None, 0)
        .await?;
    assert_eq!(lists(&pool).await?.showing(STEP_THREAD), DRAFT_LISTS);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn failed_sequence_step_shows_again(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    repo.change_schedule(
        LINK,
        STEP,
        &actor(),
        schedule(Some(ScheduledSendSource::Sequence)),
        None,
        0,
    )
    .await?;
    fail_delivery(&pool, STEP).await?;
    recompute(&pool, STEP_THREAD).await?;
    assert_eq!(lists(&pool).await?.showing(STEP_THREAD), DRAFT_LISTS);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn follow_up_step_hides_from_drafts_but_not_from_sent(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    recompute(&pool, SENT_THREAD).await?;
    // An ordinary scheduled draft is still the user's draft.
    repo.change_schedule(LINK, REPLY_DRAFT, &actor(), schedule(None), None, 0)
        .await?;
    let ordinary = lists(&pool).await?;
    assert!(ordinary.drafts.contains(&SENT_THREAD));
    assert!(ordinary.drafts_dynamic.contains(&SENT_THREAD));

    repo.change_schedule(LINK, REPLY_DRAFT, &actor(), ScheduleChange::Cancel, None, 0)
        .await?;
    repo.change_schedule(
        LINK,
        REPLY_DRAFT,
        &actor(),
        schedule(Some(ScheduledSendSource::Sequence)),
        None,
        0,
    )
    .await?;
    let lists = lists(&pool).await?;
    assert!(!lists.drafts.contains(&SENT_THREAD));
    assert!(!lists.drafts_dynamic.contains(&SENT_THREAD));
    assert!(lists.sent_dynamic.contains(&SENT_THREAD));
    // The thread previews its sent message, not the pending step.
    let all = all_mail_preview_names(&pool).await?;
    assert_eq!(all, vec![Some("Hello World".to_owned())]);
    Ok(())
}

async fn all_mail_preview_names(pool: &Pool<Postgres>) -> anyhow::Result<Vec<Option<String>>> {
    let rows = super::super::preview_views::all_mail::all_mail_preview_cursor(
        pool,
        &[LINK],
        50,
        &Query::new(None, SimpleSortMethod::UpdatedAt, ()),
    )
    .await?;
    Ok(rows
        .into_iter()
        .filter(|row| row.id == SENT_THREAD)
        .map(|row| row.name)
        .collect())
}

fn follow_up(replying_to_id: Uuid) -> CreateDraftInput {
    CreateDraftInput {
        frozen_signature_html: None,
        draft_generation: 0,
        db_id: None,
        provider_id: None,
        replying_to_id: Some(replying_to_id),
        reuse_reply_draft: true,
        provider_thread_id: None,
        thread_db_id: None,
        subject: "Re: Draft only thread".to_owned(),
        sender_email: None,
        to: vec![crate::domain::models::ContactInfo {
            email: "bob@example.com".to_owned(),
            name: None,
            photo_url: None,
        }],
        cc: vec![],
        bcc: vec![],
        body_text: Some("Following up".to_owned()),
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
async fn follow_up_replies_only_to_a_scheduled_draft_in_its_inbox(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service(pool.clone());
    let inboxes = service.email_repo.inboxes_for_macro_id(actor()).await?;
    let link = inboxes.iter().find(|link| link.id == LINK).unwrap();
    let other = inboxes.iter().find(|link| link.id == OTHER_LINK).unwrap();

    assert!(matches!(
        service
            .create_draft_impl(link, &inboxes, follow_up(STEP))
            .await,
        Err(EmailErr::CannotReplyToDraft)
    ));

    service
        .change_schedule(
            actor(),
            LINK,
            STEP,
            schedule(Some(ScheduledSendSource::Sequence)),
            Some(false),
            0,
        )
        .await?;
    let first = service
        .create_draft_impl(link, &inboxes, follow_up(STEP))
        .await?;
    assert_eq!(first.replying_to_id, Some(STEP));
    assert_eq!(
        first.thread_db_id, STEP_THREAD,
        "the follow-up joins the step's thread"
    );
    assert_eq!(
        first.headers_json,
        Some(serde_json::json!([{ "Macro-In-Reply-To": STEP.to_string() }]))
    );

    // Each create is its own step; an earlier reply to the step is not reused.
    let second = service
        .create_draft_impl(link, &inboxes, follow_up(STEP))
        .await?;
    assert_ne!(second.db_id, first.db_id);

    // Saving the follow-up again keeps its reply target.
    let mut edit = follow_up(STEP);
    edit.db_id = Some(first.db_id);
    edit.body_text = Some("Following up again".to_owned());
    service.create_draft_impl(link, &inboxes, edit).await?;

    // The step lives in another inbox than the sender.
    assert!(matches!(
        service
            .create_draft_impl(other, &inboxes, follow_up(STEP))
            .await,
        Err(EmailErr::CannotReplyToDraft)
    ));

    // A failed step stays scheduled (unsent) and can still be followed up;
    // its delivery is what decides whether the follow-up sends.
    fail_delivery(&pool, STEP).await?;
    service
        .create_draft_impl(link, &inboxes, follow_up(STEP))
        .await?;

    // An unscheduled draft cannot be replied to.
    sqlx::query!(
        "DELETE FROM email_scheduled_messages WHERE message_id = $1",
        STEP
    )
    .execute(&pool)
    .await?;
    assert!(matches!(
        service
            .create_draft_impl(link, &inboxes, follow_up(STEP))
            .await,
        Err(EmailErr::CannotReplyToDraft)
    ));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn follow_up_to_a_sent_step_leaves_the_users_reply_draft_alone(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service(pool.clone());
    let inboxes = service.email_repo.inboxes_for_macro_id(actor()).await?;
    let link = inboxes.iter().find(|link| link.id == LINK).unwrap();
    let users_draft = || async {
        let row = sqlx::query!(
            "SELECT subject, body_text, updated_at FROM email_messages WHERE id = $1",
            REPLY_DRAFT
        )
        .fetch_one(&pool)
        .await?;
        Ok::<_, anyhow::Error>((row.subject, row.body_text, row.updated_at))
    };
    let before = users_draft().await?;

    let mut step = follow_up(SENT);
    step.reuse_reply_draft = false;
    let step = service.create_draft_impl(link, &inboxes, step).await?;
    assert_ne!(step.db_id, REPLY_DRAFT, "the step is a draft of its own");
    assert_eq!(step.replying_to_id, Some(SENT));
    assert_eq!(step.thread_db_id, SENT_THREAD);
    assert_eq!(users_draft().await?, before);

    // By default a reply continues the user's existing draft, never the
    // scheduled step.
    service
        .change_schedule(
            actor(),
            LINK,
            step.db_id,
            schedule(Some(ScheduledSendSource::Sequence)),
            Some(false),
            0,
        )
        .await?;
    let reply = service
        .create_draft_impl(link, &inboxes, follow_up(SENT))
        .await?;
    assert_eq!(reply.db_id, REPLY_DRAFT);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn sequence_schedules_need_a_gmail_inbox(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let outlook = uuid::uuid!("dddddddd-dddd-dddd-dddd-dddddddddddd");
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active)
           SELECT $1, macro_id, fusionauth_user_id, 'outlook@example.com', 'OUTLOOK', true
           FROM email_links WHERE id = $2"#,
        outlook,
        LINK,
    )
    .execute(&pool)
    .await?;
    assert!(matches!(
        service(pool)
            .change_schedule(
                actor(),
                outlook,
                STEP,
                schedule(Some(ScheduledSendSource::Sequence)),
                None,
                0,
            )
            .await,
        Err(EmailErr::ScheduleSourceUnsupported)
    ));
    Ok(())
}
