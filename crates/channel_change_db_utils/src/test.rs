use super::*;
use chrono::{Duration, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rollback_keeps_counter_and_log_atomic(pool: PgPool) {
    let channel = Uuid::from_u128(1);
    let message = Uuid::from_u128(2);
    let mut tx = pool.begin().await.unwrap();
    assert_eq!(
        append_in(&mut tx, channel, Change::Message(message))
            .await
            .unwrap(),
        1
    );
    assert_eq!(current_seq(&pool, channel).await.unwrap(), 0);
    tx.rollback().await.unwrap();
    assert_eq!(current_seq(&pool, channel).await.unwrap(), 0);

    let mut tx = pool.begin().await.unwrap();
    assert_eq!(
        append_in(&mut tx, channel, Change::Message(message))
            .await
            .unwrap(),
        1
    );
    tx.commit().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    let log = read_log(&mut tx, channel, 0, 1000, 200).await.unwrap();
    assert_eq!(log.counter, 1);
    assert_eq!(log.floor, 0);
    assert_eq!(
        log.rows,
        vec![LogRow {
            seq: 1,
            kind: 1,
            message_id: Some(message),
            activity_id: None,
        }]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn activity_batch_preserves_each_channels_input_order(pool: PgPool) {
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);
    let activities = [
        Uuid::from_u128(10),
        Uuid::from_u128(11),
        Uuid::from_u128(12),
        Uuid::from_u128(13),
    ];
    let mut tx = pool.begin().await.unwrap();
    let receipts = append_activities_in(&mut tx, &[second, first, second, first], &activities)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(receipts.len(), 4);
    let positions: std::collections::BTreeMap<_, _> = receipts
        .into_iter()
        .map(|receipt| (receipt.activity_id, receipt.seq))
        .collect();
    assert_eq!(
        positions,
        std::collections::BTreeMap::from([
            (activities[1], 1),
            (activities[3], 2),
            (activities[0], 1),
            (activities[2], 2),
        ])
    );
    assert_eq!(current_seq(&pool, first).await.unwrap(), 2);
    assert_eq!(current_seq(&pool, second).await.unwrap(), 2);

    let mut tx = pool.begin().await.unwrap();
    let replay = append_activities_in(&mut tx, &[first], &activities[1..2])
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(
        replay,
        vec![ActivitySequence {
            activity_id: activities[1],
            seq: 3
        }]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bounded_reads_and_pruning_preserve_the_resume_floor(pool: PgPool) {
    let channel = Uuid::from_u128(1);
    for change in [
        Change::Message(Uuid::from_u128(2)),
        Change::Activity(Uuid::from_u128(3)),
        Change::Reset,
    ] {
        let mut tx = pool.begin().await.unwrap();
        append_in(&mut tx, channel, change).await.unwrap();
        tx.commit().await.unwrap();
    }
    let mut tx = pool.begin().await.unwrap();
    let page = read_log(&mut tx, channel, 0, 1000, 2).await.unwrap();
    assert_eq!(page.counter, 3);
    assert_eq!(page.rows.len(), 2);
    assert_eq!(
        page.rows[1],
        LogRow {
            seq: 2,
            kind: 2,
            message_id: None,
            activity_id: Some(Uuid::from_u128(3))
        }
    );
    let lagged = read_log(&mut tx, channel, 0, 2, 200).await.unwrap();
    assert!(lagged.rows.is_empty());
    let reset = read_log(&mut tx, channel, 2, 1000, 200).await.unwrap();
    assert_eq!(
        reset.rows,
        vec![LogRow {
            seq: 3,
            kind: 3,
            message_id: None,
            activity_id: None
        }]
    );
    tx.commit().await.unwrap();

    let now = Utc::now();
    sqlx::query!(
        "UPDATE channel_change_log SET created_at = $2 WHERE channel_id = $1 AND seq <= 2",
        channel,
        now - Duration::days(31)
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut tx = pool.begin().await.unwrap();
    assert_eq!(
        prune_in(&mut tx, now - Duration::days(30), 1)
            .await
            .unwrap(),
        1
    );
    tx.commit().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    assert_eq!(
        read_log(&mut tx, channel, 0, 1000, 200)
            .await
            .unwrap()
            .floor,
        1
    );
    assert_eq!(
        prune_in(&mut tx, now + Duration::days(1), 200)
            .await
            .unwrap(),
        2
    );
    tx.commit().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    let empty = read_log(&mut tx, channel, 3, 1000, 200).await.unwrap();
    assert_eq!((empty.counter, empty.floor), (3, 3));
    assert!(empty.rows.is_empty());
    assert_eq!(current_seq(&pool, channel).await.unwrap(), 3);
}
