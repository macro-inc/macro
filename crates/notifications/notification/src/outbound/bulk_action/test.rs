use macro_db_migrator::MACRO_DB_MIGRATIONS;
use notification_state::NotificationState;
use serde_json::json;
use sqlx::{Pool, Postgres};

use super::*;
use crate::{domain::bulk_action::BulkActionItem, outbound::repository::NotificationDbOps};

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("user@example.com").unwrap()
}

/// A notification for the test user in `state`, created `age_seconds` ago.
async fn notification(pool: &Pool<Postgres>, state: NotificationState, age_seconds: f64) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata)
         VALUES ($1, 'test', 'item-1', 'document', 'test_service', '{}')",
        id,
    )
    .execute(pool)
    .await
    .unwrap();
    let user = user();
    sqlx::query!(
        "INSERT INTO user_notification (user_id, notification_id, created_at, state)
         VALUES ($1, $2, (now() - make_interval(secs => $4))::timestamp, $3)",
        user.as_ref(),
        id,
        state as _,
        age_seconds,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn state(pool: &Pool<Postgres>, id: Uuid) -> NotificationState {
    sqlx::query_scalar!(
        r#"SELECT state AS "state!: NotificationState" FROM user_notification WHERE notification_id = $1"#,
        id,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn create(store: &PgBulkActions, scope: serde_json::Value) -> (BulkAction, BulkActionLease) {
    let new = NewBulkAction {
        id: Uuid::now_v7(),
        user_id: user(),
        scope,
    };
    match store.create(new).await.unwrap() {
        CreatedBulkAction::Created(action, lease) => (action, lease),
        other => panic!("expected a new action, got {other:?}"),
    }
}

fn chunk(ids: &[Uuid], finished: bool) -> ApplyChunk {
    ApplyChunk {
        items: ids
            .iter()
            .map(|id| BulkActionItem {
                notification_id: *id,
                group_key: "document:item-1".to_owned(),
            })
            .collect(),
        units: 1,
        cursor: Some(json!({ "after": ids.len() })),
        finished,
    }
}

fn committed<T>(outcome: ChunkOutcome<T>) -> T {
    match outcome {
        ChunkOutcome::Committed(value) => value,
        ChunkOutcome::Stopped => panic!("expected the chunk to commit"),
    }
}

/// Undo every chunk; returns the finished action.
async fn undo(store: &PgBulkActions, id: Uuid) -> BulkAction {
    let Some(UndoRequested::Started(_, lease)) = store.request_undo(&user(), id).await.unwrap()
    else {
        panic!("expected the undo to start");
    };
    loop {
        let reverted = committed(store.revert_chunk(&lease, 2).await.unwrap());
        if reverted.action.status == BulkActionStatus::Undone {
            return reverted.action;
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn undo_restores_each_notification_to_its_earlier_state(pool: Pool<Postgres>) {
    let store = PgBulkActions::new(pool.clone());
    let unseen = notification(&pool, NotificationState::Unseen, 60.0).await;
    let seen = notification(&pool, NotificationState::Seen, 60.0).await;
    let already_done = notification(&pool, NotificationState::Done, 60.0).await;
    let (_, lease) = create(&store, json!({})).await;

    let applied = committed(
        store
            .apply_chunk(&lease, chunk(&[unseen, seen, already_done], true))
            .await
            .unwrap(),
    );
    assert_eq!(applied.action.status, BulkActionStatus::Done);
    assert_eq!(
        applied.action.applied, 2,
        "a notification already done is not the action's"
    );
    assert_eq!(state(&pool, unseen).await, NotificationState::Done);
    assert_eq!(state(&pool, seen).await, NotificationState::Done);

    let undone = undo(&store, lease.action_id).await;
    assert_eq!(undone.restored, 2);
    assert_eq!(state(&pool, unseen).await, NotificationState::Unseen);
    assert_eq!(state(&pool, seen).await, NotificationState::Seen);
    assert_eq!(state(&pool, already_done).await, NotificationState::Done);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_notification_newer_than_the_action_is_left_alone(pool: Pool<Postgres>) {
    let store = PgBulkActions::new(pool.clone());
    let before = notification(&pool, NotificationState::Unseen, 60.0).await;
    let (_, lease) = create(&store, json!({})).await;
    // Arrives after the action was created.
    let after = notification(&pool, NotificationState::Unseen, -60.0).await;

    let applied = committed(
        store
            .apply_chunk(&lease, chunk(&[before, after], true))
            .await
            .unwrap(),
    );
    assert_eq!(applied.changed, vec![before]);
    assert_eq!(state(&pool, after).await, NotificationState::Unseen);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn undo_skips_what_the_user_changed_after_the_action(pool: Pool<Postgres>) {
    let store = PgBulkActions::new(pool.clone());
    let untouched = notification(&pool, NotificationState::Unseen, 60.0).await;
    let reopened = notification(&pool, NotificationState::Unseen, 60.0).await;
    let redone = notification(&pool, NotificationState::Unseen, 60.0).await;
    let (_, lease) = create(&store, json!({})).await;
    committed(
        store
            .apply_chunk(&lease, chunk(&[untouched, reopened, redone], true))
            .await
            .unwrap(),
    );

    // The user reopens two themselves, then marks one of them done again.
    pool.mark_notifications_done(&user(), &[reopened, redone], false)
        .await
        .unwrap();
    pool.mark_notifications_done(&user(), &[redone], true)
        .await
        .unwrap();

    let undone = undo(&store, lease.action_id).await;
    assert_eq!(undone.restored, 1);
    assert_eq!(state(&pool, untouched).await, NotificationState::Unseen);
    assert_eq!(state(&pool, reopened).await, NotificationState::Seen);
    assert_eq!(
        state(&pool, redone).await,
        NotificationState::Done,
        "the user's own done outlives the action's undo"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_undo_stops_the_worker_still_applying(pool: Pool<Postgres>) {
    let store = PgBulkActions::new(pool.clone());
    let first = notification(&pool, NotificationState::Unseen, 60.0).await;
    let second = notification(&pool, NotificationState::Unseen, 60.0).await;
    let (_, lease) = create(&store, json!({})).await;
    committed(
        store
            .apply_chunk(&lease, chunk(&[first], false))
            .await
            .unwrap(),
    );

    let Some(UndoRequested::Started(undoing, undo_lease)) =
        store.request_undo(&user(), lease.action_id).await.unwrap()
    else {
        panic!("expected the undo to start");
    };
    assert_eq!(undoing.status, BulkActionStatus::Undoing);

    // The worker's next chunk commits nothing.
    let late = store
        .apply_chunk(&lease, chunk(&[second], true))
        .await
        .unwrap();
    assert!(matches!(late, ChunkOutcome::Stopped));
    assert_eq!(state(&pool, second).await, NotificationState::Unseen);

    committed(store.revert_chunk(&undo_lease, 10).await.unwrap());
    let finished = committed(store.revert_chunk(&undo_lease, 10).await.unwrap());
    assert_eq!(finished.action.status, BulkActionStatus::Undone);
    assert_eq!(finished.action.restored, 1);
    assert_eq!(state(&pool, first).await, NotificationState::Unseen);

    // A second undo changes nothing.
    assert!(matches!(
        store.request_undo(&user(), lease.action_id).await.unwrap(),
        Some(UndoRequested::Already(_))
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stalled_action_is_claimed_and_resumes_from_its_cursor(pool: Pool<Postgres>) {
    let store = PgBulkActions::new(pool.clone());
    let first = notification(&pool, NotificationState::Unseen, 60.0).await;
    let second = notification(&pool, NotificationState::Seen, 60.0).await;
    let (_, lease) = create(&store, json!({ "kinds": ["task"] })).await;
    committed(
        store
            .apply_chunk(&lease, chunk(&[first], false))
            .await
            .unwrap(),
    );

    // A live lease is not claimable.
    assert!(store.claim_stalled(10).await.unwrap().is_empty());

    // The worker dies: its lease runs out.
    sqlx::query!(
        "UPDATE notification_bulk_action SET lease_expires_at = now() - interval '1 second' WHERE id = $1",
        lease.action_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut claimed = store.claim_stalled(10).await.unwrap();
    let (action, new_lease) = claimed.pop().expect("the stalled action is claimed");
    assert_eq!(action.id, lease.action_id);
    assert_eq!(action.cursor, Some(json!({ "after": 1 })));
    assert_eq!(action.scope, json!({ "kinds": ["task"] }));
    assert_eq!(action.applied, 1);

    // The dead worker, back late, commits nothing; the new one finishes.
    let late = store
        .apply_chunk(&lease, chunk(&[second], true))
        .await
        .unwrap();
    assert!(matches!(late, ChunkOutcome::Stopped));
    let finished = committed(
        store
            .apply_chunk(&new_lease, chunk(&[first, second], true))
            .await
            .unwrap(),
    );
    assert_eq!(
        finished.changed,
        vec![second],
        "the first chunk is not applied twice"
    );
    assert_eq!(finished.action.applied, 2);
    assert_eq!(finished.action.status, BulkActionStatus::Done);
    assert!(store.running(&user()).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_action_that_keeps_stalling_is_marked_failed(pool: Pool<Postgres>) {
    let store = PgBulkActions::new(pool.clone());
    let (_, lease) = create(&store, json!({})).await;
    let mut claims = 0;
    loop {
        sqlx::query!(
            "UPDATE notification_bulk_action SET lease_expires_at = now() - interval '1 second' WHERE id = $1",
            lease.action_id,
        )
        .execute(&pool)
        .await
        .unwrap();
        if store.claim_stalled(10).await.unwrap().is_empty() {
            break;
        }
        claims += 1;
        assert!(claims <= 10, "the action is never given up");
    }
    assert_eq!(claims, usize::try_from(MAX_ATTEMPTS).unwrap());
    let action = store.get(&user(), lease.action_id).await.unwrap().unwrap();
    assert_eq!(action.status, BulkActionStatus::Failed);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn creating_the_same_action_twice_creates_it_once(pool: Pool<Postgres>) {
    let store = PgBulkActions::new(pool.clone());
    let new = NewBulkAction {
        id: Uuid::now_v7(),
        user_id: user(),
        scope: json!({ "kinds": ["task"] }),
    };
    assert!(matches!(
        store.create(new.clone()).await.unwrap(),
        CreatedBulkAction::Created(..)
    ));
    assert!(matches!(
        store.create(new.clone()).await.unwrap(),
        CreatedBulkAction::Existing(_)
    ));
    let other_scope = NewBulkAction {
        scope: json!({ "kinds": ["email"] }),
        ..new.clone()
    };
    assert!(matches!(
        store.create(other_scope).await.unwrap(),
        CreatedBulkAction::Conflict
    ));
    let other_user = NewBulkAction {
        user_id: MacroUserIdStr::try_from_email("other@example.com").unwrap(),
        ..new
    };
    assert!(matches!(
        store.create(other_user).await.unwrap(),
        CreatedBulkAction::Conflict
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn finished_actions_are_purged_with_their_ledgers(pool: Pool<Postgres>) {
    let store = PgBulkActions::new(pool.clone());
    let id = notification(&pool, NotificationState::Unseen, 60.0).await;
    let (_, lease) = create(&store, json!({})).await;
    committed(store.apply_chunk(&lease, chunk(&[id], true)).await.unwrap());
    let (_, running) = create(&store, json!({})).await;

    let deleted = store
        .purge_finished(Utc::now() + chrono::Duration::seconds(5), 10)
        .await
        .unwrap();
    assert_eq!(deleted, 1);
    assert!(store.get(&user(), lease.action_id).await.unwrap().is_none());
    assert!(
        store
            .get(&user(), running.action_id)
            .await
            .unwrap()
            .is_some()
    );
    let ledger =
        sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM notification_bulk_action_item"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(ledger, 0);
}
