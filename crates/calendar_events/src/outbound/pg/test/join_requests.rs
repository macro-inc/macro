use super::*;
use crate::domain::join_requests::{CalendarJoinRequest, CalendarJoinRequestStatus};
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

const JOIN_REQUEST_NOTIFICATION: &str = "calendar_event_join_request";

/// Store an unseen notification about `event_id`, as notification ingress does.
async fn store_notification(
    pool: &PgPool,
    notification_event_type: &str,
    event_id: Uuid,
    metadata: serde_json::Value,
    recipients: &[&str],
) -> Uuid {
    let id = Uuid::now_v7();
    let event_item_id = event_id.to_string();
    sqlx::query!(
        r#"
        INSERT INTO notification (
            id, notification_event_type, event_item_id, event_item_type, service_sender, metadata
        )
        VALUES ($1, $2, $3, 'calendar_event', 'document_storage_service', $4)
        "#,
        id,
        notification_event_type,
        event_item_id,
        metadata,
    )
    .execute(pool)
    .await
    .unwrap();
    for user_id in recipients {
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
    }
    id
}

/// The metadata `CalendarEventJoinRequestMetadata` stores for `request`.
fn join_request_metadata(request: &CalendarJoinRequest) -> serde_json::Value {
    serde_json::json!({
        "requestId": request.id,
        "eventId": request.event_id,
        "title": "Offsite",
    })
}

/// Store the notification about `request`, as notification ingress does.
pub(super) async fn insert_join_request_notification(
    pool: &PgPool,
    request: &CalendarJoinRequest,
    recipients: &[&str],
) -> Uuid {
    store_notification(
        pool,
        JOIN_REQUEST_NOTIFICATION,
        request.event_id,
        join_request_metadata(request),
        recipients,
    )
    .await
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
    let (request, _) = repo
        .open_join_request(event_id, member_id, "member@work.example.com")
        .await
        .unwrap();
    let (other_request, _) = repo
        .open_join_request(other_event_id, member_id, "member@work.example.com")
        .await
        .unwrap();
    let asked = insert_join_request_notification(&pool, &request, &[sharer_id]).await;
    let reminder = store_notification(
        &pool,
        "calendar_event_reminder",
        event_id,
        serde_json::json!({}),
        &[sharer_id],
    )
    .await;
    let asked_elsewhere =
        insert_join_request_notification(&pool, &other_request, &[sharer_id]).await;
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
    assert_eq!(
        published_delete(&mut listener).await,
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
    let asked = insert_join_request_notification(&pool, &request, &[sharer_id]).await;

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
    let (disconnected_request, _) = repo
        .open_join_request(disconnected_event_id, member_id, "member@work.example.com")
        .await
        .unwrap();
    let (removed_request, _) = repo
        .open_join_request(removed_event_id, member_id, "member@work.example.com")
        .await
        .unwrap();
    let on_disconnected_calendar =
        insert_join_request_notification(&pool, &disconnected_request, &[sharer_id]).await;
    let on_removed_inbox =
        insert_join_request_notification(&pool, &removed_request, &[sharer_id]).await;

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
    request: &CalendarJoinRequest,
) -> Result<bool, sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO notification (
            id, notification_event_type, event_item_id, event_item_type, service_sender, metadata
        )
        VALUES (
            $1, 'calendar_event_join_request', $2, 'calendar_event', 'notification_service', $3
        )
        ON CONFLICT (id) DO NOTHING
        "#,
        Uuid::now_v7(),
        request.event_id.to_string(),
        join_request_metadata(request),
    )
    .execute(executor)
    .await
    .map(|result| result.rows_affected() == 1)
}

const SHARER_ID: &str = "macro|join-queued@example.com";
const MEMBER_ID: &str = "macro|join-queued-member@example.com";
const OTHER_MEMBER_ID: &str = "macro|join-queued-other@example.com";

/// A pending request to join an event a sharer shared.
async fn open_request(pool: &PgPool) -> CalendarJoinRequest {
    insert_user(pool, MEMBER_ID).await;
    let sharer_link = insert_link(pool, SHARER_ID).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, sharer_link).await;
    let event_id = repo
        .upsert_event_fixture(timed_upsert(
            SHARER_ID,
            sharer_link,
            provider,
            "join-queued@example.com",
            "Offsite",
            1,
        ))
        .await
        .unwrap();
    repo.open_join_request(event_id, MEMBER_ID, "member@work.example.com")
        .await
        .unwrap()
        .0
}

/// A second member's pending request to join the event of `request`.
async fn another_open_request(pool: &PgPool, request: &CalendarJoinRequest) -> CalendarJoinRequest {
    insert_user(pool, OTHER_MEMBER_ID).await;
    PgCalendarRepository::new(pool.clone())
        .open_join_request(request.event_id, OTHER_MEMBER_ID, "other@work.example.com")
        .await
        .unwrap()
        .0
}

/// The next delete `trg_notify_user_notification_deletes` published.
async fn published_delete(listener: &mut PgListener) -> serde_json::Value {
    let delivered = tokio::time::timeout(std::time::Duration::from_secs(5), listener.recv())
        .await
        .expect("the notification's delete should be published")
        .unwrap();
    serde_json::from_str(delivered.payload()).unwrap()
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
    let request = open_request(&pool).await;
    let event_id = request.event_id;
    assert!(ingress_insert(&pool, &request).await.unwrap());

    sqlx::query!(
        "UPDATE calendar_events SET status = 'cancelled' WHERE id = $1",
        event_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(!ingress_insert(&pool, &request).await.unwrap());

    sqlx::query!("DELETE FROM calendar_events WHERE id = $1", event_id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!ingress_insert(&pool, &request).await.unwrap());
    assert_eq!(stored_notifications(&pool).await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_queued_insert_waits_for_a_cancellation_then_stores_nothing(pool: PgPool) {
    let request = open_request(&pool).await;
    let event_id = request.event_id;
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
        let request = request.clone();
        async move { ingress_insert(&pool, &request).await }
    });
    wait_for_blocked_transaction(&pool, blocker).await;
    cancelling.commit().await.unwrap();

    assert!(!arriving.await.unwrap().unwrap());
    assert_eq!(stored_notifications(&pool).await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_queued_insert_waits_for_a_delete_then_stores_nothing(pool: PgPool) {
    let request = open_request(&pool).await;
    let event_id = request.event_id;
    let mut deleting = pool.begin().await.unwrap();
    let blocker = backend_pid(&mut deleting).await;
    sqlx::query!("DELETE FROM calendar_events WHERE id = $1", event_id)
        .execute(&mut *deleting)
        .await
        .unwrap();

    let arriving = tokio::spawn({
        let pool = pool.clone();
        let request = request.clone();
        async move { ingress_insert(&pool, &request).await }
    });
    wait_for_blocked_transaction(&pool, blocker).await;
    deleting.commit().await.unwrap();

    assert!(!arriving.await.unwrap().unwrap());
    assert_eq!(stored_notifications(&pool).await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_delete_waits_for_a_queued_insert_then_retires_it(pool: PgPool) {
    let request = open_request(&pool).await;
    let event_id = request.event_id;
    let mut arriving = pool.begin().await.unwrap();
    let blocker = backend_pid(&mut arriving).await;
    assert!(ingress_insert(&mut *arriving, &request).await.unwrap());

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

/// Answers `request` inside `transaction`, as `resolve_join_request` does.
async fn answer_within(transaction: &mut Transaction<'_, Postgres>, request: &CalendarJoinRequest) {
    sqlx::query!(
        "UPDATE calendar_event_join_requests SET status = 'declined' WHERE id = $1",
        request.id,
    )
    .execute(&mut **transaction)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn answering_a_join_request_retires_its_notification_for_every_recipient(pool: PgPool) {
    let accepted = open_request(&pool).await;
    let declined = another_open_request(&pool, &accepted).await;
    let delegate_id = "macro|join-queued-delegate@example.com";
    insert_user(&pool, delegate_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let reminder = store_notification(
        &pool,
        "calendar_event_reminder",
        accepted.event_id,
        serde_json::json!({}),
        &[SHARER_ID],
    )
    .await;
    let mut listener = PgListener::connect_with(&pool).await.unwrap();
    listener.listen("notification_events").await.unwrap();

    for (request, status) in [
        (&accepted, CalendarJoinRequestStatus::Accepted),
        (&declined, CalendarJoinRequestStatus::Declined),
    ] {
        let asked =
            insert_join_request_notification(&pool, request, &[SHARER_ID, delegate_id]).await;
        repo.resolve_join_request(request.id, status)
            .await
            .unwrap()
            .expect("the request was open");
        assert!(!recipient_holds(&pool, asked).await);

        let mut published = published_delete(&mut listener).await;
        assert_eq!(published["notificationId"], serde_json::json!(asked));
        let recipients = published["userIds"].as_array_mut().unwrap();
        recipients.sort_by_key(ToString::to_string);
        assert_eq!(
            *recipients,
            vec![serde_json::json!(delegate_id), serde_json::json!(SHARER_ID)]
        );
    }

    assert!(recipient_holds(&pool, reminder).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn answering_one_join_request_keeps_the_notification_of_another_still_open(pool: PgPool) {
    let answered = open_request(&pool).await;
    let still_open = another_open_request(&pool, &answered).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let about_answered = insert_join_request_notification(&pool, &answered, &[SHARER_ID]).await;
    let about_still_open = insert_join_request_notification(&pool, &still_open, &[SHARER_ID]).await;

    repo.resolve_join_request(answered.id, CalendarJoinRequestStatus::Declined)
        .await
        .unwrap()
        .expect("the request was open");
    assert!(!recipient_holds(&pool, about_answered).await);
    assert!(recipient_holds(&pool, about_still_open).await);
    assert_eq!(
        repo.list_pending_join_requests(answered.event_id)
            .await
            .unwrap(),
        std::slice::from_ref(&still_open)
    );

    repo.resolve_join_request(still_open.id, CalendarJoinRequestStatus::Accepted)
        .await
        .unwrap()
        .expect("the request was open");
    assert!(!recipient_holds(&pool, about_still_open).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_queued_join_request_notification_is_not_stored_after_its_request_was_answered(
    pool: PgPool,
) {
    let accepted = open_request(&pool).await;
    let declined = another_open_request(&pool, &accepted).await;
    let third_member = "macro|join-queued-third@example.com";
    insert_user(&pool, third_member).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (still_open, _) = repo
        .open_join_request(accepted.event_id, third_member, "third@work.example.com")
        .await
        .unwrap();
    repo.resolve_join_request(accepted.id, CalendarJoinRequestStatus::Accepted)
        .await
        .unwrap();
    repo.resolve_join_request(declined.id, CalendarJoinRequestStatus::Declined)
        .await
        .unwrap();

    assert!(!ingress_insert(&pool, &accepted).await.unwrap());
    assert!(!ingress_insert(&pool, &declined).await.unwrap());
    assert_eq!(stored_notifications(&pool).await, 0);

    assert!(ingress_insert(&pool, &still_open).await.unwrap());
    assert_eq!(stored_notifications(&pool).await, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_queued_join_request_notification_is_not_stored_without_its_request(pool: PgPool) {
    let request = open_request(&pool).await;
    sqlx::query!(
        "DELETE FROM calendar_event_join_requests WHERE id = $1",
        request.id,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(!ingress_insert(&pool, &request).await.unwrap());
    assert_eq!(stored_notifications(&pool).await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_queued_insert_waits_for_an_answer_then_stores_nothing(pool: PgPool) {
    let request = open_request(&pool).await;
    let mut answering = pool.begin().await.unwrap();
    let blocker = backend_pid(&mut answering).await;
    answer_within(&mut answering, &request).await;

    let arriving = tokio::spawn({
        let pool = pool.clone();
        let request = request.clone();
        async move { ingress_insert(&pool, &request).await }
    });
    wait_for_blocked_transaction(&pool, blocker).await;
    answering.commit().await.unwrap();

    assert!(!arriving.await.unwrap().unwrap());
    assert_eq!(stored_notifications(&pool).await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_queued_insert_is_stored_when_the_answer_it_waited_for_rolls_back(pool: PgPool) {
    let request = open_request(&pool).await;
    let mut answering = pool.begin().await.unwrap();
    let blocker = backend_pid(&mut answering).await;
    answer_within(&mut answering, &request).await;

    let arriving = tokio::spawn({
        let pool = pool.clone();
        let request = request.clone();
        async move { ingress_insert(&pool, &request).await }
    });
    wait_for_blocked_transaction(&pool, blocker).await;
    answering.rollback().await.unwrap();

    assert!(arriving.await.unwrap().unwrap());
    assert_eq!(stored_notifications(&pool).await, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_answer_waits_for_a_queued_insert_then_retires_it(pool: PgPool) {
    let request = open_request(&pool).await;
    let mut arriving = pool.begin().await.unwrap();
    let blocker = backend_pid(&mut arriving).await;
    assert!(ingress_insert(&mut *arriving, &request).await.unwrap());

    let answering = tokio::spawn({
        let repo = PgCalendarRepository::new(pool.clone());
        let request_id = request.id;
        async move {
            repo.resolve_join_request(request_id, CalendarJoinRequestStatus::Declined)
                .await
        }
    });
    wait_for_blocked_transaction(&pool, blocker).await;
    arriving.commit().await.unwrap();

    assert!(answering.await.unwrap().unwrap().is_some());
    assert_eq!(stored_notifications(&pool).await, 0);
}

/// The statement `delete_user` runs, which cascades the user's requests away.
async fn delete_account(
    executor: impl sqlx::PgExecutor<'_>,
    user_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, user_id)
        .execute(executor)
        .await
        .map(|_| ())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_the_requesters_account_retires_their_requests_notification(pool: PgPool) {
    let removed = open_request(&pool).await;
    let still_open = another_open_request(&pool, &removed).await;
    let delegate_id = "macro|join-queued-delegate@example.com";
    insert_user(&pool, delegate_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let about_removed =
        insert_join_request_notification(&pool, &removed, &[SHARER_ID, delegate_id]).await;
    let about_still_open = insert_join_request_notification(&pool, &still_open, &[SHARER_ID]).await;
    let reminder = store_notification(
        &pool,
        "calendar_event_reminder",
        removed.event_id,
        serde_json::json!({}),
        &[SHARER_ID],
    )
    .await;
    let mut listener = PgListener::connect_with(&pool).await.unwrap();
    listener.listen("notification_events").await.unwrap();

    delete_account(&pool, MEMBER_ID).await.unwrap();

    assert_eq!(repo.get_join_request(removed.id).await.unwrap(), None);
    assert!(!recipient_holds(&pool, about_removed).await);
    let mut published = published_delete(&mut listener).await;
    assert_eq!(
        published["notificationId"],
        serde_json::json!(about_removed)
    );
    let recipients = published["userIds"].as_array_mut().unwrap();
    recipients.sort_by_key(ToString::to_string);
    assert_eq!(
        *recipients,
        vec![serde_json::json!(delegate_id), serde_json::json!(SHARER_ID)]
    );

    assert!(recipient_holds(&pool, about_still_open).await);
    assert!(recipient_holds(&pool, reminder).await);
    assert_eq!(
        repo.list_pending_join_requests(removed.event_id)
            .await
            .unwrap(),
        std::slice::from_ref(&still_open)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_the_event_retires_each_join_request_notification_once(pool: PgPool) {
    let first = open_request(&pool).await;
    let second = another_open_request(&pool, &first).await;
    let event_id = first.event_id;
    let about_first = insert_join_request_notification(&pool, &first, &[SHARER_ID]).await;
    let about_second = insert_join_request_notification(&pool, &second, &[SHARER_ID]).await;
    let mut listener = PgListener::connect_with(&pool).await.unwrap();
    listener.listen("notification_events").await.unwrap();

    sqlx::query!("DELETE FROM calendar_events WHERE id = $1", event_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(stored_notifications(&pool).await, 0);

    let mut retired = vec![
        published_delete(&mut listener).await["notificationId"].clone(),
        published_delete(&mut listener).await["notificationId"].clone(),
    ];
    retired.sort_by_key(ToString::to_string);
    let mut expected = vec![
        serde_json::json!(about_first),
        serde_json::json!(about_second),
    ];
    expected.sort_by_key(ToString::to_string);
    assert_eq!(retired, expected);

    // Sent after the delete, so a third publish would arrive ahead of it.
    sqlx::query!(r#"SELECT pg_notify('notification_events', '{"marker":true}')"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        published_delete(&mut listener).await,
        serde_json::json!({ "marker": true })
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_queued_insert_waits_for_an_account_delete_then_stores_nothing(pool: PgPool) {
    let request = open_request(&pool).await;
    let mut deleting = pool.begin().await.unwrap();
    let blocker = backend_pid(&mut deleting).await;
    delete_account(&mut *deleting, MEMBER_ID).await.unwrap();

    let arriving = tokio::spawn({
        let pool = pool.clone();
        let request = request.clone();
        async move { ingress_insert(&pool, &request).await }
    });
    wait_for_blocked_transaction(&pool, blocker).await;
    deleting.commit().await.unwrap();

    assert!(!arriving.await.unwrap().unwrap());
    assert_eq!(stored_notifications(&pool).await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_queued_insert_is_stored_when_the_account_delete_it_waited_for_rolls_back(pool: PgPool) {
    let request = open_request(&pool).await;
    let mut deleting = pool.begin().await.unwrap();
    let blocker = backend_pid(&mut deleting).await;
    delete_account(&mut *deleting, MEMBER_ID).await.unwrap();

    let arriving = tokio::spawn({
        let pool = pool.clone();
        let request = request.clone();
        async move { ingress_insert(&pool, &request).await }
    });
    wait_for_blocked_transaction(&pool, blocker).await;
    deleting.rollback().await.unwrap();

    assert!(arriving.await.unwrap().unwrap());
    assert_eq!(stored_notifications(&pool).await, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_account_delete_waits_for_a_queued_insert_then_retires_it(pool: PgPool) {
    let request = open_request(&pool).await;
    let mut arriving = pool.begin().await.unwrap();
    let blocker = backend_pid(&mut arriving).await;
    assert!(ingress_insert(&mut *arriving, &request).await.unwrap());

    let deleting = tokio::spawn({
        let pool = pool.clone();
        async move { delete_account(&pool, MEMBER_ID).await }
    });
    wait_for_blocked_transaction(&pool, blocker).await;
    arriving.commit().await.unwrap();

    deleting.await.unwrap().unwrap();
    assert_eq!(stored_notifications(&pool).await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_event_delete_waits_for_an_account_delete_and_both_retire_once(pool: PgPool) {
    let request = open_request(&pool).await;
    let event_id = request.event_id;
    let asked = insert_join_request_notification(&pool, &request, &[SHARER_ID]).await;
    let mut listener = PgListener::connect_with(&pool).await.unwrap();
    listener.listen("notification_events").await.unwrap();
    let mut deleting_account = pool.begin().await.unwrap();
    let blocker = backend_pid(&mut deleting_account).await;
    delete_account(&mut *deleting_account, MEMBER_ID)
        .await
        .unwrap();

    let deleting_event = tokio::spawn({
        let pool = pool.clone();
        async move {
            sqlx::query!("DELETE FROM calendar_events WHERE id = $1", event_id)
                .execute(&pool)
                .await
        }
    });
    wait_for_blocked_transaction(&pool, blocker).await;
    deleting_account.commit().await.unwrap();

    deleting_event.await.unwrap().unwrap();
    assert_eq!(stored_notifications(&pool).await, 0);
    let published = published_delete(&mut listener).await;
    assert_eq!(published["notificationId"], serde_json::json!(asked));
}
