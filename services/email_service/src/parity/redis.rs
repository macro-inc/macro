use redis::AsyncCommands;
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub(super) async fn snapshot(
    connection: &mut redis::aio::MultiplexedConnection,
    scopes: &[String],
) -> BTreeMap<String, Value> {
    let keys: Vec<String> = connection.keys("*").await.expect("private Redis keys");
    let mut state = BTreeMap::new();
    for key in keys {
        // The private instance is shared by parallel scenarios. Each scenario
        // observes only its fixture's keys, including token cache identity.
        if !scopes.iter().any(|scope| key.contains(scope)) {
            continue;
        }
        let kind: String = redis::cmd("TYPE")
            .arg(&key)
            .query_async(connection)
            .await
            .expect("Redis type");
        let value = match kind.as_str() {
            "string" => json!(
                connection
                    .get::<_, Option<String>>(&key)
                    .await
                    .expect("Redis string")
            ),
            "zset" => json!(
                connection
                    .zrange_withscores::<_, Vec<(String, f64)>>(&key, 0, -1)
                    .await
                    .expect("Redis sorted set")
            ),
            "set" => {
                let mut members: Vec<String> = connection.smembers(&key).await.expect("Redis set");
                members.sort();
                json!(members)
            }
            "hash" => json!(
                connection
                    .hgetall::<_, BTreeMap<String, String>>(&key)
                    .await
                    .expect("Redis hash")
            ),
            other => json!({"type": other}),
        };
        state.insert(key, value);
    }
    state
}

pub(super) fn changes(before: BTreeMap<String, Value>, after: BTreeMap<String, Value>) -> Value {
    let mut changes = BTreeMap::new();
    for key in before.keys().chain(after.keys()) {
        if before.get(key) != after.get(key) {
            changes.insert(
                key,
                json!({"before": before.get(key), "after": after.get(key)}),
            );
        }
    }
    json!(changes)
}
