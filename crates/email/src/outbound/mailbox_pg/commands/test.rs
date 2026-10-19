use super::*;
use crate::domain::{models::mailbox_action::MailboxAction, ports::EmailRepo};
use crate::outbound::mailbox_pg::test::{fixture, page, snapshot};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;

async fn setup(
    db: &PgPool,
) -> (
    PgMailboxSync,
    crate::outbound::EmailPgRepo,
    MessageLease,
    Uuid,
) {
    let (sync, link) = fixture(db).await;
    let stream = sync
        .claim_stream(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    sync.commit_page(&stream, &page()).await.unwrap();
    let work = sync
        .claim_message(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    sync.ingest(
        &work,
        snapshot(link, work.provider_id.as_str(), Default::default(), "v1"),
    )
    .await
    .unwrap();
    let thread = sqlx::query_scalar!(
        "SELECT thread_id FROM email_messages WHERE link_id = $1 AND provider_id = $2",
        link,
        work.provider_id.as_str()
    )
    .fetch_one(db)
    .await
    .unwrap();
    (
        sync,
        crate::outbound::EmailPgRepo::new(db.clone()),
        work,
        thread,
    )
}
fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("outlook-test@example.com").unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn newer_intent_survives_sync_and_ack_of_an_older_command(db: PgPool) {
    let (sync, repo, work, thread) = setup(&db).await;
    let messages = repo
        .mailbox_action_messages(work.mailbox.link_id, thread)
        .await
        .unwrap();
    let id = messages[0].id;
    let first = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Read(true),
            &MailboxAction::Read(true).targets(&messages),
        )
        .await
        .unwrap();
    let lease = sync
        .claim_command(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(lease.id, first);
    let context = sync.command_context(&lease).await.unwrap();
    let target = context.target.unwrap();
    sync.ingest(
        &work,
        snapshot(
            work.mailbox.link_id,
            work.provider_id.as_str(),
            Default::default(),
            "v2",
        ),
    )
    .await
    .unwrap();
    let row = sqlx::query!(
        "SELECT is_read,mailbox_state FROM email_messages WHERE id = $1",
        id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(row.is_read);
    assert_eq!(
        row.mailbox_state.unwrap()["is_read"],
        false,
        "observed provider state stays separate"
    );
    let second = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Read(false),
            &MailboxAction::Read(false).targets(&messages),
        )
        .await
        .unwrap();
    let mut confirmed = snapshot(
        work.mailbox.link_id,
        work.provider_id.as_str(),
        Default::default(),
        "v3",
    );
    confirmed.state.is_read = true;
    sync.confirm_target(&lease, &target, Some(&confirmed.into()))
        .await
        .unwrap();
    let row = sqlx::query!("SELECT m.is_read,p.command_id FROM email_messages m JOIN email_pending_mailbox_state p ON p.message_id = m.id WHERE m.id = $1",id).fetch_one(&db).await.unwrap();
    assert!(!row.is_read);
    assert_eq!(row.command_id, second);
    sync.finish_command(&lease, CommandCompletion::Succeeded)
        .await
        .unwrap();
    assert_eq!(
        sync.claim_command(macro_uuid::generate_uuid_v7())
            .await
            .unwrap()
            .unwrap()
            .id,
        second
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn acceptance_rechecks_access_and_expired_worker_cannot_confirm(db: PgPool) {
    let (sync, repo, work, thread) = setup(&db).await;
    let messages = repo
        .mailbox_action_messages(work.mailbox.link_id, thread)
        .await
        .unwrap();
    let targets = MailboxAction::Flagged(true).targets(&messages);
    assert!(
        repo.enqueue_mailbox_action(
            work.mailbox.link_id,
            MacroUserIdStr::try_from_email("stranger@example.com").unwrap(),
            &MailboxAction::Flagged(true),
            &targets
        )
        .await
        .is_err()
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM email_mailbox_commands")
            .fetch_one(&db)
            .await
            .unwrap(),
        Some(0)
    );
    repo.enqueue_mailbox_action(
        work.mailbox.link_id,
        owner(),
        &MailboxAction::Flagged(true),
        &targets,
    )
    .await
    .unwrap();
    let old = sync
        .claim_command(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    let target = sync.command_context(&old).await.unwrap().target.unwrap();
    sqlx::query!(
        "UPDATE email_mailbox_commands SET lease_until = now() - interval '1 second' WHERE id = $1",
        old.id
    )
    .execute(&db)
    .await
    .unwrap();
    let new = sync
        .claim_command(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    assert_ne!(old.lease_id, new.lease_id);
    assert!(matches!(
        sync.confirm_target(&old, &target, None).await,
        Err(MailboxError::Stale)
    ));
    assert!(matches!(
        sync.renew_command(&old).await,
        Err(MailboxError::Stale)
    ));
    sync.fail_target(&new, &target, false).await.unwrap();
    assert!(
        !sqlx::query_scalar!(
            "SELECT is_starred FROM email_messages WHERE id = $1",
            target.message_id
        )
        .fetch_one(&db)
        .await
        .unwrap()
    );
}

#[derive(Clone)]
struct UncertainProvider {
    state: std::sync::Arc<std::sync::Mutex<email_api_client::domain::models::MailboxOrganization>>,
    writes: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    reads: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}
impl MailboxGateway for UncertainProvider {
    async fn folders(
        &self,
        _: MailboxKey,
    ) -> Result<Vec<MailFolder>, email_api_client::domain::models::EmailApiError> {
        unreachable!()
    }
    async fn changes(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: Option<&StreamToken>,
    ) -> Result<MailboxChangePage, email_api_client::domain::models::EmailApiError> {
        unreachable!()
    }
    async fn message(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: &[MailFolder],
    ) -> Result<
        Option<email_api_client::domain::models::MailboxMessage>,
        email_api_client::domain::models::EmailApiError,
    > {
        unreachable!("commands must not fetch bodies or attachments")
    }
}
impl MailboxCommandGateway for UncertainProvider {
    async fn organization(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: &[MailFolder],
    ) -> Result<
        Option<email_api_client::domain::models::MailboxOrganization>,
        email_api_client::domain::models::EmailApiError,
    > {
        self.reads.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(Some(self.state.lock().unwrap().clone()))
    }
    async fn apply(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        action: &email_api_client::domain::models::MessageAction,
        _: Option<&str>,
    ) -> Result<
        email_api_client::domain::models::MessageWriteReceipt,
        email_api_client::domain::models::EmailApiError,
    > {
        self.writes
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let email_api_client::domain::models::MessageAction::SetRead(value) = action else {
            panic!("unexpected action")
        };
        self.state.lock().unwrap().state.is_read = *value;
        Err(email_api_client::domain::models::EmailApiError::Transient {
            message: "response lost after the provider applied the write".into(),
        })
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unknown_write_is_confirmed_before_retry_and_revoked_access_stops_execution(db: PgPool) {
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    };
    let (sync, repo, work, thread) = setup(&db).await;
    let messages = repo
        .mailbox_action_messages(work.mailbox.link_id, thread)
        .await
        .unwrap();
    let command = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Read(true),
            &MailboxAction::Read(true).targets(&messages),
        )
        .await
        .unwrap();
    let provider = UncertainProvider {
        state: Arc::new(Mutex::new(
            snapshot(
                work.mailbox.link_id,
                work.provider_id.as_str(),
                Default::default(),
                "one",
            )
            .into(),
        )),
        writes: Arc::new(AtomicUsize::new(0)),
        reads: Arc::new(AtomicUsize::new(0)),
    };
    let service = MailboxCommandService::new(sync.clone(), provider.clone());
    assert!(service.execute_once().await.is_err());
    sqlx::query!(
        "UPDATE email_mailbox_commands SET available_at = now() WHERE id = $1",
        command
    )
    .execute(&db)
    .await
    .unwrap();
    service.execute_once().await.unwrap();
    service.execute_once().await.unwrap();
    assert_eq!(
        provider.writes.load(Ordering::SeqCst),
        1,
        "a committed write with a lost response must not be sent again"
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT status FROM email_mailbox_commands WHERE id = $1",
            command
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        "succeeded"
    );
    let next = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Read(false),
            &MailboxAction::Read(false).targets(&messages),
        )
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE email_links SET macro_id = 'macro|new-owner@example.com' WHERE id = $1",
        work.mailbox.link_id
    )
    .execute(&db)
    .await
    .unwrap();
    let reads = provider.reads.load(Ordering::SeqCst);
    service.execute_once().await.unwrap();
    assert_eq!(
        provider.reads.load(Ordering::SeqCst),
        reads,
        "revoked actors cannot acquire provider access"
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT status FROM email_mailbox_commands WHERE id = $1",
            next
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        "cancelled"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn category_projection_keeps_latest_intent_across_sync_failure_and_deletion(db: PgPool) {
    use crate::domain::mailbox::settings::MailboxSettingsRepository;
    let (sync, repo, work, thread) = setup(&db).await;
    let link = work.mailbox.link_id;
    let label = Uuid::now_v7();
    sqlx::query!("INSERT INTO email_labels(id,link_id,provider_label_id,name,type) VALUES($1,$2,'Projects','Projects','User')",label,link).execute(&db).await.unwrap();
    let messages = repo.mailbox_action_messages(link, thread).await.unwrap();
    let message = messages[0].id;
    let add = MailboxAction::Category {
        name: "Projects".into(),
        present: true,
    };
    repo.enqueue_mailbox_action(link, owner(), &add, &add.targets(&messages))
        .await
        .unwrap();
    assert!(
        repo.labels_by_message_ids(&[message]).await.unwrap()[&message]
            .iter()
            .any(|label| label.provider_label_id == "Projects")
    );
    // A stale provider observation must not undo the user's accepted category.
    sync.ingest(
        &work,
        snapshot(link, work.provider_id.as_str(), Default::default(), "v2"),
    )
    .await
    .unwrap();
    assert!(
        repo.labels_by_message_ids(&[message]).await.unwrap()[&message]
            .iter()
            .any(|label| label.provider_label_id == "Projects")
    );
    let first = sync.claim_command(Uuid::now_v7()).await.unwrap().unwrap();
    let target = sync.command_context(&first).await.unwrap().target.unwrap();
    let remove = MailboxAction::Category {
        name: "Projects".into(),
        present: false,
    };
    repo.enqueue_mailbox_action(link, owner(), &remove, &remove.targets(&messages))
        .await
        .unwrap();
    let mut remote = snapshot(link, work.provider_id.as_str(), Default::default(), "v3");
    remote.tags = vec!["Projects".into()];
    sync.confirm_target(&first, &target, Some(&remote.into()))
        .await
        .unwrap();
    sync.finish_command(&first, CommandCompletion::Succeeded)
        .await
        .unwrap();
    assert!(
        !repo
            .labels_by_message_ids(&[message])
            .await
            .unwrap()
            .get(&message)
            .is_some_and(|labels| labels
                .iter()
                .any(|label| label.provider_label_id == "Projects"))
    );
    let second = sync.claim_command(Uuid::now_v7()).await.unwrap().unwrap();
    let target = sync.command_context(&second).await.unwrap().target.unwrap();
    // Failure removes only its overlay, revealing the confirmed provider fact.
    sync.fail_target(&second, &target, false).await.unwrap();
    sync.finish_command(&second, CommandCompletion::Failed)
        .await
        .unwrap();
    let operations = repo.thread_mailbox_operations(link, thread).await.unwrap();
    assert_eq!(operations.len(), 1);
    assert!(matches!(
        operations[0].state,
        crate::domain::models::mailbox_action::MailboxOperationState::Failed
    ));
    assert!(
        repo.thread_mailbox_operations(Uuid::now_v7(), thread)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        repo.labels_by_message_ids(&[message]).await.unwrap()[&message]
            .iter()
            .any(|label| label.provider_label_id == "Projects")
    );
    // Deletion waits for previously accepted category work, and rejects new assignment.
    repo.enqueue_mailbox_action(link, owner(), &add, &add.targets(&messages))
        .await
        .unwrap();
    sync.delete_label(&owner(), link, label).await.unwrap();
    assert!(
        !repo
            .labels_by_message_ids(&[message])
            .await
            .unwrap()
            .get(&message)
            .is_some_and(|labels| labels
                .iter()
                .any(|label| label.provider_label_id == "Projects"))
    );
    assert!(
        repo.enqueue_mailbox_action(link, owner(), &add, &add.targets(&messages))
            .await
            .is_err()
    );
    assert!(
        sync.claim_settings(Uuid::now_v7(), false, true)
            .await
            .unwrap()
            .is_none()
    );
    let last = sync.claim_command(Uuid::now_v7()).await.unwrap().unwrap();
    let target = sync.command_context(&last).await.unwrap().target.unwrap();
    sync.confirm_target(&last, &target, None).await.unwrap();
    sync.finish_command(&last, CommandCompletion::Succeeded)
        .await
        .unwrap();
    assert_eq!(
        sync.claim_settings(Uuid::now_v7(), false, true)
            .await
            .unwrap()
            .unwrap()
            .kind,
        "delete_label"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn acceptance_order_wins_over_transaction_start_order(db: PgPool) {
    let (sync, repo, work, thread) = setup(&db).await;
    let messages = repo
        .mailbox_action_messages(work.mailbox.link_id, thread)
        .await
        .unwrap();
    let first = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Read(true),
            &MailboxAction::Read(true).targets(&messages),
        )
        .await
        .unwrap();
    let second = repo
        .enqueue_mailbox_action(
            work.mailbox.link_id,
            owner(),
            &MailboxAction::Read(false),
            &MailboxAction::Read(false).targets(&messages),
        )
        .await
        .unwrap();
    // Reproduce a transaction that started first but waited for the mailbox
    // acceptance lock and committed its newer intent last.
    sqlx::query!(
        "UPDATE email_mailbox_commands SET created_at=now()-interval '1 day' WHERE id=$1",
        second
    )
    .execute(&db)
    .await
    .unwrap();
    let lease = sync.claim_command(Uuid::now_v7()).await.unwrap().unwrap();
    assert_eq!(lease.id, first);
    assert!(sync.claim_command(Uuid::now_v7()).await.unwrap().is_none());
    let target = sync.command_context(&lease).await.unwrap().target.unwrap();
    sync.confirm_target(&lease, &target, None).await.unwrap();
    sync.finish_command(&lease, CommandCompletion::Succeeded)
        .await
        .unwrap();
    assert_eq!(
        sync.claim_command(Uuid::now_v7())
            .await
            .unwrap()
            .unwrap()
            .id,
        second
    );
    let operations = repo
        .thread_mailbox_operations(work.mailbox.link_id, thread)
        .await
        .unwrap();
    assert_eq!(operations[0].id, second);
}
