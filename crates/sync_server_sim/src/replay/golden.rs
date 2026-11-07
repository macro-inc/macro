//! Exact boundary projection for extracted callbacks; unknown raw operations fail closed.
use super::*;
use crate::{ports::*, transcript::*};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use macro_sync_service_jwt::session::SessionKind;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use sync_server_core::domain::{
    permissions::{AccessLevel, AuthToken},
    types::SessionKey,
};

fn invalid(message: impl Into<String>) -> ReplayError {
    ReplayError::Invalid(message.into())
}
fn decode(value: &Value) -> Result<Vec<u8>, ReplayError> {
    STANDARD
        .decode(value.as_str().ok_or_else(|| invalid("missing base64"))?)
        .map_err(|e| invalid(e.to_string()))
}
fn effect(operation: &str, value: Value) -> Effect {
    Effect {
        operation: operation.into(),
        value,
    }
}
fn grant(query: &str) -> Result<AuthToken, ReplayError> {
    let token = query
        .strip_prefix("?token=")
        .ok_or_else(|| invalid("expected local test token"))?;
    let payload = token
        .split('.')
        .nth(1)
        .ok_or_else(|| invalid("invalid JWT"))?;
    let claims: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|e| invalid(e.to_string()))?,
    )
    .map_err(|e| invalid(e.to_string()))?;
    Ok(AuthToken::new(
        claims["document_id"]
            .as_str()
            .ok_or_else(|| invalid("missing document grant"))?
            .into(),
        serde_json::from_value::<AccessLevel>(claims["access_level"].clone())
            .map_err(|e| invalid(e.to_string()))?,
        SessionKind::Document,
        claims["user_id"].as_str().map(str::to_owned),
        claims["actor"].as_str().map(str::to_owned),
        None,
        None,
    ))
}
fn socket(value: &Value) -> Result<sync_server_core::domain::socket::WebSocketId, ReplayError> {
    sync_server_core::domain::socket::WebSocketId::from_tags(&[value
        .as_str()
        .ok_or_else(|| invalid("missing socket"))?
        .into()])
    .map_err(|e| invalid(e.to_string()))
}
fn projected(records: &[&Value], key: &str) -> Result<Vec<Effect>, ReplayError> {
    let mut result = Vec::new();
    for (index, record) in records.iter().enumerate() {
        let args = &record["args"];
        if let Some(port) = record["port"].as_str() {
            let next = match port {
                "storage.get" => effect("storage.get", args[0].clone()),
                "storage.put" => effect("storage.put", json!({"key":args[0],"value":args[1]})),
                "storage.delete" => effect("storage.delete", args[0].clone()),
                "storage.list" if args[0] == json!({"prefix":"o/"}) => {
                    effect("storage.list", json!("o/"))
                }
                "connections.list" => effect("connections.all", record["ws_ids"].clone()),
                "connections.tags" => effect(
                    "connections.id",
                    json!({"socket":record["tags"][0],"tags":record["tags"]}),
                ),
                "wait_until" => effect("background.schedule", Value::Null),
                "sql.exec" => {
                    let sql = args[0]
                        .as_str()
                        .ok_or_else(|| invalid("SQL text missing"))?;
                    if sql.starts_with("CREATE TABLE IF NOT EXISTS kv_store (") {
                        continue;
                    }
                    if sql == "SELECT 1 FROM kv_store WHERE id = ?1 LIMIT 1" {
                        effect("snapshot.get", args[1].clone())
                    } else if sql == "DELETE FROM kv_store WHERE id = ?1" {
                        let insert = records
                            .get(index + 1)
                            .ok_or_else(|| invalid("snapshot write missing chunk"))?;
                        if insert["args"][0]
                            != "INSERT INTO kv_store (id, chunk, data) VALUES (?1, ?2, ?3)"
                            || insert["args"][1] != args[1]
                            || insert["args"][2] != 0
                        {
                            return Err(invalid("unexpected snapshot write"));
                        }
                        effect(
                            "snapshot.put",
                            json!({"key":args[1],"bytes":decode(&insert["args"][3]["bytes_b64"])?}),
                        )
                    } else if sql == "INSERT INTO kv_store (id, chunk, data) VALUES (?1, ?2, ?3)" {
                        let previous = records
                            .get(index.wrapping_sub(1))
                            .ok_or_else(|| invalid("orphan snapshot chunk"))?;
                        if previous["args"][0] != "DELETE FROM kv_store WHERE id = ?1"
                            || previous["args"][1] != args[1]
                            || args[2] != 0
                        {
                            return Err(invalid("orphan snapshot chunk"));
                        }
                        continue;
                    } else {
                        return Err(ReplayError::Unsupported(format!("raw SQL: {sql}")));
                    }
                }
                "SNAPSHOT_STORE_KV.get" => {
                    if args != &json!([format!("{key}/{key}.snapshot"), {"type":"arrayBuffer"}]) {
                        return Err(invalid("unexpected snapshot fallback"));
                    }
                    continue;
                }
                other => return Err(ReplayError::Unsupported(format!("raw port {other}"))),
            };
            result.push(next);
        } else if let Some(out) = record["out"].as_str() {
            match out {
                "accept" => {
                    let id = record["ws_id"]
                        .as_str()
                        .ok_or_else(|| invalid("missing accepted tag"))?;
                    result.push(effect(
                        "entropy",
                        json!(
                            id.strip_prefix("ws_id")
                                .ok_or_else(|| invalid("invalid accepted tag"))?
                        ),
                    ));
                    result.push(effect("connections.accept", json!(id)));
                }
                "send" => {
                    let value =
                        json!({"socket":record["ws_id"],"frame":decode(&record["frame_b64"])?});
                    result.push(effect("connections.send_binary", value.clone()));
                    result.push(effect("send", value));
                }
                "send_text" => {
                    let value = json!({"socket":record["ws_id"],"text":record["text"]});
                    result.push(effect("connections.send_text", value.clone()));
                    result.push(effect("send_text", value));
                }
                "response" | "dump" => {}
                other => return Err(ReplayError::Unsupported(format!("raw output {other}"))),
            }
        }
    }
    Ok(result)
}
pub(super) fn replay(transcript: &Transcript) -> Result<Vec<Effect>, ReplayError> {
    let mut rooms: BTreeMap<String, SimRoom> = BTreeMap::new();
    let mut all = Vec::new();
    for recorded in transcript.inputs()? {
        if recorded.room.starts_with('@') {
            continue;
        }
        let room = rooms
            .entry(recorded.room.clone())
            .or_insert_with(|| SimRoom::new(SimPorts::new()));
        let callback = serde_json::json!(recorded.callback);
        let raw = transcript
            .records
            .iter()
            .find(|r| {
                r["room"] == recorded.room && r["callback"] == callback && r.get("in").is_some()
            })
            .ok_or_else(|| invalid("missing callback"))?;
        let records: Vec<_> = transcript
            .records
            .iter()
            .filter(|r| r["room"] == recorded.room && r["callback"] == callback)
            .collect();
        let ports = room.room.ports().clone();
        ports.seed_entropy(records.iter().filter(|r| r["out"] == "accept").map(|r| {
            r["ws_id"].as_str().expect("accepted socket")[5..]
                .parse()
                .expect("recorded UUID")
        }));
        let key = match &recorded.input {
            ServerInput::Http(req) => req.path.split('/').nth(2).unwrap_or("").to_owned(),
            _ => room
                .room
                .memory_view()
                .session_key
                .as_ref()
                .map(|k| k.as_str().to_owned())
                .unwrap_or_default(),
        };
        let result = match recorded.input {
            ServerInput::Http(req) if req.method == "GET" && req.path.ends_with("/connect") => {
                ports.set_now(recorded.now);
                if room
                    .room
                    .source_blocked()
                    .now_or_never()
                    .ok_or_else(|| invalid("gate blocked"))?
                    .map_err(|e| invalid(e.to_string()))?
                {
                    return Err(ReplayError::Unsupported("blocked source route".into()));
                }
                let gate_effects = ports.take_effects();
                let step = room.step(
                    recorded.now,
                    ServerInput::Connect {
                        grant: grant(&req.query)?,
                        key: SessionKey::new(key.clone()),
                    },
                )?;
                let StepResult::Done(mut effects) = step else {
                    return Err(invalid("golden callback crashed"));
                };
                let mut effects = gate_effects
                    .into_iter()
                    .chain(effects.drain(..))
                    .collect::<Vec<_>>();
                if !records
                    .iter()
                    .any(|r| r["out"] == "response" && r["status"] == 101 && r["body_b64"] == "")
                {
                    return Err(invalid("missing upgrade response"));
                }
                effects.shrink_to_fit();
                effects
            }
            other => match room.step(recorded.now, other)? {
                StepResult::Done(effects) => effects,
                StepResult::Crashed(_) => return Err(invalid("golden callback crashed")),
            },
        };
        let expected = projected(&records, &key)?;
        let actual: Vec<_> = result
            .iter()
            .map(|e| {
                if e.operation == "background.publish" {
                    effect("background.schedule", Value::Null)
                } else {
                    e.clone()
                }
            })
            .collect();
        compare_effects(&expected, &actual).map_err(|error| {
            ReplayError::Mismatch(format!(
                "{} callback {callback}: {error}; expected {expected:?}; actual {actual:?}",
                transcript.name
            ))
        })?;
        if let Some(dump) = records.iter().find(|r| r["out"] == "dump") {
            let expected_kv = serde_json::from_value::<Vec<(String, Value)>>(dump["kv"].clone())
                .map_err(|e| invalid(e.to_string()))?
                .into_iter()
                .collect::<BTreeMap<_, _>>();
            if ports.storage_dump() != expected_kv {
                return Err(ReplayError::Mismatch(
                    "final transactional storage differs".into(),
                ));
            }
            let snapshots = ports.snapshot_dump();
            let rows = dump["sql"]
                .as_array()
                .ok_or_else(|| invalid("missing SQL dump"))?;
            if rows.len() != snapshots.len() {
                return Err(ReplayError::Mismatch("final snapshot count differs".into()));
            }
            for row in rows {
                let id = row["id"]
                    .as_str()
                    .ok_or_else(|| invalid("missing snapshot identity"))?;
                if row["chunk"] != 0 {
                    return Err(ReplayError::Unsupported(
                        "multi-chunk SQL snapshot dump".into(),
                    ));
                }
                let actual = snapshots
                    .get(id)
                    .ok_or_else(|| invalid("native snapshot missing"))?;
                if !equivalent_snapshots(&decode(&row["data"]["bytes_b64"])?, actual)? {
                    return Err(ReplayError::Mismatch("final snapshot differs".into()));
                }
            }
            if dump["d1"] != json!({"peer_user_map":[],"blame":[]})
                || dump["snapshots"] != json!([])
                || !dump["alarm"].is_null()
            {
                return Err(ReplayError::Unsupported(
                    "nonempty external store in C8 fixture".into(),
                ));
            }
        }
        // A close callback sees the socket listed; removal happens only afterwards.
        if raw["in"] == "close" {
            ports.runtime_closes(&socket(&raw["ws_id"])?);
        }
        all.extend(result);
    }
    Ok(all)
}
