//! Against a real Redis (`REDIS_URL`, default `redis://127.0.0.1:6379`), on
//! a stream key unique to each test.

use super::*;
use crate::domain::models::Invalidation;
use event_exposure::EntityType;
use redis::AsyncCommands as _;

fn client() -> redis::Client {
    let url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
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

    let entries = log.0.read_after(first, 10).await.unwrap();

    let cursors: Vec<Cursor> = entries.iter().map(|entry| entry.cursor).collect();
    assert_eq!(cursors, vec![second, third]);
    assert_eq!(entries[0].record, record("b"));
    assert_eq!(log.0.read_after(first, 1).await.unwrap().len(), 1);
}

#[tokio::test]
async fn a_tail_starts_at_the_end_and_returns_what_is_appended_after() {
    let log = TestLog::new();
    log.0.append(&record("before")).await.unwrap();
    let mut tail = log.0.tail();

    let next = tokio::spawn(async move { tail.next().await });
    // The first read blocks at `$`; append once it is waiting. Appending in
    // a loop until the tail returns covers the race without sleeping.
    let mut appended = Vec::new();
    while !next.is_finished() {
        appended.push(log.0.append(&record("after")).await.unwrap());
        tokio::task::yield_now().await;
        if appended.len() > 1_000 {
            break;
        }
    }

    match next.await.unwrap().unwrap() {
        TailItem::Entry(entry) => {
            assert_eq!(entry.record, record("after"));
            assert!(appended.contains(&entry.cursor));
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
