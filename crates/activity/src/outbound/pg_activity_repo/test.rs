use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::models::{Action, Actor, CommonAction};

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn nz(limit: u32) -> NonZeroU32 {
    NonZeroU32::new(limit).expect("non-zero test limit")
}

fn seed(source_event: u128, action: CommonAction, entity_id: &str) -> Activity {
    Activity::common(
        Uuid::from_u128(source_event),
        0,
        Actor::new_from_user(user("macro|actor@example.com")),
        None,
        model_entity::EntityType::Document,
        entity_id,
        action,
        Utc::now(),
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn inserts_activities_with_split_action_columns(pool: PgPool) {
    let repo = PgActivityRepo::new(pool.clone());

    repo.insert_activities(&[seed(1, CommonAction::Opened, "doc-1")])
        .await
        .unwrap();

    let row = sqlx::query!(
        r#"
        SELECT actor_id, subject_id, action, action_payload, entity_type, entity_id
        FROM activity_events
        "#
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.actor_id, "macro|actor@example.com");
    assert_eq!(row.subject_id, "macro|actor@example.com");
    assert_eq!(row.action, "opened");
    assert_eq!(row.action_payload, None);
    assert_eq!(row.entity_type, "document");
    assert_eq!(row.entity_id, "doc-1");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replayed_activities_are_absorbed_by_the_id_conflict(pool: PgPool) {
    let repo = PgActivityRepo::new(pool.clone());
    let seed_activity = seed(2, CommonAction::Edited, "doc-2");

    repo.insert_activities(std::slice::from_ref(&seed_activity))
        .await
        .unwrap();
    repo.insert_activities(std::slice::from_ref(&seed_activity))
        .await
        .unwrap();

    let count = sqlx::query_scalar!(r#"SELECT COUNT(*) FROM activity_events"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, Some(1));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn purge_removes_only_that_entitys_activities(pool: PgPool) {
    let repo = PgActivityRepo::new(pool.clone());
    repo.insert_activities(&[
        seed(3, CommonAction::Created, "doc-purged"),
        seed(4, CommonAction::Opened, "doc-purged"),
        seed(5, CommonAction::Created, "doc-kept"),
    ])
    .await
    .unwrap();

    repo.purge_entities(&[(model_entity::EntityType::Document, "doc-purged".to_string())])
        .await
        .unwrap();

    let remaining = sqlx::query_scalar!(r#"SELECT entity_id FROM activity_events"#)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, vec!["doc-kept".to_string()]);
}

fn seed_at(
    source_event: u128,
    action: CommonAction,
    entity_id: &str,
    occurred_at: chrono::DateTime<Utc>,
) -> Activity {
    Activity::common(
        Uuid::from_u128(source_event),
        0,
        Actor::new_from_user(user("macro|actor@example.com")),
        None,
        model_entity::EntityType::Document,
        entity_id,
        action,
        occurred_at,
    )
}

fn base_time() -> chrono::DateTime<Utc> {
    chrono::DateTime::parse_from_rfc3339("2026-08-01T00:00:00Z")
        .unwrap()
        .with_timezone(&Utc)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn subject_feed_pages_by_keyset_newest_first(pool: PgPool) {
    let repo = PgActivityRepo::new(pool.clone());
    let t = base_time();
    let seeded: Vec<Activity> = (0..5u32)
        .map(|i| {
            seed_at(
                u128::from(10 + i),
                CommonAction::Edited,
                &format!("doc-{i}"),
                t + chrono::Duration::seconds(i64::from(i)),
            )
        })
        .collect();
    repo.insert_activities(&seeded).await.unwrap();

    let first = repo
        .subject_feed("macro|actor@example.com", None, nz(2))
        .await
        .unwrap();
    assert_eq!(first.records.len(), 2);
    assert_eq!(first.records[0].entity_id, "doc-4");
    assert_eq!(first.records[1].entity_id, "doc-3");
    assert_eq!(
        first.records[0].action,
        RecordedAction::Known(Action::Edited)
    );

    let second = repo
        .subject_feed("macro|actor@example.com", first.next, nz(2))
        .await
        .unwrap();
    assert_eq!(second.records.len(), 2);
    assert_eq!(second.records[0].entity_id, "doc-2");
    assert_eq!(second.records[1].entity_id, "doc-1");

    let last = repo
        .subject_feed("macro|actor@example.com", second.next, nz(2))
        .await
        .unwrap();
    assert_eq!(last.records.len(), 1);
    assert_eq!(last.records[0].entity_id, "doc-0");
    assert_eq!(last.next, None, "exhausted feed carries no cursor");

    let other = repo
        .subject_feed("macro|someone-else@example.com", None, nz(10))
        .await
        .unwrap();
    assert!(other.records.is_empty());
    assert_eq!(other.next, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn subject_feed_breaks_timestamp_ties_by_id(pool: PgPool) {
    let repo = PgActivityRepo::new(pool.clone());
    let t = base_time();
    // Same occurred_at on every row: order must fall back to id DESC.
    let seeded: Vec<Activity> = (0..3u32)
        .map(|i| {
            seed_at(
                u128::from(20 + i),
                CommonAction::Edited,
                &format!("doc-{i}"),
                t,
            )
        })
        .collect();
    repo.insert_activities(&seeded).await.unwrap();

    let mut expected_ids: Vec<Uuid> = seeded.iter().map(|a| a.id).collect();
    expected_ids.sort();
    expected_ids.reverse();

    let first = repo
        .subject_feed("macro|actor@example.com", None, nz(2))
        .await
        .unwrap();
    let rest = repo
        .subject_feed("macro|actor@example.com", first.next, nz(2))
        .await
        .unwrap();

    let fetched_ids: Vec<Uuid> = first
        .records
        .iter()
        .chain(rest.records.iter())
        .map(|r| r.id)
        .collect();
    assert_eq!(fetched_ids, expected_ids);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn subject_activity_range_filters_half_open_interval_and_subject(pool: PgPool) {
    let repo = PgActivityRepo::new(pool.clone());
    let from = base_time();
    let to = from + chrono::Duration::seconds(3);
    repo.insert_activities(&[
        seed_at(
            60,
            CommonAction::Edited,
            "before",
            from - chrono::Duration::seconds(1),
        ),
        seed_at(61, CommonAction::Created, "at-from", from),
        seed_at(
            62,
            CommonAction::Opened,
            "inside",
            from + chrono::Duration::seconds(2),
        ),
        seed_at(63, CommonAction::Deleted, "at-to", to),
        Activity::common(
            Uuid::from_u128(64),
            0,
            Actor::new_from_user(user("macro|someone-else@example.com")),
            None,
            model_entity::EntityType::Document,
            "other-subject",
            CommonAction::Edited,
            from + chrono::Duration::seconds(1),
        ),
    ])
    .await
    .unwrap();

    let range = repo
        .subject_activity_range("macro|actor@example.com", from, to, nz(10))
        .await
        .unwrap();

    let entity_ids: Vec<&str> = range
        .records
        .iter()
        .map(|record| record.entity_id.as_str())
        .collect();
    assert_eq!(entity_ids, vec!["inside", "at-from"]);
    assert!(!range.truncated);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn subject_activity_range_reports_truncation(pool: PgPool) {
    let repo = PgActivityRepo::new(pool.clone());
    let from = base_time();
    let activities: Vec<Activity> = (0..3u32)
        .map(|i| {
            seed_at(
                u128::from(70 + i),
                CommonAction::Edited,
                &format!("doc-{i}"),
                from + chrono::Duration::seconds(i64::from(i)),
            )
        })
        .collect();
    repo.insert_activities(&activities).await.unwrap();

    let range = repo
        .subject_activity_range(
            "macro|actor@example.com",
            from,
            from + chrono::Duration::seconds(10),
            nz(2),
        )
        .await
        .unwrap();

    assert_eq!(range.records.len(), 2);
    assert_eq!(range.records[0].entity_id, "doc-2");
    assert_eq!(range.records[1].entity_id, "doc-1");
    assert!(range.truncated);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn entity_activity_batches_with_a_per_entity_limit(pool: PgPool) {
    let repo = PgActivityRepo::new(pool.clone());
    let t = base_time();
    repo.insert_activities(&[
        seed_at(30, CommonAction::Created, "doc-a", t),
        seed_at(
            31,
            CommonAction::Edited,
            "doc-a",
            t + chrono::Duration::seconds(1),
        ),
        seed_at(
            32,
            CommonAction::Edited,
            "doc-a",
            t + chrono::Duration::seconds(2),
        ),
        seed_at(33, CommonAction::Created, "doc-b", t),
    ])
    .await
    .unwrap();

    let keys = vec![
        (model_entity::EntityType::Document, "doc-a".to_string()),
        (model_entity::EntityType::Document, "doc-b".to_string()),
        (
            model_entity::EntityType::Document,
            "doc-untouched".to_string(),
        ),
        // Repeated on purpose: duplicates must not stack extra rows.
        (model_entity::EntityType::Document, "doc-a".to_string()),
    ];
    let by_entity = repo.entity_activity(&keys, 2).await.unwrap();

    let doc_a = &by_entity[&keys[0]];
    assert_eq!(doc_a.len(), 2, "limit caps per entity, duplicates deduped");
    assert_eq!(doc_a[0].action, RecordedAction::Known(Action::Edited));
    assert!(doc_a[0].occurred_at > doc_a[1].occurred_at, "newest first");

    assert_eq!(by_entity[&keys[1]].len(), 1);
    assert!(
        !by_entity.contains_key(&keys[2]),
        "entities with no activity are absent"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rows_written_by_a_newer_vocabulary_read_as_unknown(pool: PgPool) {
    let repo = PgActivityRepo::new(pool.clone());
    sqlx::query!(
        r#"
        INSERT INTO activity_events
            (id, actor_id, subject_id, action, action_payload,
             entity_type, entity_id, occurred_at)
        VALUES ($1, 'macro|actor@example.com', 'macro|actor@example.com',
                'transmogrified', '{"into": "a newt"}',
                'document', 'doc-new', $2)
        "#,
        Uuid::from_u128(40),
        base_time(),
    )
    .execute(&pool)
    .await
    .unwrap();

    let feed = repo
        .subject_feed("macro|actor@example.com", None, nz(10))
        .await
        .unwrap();
    assert_eq!(feed.records.len(), 1);
    assert_eq!(
        feed.records[0].action,
        RecordedAction::Unknown {
            tag: "transmogrified".to_string(),
            payload: Some(serde_json::json!({ "into": "a newt" })),
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn corrupt_rows_are_skipped_not_page_failures(pool: PgPool) {
    let repo = PgActivityRepo::new(pool.clone());
    // An actor without a recognizable principal prefix is unrepresentable in
    // the model; the row is dropped from the page rather than failing it.
    sqlx::query!(
        r#"
        INSERT INTO activity_events
            (id, actor_id, subject_id, action, action_payload,
             entity_type, entity_id, occurred_at)
        VALUES ($1, 'garbled', 'macro|actor@example.com', 'edited', NULL,
                'document', 'doc-corrupt', $2)
        "#,
        Uuid::from_u128(41),
        base_time(),
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.insert_activities(&[seed_at(
        42,
        CommonAction::Edited,
        "doc-fine",
        base_time() + chrono::Duration::seconds(1),
    )])
    .await
    .unwrap();

    let feed = repo
        .subject_feed("macro|actor@example.com", None, nz(10))
        .await
        .unwrap();
    assert_eq!(feed.records.len(), 1);
    assert_eq!(feed.records[0].entity_id, "doc-fine");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_corrupt_row_shrinks_the_page_but_never_ends_pagination(pool: PgPool) {
    let repo = PgActivityRepo::new(pool.clone());
    let t = base_time();
    // Newest-first raw order: doc-new (2s), corrupt (1s), doc-old (0s).
    // With limit 2 the corrupt row sits inside the first raw page.
    repo.insert_activities(&[
        seed_at(50, CommonAction::Edited, "doc-old", t),
        seed_at(
            51,
            CommonAction::Edited,
            "doc-new",
            t + chrono::Duration::seconds(2),
        ),
    ])
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO activity_events
            (id, actor_id, subject_id, action, action_payload,
             entity_type, entity_id, occurred_at)
        VALUES ($1, 'garbled', 'macro|actor@example.com', 'edited', NULL,
                'document', 'doc-corrupt', $2)
        "#,
        Uuid::from_u128(52),
        t + chrono::Duration::seconds(1),
    )
    .execute(&pool)
    .await
    .unwrap();

    let first = repo
        .subject_feed("macro|actor@example.com", None, nz(2))
        .await
        .unwrap();
    assert_eq!(first.records.len(), 1, "the corrupt row shrinks the page");
    assert_eq!(first.records[0].entity_id, "doc-new");
    let next = first.next.expect("a skipped row must not end pagination");

    let second = repo
        .subject_feed("macro|actor@example.com", Some(next), nz(2))
        .await
        .unwrap();
    assert_eq!(second.records.len(), 1);
    assert_eq!(second.records[0].entity_id, "doc-old");
    assert_eq!(second.next, None);
}
