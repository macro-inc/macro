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
            .mark_thread_unread_impl(owner.clone(), Uuid::new_v7())
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
