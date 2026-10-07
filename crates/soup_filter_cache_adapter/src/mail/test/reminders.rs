use super::*;

const RETURNED: &str = "2025-02-01T00:00:00.123456Z";
const LATER: &str = "2025-02-02T00:00:00Z";
const PATCH: &str = r#"query ReminderUpdate { user { id soup(input:{initial:{limit:1}}) { items { __typename id ... on GraphqlSoupEmailThread { reminderReturnedAt latestInboundMessageTs } } } } }"#;

async fn inbox<S: PredicateIndexStorage>(engine: &mut Engine<S>) -> (Vec<String>, Vec<String>) {
    let PageResult::MailPage {
        keys,
        sort_timestamps,
        ..
    } = read(engine, filters(), "INBOX", None).await
    else {
        panic!("cached inbox page")
    };
    (keys, sort_timestamps)
}

async fn reminder_returns<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    let mut older = row(4);
    older["reminderReturnedAt"] = json!(RETURNED);
    let mut recent = row(6);
    recent["latestInboundMessageTs"] = json!(LATER);
    let mut sent_only = row(2);
    sent_only["reminderReturnedAt"] = json!(RETURNED);
    let mut data = seed();
    data["user"]["soup"]["items"] = json!([older, recent, sent_only]);
    write(&mut engine, QUERY, &data).await;

    let (keys, timestamps) = inbox(&mut engine).await;
    assert_eq!(
        keys,
        [6, 4, 2].map(|n| format!("{TYPE}:{}", id(n))),
        "newer inbound mail wins; older and sent-only threads sort by their return time"
    );
    assert_eq!(micros(&timestamps[0]), micros(LATER));
    assert_eq!(micros(&timestamps[1]), micros(RETURNED));
    assert_eq!(micros(&timestamps[2]), micros(RETURNED));

    let all_before = all_keys(&mut engine, filters(), "ALL").await;
    let sent_before = all_keys(&mut engine, filters(), "SENT").await;
    // A partial update must recompute the effective timestamp from both facts,
    // including the inbound timestamp that was already cached.
    let cleared = json!({"user":{"id":VIEWER,"soup":{"items":[{
        "__typename":TYPE,"id":id(4),"reminderReturnedAt":null
    }]}}});
    write(&mut engine, PATCH, &cleared).await;
    let (keys, timestamps) = inbox(&mut engine).await;
    assert_eq!(keys, [6, 2, 4].map(|n| format!("{TYPE}:{}", id(n))));
    assert_eq!(
        micros(&timestamps[2]),
        micros("2025-01-02T00:00:00.000002Z")
    );
    assert_eq!(all_keys(&mut engine, filters(), "ALL").await, all_before);
    assert_eq!(all_keys(&mut engine, filters(), "SENT").await, sent_before);

    let delivered = json!({"user":{"id":VIEWER,"soup":{"items":[{
        "__typename":TYPE,"id":id(4),"reminderReturnedAt":"2025-03-01T00:00:00Z"
    }]}}});
    write(&mut engine, PATCH, &delivered).await;
    let (keys, _) = inbox(&mut engine).await;
    assert_eq!(keys[0], format!("{TYPE}:{}", id(4)));

    let inbound_cleared = json!({"user":{"id":VIEWER,"soup":{"items":[{
        "__typename":TYPE,"id":id(4),"latestInboundMessageTs":null
    }]}}});
    write(&mut engine, PATCH, &inbound_cleared).await;
    let (keys, timestamps) = inbox(&mut engine).await;
    assert_eq!(keys[0], format!("{TYPE}:{}", id(4)));
    assert_eq!(micros(&timestamps[0]), micros("2025-03-01T00:00:00Z"));

    // Removing the last effective timestamp must not leave a stale sort fact.
    let cleared = json!({"user":{"id":VIEWER,"soup":{"items":[{
        "__typename":TYPE,"id":id(2),"reminderReturnedAt":null
    }]}}});
    write(&mut engine, PATCH, &cleared).await;
    let mut engine = Engine::new(engine.into_storage());
    let (keys, _) = inbox(&mut engine).await;
    assert_eq!(keys, [4, 6].map(|n| format!("{TYPE}:{}", id(n))));
}

#[test]
fn memory_reminder_returns() {
    pollster::block_on(reminder_returns(InMemoryStorage::new()));
}

#[test]
fn turso_reminder_returns() {
    pollster::block_on(reminder_returns(
        cache_turso::TursoStorage::open_in_memory("mail-reminder-returns").unwrap(),
    ));
}
