use super::*;
use crate::domain::email_followup::{
    EmailFollowup, EmailFollowupRepo, EmailReminderCondition, FollowupRecord, FollowupState,
};
use email::domain::followup::ReplyBaseline;

async fn attached(
    repo: &PgRemindersRepo,
    owner: &str,
    thread: Uuid,
    time: DateTime<Utc>,
) -> Reminder {
    let mut new = new_reminder("email work", once_at(time));
    new.entity = Some(EntityType::EmailThread.with_entity_string(thread.to_string()));
    repo.create_reminder(&user(owner), &new).await.unwrap()
}

pub(super) async fn snooze(
    repo: &PgRemindersRepo,
    owner: &str,
    thread: Uuid,
    time: DateTime<Utc>,
) -> Reminder {
    let reminder = attached(repo, owner, thread, time).await;
    let record = FollowupRecord {
        followup: EmailFollowup {
            reminder_id: reminder.id,
            thread_id: thread,
            link_id: Uuid::now_v7(),
            condition: EmailReminderCondition::IfNoReply,
            remind_at: time,
            revision: Uuid::now_v7(),
            state: FollowupState::Pending,
        },
        user_id: user(owner).into_owned(),
        baseline: ReplyBaseline {
            captured_at: time - Duration::days(1),
            message_ids: vec![],
        },
        original_inbox_visible: true,
        original_returned_at: None,
        restore_original: false,
        restore_inbox_visible: true,
        cancel_on_restore: false,
    };
    repo.save_followup(&record, None, None).await.unwrap();
    reminder
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_candidates_ignore_legacy_duplicates_and_keep_private(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgRemindersRepo::new(pool);
    let now = at(2026, 10, 2, 12);
    let thread = macro_uuid::generate_uuid_v7();
    let nearest = snooze(&repo, USER_A, thread, now).await;
    for i in 0..105 {
        attached(&repo, USER_A, thread, now + Duration::seconds(i + 1)).await;
    }
    snooze(&repo, USER_B, thread, now - Duration::hours(1)).await;
    for i in 0..105 {
        snooze(
            &repo,
            USER_A,
            macro_uuid::generate_uuid_v7(),
            now + Duration::days(1) + Duration::seconds(i),
        )
        .await;
    }
    let first = repo
        .email_candidates(&user(USER_A), None, None, now, 100)
        .await
        .unwrap();
    assert_eq!(first.len(), 100);
    let summary = first[0].summary.as_ref().unwrap();
    assert_eq!(summary.thread_id, thread);
    assert_eq!(summary.count, 1);
    assert_eq!(summary.nearest.reminder.id, nearest.id);
    let second = repo
        .email_candidates(
            &user(USER_A),
            None,
            Some(first.last().unwrap().cursor),
            now,
            100,
        )
        .await
        .unwrap();
    assert_eq!(second.len(), 6);
    let ids: std::collections::HashSet<_> = first
        .iter()
        .chain(second.iter())
        .map(|row| row.cursor.thread_id)
        .collect();
    assert_eq!(ids.len(), 106);
    let batch = repo
        .email_candidates(&user(USER_B), Some(&[thread]), None, now, 100)
        .await
        .unwrap();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].summary.as_ref().unwrap().count, 1);
    assert!(
        repo.email_candidates(&user(USER_A), Some(&[]), None, now, 100)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_email_reminders_are_not_snoozes(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);
    let now = at(2026, 10, 2, 12);
    attached(&repo, USER_A, Uuid::now_v7(), now).await;
    assert!(
        repo.email_candidates(&user(USER_A), None, None, now, 100)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_candidates_workflow_membership_is_not_archive_status(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);
    let now = at(2026, 10, 2, 12);
    for state in [
        FollowupState::Archiving,
        FollowupState::Pending,
        FollowupState::Returning,
        FollowupState::Returned,
        FollowupState::Cancelled,
        FollowupState::Removed,
    ] {
        let thread = macro_uuid::generate_uuid_v7();
        let reminder = attached(&repo, USER_A, thread, now + Duration::hours(1)).await;
        let record = FollowupRecord {
            followup: EmailFollowup {
                reminder_id: reminder.id,
                thread_id: thread,
                link_id: macro_uuid::generate_uuid_v7(),
                condition: EmailReminderCondition::IfNoReply,
                remind_at: reminder.next_run_at,
                revision: macro_uuid::generate_uuid_v7(),
                state,
            },
            user_id: user(USER_A).into_owned(),
            baseline: ReplyBaseline {
                captured_at: now,
                message_ids: vec![],
            },
            original_inbox_visible: true,
            original_returned_at: None,
            restore_original: false,
            restore_inbox_visible: true,
            cancel_on_restore: false,
        };
        repo.save_followup(&record, None, None).await.unwrap();
        let rows = repo
            .email_candidates(&user(USER_A), Some(&[thread]), None, now, 100)
            .await
            .unwrap();
        assert_eq!(!rows.is_empty(), state.active(), "{state:?}");
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_candidates_never_downgrade_malformed_workflows_to_generic(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());
    let now = at(2026, 10, 2, 12);
    for payload in [
        serde_json::Value::Null,
        serde_json::json!({"invalid": true}),
    ] {
        let thread = macro_uuid::generate_uuid_v7();
        let mirror = attached(&repo, USER_A, thread, now).await;
        sqlx::query!(
            "INSERT INTO reminder_email_followup (reminder_id, user_id, thread_id, link_id, state, payload) VALUES ($1, $2, $3, $4, 'pending', $5)",
            mirror.id, USER_A, thread, macro_uuid::generate_uuid_v7(), payload
        ).execute(&pool).await.unwrap();
        let rows = repo
            .email_candidates(&user(USER_A), Some(&[thread]), None, now, 1)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].summary.is_none());
        assert_eq!(rows[0].cursor.thread_id, thread);
        let _generic = attached(&repo, USER_A, thread, now + Duration::hours(1)).await;
        let rows = repo
            .email_candidates(&user(USER_A), Some(&[thread]), None, now, 1)
            .await
            .unwrap();
        assert!(rows[0].summary.is_none());
    }
}
