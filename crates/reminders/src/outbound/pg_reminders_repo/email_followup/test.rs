use super::*;
use crate::domain::email_followup::{EmailReminderCondition, service::EmailFollowupService};
use crate::domain::ports::Clock;
use crate::domain::{
    email_followup::dispatch::EmailReminderDispatch,
    models::{DeliveryOutcome, DueFiring, SweepSummary},
    ports::ReminderDispatch,
};
use chrono::{DateTime, Duration, Utc};
use email::domain::{
    followup::{EmailFollowupMailbox, FollowupMessage, FollowupThread},
    models::EmailErr,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;

struct SweepProbe {
    calls: Arc<AtomicUsize>,
    fail: bool,
}

impl ReminderDispatch for SweepProbe {
    async fn sweep(&self) -> Result<SweepSummary, ReminderError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail {
            Err(ReminderError::NotFound)
        } else {
            Ok(SweepSummary { dispatched: 7 })
        }
    }

    async fn deliver(&self, _: DueFiring) -> Result<DeliveryOutcome, ReminderError> {
        Ok(DeliveryOutcome::Gone)
    }
}

struct PausedDelivery {
    entered: Arc<Notify>,
    release: Arc<Notify>,
}

impl ReminderDispatch for PausedDelivery {
    async fn sweep(&self) -> Result<SweepSummary, ReminderError> {
        Ok(SweepSummary::default())
    }

    async fn deliver(&self, _: DueFiring) -> Result<DeliveryOutcome, ReminderError> {
        self.entered.notify_one();
        self.release.notified().await;
        Ok(DeliveryOutcome::Delivered)
    }
}

const THREAD: Uuid = Uuid::from_u128(11);
const LINK: Uuid = Uuid::from_u128(12);
fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|followup@test.com").unwrap()
}
#[derive(Clone)]
struct FixedClock(DateTime<Utc>);
impl Clock for FixedClock {
    fn now(&self) -> DateTime<Utc> {
        self.0
    }
}
#[derive(Clone)]
struct Mailbox(Arc<Mutex<Mail>>);
struct Mail {
    facts: Option<FollowupThread>,
    archive_fails: bool,
    return_fails: bool,
    writes: usize,
    reply_on_archive: Option<DateTime<Utc>>,
}
impl EmailFollowupMailbox for Mailbox {
    async fn reminder_threads(
        &self,
        _user: MacroUserIdStr<'static>,
        _receipts: Vec<
            entity_access::domain::models::EntityAccessReceipt<
                entity_access::domain::models::ViewAccessLevel,
            >,
        >,
        _filters: &email::domain::followup::ReminderThreadFilter,
    ) -> Result<Vec<Uuid>, EmailErr> {
        unreachable!("lifecycle tests do not read email collections")
    }
    async fn followup_thread(
        &self,
        actor: MacroUserIdStr<'static>,
        thread: Uuid,
    ) -> Result<Option<FollowupThread>, EmailErr> {
        if actor != user() || thread != THREAD {
            return Ok(None);
        }
        Ok(self.0.lock().unwrap().facts.clone())
    }
    async fn set_followup_inbox(
        &self,
        actor: MacroUserIdStr<'static>,
        thread: Uuid,
        link: Uuid,
        visible: bool,
        returned_at: Option<DateTime<Utc>>,
    ) -> Result<(), EmailErr> {
        assert_eq!(actor, user());
        assert_eq!(thread, THREAD);
        assert_eq!(link, LINK);
        let mut mail = self.0.lock().unwrap();
        if (visible && mail.return_fails) || (!visible && mail.archive_fails) {
            return Err(EmailErr::ThreadEmpty);
        }
        if !visible && let Some(received_at) = mail.reply_on_archive.take() {
            mail.facts.as_mut().unwrap().messages.push(FollowupMessage {
                id: Uuid::now_v7(),
                received_at: Some(received_at),
                outgoing: false,
                from_self: false,
            });
        }
        mail.writes += 1;
        mail.facts.as_mut().unwrap().inbox_visible = visible;
        mail.facts.as_mut().unwrap().returned_at = if visible { returned_at } else { None };
        Ok(())
    }
}
async fn setup(pool: PgPool) -> EmailFollowupService<PgRemindersRepo, Mailbox, FixedClock> {
    let owner = user();
    sqlx::query!(r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'followup', 'followup@test.com', 'followup')"#, Uuid::now_v7()).execute(&pool).await.unwrap();
    sqlx::query!(r#"INSERT INTO "User" (id, email, macro_user_id) SELECT $1, 'followup@test.com', id FROM macro_user WHERE email = 'followup@test.com'"#, owner.as_ref()).execute(&pool).await.unwrap();
    sqlx::query!("INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES ($1, $2, 'followup', 'followup@test.com', 'GMAIL')", LINK, owner.as_ref()).execute(&pool).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id) VALUES ($1, $2)",
        THREAD,
        LINK
    )
    .execute(&pool)
    .await
    .unwrap();
    EmailFollowupService {
        repo: PgRemindersRepo::new(pool),
        clock: FixedClock(Utc::now()),
        mailbox: Mailbox(Arc::new(Mutex::new(Mail {
            facts: Some(FollowupThread {
                link_id: LINK,
                subject: "Waiting for a reply".into(),
                inbox_visible: true,
                returned_at: None,
                unavailable: false,
                messages: vec![],
            }),
            archive_fails: false,
            return_fails: false,
            writes: 0,
            reply_on_archive: None,
        }))),
    }
}
fn set(at: DateTime<Utc>, condition: EmailReminderCondition) -> EmailFollowupCommand {
    EmailFollowupCommand::Set {
        operation_id: Uuid::now_v7(),
        expected_revision: None,
        remind_at: at,
        condition,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn retry_concurrency_and_stale_undo_do_not_duplicate_or_resurrect(pool: PgPool) {
    let service = setup(pool).await;
    let command = set(
        service.clock.now() + Duration::hours(1),
        EmailReminderCondition::IfNoReply,
    );
    let (first, retry) = tokio::join!(
        service.execute(user(), THREAD, command.clone()),
        service.execute(user(), THREAD, command.clone())
    );
    let first = first.unwrap();
    assert_eq!(first, retry.unwrap());
    assert_eq!(service.mailbox.0.lock().unwrap().writes, 1);
    let mut edit = set(
        service.clock.now() + Duration::hours(2),
        EmailReminderCondition::Regardless,
    );
    if let EmailFollowupCommand::Set {
        expected_revision, ..
    } = &mut edit
    {
        *expected_revision = Some(first.revision);
    }
    let edited = service.execute(user(), THREAD, edit).await.unwrap();
    let stale = EmailFollowupCommand::Remove {
        operation_id: Uuid::now_v7(),
        expected_revision: first.revision,
        undo: true,
    };
    assert!(service.execute(user(), THREAD, stale).await.is_err());
    let removed = service
        .execute(
            user(),
            THREAD,
            EmailFollowupCommand::Remove {
                operation_id: Uuid::now_v7(),
                expected_revision: edited.revision,
                undo: false,
            },
        )
        .await
        .unwrap();
    assert_eq!(removed.state, FollowupState::Removed);
    assert_eq!(
        service
            .execute(user(), THREAD, command)
            .await
            .unwrap()
            .state,
        FollowupState::Removed
    );
    assert!(
        service
            .mailbox
            .0
            .lock()
            .unwrap()
            .facts
            .as_ref()
            .unwrap()
            .inbox_visible
    );
    let reminder = sqlx::query!(
        "SELECT enabled, completed_at FROM reminder WHERE id = $1",
        first.reminder_id
    )
    .fetch_one(&service.repo.pool)
    .await
    .unwrap();
    assert!(!reminder.enabled);
    assert!(reminder.completed_at.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reply_cancels_but_regardless_returns_sent_only_and_retry_is_idempotent(pool: PgPool) {
    let service = setup(pool).await;
    let first = service
        .execute(
            user(),
            THREAD,
            set(
                service.clock.now() + Duration::hours(1),
                EmailReminderCondition::IfNoReply,
            ),
        )
        .await
        .unwrap();
    service
        .mailbox
        .0
        .lock()
        .unwrap()
        .facts
        .as_mut()
        .unwrap()
        .messages
        .push(FollowupMessage {
            id: Uuid::now_v7(),
            received_at: Some(service.clock.now() + Duration::seconds(1)),
            outgoing: false,
            from_self: false,
        });
    service.reconcile().await.unwrap();
    let mut record = service
        .repo
        .reminder_followup(&user(), first.reminder_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(record.followup.state, FollowupState::Cancelled);
    assert!(
        !service
            .return_due_locked(&mut record, first.remind_at)
            .await
            .unwrap()
    );
    // A sent-only conversation has no inbound message requirement on this port.
    service
        .mailbox
        .0
        .lock()
        .unwrap()
        .facts
        .as_mut()
        .unwrap()
        .messages
        .clear();
    let second = service
        .execute(
            user(),
            THREAD,
            set(
                service.clock.now() + Duration::hours(2),
                EmailReminderCondition::Regardless,
            ),
        )
        .await
        .unwrap();
    service
        .mailbox
        .0
        .lock()
        .unwrap()
        .facts
        .as_mut()
        .unwrap()
        .messages
        .push(FollowupMessage {
            id: Uuid::now_v7(),
            received_at: Some(service.clock.now() + Duration::seconds(2)),
            outgoing: false,
            from_self: false,
        });
    let mut record = service
        .repo
        .reminder_followup(&user(), second.reminder_id)
        .await
        .unwrap()
        .unwrap();
    service.mailbox.0.lock().unwrap().return_fails = true;
    assert!(
        service
            .return_due_locked(&mut record, second.remind_at)
            .await
            .is_err()
    );
    assert_eq!(record.followup.state, FollowupState::Pending);
    service.mailbox.0.lock().unwrap().return_fails = false;
    assert!(
        service
            .return_due_locked(&mut record, second.remind_at)
            .await
            .unwrap()
    );
    let writes = service.mailbox.0.lock().unwrap().writes;
    assert!(
        service
            .return_due_locked(&mut record, second.remind_at)
            .await
            .unwrap()
    );
    assert_eq!(service.mailbox.0.lock().unwrap().writes, writes);
    assert!(
        service
            .mailbox
            .0
            .lock()
            .unwrap()
            .facts
            .as_ref()
            .unwrap()
            .inbox_visible
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn archive_failure_rolls_back_and_ineligible_mail_never_returns(pool: PgPool) {
    let service = setup(pool).await;
    service.mailbox.0.lock().unwrap().archive_fails = true;
    assert!(
        service
            .execute(
                user(),
                THREAD,
                set(
                    service.clock.now() + Duration::hours(1),
                    EmailReminderCondition::IfNoReply
                )
            )
            .await
            .is_err()
    );
    service.mailbox.0.lock().unwrap().archive_fails = false;
    service.reconcile().await.unwrap();
    assert!(
        service
            .mailbox
            .0
            .lock()
            .unwrap()
            .facts
            .as_ref()
            .unwrap()
            .inbox_visible
    );
    let first = service
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
    let mut record = service
        .repo
        .reminder_followup(&user(), first.reminder_id)
        .await
        .unwrap()
        .unwrap();
    assert!(
        !service
            .return_due_locked(&mut record, first.remind_at + Duration::minutes(1))
            .await
            .unwrap()
    );
    service
        .mailbox
        .0
        .lock()
        .unwrap()
        .facts
        .as_mut()
        .unwrap()
        .unavailable = true;
    assert!(
        !service
            .return_due_locked(&mut record, first.remind_at)
            .await
            .unwrap()
    );
    sqlx::query!("DELETE FROM email_threads WHERE id = $1", THREAD)
        .execute(&service.repo.pool)
        .await
        .unwrap();
    assert!(
        service
            .repo
            .reminder_followup(&user(), first.reminder_id)
            .await
            .unwrap()
            .is_some(),
        "deletion keeps the specialization tombstone"
    );
    service.mailbox.0.lock().unwrap().facts = None;
    assert!(service.get(user(), THREAD).await.is_err());
    assert!(
        service
            .execute(
                user(),
                Uuid::now_v7(),
                set(
                    service.clock.now() + Duration::hours(1),
                    EmailReminderCondition::Regardless
                )
            )
            .await
            .is_err()
    );
    let other = MacroUserIdStr::parse_from_str("macro|other@test.com").unwrap();
    assert!(
        service
            .execute(
                other,
                THREAD,
                set(
                    service.clock.now() + Duration::hours(1),
                    EmailReminderCondition::Regardless
                )
            )
            .await
            .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reply_racing_archive_is_durably_restored(pool: PgPool) {
    let service = setup(pool).await;
    service.mailbox.0.lock().unwrap().reply_on_archive =
        Some(service.clock.now() + Duration::seconds(1));
    let created = service
        .execute(
            user(),
            THREAD,
            set(
                service.clock.now() + Duration::hours(1),
                EmailReminderCondition::IfNoReply,
            ),
        )
        .await
        .unwrap();
    service.mailbox.0.lock().unwrap().return_fails = true;
    service.reconcile().await.unwrap();
    let restoring = service
        .repo
        .reminder_followup(&user(), created.reminder_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(restoring.followup.state, FollowupState::Returning);
    assert!(restoring.cancel_on_restore);
    service.mailbox.0.lock().unwrap().return_fails = false;
    service.reconcile().await.unwrap();
    assert_eq!(
        service.get(user(), THREAD).await.unwrap().unwrap().state,
        FollowupState::Cancelled
    );
    assert!(
        service
            .mailbox
            .0
            .lock()
            .unwrap()
            .facts
            .as_ref()
            .unwrap()
            .inbox_visible
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn exact_seconds_and_removal_without_source_access(pool: PgPool) {
    let service = setup(pool).await;
    let requested = DateTime::from_timestamp_micros(
        (service.clock.now() + Duration::seconds(10)).timestamp_micros(),
    )
    .unwrap();
    let first = service
        .execute(
            user(),
            THREAD,
            set(requested, EmailReminderCondition::Regardless),
        )
        .await
        .unwrap();
    assert_eq!(first.remind_at, requested);
    let edited = service
        .execute(
            user(),
            THREAD,
            EmailFollowupCommand::Set {
                operation_id: Uuid::now_v7(),
                expected_revision: Some(first.revision),
                remind_at: requested + Duration::seconds(1),
                condition: EmailReminderCondition::Regardless,
            },
        )
        .await
        .unwrap();
    let mut record = service
        .repo
        .reminder_followup(&user(), first.reminder_id)
        .await
        .unwrap()
        .unwrap();
    assert!(
        !service
            .return_due_locked(&mut record, first.remind_at)
            .await
            .unwrap()
    );
    service.mailbox.0.lock().unwrap().facts = None;
    let writes = service.mailbox.0.lock().unwrap().writes;
    let command = EmailFollowupCommand::Remove {
        operation_id: Uuid::now_v7(),
        expected_revision: edited.revision,
        undo: false,
    };
    let removed = service
        .execute(user(), THREAD, command.clone())
        .await
        .unwrap();
    assert_eq!(removed.state, FollowupState::Removed);
    assert_eq!(
        service.execute(user(), THREAD, command).await.unwrap(),
        removed
    );
    assert_eq!(service.mailbox.0.lock().unwrap().writes, writes);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removal_waits_for_delivery_after_inbox_return(pool: PgPool) {
    let service = setup(pool).await;
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
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let dispatch = EmailReminderDispatch::new(
        PausedDelivery {
            entered: entered.clone(),
            release: release.clone(),
        },
        service.clone(),
    );
    let delivery = tokio::spawn(async move {
        dispatch
            .deliver(DueFiring {
                reminder_id: created.reminder_id,
                scheduled_for: created.remind_at,
            })
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), entered.notified())
        .await
        .unwrap();
    let returned = service
        .repo
        .reminder_followup(&user(), created.reminder_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(returned.followup.state, FollowupState::Returned);
    let completion = service.execute(
        user(),
        THREAD,
        EmailFollowupCommand::Remove {
            operation_id: Uuid::now_v7(),
            expected_revision: created.revision,
            undo: false,
        },
    );
    tokio::pin!(completion);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), &mut completion)
            .await
            .is_err(),
        "completion must wait while notification delivery owns the workflow lock"
    );
    release.notify_one();
    assert_eq!(delivery.await.unwrap().unwrap(), DeliveryOutcome::Delivered);
    let completed = tokio::time::timeout(std::time::Duration::from_secs(5), completion)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(completed.state, FollowupState::Removed);
    assert_eq!(
        service
            .repo
            .reminder_followup(&user(), created.reminder_id)
            .await
            .unwrap()
            .unwrap()
            .followup
            .state,
        FollowupState::Removed
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn corrupt_email_reconciliation_does_not_suppress_delivery_sweep(pool: PgPool) {
    let service = setup(pool).await;
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
    sqlx::query!(
        "UPDATE reminder_email_followup SET payload = '{}'::jsonb WHERE reminder_id = $1",
        created.reminder_id,
    )
    .execute(&service.repo.pool)
    .await
    .unwrap();
    assert!(
        service.reconcile().await.is_err(),
        "fixture must fail decoding"
    );
    let calls = Arc::new(AtomicUsize::new(0));
    let dispatch = EmailReminderDispatch::new(
        SweepProbe {
            calls: calls.clone(),
            fail: false,
        },
        service.clone(),
    );
    assert_eq!(dispatch.sweep().await.unwrap().dispatched, 7);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let dispatch = EmailReminderDispatch::new(
        SweepProbe {
            calls: calls.clone(),
            fail: true,
        },
        service,
    );
    assert!(matches!(
        dispatch.sweep().await,
        Err(ReminderError::NotFound)
    ));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn independent_followups_use_configured_pool_capacity(pool: PgPool) {
    let repo = PgRemindersRepo::with_followup_lock_capacity(pool.clone(), 8);
    let mut guards = Vec::new();
    for _ in 0..8 {
        guards.push(
            tokio::time::timeout(
                std::time::Duration::from_secs(1),
                repo.lock_followup(&user(), Uuid::now_v7()),
            )
            .await
            .expect("unrelated followups must use the configured concurrency budget")
            .unwrap(),
        );
    }
    // Saturated lock holders must still be able to perform their data writes.
    let connection = tokio::time::timeout(std::time::Duration::from_secs(1), pool.acquire())
        .await
        .expect("lock holders must not consume the data pool")
        .unwrap();
    drop(connection);
    for guard in guards {
        guard.rollback().await.unwrap();
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn busy_thread_waiters_leave_lock_pool_available(pool: PgPool) {
    // A different process owns the busy key. Four waiters used to occupy every
    // connection in this process's lock pool while blocked inside PostgreSQL.
    let holder = PgRemindersRepo::new(pool.clone());
    let held = holder.lock_followup(&user(), THREAD).await.unwrap();
    let repo = PgRemindersRepo::new(pool);
    let mut waiters = Vec::new();
    for _ in 0..4 {
        let repo = repo.clone();
        waiters.push(tokio::spawn(async move {
            repo.lock_followup(&user(), THREAD).await
        }));
    }
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    assert!(waiters.iter().all(|waiter| !waiter.is_finished()));
    let unrelated = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        repo.lock_followup(&user(), Uuid::now_v7()),
    )
    .await
    .expect("busy-thread waiters must not monopolize the lock pool")
    .unwrap();
    unrelated.rollback().await.unwrap();
    for waiter in waiters {
        waiter.abort();
        let _ = waiter.await;
    }
    // The same busy key fails within the bounded acquisition deadline.
    let result = tokio::time::timeout(
        LOCK_WAIT_TIMEOUT + std::time::Duration::from_secs(1),
        repo.lock_followup(&user(), THREAD),
    )
    .await
    .expect("lock acquisition must have a bounded deadline");
    assert!(result.is_err());
    held.rollback().await.unwrap();
    let recovered = repo.lock_followup(&user(), THREAD).await.unwrap();
    recovered.rollback().await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn guard_survives_configured_idle_transaction_timeout(pool: PgPool) {
    let mut repo = PgRemindersRepo::new(pool.clone());
    repo.followup_locks = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_lazy_with(pool.connect_options().as_ref().clone());
    sqlx::query!("SET idle_in_transaction_session_timeout = '50ms'")
        .execute(&repo.followup_locks)
        .await
        .unwrap();
    let guard = repo.lock_followup(&user(), THREAD).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    let key = format!("{}:{THREAD}", user().as_ref());
    let mut competing = pool.begin().await.unwrap();
    let locked = sqlx::query_scalar!(
        r#"SELECT pg_try_advisory_xact_lock(hashtextextended($1, 732849)) AS "locked!""#,
        key,
    )
    .fetch_one(&mut *competing)
    .await
    .unwrap();
    assert!(
        !locked,
        "an idle guard must retain the lock across external I/O"
    );
    competing.rollback().await.unwrap();
    guard.rollback().await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn undo_and_archive_rollback_restore_original_inbox_order(pool: PgPool) {
    let service = setup(pool).await;
    for original in [None, Some(service.clock.now() - Duration::days(1))] {
        service
            .mailbox
            .0
            .lock()
            .unwrap()
            .facts
            .as_mut()
            .unwrap()
            .returned_at = original;
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
        assert_eq!(
            service
                .mailbox
                .0
                .lock()
                .unwrap()
                .facts
                .as_ref()
                .unwrap()
                .returned_at,
            None
        );
        service
            .execute(
                user(),
                THREAD,
                EmailFollowupCommand::Remove {
                    operation_id: Uuid::now_v7(),
                    expected_revision: created.revision,
                    undo: true,
                },
            )
            .await
            .unwrap();
        assert_eq!(
            service
                .mailbox
                .0
                .lock()
                .unwrap()
                .facts
                .as_ref()
                .unwrap()
                .returned_at,
            original
        );
        service.mailbox.0.lock().unwrap().archive_fails = true;
        assert!(
            service
                .execute(
                    user(),
                    THREAD,
                    set(
                        service.clock.now() + Duration::hours(1),
                        EmailReminderCondition::Regardless
                    )
                )
                .await
                .is_err()
        );
        assert_eq!(
            service
                .mailbox
                .0
                .lock()
                .unwrap()
                .facts
                .as_ref()
                .unwrap()
                .returned_at,
            original
        );
        service.mailbox.0.lock().unwrap().archive_fails = false;
    }
}
