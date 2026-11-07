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
        if let Some(kind) = record["clock"].as_str() {
            if kind == "presence" {
                continue;
            }
            let kind = match kind {
                "state_instant" => "monotonic",
                "op_id_nanos" => "unix_nanos",
                other => other,
            };
            result.push(effect(
                "clock",
                json!({"kind":kind,"value":record["value"]}),
            ));
        } else if let Some(port) = record["port"].as_str() {
            let next = match port {
                "storage.get" => effect("storage.get", args[0].clone()),
                "storage.put" => effect("storage.put", json!({"key":args[0],"value":args[1]})),
                "storage.delete" if args[0].is_array() => {
                    effect("storage.delete_multiple", args[0].clone())
                }
                "storage.delete" => effect("storage.delete", args[0].clone()),
                "storage.deleteAlarm" => effect("alarm.delete", Value::Null),
                "storage.deleteAll" => effect("storage.delete_all", Value::Null),
                "storage.getAlarm" => effect("alarm.get", Value::Null),
                "storage.setAlarm" => {
                    let clock = records[..index]
                        .iter()
                        .rev()
                        .find(|r| r["clock"] == "alarm_set_ms")
                        .ok_or_else(|| invalid("missing alarm scheduling clock"))?;
                    let now = clock["value"]
                        .as_str()
                        .ok_or_else(|| invalid("missing alarm wall clock"))?
                        .parse::<i64>()
                        .map_err(|e| invalid(e.to_string()))?;
                    let deadline = args[0]["date_ms"]
                        .as_i64()
                        .ok_or_else(|| invalid("missing alarm deadline"))?;
                    let delay = deadline
                        .checked_sub(now)
                        .filter(|delay| *delay >= 0)
                        .ok_or_else(|| invalid("invalid alarm delay"))?;
                    effect("alarm.set", json!({"delay_ms":delay}))
                }
                "d1.run"
                    if record["sql"]
                        == "INSERT INTO peer_user_map (document_id, peer_id, user_id, actor) VALUES (?, ?, ?, ?) ON CONFLICT(document_id, peer_id) DO UPDATE SET user_id = excluded.user_id, actor = excluded.actor WHERE peer_user_map.user_id = ?;" =>
                {
                    let params = &record["params"];
                    if params[4] != "system" {
                        return Err(invalid("unexpected claim policy"));
                    }
                    effect(
                        "peers.claim",
                        json!({"document":params[0],"peer":params[1],"user":params[2],"actor":params[3]}),
                    )
                }
                "d1.batch" => {
                    let statements = record["statements"]
                        .as_array()
                        .ok_or_else(|| invalid("missing D1 batch"))?;
                    if statements.len() == 2
                        && statements[0]["sql"]
                            == "DELETE FROM peer_user_map WHERE document_id = ?;"
                        && statements[1]["sql"] == "DELETE FROM blame WHERE document_id = ?;"
                    {
                        if statements[0]["params"] != json!([key])
                            || statements[1]["params"] != json!([key])
                        {
                            return Err(invalid("delete attribution identity differs"));
                        }
                        result.push(effect("peers.delete_document", json!(key)));
                        continue;
                    }
                    let first = statements
                        .first()
                        .ok_or_else(|| invalid("empty D1 batch"))?;
                    let sql = "INSERT OR IGNORE INTO peer_user_map (document_id, peer_id, user_id, actor) VALUES (?, ?, ?, ?);";
                    let params = &first["params"];
                    let mut peers = Vec::new();
                    for statement in statements {
                        if statement["sql"] != sql
                            || statement["params"][0] != params[0]
                            || statement["params"][2] != params[2]
                            || statement["params"][3] != params[3]
                        {
                            return Err(ReplayError::Unsupported("D1 batch policy".into()));
                        }
                        peers.push(statement["params"][1].clone());
                    }
                    effect(
                        "peers.map_unowned",
                        json!({"document":params[0],"peers":peers,"user":params[2],"actor":params[3]}),
                    )
                }
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
                        let next = records[index + 1..]
                            .iter()
                            .find(|r| r["port"] == "sql.exec")
                            .ok_or_else(|| invalid("snapshot preparation without access"))?;
                        let identity = next["args"][1]
                            .as_str()
                            .ok_or_else(|| invalid("snapshot key missing"))?;
                        result.push(effect("snapshot.prepare", json!(identity)));
                        continue;
                    }
                    if sql == "SELECT 1 FROM kv_store WHERE id = ?1 LIMIT 1" {
                        let next = records
                            .get(index + 1)
                            .ok_or_else(|| invalid("snapshot existence without result"))?;
                        let reads = next["args"][0]
                            == "SELECT chunk, data FROM kv_store WHERE id = ?1 ORDER BY chunk"
                            || next["port"] == "SNAPSHOT_STORE_KV.get";
                        effect(
                            if reads {
                                "snapshot.get"
                            } else {
                                "snapshot.has"
                            },
                            args[1].clone(),
                        )
                    } else if sql == "DELETE FROM kv_store WHERE id = ?1" {
                        if records[..index]
                            .iter()
                            .rev()
                            .find(|r| r.get("port").is_some())
                            .is_some_and(|r| r["port"] == "SNAPSHOT_STORE_KV.delete")
                        {
                            if args[1] != key {
                                return Err(invalid("snapshot delete identity differs"));
                            }
                            continue;
                        }
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
                    } else if sql == "SELECT chunk, data FROM kv_store WHERE id = ?1 ORDER BY chunk"
                    {
                        // The preceding existence query is the snapshot.get boundary.
                        if !records[..index].iter().any(|r| {
                            r["args"][0] == "SELECT 1 FROM kv_store WHERE id = ?1 LIMIT 1"
                                && r["args"][1] == args[1]
                        }) {
                            return Err(invalid("orphan snapshot chunk read"));
                        }
                        continue;
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
                "SNAPSHOT_STORE_KV.delete" => {
                    if args != &json!([format!("{key}/{key}.snapshot")])
                        || records[index + 1..]
                            .iter()
                            .find(|r| r.get("port").is_some())
                            .is_none_or(|r| {
                                r["args"] != json!(["DELETE FROM kv_store WHERE id = ?1", key])
                            })
                    {
                        return Err(invalid("fallback must be deleted before primary"));
                    }
                    effect("snapshot.delete", json!(key))
                }
                "SNAPSHOT_STORE_KV.list" => {
                    if args != &json!([{"limit":1,"prefix":key}]) {
                        return Err(invalid("unexpected snapshot existence fallback"));
                    }
                    continue;
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
                "alarm" => result.push(effect(
                    "alarm.response",
                    json!({"status":record["status"],"body":decode(&record["body_b64"])?}),
                )),
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
        ports.seed_clocks(
            records
                .iter()
                .filter_map(|r| {
                    r["clock"].as_str().map(|kind| {
                        let kind = match kind {
                            "state_instant" => "monotonic",
                            "op_id_nanos" => "unix_nanos",
                            other => other,
                        };
                        Ok::<_, ReplayError>((
                            kind.to_owned(),
                            r["value"]
                                .as_str()
                                .ok_or_else(|| invalid("missing clock value"))?
                                .parse::<u128>()
                                .map_err(|e| invalid(e.to_string()))?,
                        ))
                    })
                })
                .collect::<Result<Vec<_>, _>>()?,
        );
        ports.seed_enumeration(
            records
                .iter()
                .filter(|r| r["port"] == "connections.list")
                .map(|r| {
                    r["ws_ids"]
                        .as_array()
                        .ok_or_else(|| invalid("missing runtime list"))?
                        .iter()
                        .map(socket)
                        .collect::<Result<Vec<_>, _>>()
                })
                .collect::<Result<Vec<_>, _>>()?,
        );
        if raw["in"] == "close" && !records.iter().any(|r| r["clock"] == "presence") {
            // C0's internal delete clock was not observable. Recover only clock
            // inputs from tombstone timestamps; Room still computes all outputs.
            use bebop::Record;
            let mut tombstones = BTreeMap::new();
            for record in records.iter().filter(|r| r["out"] == "send") {
                let frame = decode(&record["frame_b64"])?;
                let (_, payload) = sync_protocol::framing::strip_frame(&frame)
                    .map_err(|e| invalid(e.to_string()))?;
                if let sync_protocol::FromRemote::RemoteAwareness { awareness } =
                    sync_protocol::FromRemote::deserialize(payload)
                        .map_err(|e| invalid(e.to_string()))?
                {
                    for (key, (value, time)) in
                        sync_protocol::presence::decode_timestamps(&awareness)
                            .map_err(|e| invalid(e.to_string()))?
                    {
                        if value.is_none() {
                            tombstones.insert(
                                key.parse::<u64>().map_err(|e| invalid(e.to_string()))?,
                                time.0,
                            );
                        }
                    }
                }
            }
            ports.seed_presence_clocks(tombstones.values().flat_map(|time| [*time, *time]));
        }
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
        let baseline = room
            .room
            .memory_view()
            .document
            .as_ref()
            .map(|document| document.export_snapshot(None))
            .transpose()
            .map_err(|e| invalid(e.to_string()))?;
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
            ServerInput::Http(req)
                if req.method == "GET"
                    && (req.path.ends_with("/raw") || req.path.ends_with("/exists")) =>
            {
                ports.set_now(recorded.now);
                let outcome = async {
                    use sync_server_core::domain::room::{RequestGate, RouteClass};
                    if room.room.gate_request(RouteClass::Document).await? != RequestGate::Allowed {
                        return Err(sync_server_core::domain::room::RoomError::MissingPeer);
                    }
                    if req.path.ends_with("/exists") {
                        Ok(room
                            .room
                            .exists(&SessionKey::new(key.clone()))
                            .await?
                            .then(String::new))
                    } else {
                        room.room.raw_json(&SessionKey::new(key.clone())).await
                    }
                }
                .now_or_never()
                .ok_or_else(|| invalid("read blocked"))?
                .map_err(|e| ReplayError::Callback(e.to_string()))?;
                let (status, body) = match outcome {
                    Some(json) => (200, json.into_bytes()),
                    None => (404, vec![]),
                };
                let response = records
                    .iter()
                    .find(|r| r["out"] == "response")
                    .ok_or_else(|| invalid("missing HTTP response"))?;
                let headers = json!({"access-control-allow-credentials":"true","access-control-allow-headers":"authorization,content-type,traceparent,tracestate","access-control-allow-methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS"});
                if response["status"] != status
                    || decode(&response["body_b64"])? != body
                    || response["headers"] != headers
                {
                    return Err(ReplayError::Mismatch("raw HTTP response differs".into()));
                }
                ports.take_effects()
            }
            ServerInput::Http(req) if req.method == "DELETE" && req.path.ends_with("/delete") => {
                ports.set_now(recorded.now);
                let outcome = async {
                    use sync_server_core::domain::room::{RequestGate, RouteClass};
                    if room.room.gate_request(RouteClass::Document).await? != RequestGate::Allowed {
                        return Err(sync_server_core::domain::room::RoomError::MissingPeer);
                    }
                    room.room.delete(&SessionKey::new(key.clone())).await
                }
                .now_or_never()
                .ok_or_else(|| invalid("delete blocked"))?;
                outcome.map_err(|e| ReplayError::Callback(e.to_string()))?;
                let response = records
                    .iter()
                    .find(|r| r["out"] == "response")
                    .ok_or_else(|| invalid("missing delete response"))?;
                let headers = json!({"access-control-allow-credentials":"true","access-control-allow-headers":"authorization,content-type,traceparent,tracestate","access-control-allow-methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS"});
                if response["status"] != 200
                    || decode(&response["body_b64"])? != Vec::<u8>::new()
                    || response["headers"] != headers
                {
                    return Err(ReplayError::Mismatch("delete HTTP response differs".into()));
                }
                ports.take_effects()
            }
            other => match room.step(recorded.now, other)? {
                StepResult::Done(effects) => effects,
                StepResult::Crashed(_) => return Err(invalid("golden callback crashed")),
            },
        };
        if ports.remaining_clocks() != 0 {
            return Err(ReplayError::Mismatch("unconsumed clock reads".into()));
        }
        let expected = projected(&records, &key)?;
        let actual: Vec<_> = result
            .iter()
            .filter(|e| {
                e.operation != "background.keep_alive"
                    && !(e.operation == "clock" && e.value["kind"] == "presence")
            })
            .map(|e| {
                if e.operation == "background.publish" {
                    effect("background.schedule", Value::Null)
                } else {
                    e.clone()
                }
            })
            .collect();
        compare_effects_in_context(&expected, &actual, baseline.as_deref()).map_err(|error| {
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
            if dump["d1"] != ports.directory_dump()
                || dump["snapshots"] != json!([])
                || dump["alarm"] != json!(ports.alarm_dump())
            {
                return Err(ReplayError::Unsupported(
                    "nonempty external store in C8 fixture".into(),
                ));
            }
        }
        // A close callback sees the socket listed; removal happens only afterwards.
        ports.seed_enumeration(
            records
                .iter()
                .filter(|r| r["port"] == "connections.list")
                .map(|r| {
                    r["ws_ids"]
                        .as_array()
                        .ok_or_else(|| invalid("missing runtime list"))?
                        .iter()
                        .map(socket)
                        .collect::<Result<Vec<_>, _>>()
                })
                .collect::<Result<Vec<_>, _>>()?,
        );
        if raw["in"] == "close" {
            ports.runtime_closes(&socket(&raw["ws_id"])?);
        }
        all.extend(result);
    }
    Ok(all)
}
