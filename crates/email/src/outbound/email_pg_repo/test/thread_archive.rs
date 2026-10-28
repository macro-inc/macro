use super::thread_unread::service;
use super::*;
use crate::domain::models::{EmailErr, MAX_BULK_ARCHIVE_THREADS, SetThreadsArchivedResult};
use crate::domain::{ports::EmailMessageEnqueuer, service::EmailServiceImpl};
use crm::domain::service::NoOpCrmService;
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};

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

fn service_with_enqueuer<E: EmailMessageEnqueuer>(
    pool: Pool<Postgres>,
    enqueuer: E,
) -> EmailServiceImpl<EmailPgRepo, FrecencyQueryServiceImpl<FrecencyPgStorage>, E, NoOpCrmService, ()>
{
    let original = service(pool);
    EmailServiceImpl {
        email_repo: original.email_repo,
        frecency_service: original.frecency_service,
        enqueuer,
        crm_service: original.crm_service,
        entity_access_management_service: original.entity_access_management_service,
        macro_event_broker: original.macro_event_broker,
        sent_undo_delay_secs: original.sent_undo_delay_secs,
        sender_provider: original.sender_provider,
    }
}

type LabelWrite = (Uuid, Vec<(Uuid, String)>, Vec<String>, Vec<String>);

/// Label writes and, in the same order, the pending write id each carried.
#[derive(Clone, Default)]
struct RecordingEnqueuer(
    Arc<std::sync::Mutex<Vec<LabelWrite>>>,
    Arc<std::sync::Mutex<Vec<Uuid>>>,
);
impl EmailMessageEnqueuer for RecordingEnqueuer {
    type Err = anyhow::Error;
    const MAX_LABEL_WRITE_MESSAGES: usize = 1000;
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
        link_id: Uuid,
        messages: Vec<(Uuid, String)>,
        labels_to_add: Vec<String>,
        labels_to_remove: Vec<String>,
        pending_write_id: Uuid,
    ) -> anyhow::Result<()> {
        self.0
            .lock()
            .unwrap()
            .push((link_id, messages, labels_to_add, labels_to_remove));
        self.1.lock().unwrap().push(pending_write_id);
        Ok(())
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
async fn archive_sends_gmail_only_the_messages_still_in_the_inbox(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let enqueuer = RecordingEnqueuer::default();
    let service = service_with_enqueuer(pool.clone(), enqueuer.clone());
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let first = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;
    let second = Uuid::parse_str("11111111-bbbb-bbbb-bbbb-111111111111")?;
    service
        .email_repo
        .delete_message_labels_batch(&[second], "INBOX", link)
        .await?;

    service
        .set_thread_archived_impl(owner.clone(), thread, true)
        .await?;
    // Archiving again changes no labels, so Gmail hears nothing.
    service
        .set_thread_archived_impl(owner, thread, true)
        .await?;

    assert_eq!(
        *enqueuer.0.lock().unwrap(),
        vec![(
            link,
            vec![(first, "msg1a".to_string())],
            vec![],
            vec!["INBOX".to_string()]
        )]
    );
    let write_id = enqueuer.1.lock().unwrap()[0];
    assert_eq!(
        pending_markers(&pool).await?,
        vec![(first, "INBOX".to_string(), write_id)]
    );
    assert_inbox_state(&service.email_repo, thread, false).await?;
    Ok(())
}

async fn pending_markers(pool: &Pool<Postgres>) -> anyhow::Result<Vec<(Uuid, String, Uuid)>> {
    Ok(sqlx::query!(
        "SELECT message_id, provider_label_id, write_id FROM email_gmail_pending_label_writes ORDER BY message_id, seq"
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|marker| (marker.message_id, marker.provider_label_id, marker.write_id))
    .collect())
}

struct FailingEnqueuer;
impl EmailMessageEnqueuer for FailingEnqueuer {
    type Err = anyhow::Error;
    const MAX_LABEL_WRITE_MESSAGES: usize = 1000;
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
        _: Uuid,
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
    let service = service_with_enqueuer(pool.clone(), FailingEnqueuer);
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
    assert!(pending_markers(&pool).await?.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unread", "email_thread_archive")
    )
)]
async fn failed_enqueue_hands_markers_back_to_the_write_still_on_its_way(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let enqueuer = RecordingEnqueuer::default();
    let queued = service_with_enqueuer(pool.clone(), enqueuer.clone());
    let unqueued = service_with_enqueuer(pool.clone(), FailingEnqueuer);
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let first = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;
    let second = Uuid::parse_str("11111111-bbbb-bbbb-bbbb-111111111111")?;

    // The archive is queued but not yet applied by Gmail.
    queued
        .set_thread_archived_impl(owner.clone(), thread, true)
        .await?;
    let archive = enqueuer.1.lock().unwrap()[0];
    // The unarchive takes the markers over, then cannot be queued.
    assert!(
        unqueued
            .set_thread_archived_impl(owner, thread, false)
            .await
            .is_err()
    );

    assert_inbox_state(&queued.email_repo, thread, false).await?;
    assert_eq!(
        pending_markers(&pool).await?,
        vec![
            (first, "INBOX".to_string(), archive),
            (second, "INBOX".to_string(), archive),
        ]
    );
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
    let service = service(pool.clone());
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let first = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let second = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;
    for archived in [true, true, false, false, true] {
        service
            .set_thread_archived_impl(owner.clone(), second, archived)
            .await?;
        assert_inbox_state(&service.email_repo, second, !archived).await?;
        assert_inbox_state(&service.email_repo, first, true).await?;
        // Model provider sync between actions, including delayed Undo. The
        // inbox sort timestamp legitimately vanishes when INBOX is removed.
        let mut tx = pool.begin().await?;
        super::super::thread::update_thread_metadata(
            &mut tx,
            second,
            Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb")?,
        )
        .await?;
        tx.commit().await?;
        if archived {
            assert!(
                service
                    .email_repo
                    .thread_by_id(second)
                    .await?
                    .unwrap()
                    .latest_inbound_message_ts
                    .is_none()
            );
        }
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
    let service = service(pool.clone());
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
    assert!(pending_markers(&pool).await?.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unread", "email_thread_archive")
    )
)]
async fn staged_inbox_change_marks_the_messages_it_changed_in_the_same_transaction(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let first = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;
    let second = Uuid::parse_str("11111111-bbbb-bbbb-bbbb-111111111111")?;
    let write_id = Uuid::from_u128(0xf1);
    repo.delete_message_labels_batch(&[second], "INBOX", link)
        .await?;

    let staged = repo
        .stage_thread_label_change(thread, link, "INBOX", false, write_id)
        .await?
        .expect("the thread has messages");

    assert_eq!(staged.changed_ids, vec![first]);
    assert_inbox_state(&repo, thread, false).await?;
    assert_eq!(
        pending_markers(&pool).await?,
        vec![(first, "INBOX".to_string(), write_id)]
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unread", "email_thread_archive")
    )
)]
async fn a_label_write_waits_for_the_one_already_staging_on_its_thread(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let first = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;

    // Another write holds the thread's label-write lock while it archives `first`.
    let mut staging = pool.begin().await?;
    email_db_client::labels::pending_writes::lock_thread_label_writes(&mut staging, &[thread])
        .await?;
    sqlx::query!(
        "DELETE FROM email_message_labels WHERE message_id = $1",
        first
    )
    .execute(&mut *staging)
    .await?;

    let blocked = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        repo.stage_thread_label_change(thread, link, "INBOX", true, Uuid::from_u128(0xf2)),
    )
    .await;
    assert!(blocked.is_err(), "a second write must wait for the first");

    staging.commit().await?;
    let staged = repo
        .stage_thread_label_change(thread, link, "INBOX", true, Uuid::from_u128(0xf2))
        .await?
        .expect("the thread has messages");
    assert_eq!(staged.changed_ids, vec![first]);
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
async fn failed_staged_inbox_change_leaves_no_pending_marker(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let thread = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;
    let link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb")?;

    assert!(
        repo.stage_thread_label_change(thread, link, "INBOX", false, Uuid::from_u128(0xf1))
            .await
            .is_err()
    );

    assert_inbox_state(&repo, thread, true).await?;
    assert!(pending_markers(&pool).await?.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_message_star_failure")
    )
)]
async fn failed_star_flag_rolls_back_the_label_and_its_marker(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    assert!(
        repo.stage_thread_label_change(thread, link, "STARRED", true, Uuid::from_u128(0xf1))
            .await
            .is_err()
    );

    let messages = repo.get_thread_label_messages(thread, link).await?;
    assert!(messages.iter().all(|message| !message.is_starred));
    let ids: Vec<_> = messages.iter().map(|message| message.db_id).collect();
    let labels = repo.labels_by_message_ids(&ids).await?;
    assert!(
        !labels
            .values()
            .flatten()
            .any(|label| label.provider_label_id == "STARRED")
    );
    assert!(pending_markers(&pool).await?.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn unarchive_uses_messages_when_the_inbox_sort_timestamp_is_missing(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service(pool);
    let thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    assert!(
        service
            .email_repo
            .thread_by_id(thread)
            .await?
            .unwrap()
            .latest_inbound_message_ts
            .is_none()
    );
    service
        .set_thread_archived_impl(
            MacroUserIdStr::try_from_email("user1@test.com")?,
            thread,
            false,
        )
        .await?;
    assert_inbox_state(&service.email_repo, thread, true).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unarchive")
    )
)]
async fn unarchive_rejects_sent_only_and_drafts_but_accepts_self_addressed_mail(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service(pool);
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    for id in [
        "44444444-4444-4444-4444-444444444444",
        "55555555-5555-5555-5555-555555555555",
    ] {
        let thread = Uuid::parse_str(id)?;
        assert!(matches!(
            service
                .set_thread_archived_impl(owner.clone(), thread, false)
                .await,
            Err(EmailErr::ThreadHasNoInboundMessages)
        ));
        assert_inbox_state(&service.email_repo, thread, false).await?;
    }
    let self_addressed = Uuid::parse_str("66666666-6666-6666-6666-666666666666")?;
    service
        .set_thread_archived_impl(owner, self_addressed, false)
        .await?;
    assert_inbox_state(&service.email_repo, self_addressed, true).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_outlook_threads"))
)]
async fn outlook_archive_moves_the_thread_through_mailbox_commands(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service(pool);
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let received = Uuid::parse_str("0a000000-0000-0000-0000-0000000000a1")?;
    let sent_only = Uuid::parse_str("0a000000-0000-0000-0000-0000000000a2")?;
    let inbox_visible = |thread| {
        let repo = &service.email_repo;
        async move { anyhow::Ok(repo.thread_by_id(thread).await?.unwrap().inbox_visible) }
    };
    for archived in [true, false] {
        service
            .set_thread_archived_impl(owner.clone(), received, archived)
            .await?;
        assert_eq!(inbox_visible(received).await?, !archived);
    }
    assert!(matches!(
        service
            .set_thread_archived_impl(owner, sent_only, false)
            .await,
        Err(EmailErr::ThreadHasNoInboundMessages)
    ));
    assert!(!inbox_visible(sent_only).await?);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unread", "email_thread_archive")
    )
)]
async fn bulk_archive_sends_one_gmail_write_per_inbox_and_reports_threads_it_skips(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let enqueuer = RecordingEnqueuer::default();
    let service = service_with_enqueuer(pool.clone(), enqueuer.clone());
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let primary_thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let empty_thread = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;
    let secondary_thread = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;
    let missing_thread = Uuid::from_u128(404);

    let result = service
        .set_threads_archived_impl(
            owner,
            vec![
                primary_thread,
                empty_thread,
                secondary_thread,
                primary_thread,
                missing_thread,
            ],
            true,
        )
        .await?;

    assert_eq!(
        result,
        SetThreadsArchivedResult {
            updated_thread_ids: vec![primary_thread, secondary_thread],
            failed_thread_ids: vec![empty_thread, missing_thread],
        }
    );
    assert_eq!(
        *enqueuer.0.lock().unwrap(),
        vec![
            (
                Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?,
                vec![
                    (
                        Uuid::parse_str("11111111-bbbb-bbbb-bbbb-111111111111")?,
                        "msg1b".to_string()
                    ),
                    (
                        Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?,
                        "msg1a".to_string()
                    ),
                ],
                vec![],
                vec!["INBOX".to_string()],
            ),
            (
                Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb")?,
                vec![(
                    Uuid::parse_str("33333333-aaaa-aaaa-aaaa-333333333333")?,
                    "msg3".to_string()
                )],
                vec![],
                vec!["INBOX".to_string()],
            ),
        ]
    );
    let write_ids = enqueuer.1.lock().unwrap().clone();
    assert_ne!(write_ids[0], write_ids[1]);
    assert_eq!(
        pending_markers(&pool).await?,
        vec![
            (
                Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?,
                "INBOX".to_string(),
                write_ids[0]
            ),
            (
                Uuid::parse_str("11111111-bbbb-bbbb-bbbb-111111111111")?,
                "INBOX".to_string(),
                write_ids[0]
            ),
            (
                Uuid::parse_str("33333333-aaaa-aaaa-aaaa-333333333333")?,
                "INBOX".to_string(),
                write_ids[1]
            ),
        ]
    );
    assert_inbox_state(&service.email_repo, primary_thread, false).await?;
    assert_inbox_state(&service.email_repo, secondary_thread, false).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unread", "email_thread_archive")
    )
)]
async fn bulk_archive_reports_an_enqueue_outage_instead_of_failing_every_thread(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service_with_enqueuer(pool.clone(), FailingEnqueuer);
    let primary_thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let secondary_thread = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;

    let result = service
        .set_threads_archived_impl(
            MacroUserIdStr::try_from_email("user1@test.com")?,
            vec![primary_thread, secondary_thread],
            true,
        )
        .await;

    assert!(matches!(result, Err(EmailErr::EnqueueErr(_))));
    assert_inbox_state(&service.email_repo, primary_thread, true).await?;
    assert_inbox_state(&service.email_repo, secondary_thread, true).await?;
    assert!(pending_markers(&pool).await?.is_empty());
    Ok(())
}

/// Accepts one label write, then fails, with room for two messages per write.
#[derive(Clone, Default)]
struct FailsAfterFirstWriteEnqueuer(Arc<std::sync::Mutex<Vec<(LabelWrite, Uuid)>>>);
impl EmailMessageEnqueuer for FailsAfterFirstWriteEnqueuer {
    type Err = anyhow::Error;
    const MAX_LABEL_WRITE_MESSAGES: usize = 2;
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
        link_id: Uuid,
        messages: Vec<(Uuid, String)>,
        labels_to_add: Vec<String>,
        labels_to_remove: Vec<String>,
        pending_write_id: Uuid,
    ) -> anyhow::Result<()> {
        let mut writes = self.0.lock().unwrap();
        if !writes.is_empty() {
            anyhow::bail!("test queue unavailable");
        }
        writes.push((
            (link_id, messages, labels_to_add, labels_to_remove),
            pending_write_id,
        ));
        Ok(())
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
        scripts(
            "email_thread_labels",
            "email_thread_unread",
            "email_thread_archive",
            "email_thread_archive_groups"
        )
    )
)]
async fn bulk_archive_reverts_only_the_threads_whose_write_could_not_be_queued(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let enqueuer = FailsAfterFirstWriteEnqueuer::default();
    let service = service_with_enqueuer(pool.clone(), enqueuer.clone());
    let queued_thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let unqueued_thread = Uuid::parse_str("77777777-7777-7777-7777-777777777777")?;

    let result = service
        .set_threads_archived_impl(
            MacroUserIdStr::try_from_email("user1@test.com")?,
            vec![queued_thread, unqueued_thread],
            true,
        )
        .await?;

    assert_eq!(
        result,
        SetThreadsArchivedResult {
            updated_thread_ids: vec![queued_thread],
            failed_thread_ids: vec![unqueued_thread],
        }
    );
    // The first thread's two messages fill the first write on their own.
    let writes = enqueuer.0.lock().unwrap().clone();
    assert_eq!(
        writes
            .iter()
            .map(|((_, messages, _, _), _)| messages.len())
            .collect::<Vec<_>>(),
        vec![2]
    );
    let write_id = writes[0].1;
    // Only the queued group keeps its markers.
    assert_eq!(
        pending_markers(&pool).await?,
        vec![
            (
                Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?,
                "INBOX".to_string(),
                write_id
            ),
            (
                Uuid::parse_str("11111111-bbbb-bbbb-bbbb-111111111111")?,
                "INBOX".to_string(),
                write_id
            ),
        ]
    );
    assert_inbox_state(&service.email_repo, queued_thread, false).await?;
    assert_inbox_state(&service.email_repo, unqueued_thread, true).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unread", "email_thread_archive")
    )
)]
async fn bulk_archive_counts_repeated_threads_once_against_the_limit(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let enqueuer = RecordingEnqueuer::default();
    let service = service_with_enqueuer(pool, enqueuer.clone());
    let thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;

    let result = service
        .set_threads_archived_impl(
            MacroUserIdStr::try_from_email("user1@test.com")?,
            vec![thread; MAX_BULK_ARCHIVE_THREADS + 1],
            true,
        )
        .await?;

    assert_eq!(
        result,
        SetThreadsArchivedResult {
            updated_thread_ids: vec![thread],
            failed_thread_ids: vec![],
        }
    );
    assert_eq!(enqueuer.0.lock().unwrap().len(), 1);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn bulk_archive_rejects_more_threads_than_one_request_may_change(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let enqueuer = RecordingEnqueuer::default();
    let service = service_with_enqueuer(pool, enqueuer.clone());
    let thread_ids = (0..=MAX_BULK_ARCHIVE_THREADS as u128)
        .map(Uuid::from_u128)
        .collect();

    assert!(matches!(
        service
            .set_threads_archived_impl(
                MacroUserIdStr::try_from_email("user1@test.com")?,
                thread_ids,
                true,
            )
            .await,
        Err(EmailErr::TooManyThreads(MAX_BULK_ARCHIVE_THREADS))
    ));
    assert!(enqueuer.0.lock().unwrap().is_empty());
    Ok(())
}
