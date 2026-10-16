//! Exercise scan/fill against real grouped reminder storage and explicit access decisions.
use super::*;
use crate::{
    domain::{
        email_collection::{EmailReminderQuery, EmailReminderViewer, service},
        ports::Clock,
    },
    outbound::pg_reminders_repo::PgRemindersRepo,
};
use email::domain::{
    followup::{EmailFollowupMailbox, FollowupThread, ReminderThreadFilter},
    models::EmailErr,
};
use entity_access::domain::models::ViewAccessLevel;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::collections::HashSet;

#[derive(Clone, Default)]
struct Mailbox {
    rejected: HashSet<Uuid>,
    fail: bool,
}
impl EmailFollowupMailbox for Mailbox {
    async fn reminder_threads(
        &self,
        _: MacroUserIdStr<'static>,
        receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
        _: &ReminderThreadFilter,
    ) -> Result<Vec<Uuid>, EmailErr> {
        if self.fail {
            return Err(EmailErr::RepoErr(
                std::io::Error::other("temporary hydration failure").into(),
            ));
        }
        // Deliberately reverse email hydration order; the collection must retain schedule order.
        Ok(receipts
            .into_iter()
            .rev()
            .map(|r| r.entity().entity_id.parse().unwrap())
            .filter(|id| !self.rejected.contains(id))
            .collect())
    }
    async fn followup_thread(
        &self,
        _: MacroUserIdStr<'static>,
        _: Uuid,
    ) -> Result<Option<FollowupThread>, EmailErr> {
        unreachable!()
    }
    async fn set_followup_inbox(
        &self,
        _: MacroUserIdStr<'static>,
        _: Uuid,
        _: Uuid,
        _: bool,
        _: Option<DateTime<Utc>>,
    ) -> Result<(), EmailErr> {
        unreachable!()
    }
}
struct FixedClock;
impl Clock for FixedClock {
    fn now(&self) -> DateTime<Utc> {
        instant(1, 12)
    }
}
fn viewer() -> EmailReminderViewer {
    EmailReminderViewer {
        user_id: MacroUserIdStr::parse_from_str(USER_ID).unwrap(),
        org_id: None,
    }
}
fn query(cursor: Option<String>, limit: u32) -> EmailReminderQuery {
    EmailReminderQuery {
        filters: ReminderThreadFilter::default(),
        cursor,
        limit: Some(limit),
    }
}
async fn setup(
    pool: PgPool,
    count: usize,
) -> (PgRemindersRepo, FakeEntityAccessService, Vec<Uuid>) {
    let macro_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1,$2,$2,$2)"#,
        macro_id,
        USER_ID
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id,email,macro_user_id) VALUES ($1,$1,$2)"#,
        USER_ID,
        macro_id
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgRemindersRepo::new(pool);
    let ids: Vec<_> = (0..count)
        .map(|i| Uuid::from_u128(i as u128 + 100))
        .collect();
    for (i, id) in ids.iter().enumerate() {
        let when = instant(2, 12) + chrono::Duration::seconds(i as i64);
        use crate::domain::email_followup::{
            EmailFollowup, EmailFollowupRepo, EmailReminderCondition, FollowupRecord, FollowupState,
        };
        repo.save_followup(
            &FollowupRecord {
                followup: EmailFollowup {
                    reminder_id: Uuid::now_v7(),
                    thread_id: *id,
                    link_id: Uuid::now_v7(),
                    condition: EmailReminderCondition::IfNoReply,
                    remind_at: when,
                    revision: Uuid::now_v7(),
                    state: FollowupState::Pending,
                },
                user_id: viewer().user_id,
                baseline: email::domain::followup::ReplyBaseline {
                    captured_at: instant(1, 12),
                    message_ids: vec![],
                },
                original_inbox_visible: true,
                original_returned_at: None,
                restore_original: false,
                restore_inbox_visible: true,
                cancel_on_restore: false,
            },
            None,
            None,
        )
        .await
        .unwrap();
    }
    let access = FakeEntityAccessService {
        allowed_emails: Some(Arc::new(Mutex::new(ids.iter().copied().collect()))),
        ..Default::default()
    };
    (repo, access, ids)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn scan_fills_past_long_denied_and_filtered_prefix_without_reordering(pool: PgPool) {
    let (repo, access, ids) = setup(pool, 260).await;
    for id in &ids[..125] {
        access
            .allowed_emails
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .remove(id);
    }
    let mailbox = Mailbox {
        rejected: ids[125..230].iter().copied().collect(),
        fail: false,
    };
    let page = service::list(
        &repo,
        &mailbox,
        &access,
        &FixedClock,
        viewer(),
        query(None, 15),
    )
    .await
    .unwrap();
    assert_eq!(
        page.items.iter().map(|i| i.thread_id).collect::<Vec<_>>(),
        ids[230..245]
    );
    let next = service::list(
        &repo,
        &mailbox,
        &access,
        &FixedClock,
        viewer(),
        query(page.next_cursor, 15),
    )
    .await
    .unwrap();
    assert_eq!(
        next.items.iter().map(|i| i.thread_id).collect::<Vec<_>>(),
        ids[245..]
    );
    assert!(next.next_cursor.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn scan_budget_returns_empty_advancing_continuation_and_reauthorizes(pool: PgPool) {
    let (repo, access, ids) = setup(pool, 507).await;
    access
        .allowed_emails
        .as_ref()
        .unwrap()
        .lock()
        .unwrap()
        .retain(|id| ids[500..].contains(id));
    let page = service::list(
        &repo,
        &Mailbox::default(),
        &access,
        &FixedClock,
        viewer(),
        query(None, 100),
    )
    .await
    .unwrap();
    assert!(page.items.is_empty());
    let cursor = page.next_cursor.unwrap();
    assert_eq!(access.minted().len(), 500, "request scan work is bounded");
    access
        .allowed_emails
        .as_ref()
        .unwrap()
        .lock()
        .unwrap()
        .remove(&ids[500]);
    let page = service::list(
        &repo,
        &Mailbox::default(),
        &access,
        &FixedClock,
        viewer(),
        query(Some(cursor.clone()), 100),
    )
    .await
    .unwrap();
    assert_eq!(
        page.items.iter().map(|i| i.thread_id).collect::<Vec<_>>(),
        ids[501..]
    );
    assert!(page.next_cursor.is_none());
    let mut changed = query(Some(cursor), 100);
    changed.filters.inbox_ids = Some(vec![Uuid::from_u128(9)]);
    assert!(matches!(
        service::list(
            &repo,
            &Mailbox::default(),
            &access,
            &FixedClock,
            viewer(),
            changed
        )
        .await,
        Err(ReminderError::BadRequest(_))
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn scan_mid_batch_and_exact_boundary_never_skip_overflow(pool: PgPool) {
    let (repo, access, ids) = setup(pool, 203).await;
    let mut cursor = None;
    let mut seen = Vec::new();
    for _ in 0..5 {
        let page = service::list(
            &repo,
            &Mailbox::default(),
            &access,
            &FixedClock,
            viewer(),
            query(cursor, 50),
        )
        .await
        .unwrap();
        seen.extend(page.items.into_iter().map(|i| i.thread_id));
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(seen, ids);
    assert!(cursor.is_none());
    let first = service::list(
        &repo,
        &Mailbox::default(),
        &access,
        &FixedClock,
        viewer(),
        query(None, 100),
    )
    .await
    .unwrap();
    let second = service::list(
        &repo,
        &Mailbox::default(),
        &access,
        &FixedClock,
        viewer(),
        query(first.next_cursor, 100),
    )
    .await
    .unwrap();
    assert_eq!(second.items[0].thread_id, ids[100]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn scan_fails_retryably_on_access_or_hydration_failure(pool: PgPool) {
    let (repo, mut access, ids) = setup(pool, 3).await;
    let error = service::list(
        &repo,
        &Mailbox {
            fail: true,
            ..Default::default()
        },
        &access,
        &FixedClock,
        viewer(),
        query(None, 100),
    )
    .await;
    assert!(matches!(error, Err(ReminderError::Internal(_))));
    access
        .allowed_emails
        .as_ref()
        .unwrap()
        .lock()
        .unwrap()
        .remove(&ids[1]);
    access.denial = Some(|| AccessError::internal("temporary authorization outage"));
    assert!(matches!(
        service::list(
            &repo,
            &Mailbox::default(),
            &access,
            &FixedClock,
            viewer(),
            query(None, 100)
        )
        .await,
        Err(ReminderError::Internal(_))
    ));
    access.denial = None;
    let page = service::list(
        &repo,
        &Mailbox::default(),
        &access,
        &FixedClock,
        viewer(),
        query(None, 100),
    )
    .await
    .unwrap();
    assert_eq!(
        page.items.iter().map(|i| i.thread_id).collect::<Vec<_>>(),
        vec![ids[0], ids[2]]
    );
}
