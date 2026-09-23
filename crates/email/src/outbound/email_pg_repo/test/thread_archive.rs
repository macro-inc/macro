use super::thread_unread::service;
use super::*;
use crate::domain::models::EmailErr;
use crate::domain::{ports::EmailMessageEnqueuer, service::EmailServiceImpl};

struct RecordingBroker(Arc<std::sync::Mutex<Vec<serde_json::Value>>>);
impl macro_event_broker::MacroEventBroker for RecordingBroker {
    fn send_event<E: macro_event_broker::MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<
        tokio::task::JoinHandle<Result<(), macro_event_broker::EventBrokerError>>,
        macro_event_broker::EventBrokerError,
    > {
        self.0
            .lock()
            .unwrap()
            .push(serde_json::to_value(event.event())?);
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unread", "email_thread_archive")
    )
)]
async fn archive_publishes_one_user_attributed_event_after_commit(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let service = service(pool).with_macro_event_broker(RecordingBroker(events.clone()));
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let id = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;
    service
        .set_thread_archived_impl(owner.clone(), id, true)
        .await?;
    assert_inbox_state(&service.email_repo, id, false).await?;
    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["event_type"], "email.thread_archived");
    assert_eq!(events[0]["metadata"]["actor"], owner.as_ref());
    assert_eq!(events[0]["metadata"]["archived"], true);
    Ok(())
}

struct FailingEnqueuer;
impl EmailMessageEnqueuer for FailingEnqueuer {
    type Err = anyhow::Error;
    async fn enqueue_scheduled_message(
        &self,
        _: Uuid,
        _: Uuid,
        _: Option<i32>,
    ) -> anyhow::Result<()> {
        unreachable!()
    }
    async fn enqueue_gmail_ops_modify_labels_batch(
        &self,
        _: Uuid,
        _: Vec<(Uuid, String)>,
        _: Vec<String>,
        _: Vec<String>,
    ) -> anyhow::Result<()> {
        anyhow::bail!("test queue unavailable")
    }
    async fn enqueue_gmail_ops_block_sender(&self, _: Uuid, _: String) -> anyhow::Result<()> {
        unreachable!()
    }
    async fn enqueue_gmail_ops_unblock_sender(&self, _: Uuid, _: String) -> anyhow::Result<()> {
        unreachable!()
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unread", "email_thread_archive")
    )
)]
async fn archive_enqueue_failure_restores_only_changed_labels_and_the_original_flag(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let original = service(pool);
    let service = EmailServiceImpl {
        email_repo: original.email_repo,
        frecency_service: original.frecency_service,
        enqueuer: FailingEnqueuer,
        crm_service: original.crm_service,
        entity_access_management_service: original.entity_access_management_service,
        macro_event_broker: original.macro_event_broker,
        sent_undo_delay_secs: original.sent_undo_delay_secs,
    };
    let thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let first = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;
    let second = Uuid::parse_str("11111111-bbbb-bbbb-bbbb-111111111111")?;
    service
        .email_repo
        .delete_message_labels_batch(&[second], "INBOX", link)
        .await?;
    assert!(matches!(
        service
            .set_thread_archived_impl(
                MacroUserIdStr::try_from_email("user1@test.com")?,
                thread,
                true,
            )
            .await,
        Err(EmailErr::EnqueueErr(_))
    ));
    assert!(
        service
            .email_repo
            .thread_by_id(thread)
            .await?
            .unwrap()
            .inbox_visible
    );
    let labels = service
        .email_repo
        .labels_by_message_ids(&[first, second])
        .await?;
    for (id, expected) in [(first, true), (second, false)] {
        assert_eq!(
            labels
                .get(&id)
                .into_iter()
                .flatten()
                .any(|label| label.provider_label_id == "INBOX"),
            expected
        );
    }
    Ok(())
}

async fn assert_inbox_state(
    repo: &EmailPgRepo,
    thread_id: Uuid,
    visible: bool,
) -> anyhow::Result<()> {
    let thread = repo.thread_by_id(thread_id).await?.unwrap();
    assert_eq!(thread.inbox_visible, visible);
    let messages = repo
        .get_thread_label_messages(thread_id, thread.link_id)
        .await?;
    let ids: Vec<_> = messages.iter().map(|message| message.db_id).collect();
    let labels = repo.labels_by_message_ids(&ids).await?;
    for id in ids {
        assert_eq!(
            labels
                .get(&id)
                .into_iter()
                .flatten()
                .any(|label| label.provider_label_id == "INBOX"),
            visible
        );
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unread", "email_thread_archive")
    )
)]
async fn archive_undo_redo_are_idempotent_and_use_the_threads_own_inbox(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service(pool);
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let first = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let second = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;
    for archived in [true, true, false, false, true] {
        service
            .set_thread_archived_impl(owner.clone(), second, archived)
            .await?;
        assert_inbox_state(&service.email_repo, second, !archived).await?;
        assert_inbox_state(&service.email_repo, first, true).await?;
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unread", "email_thread_archive")
    )
)]
async fn archive_rejects_inaccessible_and_empty_threads(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service(pool);
    let first = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    for archived in [true, false] {
        assert!(matches!(
            service
                .set_thread_archived_impl(
                    MacroUserIdStr::try_from_email("stranger@test.com")?,
                    first,
                    archived,
                )
                .await,
            Err(EmailErr::ThreadNotFound)
        ));
    }
    assert_inbox_state(&service.email_repo, first, true).await?;
    assert!(matches!(
        service
            .set_thread_archived_impl(
                MacroUserIdStr::try_from_email("user1@test.com")?,
                Uuid::parse_str("22222222-2222-2222-2222-222222222222")?,
                true,
            )
            .await,
        Err(EmailErr::ThreadEmpty)
    ));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts(
            "email_thread_labels",
            "email_thread_unread",
            "email_thread_archive",
            "email_thread_archive_failure"
        )
    )
)]
async fn failed_archive_rolls_back_inbox_label_removal(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let service = service(pool);
    let thread = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;
    assert!(matches!(
        service
            .set_thread_archived_impl(
                MacroUserIdStr::try_from_email("user1@test.com")?,
                thread,
                true,
            )
            .await,
        Err(EmailErr::RepoErr(_))
    ));
    assert_inbox_state(&service.email_repo, thread, true).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn unarchive_requires_a_canonical_inbound_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service(pool);
    let thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    assert!(matches!(
        service
            .set_thread_archived_impl(
                MacroUserIdStr::try_from_email("user1@test.com")?,
                thread,
                false,
            )
            .await,
        Err(EmailErr::ThreadHasNoInboundMessages)
    ));
    assert_inbox_state(&service.email_repo, thread, true).await?;
    Ok(())
}
