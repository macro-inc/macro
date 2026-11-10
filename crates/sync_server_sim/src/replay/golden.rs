//! Exact boundary projection for extracted callbacks; unknown raw operations fail closed.
use super::*;
use crate::{ports::*, transcript::*};
use base64::{Engine, engine::general_purpose::STANDARD};
mod http;
mod receipts;
mod transactions;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use sync_server_core::domain::types::SessionKey;

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
fn socket(value: &Value) -> Result<sync_server_core::domain::socket::WebSocketId, ReplayError> {
    sync_server_core::domain::socket::WebSocketId::from_tags(&[value
        .as_str()
        .ok_or_else(|| invalid("missing socket"))?
        .into()])
    .map_err(|e| invalid(e.to_string()))
}
fn projected(records: &[&Value], key: &str) -> Result<Vec<Effect>, ReplayError> {
    let transaction_records = transactions::project(records)?;
    let records: Vec<_> = transaction_records.iter().collect();
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
                "storage.put" => {
                    // The Worker serializes this bounded metadata as Uint8Array;
                    // the native port uses Vec<u8>. Decode the capture wrapper
                    // losslessly, preserving every underlying metadata byte.
                    let value = if args[0] == sync_server_core::domain::fanout::FANOUT_DEBT_KEY {
                        if args.as_array().is_none_or(|args| args.len() != 2)
                            || args[1].as_object().is_none_or(|object| {
                                object.len() != 1 || !object.contains_key("bytes_b64")
                            })
                        {
                            return Err(invalid("invalid fanout byte capture wrapper"));
                        }
                        json!(decode(&args[1]["bytes_b64"])?)
                    } else {
                        args[1].clone()
                    };
                    effect("storage.put", json!({"key":args[0],"value":value}))
                }
                "storage.operation.put" => effect(
                    "storage.operation.put",
                    json!({"key":args[0],"value":args[1],"attribution":args[2]}),
                ),
                "storage.pending.put" => effect(
                    "storage.pending.put",
                    json!({"key":args[0],"value":args[1],"archive":args[2]}),
                ),
                "storage.pending.delete_multiple" => {
                    effect("storage.pending.delete_multiple", args[0].clone())
                }
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
                // Detached HTTP transports are checked against native publication
                // payloads separately; their schedule stays in this ordered log.
                "fetch"
                    if record["url"].as_str().is_some_and(|url| {
                        url.starts_with("https://dss.test/internal/documents/")
                    }) =>
                {
                    continue;
                }
                "wait_until" => effect("background.schedule", Value::Null),
                "sql.exec" => {
                    let sql = args[0]
                        .as_str()
                        .ok_or_else(|| invalid("SQL text missing"))?;
                    if sql.starts_with("CREATE TABLE IF NOT EXISTS kv_store (") {
                        // A conflicting target prepares the session backend before
                        // consulting its receipt, then returns without a SQL read.
                        let identity = records[index + 1..]
                            .iter()
                            .find(|r| r["port"] == "sql.exec")
                            .and_then(|next| next["args"][1].as_str())
                            .unwrap_or(key);
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
                            if args[1]
                                .as_str()
                                .is_some_and(|key| key.starts_with("migration-export:"))
                                && records[..index]
                                    .iter()
                                    .rev()
                                    .find(|r| r["port"] == "sql.exec")
                                    .is_some_and(|r| {
                                        r["args"][0].as_str().is_some_and(|sql| {
                                            sql.starts_with("CREATE TABLE IF NOT EXISTS kv_store (")
                                        })
                                    })
                            {
                                result.push(effect("snapshot.get", args[1].clone()));
                            } else {
                                return Err(invalid("orphan snapshot chunk read"));
                            }
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
                "close" => result.push(effect("connections.close",json!({"socket":record["ws_id"],"code":record["code"],"reason":record["reason"]}))),
                "alarm" => result.push(effect(
                    "alarm.response",
                    json!({"status":record["status"],"body":decode(&record["body_b64"])?}),
                )),
                "response" | "dump" | "fetch_body" => {}
                other => return Err(ReplayError::Unsupported(format!("raw output {other}"))),
            }
        }
    }
    Ok(result)
}
pub(super) fn replay(
    transcript: &Transcript,
    archive_writes: bool,
) -> Result<Vec<Effect>, ReplayError> {
    let mut rooms: BTreeMap<String, SimRoom> = BTreeMap::new();
    let mut all = Vec::new();
    let mut receipts = receipts::Receipts::default();
    for recorded in transcript.inputs()? {
        if recorded.room.starts_with('@') {
            continue;
        }
        // DO fake stores partition attribution by session key. The runtime D1
        // dump is global, so combine the disjoint partitions for final checking.
        let other_directories: Vec<_> = rooms
            .iter()
            .filter(|(id, _)| **id != recorded.room)
            .map(|(_, room)| room.room.ports().directory_dump())
            .collect();
        let room = rooms.entry(recorded.room.clone()).or_insert_with(|| {
            let ports = SimPorts::new();
            ports.set_operation_archive_writes(archive_writes);
            SimRoom::new(ports)
        });
        let callback = serde_json::json!(recorded.callback);
        let raw = &transcript.records[recorded.record_index];
        let end = transcript.records[recorded.record_index + 1..]
            .iter()
            .position(|r| r["room"] == recorded.room && r["in"] == "new")
            .map(|offset| recorded.record_index + 1 + offset)
            .unwrap_or(transcript.records.len());
        let records: Vec<_> = transcript.records[recorded.record_index..end]
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
            ServerInput::Http(req) => {
                let id = req.path.split('/').nth(2).unwrap_or("");
                if req.path.starts_with("/surface/") {
                    format!("surface:{}", id.to_lowercase())
                } else {
                    id.to_owned()
                }
            }
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
            ServerInput::Http(req) => {
                ports.set_now(recorded.now);
                http::replay(&mut room.room, &req, &key, &records, &mut receipts)?;
                ports.take_effects()
            }
            // C0 includes manual alarm invocations as well as scheduled firings.
            // A retained alarm read identifies the manual invocation; scheduled
            // delivery consumes it before the callback (including final drains).
            ServerInput::AlarmFired => {
                ports.set_now(recorded.now);
                if !records
                    .iter()
                    .any(|r| r["return"] == "storage.getAlarm" && !r["value"].is_null())
                {
                    ports.fire_alarm();
                }
                let outcome = room
                    .room
                    .on_alarm()
                    .now_or_never()
                    .ok_or_else(|| invalid("alarm blocked"))??;
                let body = if outcome == AlarmOutcome::Completed {
                    b"ok".to_vec()
                } else {
                    vec![]
                };
                ports.transport_effect(effect("alarm.response", json!({"status":200,"body":body})));
                ports.take_effects()
            }
            other => {
                // H10 deliberately sends the tail of a pre-eviction partial frame.
                // C0 did not record callback errors. Pin this one known failure's
                // exact input and diagnostic, then still compare every port effect.
                let malformed_tail = transcript.name
                    == "hibernation.test/H10_discards_an_incomplete_inbound_frame_on_eviction.jsonl"
                    && raw["in"] == "message"
                    && raw["binary_b64"] == "AQAABA==";
                match room.step(recorded.now, other) {
                    Err(ReplayError::Callback(error))
                        if malformed_tail
                            && error
                                == "failed to deserialize message, message length 3 : Deserialization Error, 1 more bytes expected" =>
                    {
                        ports.take_effects()
                    }
                    Ok(StepResult::Done(effects)) if !malformed_tail => effects,
                    Ok(StepResult::Done(_)) => {
                        return Err(ReplayError::Mismatch(
                            "H10 malformed tail unexpectedly succeeded".into(),
                        ));
                    }
                    Ok(StepResult::Crashed(_)) => return Err(invalid("golden callback crashed")),
                    Err(error) => return Err(error),
                }
            }
        };
        if ports.remaining_clocks() != 0 {
            return Err(ReplayError::Mismatch("unconsumed clock reads".into()));
        }
        validate_publications(&records, &result)?;
        let mut expected = projected(&records, &key).map_err(|error| {
            invalid(format!("{} callback {callback}: {error}", transcript.name))
        })?;
        for effect in &mut expected {
            if effect.operation == "storage.put" {
                let key = effect.value["key"]
                    .as_str()
                    .ok_or_else(|| invalid("missing put key"))?;
                effect.value["value"] = receipts.stored(key, &effect.value["value"]);
            }
        }
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
            let actual_kv = ports.storage_dump();
            let mut same_kv = actual_kv.keys().eq(expected_kv.keys());
            if same_kv {
                for (key, value) in &expected_kv {
                    same_kv &= equivalent_stored_value(
                        key,
                        &receipts.stored(key, value),
                        &actual_kv[key],
                    )?;
                }
            }
            if !same_kv {
                return Err(ReplayError::Mismatch(format!(
                    "{} callback {callback}: final transactional storage differs; expected {expected_kv:?}; actual {actual_kv:?}",
                    transcript.name
                )));
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
            let directory = combined_directory(
                other_directories
                    .iter()
                    .chain(std::iter::once(&ports.directory_dump())),
            )?;
            if dump["d1"] != directory
                || dump["snapshots"] != json!([])
                || dump["alarm"] != json!(ports.alarm_dump())
            {
                return Err(ReplayError::Unsupported(format!(
                    "final stores differ in {}: expected d1 {} actual {}; expected alarm {} actual {:?}; fallback {}",
                    transcript.name,
                    dump["d1"],
                    ports.directory_dump(),
                    dump["alarm"],
                    ports.alarm_dump(),
                    dump["snapshots"]
                )));
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

fn validate_publications(records: &[&Value], effects: &[Effect]) -> Result<(), ReplayError> {
    let fetches: Vec<_> = records.iter().filter(|r| r["port"] == "fetch").collect();
    if fetches.is_empty() {
        // Older fixtures have no configured outbound DSS transport. Their
        // publication scheduling remains part of the strict ordered comparison.
        return Ok(());
    }
    let mut expected = Vec::new();
    for effect in effects
        .iter()
        .filter(|e| e.operation == "background.publish")
    {
        let value = &effect.value;
        if value["noop"] == true {
            continue;
        }
        let document = value["document"]
            .as_str()
            .ok_or_else(|| invalid("missing publication identity"))?;
        let base = format!("https://dss.test/internal/documents/{document}");
        if value.get("snapshot").is_some() {
            let snapshot: Vec<u8> = serde_json::from_value(value["snapshot"].clone())
                .map_err(|e| invalid(e.to_string()))?;
            expected.push((format!("{base}/snapshot"), snapshot, true));
            let editors = &value["editors"];
            let body = if editors == &json!([]) {
                json!({})
            } else {
                json!({"editors":editors})
            };
            expected.push((
                format!("{base}/sync-content-updated"),
                body.to_string().into_bytes(),
                false,
            ));
        }
        if !value["interaction"].is_null() {
            expected.push((
                format!("{base}/interaction"),
                json!({"reason":value["interaction"]})
                    .to_string()
                    .into_bytes(),
                false,
            ));
        }
    }
    let mut actual = Vec::new();
    let mut body = None;
    for record in records {
        if record["out"] == "fetch_body" {
            if body.replace(decode(&record["body_b64"])?).is_some() {
                return Err(invalid("orphan outbound body"));
            }
        } else if record["port"] == "fetch" {
            let bytes = if let Some(value) = record.get("body") {
                value.to_string().into_bytes()
            } else {
                body.take()
                    .ok_or_else(|| invalid("missing outbound body"))?
            };
            actual.push((
                record["url"]
                    .as_str()
                    .ok_or_else(|| invalid("missing outbound URL"))?
                    .to_owned(),
                bytes,
            ));
        }
    }
    if body.is_some() || expected.len() != actual.len() {
        return Err(ReplayError::Mismatch(
            "publication request count differs".into(),
        ));
    }
    for ((url, bytes, snapshot), (actual_url, actual_bytes)) in expected.into_iter().zip(actual) {
        if url != actual_url
            || if snapshot {
                !equivalent_snapshots(&bytes, &actual_bytes)?
            } else {
                bytes != actual_bytes
            }
        {
            return Err(ReplayError::Mismatch(
                "publication transport payload differs".into(),
            ));
        }
    }
    Ok(())
}

fn combined_directory<'a>(
    partitions: impl Iterator<Item = &'a Value>,
) -> Result<Value, ReplayError> {
    let mut result = json!({"peer_user_map":[],"blame":[]});
    for partition in partitions {
        for (table, id) in [("peer_user_map", "peer_id"), ("blame", "node_id")] {
            let rows = partition[table]
                .as_array()
                .ok_or_else(|| invalid("missing D1 partition"))?;
            result[table]
                .as_array_mut()
                .unwrap()
                .extend(rows.iter().cloned());
            let merged = result[table].as_array_mut().unwrap();
            merged.sort_by(|a, b| {
                (a["document_id"].as_str(), a[id].as_str())
                    .cmp(&(b["document_id"].as_str(), b[id].as_str()))
            });
            if merged.windows(2).any(|rows| {
                rows[0]["document_id"] == rows[1]["document_id"] && rows[0][id] == rows[1][id]
            }) {
                return Err(invalid("overlapping native D1 partitions"));
            }
        }
    }
    Ok(result)
}
