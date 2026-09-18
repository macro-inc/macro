use super::*;
use crate::domain::{models::EmailErr, ports::NoOpEnqueuer, service::EmailServiceImpl};
use crm::domain::service::NoOpCrmService;
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_event_broker::NoopMacroEventBroker;

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
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unread")
    )
)]
async fn mark_unread_uses_the_threads_inbox_and_updates_authoritative_read_state(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service(pool);
    let thread_id = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb")?;
    let unread_label_id = Uuid::parse_str("cccccccc-cccc-cccc-cccc-dddddddddddd")?;
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;

    // Repeated requests stay unread and do not duplicate label assignments.
    for _ in 0..2 {
        service
            .mark_thread_unread_impl(owner.clone(), thread_id)
            .await?;
    }

    let messages = service
        .email_repo
        .get_thread_label_messages(thread_id, link_id)
        .await?;
    assert_eq!(messages.len(), 1);
    assert!(!messages[0].is_read);
    let labels = service
        .email_repo
        .labels_by_message_ids(&[messages[0].db_id])
        .await?;
    let unread_labels: Vec<_> = labels[&messages[0].db_id]
        .iter()
        .filter(|label| label.provider_label_id == "UNREAD")
        .collect();
    assert_eq!(unread_labels.len(), 1);
    assert_eq!(unread_labels[0].id, Some(unread_label_id));
    assert!(
        !service
            .email_repo
            .thread_by_id(thread_id)
            .await?
            .unwrap()
            .is_read
    );
    // The same atomic path removes UNREAD and reconciles both flags when seen.
    service.mark_thread_seen_impl(owner, thread_id).await?;
    assert!(
        service
            .email_repo
            .thread_by_id(thread_id)
            .await?
            .unwrap()
            .is_read
    );
    let messages = service
        .email_repo
        .get_thread_label_messages(thread_id, link_id)
        .await?;
    assert!(messages.iter().all(|message| message.is_read));
    let labels = service
        .email_repo
        .labels_by_message_ids(&[messages[0].db_id])
        .await?;
    assert!(
        labels
            .values()
            .flatten()
            .all(|label| label.provider_label_id != "UNREAD")
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_thread_labels", "email_thread_unread")
    )
)]
async fn mark_unread_rejects_inaccessible_threads_without_changing_them(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let service = service(pool);
    let thread_id = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;
    let stranger = MacroUserIdStr::try_from_email("stranger@test.com")?;

    assert!(matches!(
        service.mark_thread_unread_impl(stranger, thread_id).await,
        Err(EmailErr::ThreadNotFound)
    ));
    assert!(
        service
            .email_repo
            .thread_by_id(thread_id)
            .await?
            .unwrap()
            .is_read
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn mark_unread_rejects_missing_and_empty_threads(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let service = service(pool);
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    assert!(matches!(
        service
            .mark_thread_unread_impl(owner.clone(), Uuid::from_u128(99))
            .await,
        Err(EmailErr::ThreadNotFound)
    ));
    let empty_thread = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;
    assert!(matches!(
        service.mark_thread_unread_impl(owner, empty_thread).await,
        Err(EmailErr::ThreadEmpty)
    ));
    Ok(())
}

async fn assert_failed_read_state_preserves_labels_and_flags(
    pool: Pool<Postgres>,
    failure: &str,
) -> anyhow::Result<()> {
    let service = service(pool);
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    let first_link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let first_thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let second_link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb")?;
    let second_thread = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;
    // The first inbox's fixture messages are unread; give them matching labels
    // to exercise rollback of label deletion as well as insertion.
    let messages = service
        .email_repo
        .get_thread_label_messages(first_thread, first_link)
        .await?;
    let ids: Vec<_> = messages.iter().map(|message| message.db_id).collect();
    service
        .email_repo
        .insert_message_labels_batch(&ids, "UNREAD", first_link)
        .await?;

    for (thread_id, link_id, was_read) in [
        (first_thread, first_link, false),
        (second_thread, second_link, true),
    ] {
        let result = if was_read {
            service
                .mark_thread_unread_impl(owner.clone(), thread_id)
                .await
        } else {
            service
                .mark_thread_seen_impl(owner.clone(), thread_id)
                .await
        };
        let Err(EmailErr::RepoErr(error)) = result else {
            panic!("read-state persistence failure must be returned to the caller");
        };
        assert!(
            error.to_string().contains(failure),
            "unexpected error: {error}"
        );
        let thread = service.email_repo.thread_by_id(thread_id).await?.unwrap();
        assert_eq!(thread.is_read, was_read);
        let messages = service
            .email_repo
            .get_thread_label_messages(thread_id, link_id)
            .await?;
        assert!(!messages.is_empty());
        assert!(messages.iter().all(|message| message.is_read == was_read));
        let ids: Vec<_> = messages.iter().map(|message| message.db_id).collect();
        let labels = service.email_repo.labels_by_message_ids(&ids).await?;
        for id in ids {
            let has_unread = labels
                .get(&id)
                .into_iter()
                .flatten()
                .any(|label| label.provider_label_id == "UNREAD");
            assert_eq!(has_unread, !was_read);
        }
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts(
            "email_thread_labels",
            "email_thread_unread",
            "email_message_read_failure"
        )
    )
)]
async fn read_state_message_failure_rolls_back_label_changes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    assert_failed_read_state_preserves_labels_and_flags(pool, "read-state test failure: message")
        .await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts(
            "email_thread_labels",
            "email_thread_unread",
            "email_thread_read_failure"
        )
    )
)]
async fn read_state_thread_failure_rolls_back_labels_and_messages(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    assert_failed_read_state_preserves_labels_and_flags(pool, "read-state test failure: thread")
        .await
}
