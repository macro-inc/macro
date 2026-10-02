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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_candidates_dedupe_before_pagination_and_keep_private(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgRemindersRepo::new(pool);
    let now = at(2026, 10, 2, 12);
    let thread = macro_uuid::generate_uuid_v7();
    let nearest = attached(&repo, USER_A, thread, now).await;
    for i in 0..105 {
        attached(&repo, USER_A, thread, now + Duration::seconds(i + 1)).await;
    }
    attached(&repo, USER_B, thread, now - Duration::hours(1)).await;
    for i in 0..105 {
        attached(
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
    assert_eq!(summary.count, 106);
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
async fn email_candidates_generic_completion_and_disabled_state(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);
    let now = at(2026, 10, 2, 12);
    let thread = macro_uuid::generate_uuid_v7();
    let future = attached(&repo, USER_A, thread, now + Duration::days(1)).await;
    repo.update_reminder(
        &user(USER_A),
        future.id,
        &ReminderUpdate {
            enabled: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(
        repo.email_candidates(&user(USER_A), None, None, now, 100)
            .await
            .unwrap()
            .is_empty()
    );
    let due = attached(&repo, USER_A, thread, now - Duration::hours(1)).await;
    repo.update_reminder(
        &user(USER_A),
        due.id,
        &ReminderUpdate {
            enabled: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        repo.email_candidates(&user(USER_A), None, None, now, 100)
            .await
            .unwrap()[0]
            .summary
            .as_ref()
            .unwrap()
            .nearest
            .reminder
            .id,
        due.id
    );
    repo.update_reminder(
        &user(USER_A),
        due.id,
        &ReminderUpdate {
            completed: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let mut repeating = new_reminder("recurring", recurring());
    repeating.entity = Some(EntityType::EmailThread.with_entity_string(thread.to_string()));
    repeating.next_run_at = now + Duration::days(1);
    let repeating = repo
        .create_reminder(&user(USER_A), &repeating)
        .await
        .unwrap();
    repo.update_reminder(
        &user(USER_A),
        repeating.id,
        &ReminderUpdate {
            completed: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let summary = repo
        .email_candidates(&user(USER_A), None, None, now, 100)
        .await
        .unwrap()
        .remove(0)
        .summary
        .unwrap();
    assert_eq!(summary.count, 1);
    assert_eq!(summary.nearest.reminder.id, repeating.id);
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
        assert_eq!(
            !rows.is_empty(),
            state.active() || state == FollowupState::Returned,
            "{state:?}"
        );
        if state == FollowupState::Returned {
            repo.update_reminder(
                &user(USER_A),
                reminder.id,
                &ReminderUpdate {
                    completed: Some(true),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
            assert!(
                repo.email_candidates(&user(USER_A), Some(&[thread]), None, now, 100)
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_candidates_skip_malformed_schedule_without_losing_group_or_cursor(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());
    let now = at(2026, 10, 2, 12);
    let thread = macro_uuid::generate_uuid_v7();
    let mut malformed = new_reminder("bad zone", recurring());
    malformed.entity = Some(EntityType::EmailThread.with_entity_string(thread.to_string()));
    let bad = repo
        .create_reminder(&user(USER_A), &malformed)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE reminder SET timezone = 'not/a/zone' WHERE id = $1",
        bad.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let valid = attached(&repo, USER_A, thread, now).await;
    let first = repo
        .email_candidates(&user(USER_A), None, None, now, 1)
        .await
        .unwrap();
    assert_eq!(
        first[0].summary.as_ref().unwrap().nearest.reminder.id,
        valid.id
    );
    assert_eq!(first[0].summary.as_ref().unwrap().count, 1);
    repo.delete_reminder(&user(USER_A), valid.id).await.unwrap();
    let later_thread = macro_uuid::generate_uuid_v7();
    attached(&repo, USER_A, later_thread, now + Duration::days(1)).await;
    let malformed_page = repo
        .email_candidates(&user(USER_A), None, None, now, 1)
        .await
        .unwrap();
    assert!(malformed_page[0].summary.is_none());
    let later = repo
        .email_candidates(&user(USER_A), None, Some(malformed_page[0].cursor), now, 1)
        .await
        .unwrap();
    assert_eq!(later[0].cursor.thread_id, later_thread);
}
