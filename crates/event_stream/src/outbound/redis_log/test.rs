//! Against a real Redis (`REDIS_URL`, default `redis://127.0.0.1:6379`), on
//! a stream key unique to each test.

use super::*;
use crate::domain::models::Invalidation;
use event_exposure::EntityType;
use redis::AsyncCommands as _;

fn client() -> redis::Client {
    let url = macro_env_var::maybe_read_env("REDIS_URL")
        .unwrap_or_else(|| "redis://127.0.0.1:6379".to_owned());
    redis::Client::open(url).expect("valid Redis URL")
}

/// A log on its own key, deleted when dropped.
struct TestLog(RedisEventLog);

impl TestLog {
    fn new() -> Self {
        Self(RedisEventLog::at(
            client(),
            format!("test:events:{}", uuid::Uuid::new_v4()),
        ))
    }
}

impl Drop for TestLog {
    fn drop(&mut self) {
        if let Ok(mut connection) = self.0.client.get_connection() {
            let _: Result<(), _> = redis::Commands::del(&mut connection, &self.0.stream);
            let _: Result<(), _> = redis::Commands::del(&mut connection, floor_key(&self.0.stream));
        }
    }
}

fn record(entity_id: &str) -> LogRecord {
    LogRecord {
        event: None,
        invalidations: vec![Invalidation::Entity {
            entity_type: EntityType::Channel,
            entity_id: entity_id.to_owned(),
        }],
    }
}

#[tokio::test]
async fn reads_after_a_cursor_return_later_records_in_order() {
    let log = TestLog::new();
    let first = log.0.append(&record("a")).await.unwrap();
    let second = log.0.append(&record("b")).await.unwrap();
    let third = log.0.append(&record("c")).await.unwrap();

    let page = log.0.read_after(first, 10).await.unwrap();

    let cursors: Vec<Cursor> = page.entries.iter().map(|entry| entry.cursor).collect();
    assert_eq!(cursors, vec![second, third]);
    assert_eq!(page.entries[0].record, record("b"));
    assert_eq!((page.last, page.full), (Some(third), false));
    let first_page = log.0.read_after(first, 1).await.unwrap();
    assert_eq!((first_page.entries.len(), first_page.full), (1, true));
}

#[tokio::test]
async fn a_tail_returns_entries_strictly_after_its_last_one() {
    let log = TestLog::new();
    let before = log.0.append(&record("before")).await.unwrap();
    let after = log.0.append(&record("after")).await.unwrap();
    let mut tail = log.0.tail();
    tail.last = Some(before);

    match tail.next().await.unwrap() {
        TailItem::Entry(entry) => {
            assert_eq!(entry.cursor, after);
            assert_eq!(entry.record, record("after"));
        }
        TailItem::Gap => panic!("unexpected gap"),
    }
}

#[tokio::test]
async fn the_floor_follows_retention_and_the_length_cap() {
    let log = TestLog::new();
    let now = now_ms();

    let floor = log.0.retained_floor().await.unwrap();
    assert!(floor <= retention_floor(now_ms()));
    assert!(floor >= retention_floor(now));

    let mut connection = log.0.connection().await.unwrap();
    let trimmed_to = Cursor {
        ms: now - 1_000,
        seq: 0,
    };
    let _: () = connection
        .set(floor_key(&log.0.stream), trimmed_to.to_string())
        .await
        .unwrap();
    assert_eq!(log.0.retained_floor().await.unwrap(), trimmed_to);
}

#[tokio::test]
async fn a_tail_that_reconnects_behind_the_floor_reports_a_gap() {
    let log = TestLog::new();
    let mut tail = log.0.tail();
    tail.last = Some(Cursor { ms: 1, seq: 0 });

    assert!(matches!(tail.next().await.unwrap(), TailItem::Gap));
}

#[tokio::test]
async fn an_unreadable_entry_does_not_end_a_page_early() {
    let log = TestLog::new();
    let start = log.0.append(&record("start")).await.unwrap();
    let mut connection = log.0.connection().await.unwrap();
    let unreadable: String = connection
        .xadd(
            &log.0.stream,
            "*",
            &[(field::VERSION, "99"), (field::RECORD, "{}")],
        )
        .await
        .unwrap();

    let page = log.0.read_after(start, 1).await.unwrap();

    assert!(page.entries.is_empty());
    assert_eq!(page.last, Some(unreadable.parse().unwrap()));
    assert!(page.full);
}

#[tokio::test]
async fn the_length_floor_never_moves_backwards() {
    let log = TestLog::new();
    let mut connection = log.0.connection().await.unwrap();
    let _: () = connection
        .set(floor_key(&log.0.stream), "9999999999999-0")
        .await
        .unwrap();
    log.0.append(&record("a")).await.unwrap();

    log.0.raise_length_floor(&mut connection).await.unwrap();

    let floor: String = connection.get(floor_key(&log.0.stream)).await.unwrap();
    assert_eq!(floor, "9999999999999-0");
}
