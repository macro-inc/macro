use super::*;
use crate::domain::collection::{CollectionCursor, CollectionQuery, is_history};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn collection_paginates_due_upcoming_and_history_without_starvation(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgRemindersRepo::new(pool);
    let now = at(2026, 10, 1, 12);
    // More than a page of old completions must not consume the actionable page.
    for i in 0..105 {
        let r = repo
            .create_reminder(
                &user(USER_A),
                &new_reminder(
                    "history",
                    once_at(now - Duration::days(10) + Duration::seconds(i)),
                ),
            )
            .await
            .unwrap();
        repo.update_reminder(
            &user(USER_A),
            r.id,
            &ReminderUpdate {
                completed: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        repo.create_reminder(
            &user(USER_A),
            &new_reminder(
                "future",
                once_at(now + Duration::days(10) + Duration::seconds(i)),
            ),
        )
        .await
        .unwrap();
    }
    let due = repo
        .create_reminder(
            &user(USER_A),
            &new_reminder("due", once_at(now - Duration::hours(1))),
        )
        .await
        .unwrap();
    let mut repeating = new_reminder("done and scheduled", recurring());
    repeating.next_run_at = now + Duration::hours(1);
    let recurring = repo
        .create_reminder(&user(USER_A), &repeating)
        .await
        .unwrap();
    repo.update_reminder(
        &user(USER_A),
        recurring.id,
        &ReminderUpdate {
            completed: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    repo.create_reminder(
        &user(USER_B),
        &new_reminder("private", once_at(now - Duration::days(2))),
    )
    .await
    .unwrap();

    let mut query = CollectionQuery::default();
    let mut rows = Vec::new();
    loop {
        let page = repo
            .list_collection(&user(USER_A), &query, now, 100)
            .await
            .unwrap()
            .items;
        let Some(last) = page.last() else { break };
        query.cursor = Some(CollectionCursor {
            as_of: now,
            history: is_history(&last.reminder, now),
            position: ReminderCursor::after(&last.reminder),
        });
        rows.extend(page);
    }
    assert_eq!(rows.len(), 212);
    assert_eq!(rows[0].reminder.id, due.id);
    assert_eq!(rows[1].reminder.id, recurring.id);
    assert!(rows[1].reminder.completed_at.is_some());
    assert!(
        rows[..107]
            .iter()
            .all(|row| !is_history(&row.reminder, now))
    );
    assert!(rows[107..].iter().all(|row| is_history(&row.reminder, now)));
    let ids: std::collections::HashSet<_> = rows.iter().map(|r| r.reminder.id).collect();
    assert_eq!(ids.len(), rows.len());
    let done = repo
        .list_collection(
            &user(USER_A),
            &CollectionQuery {
                completed: Some(true),
                ..Default::default()
            },
            now,
            500,
        )
        .await
        .unwrap();
    let done = done.items;
    assert_eq!(done.len(), 106);
    assert_eq!(done[0].reminder.id, recurring.id);
}

#[derive(Clone)]
struct CollectionClock(DateTime<Utc>);
impl crate::domain::ports::Clock for CollectionClock {
    fn now(&self) -> DateTime<Utc> {
        self.0
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn collection_skips_unreadable_probe_rows_without_losing_following_pages(pool: PgPool) {
    use crate::domain::{ports::RemindersService, service::RemindersServiceImpl};
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());
    let now = at(2026, 10, 1, 12);
    let mut expected = Vec::new();
    for i in 0..105 {
        let row = repo
            .create_reminder(
                &user(USER_A),
                &new_reminder("row", once_at(now + Duration::seconds(i))),
            )
            .await
            .unwrap();
        if i == 0 || i == 100 {
            sqlx::query("UPDATE reminder SET entity_type = 'unknown_type', entity_id = $2::uuid WHERE id = $1")
                .bind(row.id).bind(DOC_1).execute(&pool).await.unwrap();
        } else {
            expected.push(row.id);
        }
    }
    let batch = repo
        .list_collection(&user(USER_A), &CollectionQuery::default(), now, 101)
        .await
        .unwrap();
    assert_eq!(batch.examined, 101);
    assert_eq!(batch.items.len(), 99);
    assert!(batch.last_examined.is_some());
    let service = RemindersServiceImpl::with_clock(repo, CollectionClock(now));
    let first = service
        .list_collection(&user(USER_A), CollectionQuery::default())
        .await
        .unwrap();
    assert_eq!(first.items.len(), 100);
    let second = service
        .list_collection(
            &user(USER_A),
            CollectionQuery {
                cursor: Some(
                    CollectionCursor::decode(first.next_cursor.as_deref().unwrap()).unwrap(),
                ),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(second.items.len(), 3);
    assert!(second.next_cursor.is_none());
    let actual: Vec<_> = first
        .items
        .into_iter()
        .chain(second.items)
        .map(|row| row.reminder.id)
        .collect();
    assert_eq!(actual, expected);
}
