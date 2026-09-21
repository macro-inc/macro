use super::*;
use crate::domain::scheduled::{EmailSchedulingRepo, EmailSchedulingService, ScheduleChange};
use crate::domain::service::EmailServiceImpl;
use email_db_client::messages::scheduled::get::get_and_start_processing_scheduled_message;
use macro_event_broker::NoopMacroEventBroker;

fn identity() -> (Uuid, Uuid) {
    (
        Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap(),
        Uuid::parse_str("ee000002-0000-0000-0000-000000000002").unwrap(),
    )
}

fn actor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap()
}

fn future() -> ScheduleChange {
    ScheduleChange::Set(Utc::now() + chrono::Duration::hours(1))
}

async fn wait_for_transaction_waiter(pool: &Pool<Postgres>, blocker: i32) -> anyhow::Result<()> {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let waiting = sqlx::query_scalar!(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))) AS \"exists!\"",
                blocker,
            ).fetch_one(pool).await?;
            if waiting {
                return Ok::<_, sqlx::Error>(());
            }
            tokio::task::yield_now().await;
        }
    }).await??;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn schedule_update_cancel_is_atomic_and_idempotent(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let (link, message) = identity();
    assert!(
        repo.change_schedule(link, message, &actor(), future(), None)
            .await?
            .is_some()
    );
    let later = Utc::now() + chrono::Duration::hours(2);
    repo.change_schedule(link, message, &actor(), ScheduleChange::Set(later), None)
        .await?;
    let schedule = sqlx::query!(
        "SELECT send_time, sent, processing FROM email_scheduled_messages WHERE message_id = $1",
        message
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        schedule.send_time.timestamp_micros(),
        later.timestamp_micros()
    );
    assert!(!schedule.sent && !schedule.processing);
    assert!(
        repo.change_schedule(link, message, &actor(), ScheduleChange::Cancel, None)
            .await?
            .is_some()
    );
    assert!(
        repo.change_schedule(link, message, &actor(), ScheduleChange::Cancel, None)
            .await?
            .is_none()
    );
    let wrong_link = Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc")?;
    assert!(matches!(
        repo.change_schedule(wrong_link, message, &actor(), ScheduleChange::Cancel, None)
            .await,
        Err(EmailErr::MessageNotFound(_))
    ));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn sent_or_claimed_delivery_rejects_update_cancel_and_migration(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let (link, message) = identity();
    repo.change_schedule(link, message, &actor(), future(), None)
        .await?;
    sqlx::query!(
        "UPDATE email_scheduled_messages SET processing = true WHERE message_id = $1",
        message
    )
    .execute(&pool)
    .await?;
    for change in [future(), ScheduleChange::Cancel] {
        assert!(matches!(
            repo.change_schedule(link, message, &actor(), change, None)
                .await,
            Err(EmailErr::MessageDeliveryConflict(_))
        ));
    }
    assert!(
        repo.delete_draft_message(
            message,
            Uuid::parse_str("11111111-1111-1111-1111-111111111111")?,
            &[link],
        )
        .await?
        .is_none()
    );
    sqlx::query!(
        "UPDATE email_scheduled_messages SET processing = false, sent = true WHERE message_id = $1",
        message
    )
    .execute(&pool)
    .await?;
    assert!(matches!(
        repo.change_schedule(link, message, &actor(), future(), None)
            .await,
        Err(EmailErr::MessageDeliveryConflict(_))
    ));
    let sent_message = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    assert!(matches!(
        repo.change_schedule(link, sent_message, &actor(), future(), None)
            .await,
        Err(EmailErr::MessageDeliveryConflict(_))
    ));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn service_authorizes_actor_and_validates_future_time(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = EmailServiceImpl {
        email_repo: EmailPgRepo::new(pool),
        frecency_service: (),
        enqueuer: (),
        crm_service: (),
        entity_access_management_service: (),
        macro_event_broker: NoopMacroEventBroker,
        sent_undo_delay_secs: 5,
    };
    let (link, message) = identity();
    let stranger = MacroUserIdStr::parse_from_str("macro|stranger@test.com")?;
    assert!(matches!(
        service
            .change_schedule(stranger, link, message, future(), None)
            .await,
        Err(EmailErr::Unauthorized)
    ));
    assert!(matches!(
        service
            .change_schedule(
                actor(),
                link,
                message,
                ScheduleChange::Set(Utc::now()),
                None
            )
            .await,
        Err(EmailErr::InvalidScheduleTime)
    ));
    service
        .change_schedule(actor(), link, message, future(), None)
        .await?;
    service
        .change_schedule(actor(), link, message, ScheduleChange::Cancel, None)
        .await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn scheduled_source_rejects_delete_and_migration_into_existing_reply(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use crate::domain::models::CreateDraftInput;
    use crate::domain::ports::NoOpEnqueuer;
    use crm::domain::service::NoOpCrmService;
    use frecency::{
        domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage,
    };

    let service = EmailServiceImpl {
        email_repo: EmailPgRepo::new(pool.clone()),
        frecency_service: FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(pool.clone())),
        enqueuer: NoOpEnqueuer,
        crm_service: NoOpCrmService,
        entity_access_management_service: (),
        macro_event_broker: NoopMacroEventBroker,
        sent_undo_delay_secs: 5,
    };
    let (link, message) = identity();
    service
        .change_schedule(actor(), link, message, future(), None)
        .await?;
    assert!(matches!(
        service.delete_draft_for_user_impl(actor(), message).await,
        Err(EmailErr::MessageDeliveryConflict(id)) if id == message
    ));
    let target_link = Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc")?;
    let target_draft = Uuid::parse_str("ee000005-0000-0000-0000-000000000005")?;
    let input = CreateDraftInput {
        db_id: Some(message),
        provider_id: None,
        replying_to_id: Some(Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?),
        provider_thread_id: None,
        thread_db_id: None,
        subject: "must not overwrite the target reply".to_string(),
        to: vec![],
        cc: vec![],
        bcc: vec![],
        body_text: Some("stale autosave".to_string()),
        body_html: None,
        body_macro: None,
        headers_json: None,
        send_time: None,
        include_signature: None,
        actor: None,
        draft_client_binding: None,
        thread_client_binding: None,
    };
    assert!(matches!(
        service.save_draft_for_user_impl(actor(), Some(target_link), input).await,
        Err(EmailErr::MessageDeliveryConflict(id)) if id == message
    ));
    let subject = sqlx::query_scalar!(
        "SELECT subject FROM email_messages WHERE id = $1",
        target_draft
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(subject.as_deref(), Some("Re: Hello World"));
    assert!(
        service
            .email_repo
            .get_simple_message(message, &[link])
            .await?
            .is_some()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn waiting_transition_observes_committed_claim(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let (link, message) = identity();
    repo.change_schedule(link, message, &actor(), future(), None)
        .await?;
    let mut tx = pool.begin().await?;
    let blocker = sqlx::query_scalar!("SELECT pg_backend_pid() AS \"pid!\"")
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query!(
        "SELECT id FROM email_messages WHERE id = $1 FOR UPDATE",
        message
    )
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE email_scheduled_messages SET processing = true WHERE message_id = $1",
        message
    )
    .execute(&mut *tx)
    .await?;
    let cancel = tokio::spawn(async move {
        repo.change_schedule(link, message, &actor(), ScheduleChange::Cancel, None)
            .await
    });
    wait_for_transaction_waiter(&pool, blocker).await?;
    tx.commit().await?;
    assert!(matches!(
        cancel.await?,
        Err(EmailErr::MessageDeliveryConflict(_))
    ));
    Ok(())
}

fn stale_input(message: Uuid) -> ResolvedDraftInput {
    ResolvedDraftInput {
        db_id: message,
        provider_id: None,
        replying_to_id: None,
        provider_thread_id: None,
        thread_db_id: Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap(),
        subject: "stale autosave".into(),
        to: vec![],
        cc: vec![],
        bcc: vec![],
        body_text: None,
        body_html: None,
        body_macro: None,
        headers_json: None,
        send_time: None,
        actor_id: None,
        draft_client_id: None,
        thread_client_id: None,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn stale_autosave_cannot_mutate_confirmed_claimed_or_sent_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let (link, message) = identity();
    let input = stale_input(message);
    let contacts = UpsertedContacts {
        from_contact_id: None,
        recipients: vec![],
    };
    repo.change_schedule(link, message, &actor(), future(), None)
        .await?;
    assert!(matches!(
        repo.insert_message(&input, &contacts, link, None, true)
            .await,
        Err(EmailErr::MessageDeliveryConflict(_))
    ));
    sqlx::query!("UPDATE email_scheduled_messages SET send_time = NOW() - INTERVAL '1 minute' WHERE message_id = $1", message)
        .execute(&pool).await?;
    assert!(
        get_and_start_processing_scheduled_message(&pool, link, message)
            .await?
            .is_some()
    );
    assert!(matches!(
        repo.insert_message(&input, &contacts, link, None, true)
            .await,
        Err(EmailErr::MessageDeliveryConflict(_))
    ));
    let mut tx = pool.begin().await?;
    let blocker = sqlx::query_scalar!("SELECT pg_backend_pid() AS \"pid!\"")
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query!(
        "UPDATE email_messages SET is_sent = true, is_draft = false WHERE id = $1",
        message
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "UPDATE email_scheduled_messages SET sent = true, processing = false WHERE message_id = $1",
        message
    )
    .execute(&mut *tx)
    .await?;
    let save = tokio::spawn(async move {
        repo.insert_message(&input, &contacts, link, None, true)
            .await
    });
    wait_for_transaction_waiter(&pool, blocker).await?;
    tx.commit().await?;
    assert!(save.await??.is_none());
    let row = sqlx::query!(
        "SELECT is_sent, is_draft, subject FROM email_messages WHERE id = $1",
        message
    )
    .fetch_one(&pool)
    .await?;
    assert!(row.is_sent && !row.is_draft);
    assert_ne!(row.subject.as_deref(), Some("stale autosave"));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn first_save_waiting_on_insert_cannot_overwrite_newly_confirmed_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let (link, _) = identity();
    let message = Uuid::new_v4();
    let input = stale_input(message);
    let mut tx = pool.begin().await?;
    let blocker = sqlx::query_scalar!("SELECT pg_backend_pid() AS \"pid!\"")
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query!(
        "INSERT INTO email_messages (id, link_id, thread_id, subject, is_draft, is_sent) VALUES ($1, $2, $3, 'confirmed content', true, false)",
        message, link, input.thread_db_id,
    ).execute(&mut *tx).await?;
    sqlx::query!(
        "INSERT INTO email_scheduled_messages (message_id, link_id, send_time) VALUES ($1, $2, NOW() + INTERVAL '1 hour')",
        message, link,
    ).execute(&mut *tx).await?;
    let save = tokio::spawn(async move {
        repo.insert_message(
            &input,
            &UpsertedContacts {
                from_contact_id: None,
                recipients: vec![],
            },
            link,
            None,
            true,
        )
        .await
    });
    // Wait for the actual unique-key conflict, not just the task's first poll:
    // the initial SELECT must have missed the uncommitted message and the
    // upsert's statement snapshot must predate this transaction's commit.
    wait_for_transaction_waiter(&pool, blocker).await?;
    tx.commit().await?;
    assert!(matches!(
        save.await?,
        Err(EmailErr::MessageDeliveryConflict(_))
    ));
    let subject = sqlx::query_scalar!("SELECT subject FROM email_messages WHERE id = $1", message)
        .fetch_one(&pool)
        .await?;
    assert_eq!(subject.as_deref(), Some("confirmed content"));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn update_or_cancel_before_claim_prevents_stale_queue_delivery(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let (link, message) = identity();
    repo.change_schedule(link, message, &actor(), future(), None)
        .await?;
    sqlx::query!("UPDATE email_scheduled_messages SET send_time = NOW() - INTERVAL '1 minute' WHERE message_id = $1", message).execute(&pool).await?;
    repo.change_schedule(link, message, &actor(), future(), None)
        .await?;
    assert!(
        get_and_start_processing_scheduled_message(&pool, link, message)
            .await?
            .is_none()
    );
    repo.change_schedule(link, message, &actor(), ScheduleChange::Cancel, None)
        .await?;
    assert!(
        get_and_start_processing_scheduled_message(&pool, link, message)
            .await?
            .is_none()
    );
    repo.change_schedule(link, message, &actor(), future(), None)
        .await?;
    sqlx::query!("UPDATE email_scheduled_messages SET send_time = NOW() - INTERVAL '1 minute' WHERE message_id = $1", message).execute(&pool).await?;
    assert!(
        get_and_start_processing_scheduled_message(&pool, link, message)
            .await?
            .is_some()
    );
    for change in [future(), ScheduleChange::Cancel] {
        assert!(matches!(
            repo.change_schedule(link, message, &actor(), change, None)
                .await,
            Err(EmailErr::MessageDeliveryConflict(_))
        ));
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn initial_schedule_prepares_signature_but_time_updates_preserve_content(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let (link, message) = identity();
    sqlx::query!("INSERT INTO email_settings (link_id, signature_on_replies_forwards, signature) VALUES ($1, true, '<p>Regards</p>')", link)
        .execute(&pool).await?;
    sqlx::query!("UPDATE email_messages SET body_html_sanitized = '<p>Hello</p>', body_text = 'Hello' WHERE id = $1", message)
        .execute(&pool).await?;
    let service = EmailServiceImpl {
        email_repo: EmailPgRepo::new(pool.clone()),
        frecency_service: (),
        enqueuer: (),
        crm_service: (),
        entity_access_management_service: (),
        macro_event_broker: NoopMacroEventBroker,
        sent_undo_delay_secs: 5,
    };
    service
        .change_schedule(actor(), link, message, future(), None)
        .await?;
    let original = sqlx::query!(
        "SELECT body_html_sanitized, body_text FROM email_messages WHERE id = $1",
        message
    )
    .fetch_one(&pool)
    .await?;
    let html = original.body_html_sanitized.as_deref().unwrap();
    assert!(html.contains("Regards"));
    assert_eq!(html.matches("macro-email-signature").count(), 1);
    assert_eq!(original.body_text.as_deref(), Some("Hello\n\nRegards"));
    sqlx::query!(
        "UPDATE email_settings SET signature = '<p>Changed</p>' WHERE link_id = $1",
        link
    )
    .execute(&pool)
    .await?;
    service
        .change_schedule(actor(), link, message, future(), None)
        .await?;
    let updated = sqlx::query!(
        "SELECT body_html_sanitized FROM email_messages WHERE id = $1",
        message
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(updated.body_html_sanitized, original.body_html_sanitized);
    service
        .change_schedule(actor(), link, message, ScheduleChange::Cancel, None)
        .await?;
    service
        .change_schedule(actor(), link, message, future(), Some(false))
        .await?;
    let excluded = sqlx::query!(
        "SELECT body_html_sanitized FROM email_messages WHERE id = $1",
        message
    )
    .fetch_one(&pool)
    .await?;
    assert!(
        !excluded
            .body_html_sanitized
            .unwrap()
            .contains("macro-email-signature")
    );
    Ok(())
}

struct ClaimRepo(Pool<Postgres>);

impl crate::domain::scheduled_delivery::ScheduledDeliveryRepo for ClaimRepo {
    type Claim = (Uuid, Uuid);
    type Sent = ();

    async fn try_claim(&self, link: Uuid, message: Uuid) -> anyhow::Result<Option<Self::Claim>> {
        Ok(
            get_and_start_processing_scheduled_message(&self.0, link, message)
                .await?
                .map(|_| (link, message)),
        )
    }
    async fn complete(&self, _: &Self::Claim, _: ()) -> anyhow::Result<()> {
        Ok(())
    }
    async fn release(&self, claim: Self::Claim) -> anyhow::Result<()> {
        email_db_client::messages::scheduled::upsert::clear_scheduled_message_processing(
            &self.0, claim.0, claim.1,
        )
        .await?;
        Ok(())
    }
}

#[derive(Default)]
struct PendingProvider {
    entered: tokio::sync::Notify,
    finish: tokio::sync::Notify,
}

impl crate::domain::scheduled_delivery::ScheduledMessageSender<(Uuid, Uuid), ()>
    for PendingProvider
{
    async fn send_claimed(&self, _: &(Uuid, Uuid)) -> anyhow::Result<()> {
        self.entered.notify_one();
        self.finish.notified().await;
        Ok(())
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn pending_provider_holds_no_locks_and_duplicate_cannot_release_claim(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use crate::domain::scheduled_delivery::deliver_scheduled;
    let repo = EmailPgRepo::new(pool.clone());
    let (link, message) = identity();
    repo.change_schedule(link, message, &actor(), future(), None)
        .await?;
    sqlx::query!("UPDATE email_scheduled_messages SET send_time = NOW() - INTERVAL '1 minute' WHERE message_id = $1", message).execute(&pool).await?;
    let claims = ClaimRepo(pool.clone());
    let provider = PendingProvider::default();
    let delivery = deliver_scheduled(&claims, &provider, link, message);
    tokio::pin!(delivery);
    tokio::select! {
        result = &mut delivery => panic!("delivery completed before provider was released: {result:?}"),
        _ = provider.entered.notified() => {},
    }
    for change in [future(), ScheduleChange::Cancel] {
        let caller = actor();
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            repo.change_schedule(link, message, &caller, change, None),
        )
        .await?;
        assert!(matches!(result, Err(EmailErr::MessageDeliveryConflict(_))));
    }
    deliver_scheduled(&claims, &provider, link, message).await?;
    let processing = sqlx::query_scalar!(
        "SELECT processing FROM email_scheduled_messages WHERE message_id = $1",
        message
    )
    .fetch_one(&pool)
    .await?;
    assert!(
        processing,
        "duplicate queue item cannot release the pending provider's claim"
    );
    provider.finish.notify_one();
    delivery.await?;
    Ok(())
}
