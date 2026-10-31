use super::*;
use crate::domain::join_requests::CalendarJoinRequestStatus;
use sqlx::postgres::PgListener;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn join_requests_open_once_and_resolve_once(pool: PgPool) {
    let sharer_id = "macro|join-sharer@example.com";
    let member_id = "macro|join-member@example.com";
    insert_user(&pool, member_id).await;
    let sharer_link = insert_link(&pool, sharer_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, sharer_link).await;
    let shared = timed_upsert(
        sharer_id,
        sharer_link,
        provider,
        "join@example.com",
        "Offsite",
        1,
    );
    let event_id = shared.event.id;
    repo.upsert_event_fixture(shared).await.unwrap();

    let (first, opened) = repo
        .open_join_request(event_id, member_id, "member@work.example.com")
        .await
        .unwrap();
    assert!(opened);
    assert_eq!(first.status, CalendarJoinRequestStatus::Pending);

    // Asking again while pending changes nothing and is not news.
    let (again, opened) = repo
        .open_join_request(event_id, member_id, "member@other.example.com")
        .await
        .unwrap();
    assert!(!opened);
    assert_eq!(again, first);
    assert_eq!(
        repo.list_pending_join_requests(event_id).await.unwrap(),
        std::slice::from_ref(&first)
    );

    let declined = repo
        .resolve_join_request(first.id, CalendarJoinRequestStatus::Declined)
        .await
        .unwrap()
        .expect("a pending request resolves");
    assert_eq!(declined.status, CalendarJoinRequestStatus::Declined);
    // A second decline finds nothing pending to resolve.
    assert_eq!(
        repo.resolve_join_request(first.id, CalendarJoinRequestStatus::Declined)
            .await
            .unwrap(),
        None
    );
    assert!(
        repo.list_pending_join_requests(event_id)
            .await
            .unwrap()
            .is_empty()
    );

    // A declined request stands: asking again changes nothing, keeps the
    // original address and is not news.
    let (after_decline, opened) = repo
        .open_join_request(event_id, member_id, "member@other.example.com")
        .await
        .unwrap();
    assert!(!opened);
    assert_eq!(after_decline, declined);
    assert_eq!(after_decline.requester_email, "member@work.example.com");
    assert_eq!(
        repo.find_join_request(event_id, member_id).await.unwrap(),
        Some(declined.clone())
    );

    // Another member's request is accepted.
    let second_id = "macro|join-second@example.com";
    insert_user(&pool, second_id).await;
    let (second, opened) = repo
        .open_join_request(event_id, second_id, "second@work.example.com")
        .await
        .unwrap();
    assert!(opened);
    let accepted = repo
        .resolve_join_request(second.id, CalendarJoinRequestStatus::Accepted)
        .await
        .unwrap()
        .expect("a pending request resolves");
    assert_eq!(accepted.status, CalendarJoinRequestStatus::Accepted);
    // A decline that arrives after the invitation was written changes nothing.
    assert_eq!(
        repo.resolve_join_request(second.id, CalendarJoinRequestStatus::Declined)
            .await
            .unwrap(),
        None
    );
    // An accepted request is not reopened by asking again.
    let (after_accept, opened) = repo
        .open_join_request(event_id, second_id, "second@work.example.com")
        .await
        .unwrap();
    assert!(!opened);
    assert_eq!(after_accept.status, CalendarJoinRequestStatus::Accepted);

    // An acceptance whose invitation was written while a decline landed
    // still records the grant the guest list now holds.
    sqlx::query!(
        "UPDATE calendar_event_join_requests SET status = 'declined' WHERE id = $1",
        second.id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let granted = repo
        .resolve_join_request(second.id, CalendarJoinRequestStatus::Accepted)
        .await
        .unwrap()
        .expect("the acceptance overrides the decline");
    assert_eq!(granted.status, CalendarJoinRequestStatus::Accepted);

    // Requests go with the shared event.
    sqlx::query!("DELETE FROM calendar_events WHERE id = $1", event_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(repo.get_join_request(first.id).await.unwrap(), None);
}

pub(super) const JOIN_REQUEST_NOTIFICATION: &str = "calendar_event_join_request";

/// Store an unseen notification about `event_id`, as notification ingress does.
pub(super) async fn insert_notification(
    pool: &PgPool,
    notification_event_type: &str,
    event_id: Uuid,
    user_id: &str,
) -> Uuid {
    let id = Uuid::now_v7();
    let event_item_id = event_id.to_string();
    sqlx::query!(
        r#"
        INSERT INTO notification (
            id, notification_event_type, event_item_id, event_item_type, service_sender
        )
        VALUES ($1, $2, $3, 'calendar_event', 'document_storage_service')
        "#,
        id,
        notification_event_type,
        event_item_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO user_notification (
            user_id, notification_id, event_item_type, event_item_id, notification_event_type
        )
        VALUES ($1, $2, 'calendar_event', $3, $4)
        "#,
        user_id,
        id,
        event_item_id,
        notification_event_type,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

/// Whether the notification's recipient still has it.
pub(super) async fn recipient_holds(pool: &PgPool, notification_id: Uuid) -> bool {
    sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM user_notification WHERE notification_id = $1) AS "held!""#,
        notification_id,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_join_request_notification_goes_with_the_last_copy_of_its_event(pool: PgPool) {
    let sharer_id = "macro|join-copies@example.com";
    let member_id = "macro|join-copies-member@example.com";
    insert_user(&pool, member_id).await;
    let sharer_link = insert_link(&pool, sharer_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (account_id, primary_id) = provider_ids(&repo, sharer_link).await;
    let second_id = insert_shared_calendar(&repo, account_id, "writer", &[]).await;
    let uid = "join-copies@example.com";
    let provider_event_id = format!("provider-{uid}");
    let event_id = repo
        .upsert_event_fixture(timed_upsert(
            sharer_id,
            sharer_link,
            (account_id, primary_id),
            uid,
            "Offsite",
            1,
        ))
        .await
        .unwrap();
    repo.upsert_event_fixture(timed_upsert(
        sharer_id,
        sharer_link,
        (account_id, second_id),
        uid,
        "Offsite",
        1,
    ))
    .await
    .unwrap();
    let other_event_id = repo
        .upsert_event_fixture(timed_upsert(
            sharer_id,
            sharer_link,
            (account_id, primary_id),
            "join-other@example.com",
            "Review",
            1,
        ))
        .await
        .unwrap();
    repo.open_join_request(event_id, member_id, "member@work.example.com")
        .await
        .unwrap();
    let asked = insert_notification(&pool, JOIN_REQUEST_NOTIFICATION, event_id, sharer_id).await;
    let reminder = insert_notification(&pool, "calendar_event_reminder", event_id, sharer_id).await;
    let asked_elsewhere =
        insert_notification(&pool, JOIN_REQUEST_NOTIFICATION, other_event_id, sharer_id).await;
    let mut listener = PgListener::connect_with(&pool).await.unwrap();
    listener.listen("notification_events").await.unwrap();

    // The other copy keeps the event, so the sharer can still answer.
    repo.remove_provider_source(account_id, primary_id, &provider_event_id)
        .await
        .unwrap();
    assert!(recipient_holds(&pool, asked).await);

    // A delete through Macro retires the last copy, and open clients hear of it.
    repo.remove_provider_source(account_id, second_id, &provider_event_id)
        .await
        .unwrap();
    assert!(!recipient_holds(&pool, asked).await);
    let delivered = tokio::time::timeout(std::time::Duration::from_secs(5), listener.recv())
        .await
        .expect("the notification's delete should be published")
        .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(delivered.payload()).unwrap(),
        serde_json::json!({
            "type": "user_notification_deletes",
            "notificationId": asked,
            "userIds": [sharer_id],
        })
    );

    assert!(recipient_holds(&pool, reminder).await);
    assert!(recipient_holds(&pool, asked_elsewhere).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_cancelled_occurrence_keeps_the_join_request_notification_and_a_cancelled_series_drops_it(
    pool: PgPool,
) {
    let sharer_id = "macro|join-series@example.com";
    let member_id = "macro|join-series-member@example.com";
    insert_user(&pool, member_id).await;
    let sharer_link = insert_link(&pool, sharer_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let enabled = repo
        .apply_google_grant(
            sharer_link,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    let provider = provider_ids(&repo, sharer_link).await;
    let series = timed_upsert(
        sharer_id,
        sharer_link,
        provider,
        "join-series@example.com",
        "Standup",
        1,
    );
    let event_id = repo.upsert_event_fixture(series.clone()).await.unwrap();
    let (request, _) = repo
        .open_join_request(event_id, member_id, "member@work.example.com")
        .await
        .unwrap();
    let asked = insert_notification(&pool, JOIN_REQUEST_NOTIFICATION, event_id, sharer_id).await;

    // Deleting one occurrence refreshes the series without it: the sharer can
    // still add the guest to the rest.
    let mut one_cancelled = series;
    one_cancelled.event.sequence = 2;
    one_cancelled.event.updated_at += Duration::minutes(1);
    one_cancelled.occurrences[1].is_cancelled = true;
    repo.upsert_event_fixture(one_cancelled).await.unwrap();
    assert!(recipient_holds(&pool, asked).await);
    assert_eq!(
        repo.get_join_request(request.id).await.unwrap(),
        Some(request)
    );

    // A tombstone for the series retires it.
    let google_job = enabled
        .jobs
        .into_iter()
        .find(|job| job.kind == CalendarBackfillKind::GoogleCalendar)
        .unwrap();
    let key = CalendarBackfillJobKey {
        job_id: google_job.id,
        email_link_id: sharer_link,
    };
    let CalendarBackfillClaim::Claimed { lease_token, .. } =
        repo.claim_google_backfill(key).await.unwrap()
    else {
        panic!("Google job should be claimable");
    };
    repo.commit_google_calendar_sync(
        key,
        lease_token,
        provider.0,
        GoogleCalendarSyncSnapshot {
            calendar_id: provider.1,
            next_sync_token: "after-tombstone".to_string(),
            observed_provider_event_ids: None,
            materialized_range: None,
            cancelled_provider_event_ids: vec!["provider-join-series@example.com".to_string()],
        },
        0,
    )
    .await
    .unwrap();
    assert!(!recipient_holds(&pool, asked).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_the_calendar_or_the_inbox_removes_join_request_notifications(pool: PgPool) {
    let sharer_id = "macro|join-inbox@example.com";
    let member_id = "macro|join-inbox-member@example.com";
    insert_user(&pool, member_id).await;
    let disconnected_link = insert_link(&pool, sharer_id).await;
    let removed_link = insert_link(&pool, sharer_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (_, _, disconnected_event_id, _) =
        connected_calendar(&pool, &repo, sharer_id, disconnected_link).await;
    let removed_provider = provider_ids(&repo, removed_link).await;
    let removed_event_id = repo
        .upsert_event_fixture(timed_upsert(
            sharer_id,
            removed_link,
            removed_provider,
            "join-inbox@example.com",
            "Review",
            1,
        ))
        .await
        .unwrap();
    let on_disconnected_calendar = insert_notification(
        &pool,
        JOIN_REQUEST_NOTIFICATION,
        disconnected_event_id,
        sharer_id,
    )
    .await;
    let on_removed_inbox = insert_notification(
        &pool,
        JOIN_REQUEST_NOTIFICATION,
        removed_event_id,
        sharer_id,
    )
    .await;

    repo.disconnect_provider_calendar(sharer_id, disconnected_link)
        .await
        .unwrap()
        .expect("the owner's inbox is disconnectable");
    assert!(!recipient_holds(&pool, on_disconnected_calendar).await);
    assert!(recipient_holds(&pool, on_removed_inbox).await);

    sqlx::query!("DELETE FROM email_links WHERE id = $1", removed_link)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!recipient_holds(&pool, on_removed_inbox).await);
}

/// Notification ingress's insert, reporting whether the row was stored.
async fn ingress_insert(
    executor: impl sqlx::PgExecutor<'_>,
    event_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO notification (
            id, notification_event_type, event_item_id, event_item_type, service_sender
        )
        VALUES (
            $1, 'calendar_event_join_request', $2, 'calendar_event', 'notification_service'
        )
        ON CONFLICT (id) DO NOTHING
        "#,
        Uuid::now_v7(),
        event_id.to_string(),
    )
    .execute(executor)
    .await
    .map(|result| result.rows_affected() == 1)
}

/// An event a sharer could be asked to join.
async fn shared_event(pool: &PgPool) -> Uuid {
    let sharer_id = "macro|join-queued@example.com";
    let sharer_link = insert_link(pool, sharer_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, sharer_link).await;
    repo.upsert_event_fixture(timed_upsert(
        sharer_id,
        sharer_link,
        provider,
        "join-queued@example.com",
        "Offsite",
        1,
    ))
    .await
    .unwrap()
}

async fn backend_pid(transaction: &mut Transaction<'_, Postgres>) -> i32 {
    sqlx::query_scalar!(r#"SELECT pg_backend_pid() AS "pid!""#)
        .fetch_one(&mut **transaction)
        .await
        .unwrap()
}

/// Only Postgres can tell that a statement is waiting on `blocker`'s row lock.
async fn wait_for_blocked_transaction(pool: &PgPool, blocker: i32) {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let waiting = sqlx::query_scalar!(
                r#"SELECT EXISTS (
                    SELECT 1 FROM pg_stat_activity
                    WHERE datname = current_database()
                    AND $1 = ANY(pg_blocking_pids(pid))
                ) AS "waiting!""#,
                blocker,
            )
            .fetch_one(pool)
            .await
            .unwrap();
            if waiting {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the statement should wait on the row lock");
}

async fn stored_notifications(pool: &PgPool) -> i64 {
    sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM notification"#)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_queued_join_request_notification_is_not_stored_after_its_event_went(pool: PgPool) {
    let event_id = shared_event(&pool).await;
    assert!(ingress_insert(&pool, event_id).await.unwrap());

    sqlx::query!(
        "UPDATE calendar_events SET status = 'cancelled' WHERE id = $1",
        event_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(!ingress_insert(&pool, event_id).await.unwrap());

    sqlx::query!("DELETE FROM calendar_events WHERE id = $1", event_id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!ingress_insert(&pool, event_id).await.unwrap());
    assert_eq!(stored_notifications(&pool).await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_queued_insert_waits_for_a_cancellation_then_stores_nothing(pool: PgPool) {
    let event_id = shared_event(&pool).await;
    let mut cancelling = pool.begin().await.unwrap();
    let blocker = backend_pid(&mut cancelling).await;
    sqlx::query!(
        "UPDATE calendar_events SET status = 'cancelled' WHERE id = $1",
        event_id,
    )
    .execute(&mut *cancelling)
    .await
    .unwrap();

    let arriving = tokio::spawn({
        let pool = pool.clone();
        async move { ingress_insert(&pool, event_id).await }
    });
    wait_for_blocked_transaction(&pool, blocker).await;
    cancelling.commit().await.unwrap();

    assert!(!arriving.await.unwrap().unwrap());
    assert_eq!(stored_notifications(&pool).await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_queued_insert_waits_for_a_delete_then_stores_nothing(pool: PgPool) {
    let event_id = shared_event(&pool).await;
    let mut deleting = pool.begin().await.unwrap();
    let blocker = backend_pid(&mut deleting).await;
    sqlx::query!("DELETE FROM calendar_events WHERE id = $1", event_id)
        .execute(&mut *deleting)
        .await
        .unwrap();

    let arriving = tokio::spawn({
        let pool = pool.clone();
        async move { ingress_insert(&pool, event_id).await }
    });
    wait_for_blocked_transaction(&pool, blocker).await;
    deleting.commit().await.unwrap();

    assert!(!arriving.await.unwrap().unwrap());
    assert_eq!(stored_notifications(&pool).await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_delete_waits_for_a_queued_insert_then_retires_it(pool: PgPool) {
    let event_id = shared_event(&pool).await;
    let mut arriving = pool.begin().await.unwrap();
    let blocker = backend_pid(&mut arriving).await;
    assert!(ingress_insert(&mut *arriving, event_id).await.unwrap());

    let deleting = tokio::spawn({
        let pool = pool.clone();
        async move {
            sqlx::query!("DELETE FROM calendar_events WHERE id = $1", event_id)
                .execute(&pool)
                .await
        }
    });
    wait_for_blocked_transaction(&pool, blocker).await;
    arriving.commit().await.unwrap();

    deleting.await.unwrap().unwrap();
    assert_eq!(stored_notifications(&pool).await, 0);
}
