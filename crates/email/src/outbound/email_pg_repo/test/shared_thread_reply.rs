use super::*;
use crate::domain::models::{CreateDraftInput, EmailErr};
use crate::domain::ports::NoOpEnqueuer;
use crate::domain::service::EmailServiceImpl;
use crate::domain::shared_thread_replies::{
    NoSharedThreadReplies, ReplyTargetInboxFuture, SharedThreadReplyAccess,
};
use crm::domain::service::NoOpCrmService;
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_event_broker::NoopMacroEventBroker;

/// Grants a reply into `inbox` for any message, as an edit share would.
struct GrantsInbox(Uuid);

impl SharedThreadReplyAccess for GrantsInbox {
    fn reply_target_inbox<'a>(
        &'a self,
        _actor: &'a MacroUserIdStr<'static>,
        _message_id: Uuid,
    ) -> ReplyTargetInboxFuture<'a> {
        let inbox = self.0;
        Box::pin(async move { Ok(Some(inbox)) })
    }
}

fn service(
    pool: Pool<Postgres>,
    shared_thread_replies: impl SharedThreadReplyAccess,
) -> EmailServiceImpl<
    EmailPgRepo,
    FrecencyQueryServiceImpl<FrecencyPgStorage>,
    NoOpEnqueuer,
    NoOpCrmService,
    (),
> {
    EmailServiceImpl {
        sender_provider: Arc::new(crate::domain::senders::UnavailableEmailSenderProvider),
        shared_thread_replies: Arc::new(shared_thread_replies),
        email_repo: EmailPgRepo::new(pool.clone()),
        frecency_service: FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(pool)),
        enqueuer: NoOpEnqueuer,
        crm_service: NoOpCrmService,
        entity_access_management_service: (),
        macro_event_broker: NoopMacroEventBroker,
        sent_undo_delay_secs: 5,
    }
}

/// A second user with an inbox of their own; user1's thread is shared with them.
async fn insert_recipient_inbox(pool: &Pool<Postgres>) -> anyhow::Result<Uuid> {
    let inbox = Uuid::parse_str("dddddddd-dddd-dddd-dddd-dddddddddddd")?;
    sqlx::query!(
        "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
         VALUES ($1, 'macro|user2@test.com', 'fa-user-2', 'user2@test.com', 'GMAIL', true, NOW(), NOW())",
        inbox
    )
    .execute(pool)
    .await?;
    Ok(inbox)
}

fn recipient() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user2@test.com").unwrap()
}

fn reply_to(message: Uuid) -> CreateDraftInput {
    CreateDraftInput {
        frozen_signature_html: None,
        draft_generation: 0,
        sender_email: None,
        db_id: None,
        provider_id: None,
        replying_to_id: Some(message),
        provider_thread_id: None,
        thread_db_id: None,
        subject: "Re: Hello World".to_string(),
        to: vec![],
        cc: vec![],
        bcc: vec![],
        body_text: Some("Replying from my own inbox".to_string()),
        body_html: None,
        body_macro: None,
        headers_json: None,
        send_time: None,
        include_signature: None,
        actor: None,
        draft_client_binding: None,
        thread_client_binding: None,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn shared_thread_reply_starts_a_thread_in_the_recipients_inbox(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let owner_inbox = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let owner_thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let parent = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let recipient_inbox = insert_recipient_inbox(&pool).await?;
    let service = service(pool.clone(), GrantsInbox(owner_inbox));

    let saved = service
        .save_draft_for_user_impl(recipient(), Some(recipient_inbox), reply_to(parent))
        .await?;

    assert_eq!(saved.draft.link_id, recipient_inbox);
    assert_eq!(saved.draft.replying_to_id, Some(parent));
    assert_ne!(saved.draft.thread_db_id, owner_thread);
    assert_eq!(saved.draft.provider_thread_id, None);
    assert_eq!(
        saved.draft.headers_json,
        Some(serde_json::json!([{ "Macro-In-Reply-To": parent.to_string() }]))
    );

    // Saving again (an autosave with the server id) keeps the same reply.
    let mut autosave = reply_to(parent);
    autosave.db_id = Some(saved.draft.db_id);
    autosave.draft_generation = saved.draft.draft_generation;
    let resaved = service
        .save_draft_for_user_impl(recipient(), Some(recipient_inbox), autosave)
        .await?;
    assert_eq!(resaved.draft.db_id, saved.draft.db_id);

    // The owner's thread is untouched.
    let owner_messages = sqlx::query_scalar!(
        "SELECT COUNT(*) AS \"count!\" FROM email_messages WHERE thread_id = $1",
        owner_thread
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(owner_messages, 2);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn reply_to_an_unshared_thread_is_not_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let parent = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let recipient_inbox = insert_recipient_inbox(&pool).await?;
    let service = service(pool, NoSharedThreadReplies);

    let result = service
        .save_draft_for_user_impl(recipient(), Some(recipient_inbox), reply_to(parent))
        .await;

    assert!(matches!(result, Err(EmailErr::MessageNotFound(id)) if id == parent));
    Ok(())
}
