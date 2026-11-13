use super::*;
use activity::{Action, Actor, CommonAction, DomainActivity, EntityType};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

struct TimelineFact {
    entity_id: String,
    action: Action,
}

impl DomainActivity for TimelineFact {
    const ENTITY_TYPE: EntityType = EntityType::Channel;

    fn entity_id(&self) -> &str {
        &self.entity_id
    }

    fn into_action(self) -> Action {
        self.action
    }
}

fn picture(channel: Uuid) -> Activity {
    Activity::from_domain(
        Uuid::now_v7(),
        0,
        Actor::new_from_user(
            "macro|activity-test@example.com"
                .to_owned()
                .try_into()
                .unwrap(),
        ),
        None,
        TimelineFact {
            entity_id: channel.to_string(),
            action: Action::PictureChanged,
        },
        chrono::Utc::now(),
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replay_recovers_an_activity_inserted_without_its_change_log(pool: PgPool) {
    let channel = Uuid::now_v7();
    let row = picture(channel);
    let activity = PgActivityRepo::new(pool.clone());
    activity
        .insert_activities(std::slice::from_ref(&row))
        .await
        .unwrap();

    let repo = PgChannelActivityRepo::new(pool.clone());
    let first = repo
        .insert_activities(std::slice::from_ref(&row))
        .await
        .unwrap();
    let replay = repo
        .insert_activities(std::slice::from_ref(&row))
        .await
        .unwrap();
    assert_eq!(
        first,
        vec![ActivityReceipt {
            activity_id: row.id,
            seq: Some(1)
        }]
    );
    assert_eq!(
        replay,
        vec![ActivityReceipt {
            activity_id: row.id,
            seq: Some(2)
        }]
    );
    let stored = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM activity_events WHERE id = $1"#,
        row.id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored, 1);
    let logged = sqlx::query_scalar!(
        r#"SELECT seq FROM channel_change_log WHERE channel_id = $1 AND activity_id = $2 ORDER BY seq"#,
        channel,
        row.id,
    ).fetch_all(&pool).await.unwrap();
    assert_eq!(logged, vec![1, 2]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_log_append_rolls_back_the_activity_insert(pool: PgPool) {
    let channel = Uuid::now_v7();
    let row = picture(channel);
    sqlx::query!(
        "INSERT INTO channel_change_counters (channel_id, seq) VALUES ($1, $2)",
        channel,
        i64::MAX,
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgChannelActivityRepo::new(pool.clone());
    assert!(
        repo.insert_activities(std::slice::from_ref(&row))
            .await
            .is_err()
    );
    let stored = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM activity_events WHERE id = $1) AS "exists!""#,
        row.id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!stored);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn activity_batches_allocate_each_channels_consecutive_positions(pool: PgPool) {
    let (first, second) = (Uuid::now_v7(), Uuid::now_v7());
    let rows = vec![
        picture(second),
        picture(first),
        picture(second),
        picture(first),
    ];
    let receipts = PgChannelActivityRepo::new(pool.clone())
        .insert_activities(&rows)
        .await
        .unwrap();
    let sequences: std::collections::HashMap<_, _> = receipts
        .into_iter()
        .map(|receipt| (receipt.activity_id, receipt.seq))
        .collect();
    assert_eq!(sequences[&rows[0].id], Some(1));
    assert_eq!(sequences[&rows[1].id], Some(1));
    assert_eq!(sequences[&rows[2].id], Some(2));
    assert_eq!(sequences[&rows[3].id], Some(2));
    for channel in [first, second] {
        let logged = sqlx::query!(
            "SELECT seq, created_at FROM channel_change_log WHERE channel_id = $1 ORDER BY seq",
            channel,
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(
            logged
                .windows(2)
                .all(|pair| pair[0].created_at <= pair[1].created_at)
        );
        let cutoff = logged[1].created_at;
        let before: Vec<_> = logged
            .iter()
            .filter(|row| row.created_at < cutoff)
            .collect();
        let retained: Vec<_> = logged
            .iter()
            .filter(|row| row.created_at >= cutoff)
            .collect();
        assert!(
            before
                .iter()
                .all(|old| retained.iter().all(|new| old.seq < new.seq))
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn opposing_activity_batches_lock_channel_counters_in_the_same_order(pool: PgPool) {
    let (first, second) = (Uuid::now_v7(), Uuid::now_v7());
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(16));
    let mut tasks = tokio::task::JoinSet::new();
    for index in 0..16 {
        let repo = PgChannelActivityRepo::new(pool.clone());
        let barrier = barrier.clone();
        tasks.spawn(async move {
            let channels = if index % 2 == 0 {
                [first, second]
            } else {
                [second, first]
            };
            let rows = channels.map(picture);
            barrier.wait().await;
            repo.insert_activities(&rows).await.unwrap()
        });
    }
    let mut receipts = Vec::new();
    while let Some(batch) = tasks.join_next().await {
        receipts.extend(batch.unwrap());
    }
    assert_eq!(receipts.len(), 32);
    for channel in [first, second] {
        let seqs = sqlx::query_scalar!(
            "SELECT seq FROM channel_change_log WHERE channel_id = $1 ORDER BY seq",
            channel,
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(seqs, (1..=16).collect::<Vec<_>>());
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn activity_outside_the_channel_timeline_does_not_take_a_sequence(pool: PgPool) {
    let row = Activity::common(
        Uuid::now_v7(),
        0,
        Actor::new_from_user(
            "macro|activity-test@example.com"
                .to_owned()
                .try_into()
                .unwrap(),
        ),
        None,
        EntityType::Channel,
        Uuid::now_v7().to_string(),
        CommonAction::Edited,
        chrono::Utc::now(),
    );
    let receipts = PgChannelActivityRepo::new(pool.clone())
        .insert_activities(&[row])
        .await
        .unwrap();
    assert!(receipts.is_empty());
    let count = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM channel_change_log"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}
