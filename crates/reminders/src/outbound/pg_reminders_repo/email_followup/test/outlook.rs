use super::*;
use crm::domain::service::NoOpCrmService;
use email::domain::{ports::NoOpEnqueuer, service::EmailServiceImpl};
use email::outbound::EmailPgRepo;
use entity_access_management::{
    domain::service::EntityAccessManagementServiceImpl, outbound::PgRepository,
};
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};

type Email = EmailServiceImpl<
    EmailPgRepo,
    FrecencyQueryServiceImpl<FrecencyPgStorage>,
    NoOpEnqueuer,
    NoOpCrmService,
    EntityAccessManagementServiceImpl<PgRepository>,
>;

struct Delivered;

impl ReminderDispatch for Delivered {
    async fn sweep(&self) -> Result<SweepSummary, ReminderError> {
        Ok(SweepSummary::default())
    }

    async fn deliver(&self, _: DueFiring) -> Result<DeliveryOutcome, ReminderError> {
        Ok(DeliveryOutcome::Delivered)
    }
}

async fn outlook(pool: PgPool) -> EmailFollowupService<PgRemindersRepo, Email, FixedClock> {
    let owner = user();
    sqlx::query!(r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'followup', 'followup@test.com', 'followup')"#, Uuid::now_v7()).execute(&pool).await.unwrap();
    sqlx::query!(r#"INSERT INTO "User" (id, email, macro_user_id) SELECT $1, 'followup@test.com', id FROM macro_user WHERE email = 'followup@test.com'"#, owner.as_ref()).execute(&pool).await.unwrap();
    sqlx::query!("INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active) VALUES ($1, $2, 'followup', 'followup@test.com', 'OUTLOOK', true)", LINK, owner.as_ref()).execute(&pool).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id, inbox_visible) VALUES ($1, $2, true)",
        THREAD,
        LINK
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_read, is_starred, is_sent, is_draft, has_attachments, internal_date_ts, mailbox_state)
           VALUES ($1, $2, $3, 'outlook-message', true, false, false, false, false, now() - interval '1 day',
               '{"in_inbox":true,"in_trash":false,"in_junk":false,"attention":"primary"}')"#,
        Uuid::now_v7(),
        THREAD,
        LINK
    )
    .execute(&pool)
    .await
    .unwrap();
    EmailFollowupService {
        repo: PgRemindersRepo::new(pool.clone()),
        mailbox: EmailServiceImpl::new(
            EmailPgRepo::new(pool.clone()),
            FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(pool.clone())),
            NoOpEnqueuer,
            NoOpCrmService,
            EntityAccessManagementServiceImpl::new(PgRepository::new(pool)),
            0,
        ),
        clock: FixedClock(Utc::now()),
    }
}

async fn inbox_visible(pool: &PgPool) -> bool {
    sqlx::query_scalar!(
        "SELECT inbox_visible FROM email_threads WHERE id = $1",
        THREAD
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn pending_mailbox_intents(pool: &PgPool) -> Vec<serde_json::Value> {
    sqlx::query_scalar!(
        "SELECT intent FROM email_mailbox_commands WHERE link_id = $1 AND status = 'pending' ORDER BY accepted_order",
        LINK
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn outlook_reminder_archives_then_returns_the_thread_when_due(pool: PgPool) {
    let service = outlook(pool.clone()).await;
    let created = service
        .execute(
            user(),
            THREAD,
            set(
                service.clock.now() + Duration::hours(1),
                EmailReminderCondition::Regardless,
            ),
        )
        .await
        .unwrap();
    assert_eq!(created.state, FollowupState::Pending);
    assert!(!inbox_visible(&pool).await);

    let outcome = EmailReminderDispatch::new(Delivered, service.clone())
        .deliver(DueFiring {
            reminder_id: created.reminder_id,
            scheduled_for: created.remind_at,
        })
        .await
        .unwrap();
    assert_eq!(outcome, DeliveryOutcome::Delivered);
    assert!(inbox_visible(&pool).await);
    assert_eq!(
        service.get(user(), THREAD).await.unwrap().unwrap().state,
        FollowupState::Returned
    );
    assert_eq!(
        pending_mailbox_intents(&pool).await,
        vec![
            serde_json::json!({"kind": "archived", "value": true}),
            serde_json::json!({"kind": "archived", "value": false}),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stuck_outlook_returning_reminder_reconciles_on_get(pool: PgPool) {
    let service = outlook(pool.clone()).await;
    sqlx::query!(
        "UPDATE email_links SET is_sync_active = false WHERE id = $1",
        LINK
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        service
            .execute(
                user(),
                THREAD,
                set(
                    service.clock.now() + Duration::hours(1),
                    EmailReminderCondition::Regardless,
                ),
            )
            .await
            .is_err()
    );
    let stuck = service
        .repo
        .thread_followup(&user(), THREAD)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stuck.followup.state, FollowupState::Returning);

    sqlx::query!(
        "UPDATE email_links SET is_sync_active = true WHERE id = $1",
        LINK
    )
    .execute(&pool)
    .await
    .unwrap();
    let healed = service.get(user(), THREAD).await.unwrap().unwrap();
    assert_eq!(healed.state, FollowupState::Removed);
    assert!(inbox_visible(&pool).await);
    assert_eq!(
        pending_mailbox_intents(&pool).await,
        vec![serde_json::json!({"kind": "archived", "value": false})]
    );
}
