//! Validate committed physical plans before projecting atomic logical effects.
use super::*;
use sync_server_core::domain::{
    document::DocumentAttribution,
    types::{OPERATION_ARCHIVE_PREFIX, OperationArchive, OperationId, operation_archive_key},
};

fn attempt_plan(calls: &[(&Value, &Value)]) -> Result<Value, ReplayError> {
    if let [(call, returned)] = calls {
        if call["port"] != "storage.transaction.put"
            || call["args"].as_array().map(Vec::len) != Some(1)
            || returned["return"] != "storage.transaction.put"
            || returned["value"] != json!({"undefined":true})
        {
            return Err(invalid("atomic batch method or return"));
        }
        let values = call["args"][0]
            .as_object()
            .ok_or_else(|| invalid("atomic batch object"))?;
        let pending: Vec<_> = values
            .keys()
            .filter(|key| key.starts_with("o/") && !key.starts_with("o/!"))
            .collect();
        let [key] = pending.as_slice() else {
            return Err(invalid("atomic batch pending count"));
        };
        let id = key
            .strip_prefix("o/")
            .ok_or_else(|| invalid("atomic batch namespace"))?;
        let archive = format!("a/{id}");
        let actor_key = format!("actor/{id}");
        let expected_count = if values.contains_key(&actor_key) {
            3
        } else {
            2
        };
        if values.len() != expected_count || !values.contains_key(&archive) {
            return Err(invalid("atomic batch extra or missing key"));
        }
        let update = crate::ports::inline_receipt(&values[key.as_str()])
            .map_err(|e| invalid(e.to_string()))?
            .ok_or_else(|| invalid("atomic batch missing inline receipt"))?;
        let archive_bytes: Vec<u8> =
            serde_json::from_value(values[&archive].clone()).map_err(|e| invalid(e.to_string()))?;
        if archive_bytes != update {
            return Err(invalid("atomic batch archive bytes differ"));
        }
        let attribution = if let Some(value) = values.get(&actor_key) {
            let bytes: Vec<u8> =
                serde_json::from_value(value.clone()).map_err(|e| invalid(e.to_string()))?;
            let actor: DocumentAttribution =
                serde_json::from_slice(&bytes).map_err(|e| invalid(e.to_string()))?;
            if serde_json::to_vec(&actor).map_err(|e| invalid(e.to_string()))? != bytes {
                return Err(invalid("noncanonical atomic attribution"));
            }
            serde_json::to_value(actor).map_err(|e| invalid(e.to_string()))?
        } else {
            Value::Null
        };
        return Ok(json!({"port":"storage.operation.put","args":[key,update,attribution]}));
    }
    for (call, returned) in calls {
        if call["port"] != returned["return"]
            || call.get("return").is_some()
            || returned.get("port").is_some()
            || returned.get("value").is_none()
        {
            return Err(invalid("transaction method return mismatch"));
        }
        if call["port"] == "storage.transaction.put"
            && (call["args"].as_array().map(Vec::len) != Some(2)
                || returned["value"] != json!({"undefined":true}))
        {
            return Err(invalid("transaction put arguments or return"));
        }
    }
    let [(a, a_return), (b, b_return)] = calls else {
        return Err(ReplayError::Unsupported(
            "unknown physical storage transaction".into(),
        ));
    };
    match (a["port"].as_str(), b["port"].as_str()) {
        (Some("storage.transaction.put"), Some("storage.transaction.put")) => {
            let key = b["args"][0]
                .as_str()
                .ok_or_else(|| invalid("pending transaction key"))?;
            let id = key
                .strip_prefix("o/")
                .filter(|id| !id.starts_with('!') && !id.is_empty())
                .ok_or_else(|| invalid("pending namespace"))?;
            if a["args"][0] != operation_archive_key(&OperationId::new(id.into())) {
                return Err(invalid("pending status key"));
            }
            let bytes: Vec<u8> =
                serde_json::from_value(a["args"][1].clone()).map_err(|e| invalid(e.to_string()))?;
            let status: OperationArchive =
                serde_json::from_slice(&bytes).map_err(|e| invalid(e.to_string()))?;
            if !matches!(status, OperationArchive::Incomplete { .. }) {
                return Err(invalid("pending must start Incomplete"));
            }
            let _: Vec<u8> =
                serde_json::from_value(b["args"][1].clone()).map_err(|e| invalid(e.to_string()))?;
            Ok(json!({"port":"storage.pending.put","args":[key,b["args"][1],a["args"][1]]}))
        }
        (Some("storage.transaction.delete"), Some("storage.transaction.delete")) => {
            if a["args"].as_array().map(Vec::len) != Some(1)
                || b["args"].as_array().map(Vec::len) != Some(1)
            {
                return Err(invalid("pending GC arguments"));
            }
            let keys = a["args"][0]
                .as_array()
                .ok_or_else(|| invalid("pending GC keys"))?;
            let expected = keys
                .iter()
                .map(|key| {
                    let key = key.as_str().ok_or_else(|| invalid("pending GC key"))?;
                    let id = key
                        .strip_prefix("o/")
                        .filter(|id| !id.starts_with('!') && !id.is_empty())
                        .ok_or_else(|| invalid("pending GC namespace"))?;
                    Ok(format!("{OPERATION_ARCHIVE_PREFIX}{id}"))
                })
                .collect::<Result<Vec<_>, ReplayError>>()?;
            if b["args"][0] != json!(expected)
                || a_return["value"] != json!(keys.len())
                || b_return["value"] != json!(keys.len())
            {
                return Err(ReplayError::Unsupported(
                    "pending GC status keys or delete-count mismatch".into(),
                ));
            }
            Ok(json!({"port":"storage.pending.delete_multiple","args":[keys]}))
        }
        _ => Err(ReplayError::Unsupported(
            "unknown physical storage transaction".into(),
        )),
    }
}

pub(super) fn project(records: &[&Value]) -> Result<Vec<Value>, ReplayError> {
    let mut groups: BTreeMap<u64, Vec<(usize, &Value)>> = BTreeMap::new();
    for (index, record) in records.iter().enumerate() {
        if let Some(transaction) = record.get("transaction") {
            let id = transaction
                .as_u64()
                .ok_or_else(|| invalid("invalid transaction id"))?;
            let allowed = [
                "room",
                "callback",
                "generation",
                "transaction",
                "attempt",
                "port",
                "return",
                "args",
                "value",
            ];
            if record
                .as_object()
                .is_none_or(|fields| fields.keys().any(|key| !allowed.contains(&key.as_str())))
            {
                return Err(invalid("unknown transaction event fields"));
            }
            if record.get("port").is_some() {
                if record.get("return").is_some() || record.get("value").is_some() {
                    return Err(invalid("transaction call contains return fields"));
                }
            } else if record.get("return").is_none() || record.get("args").is_some() {
                return Err(invalid("transaction return contains call fields"));
            }
            groups.entry(id).or_default().push((index, record));
        }
    }
    let mut commits = BTreeMap::new();
    let mut bulk_calls = std::collections::BTreeSet::new();
    for (index, record) in records.iter().enumerate() {
        if record.get("transaction").is_some()
            || record["port"] != "storage.put"
            || !record["args"][0].is_object()
        {
            continue;
        }
        let next = records[index + 1..]
            .iter()
            .position(|row| {
                row["return"] == "storage.put"
                    || row["throw"] == "storage.put"
                    || row["port"] == "storage.put"
            })
            .ok_or_else(|| invalid("atomic bulk put has no completion"))?
            + index
            + 1;
        let returned = records[next];
        if returned["return"] != "storage.put" {
            return Err(ReplayError::Unsupported(
                "failed or overlapping atomic bulk put".into(),
            ));
        }
        let call_fields = ["port", "args", "room", "callback", "generation"];
        let return_fields = ["return", "value", "room", "callback", "generation"];
        if record.as_object().is_none_or(|fields| {
            fields
                .keys()
                .any(|key| !call_fields.contains(&key.as_str()))
        }) || returned.as_object().is_none_or(|fields| {
            fields
                .keys()
                .any(|key| !return_fields.contains(&key.as_str()))
        }) || ["room", "callback", "generation"]
            .iter()
            .any(|key| record.get(*key) != returned.get(*key))
        {
            return Err(invalid("atomic bulk event shape or ownership"));
        }
        let call = json!({"port":"storage.transaction.put","args":record["args"]});
        let result = json!({"return":"storage.transaction.put","value":returned["value"]});
        commits.insert(next, attempt_plan(&[(&call, &result)])?);
        bulk_calls.insert(index);
    }
    for events in groups.values() {
        let Some((_, first)) = events.first() else {
            return Err(invalid("empty transaction"));
        };
        let Some((commit_index, last)) = events.last() else {
            return Err(invalid("empty transaction"));
        };
        if first["port"] != "storage.transaction"
            || first["args"] != json!([])
            || first.get("attempt").is_some()
            || first.get("return").is_some()
            || last["return"] != "storage.transaction"
            || last.get("value") != Some(&Value::Null)
            || last.get("attempt").is_some()
            || last.get("port").is_some()
        {
            return Err(ReplayError::Unsupported(
                "uncommitted or unknown storage transaction".into(),
            ));
        }
        let inner = &events[1..events.len() - 1];
        let mut cursor = 0;
        let mut attempt = 0;
        let mut plan = None;
        while cursor < inner.len() {
            let begin = inner[cursor].1;
            if begin["port"] != "storage.transaction.begin"
                || begin["args"] != json!([])
                || begin["attempt"] != json!(attempt)
                || begin.get("return").is_some()
            {
                return Err(invalid("invalid transaction attempt"));
            }
            cursor += 1;
            let mut calls = Vec::new();
            while cursor < inner.len() && inner[cursor].1["port"] != "storage.transaction.begin" {
                if cursor + 1 >= inner.len() {
                    return Err(invalid("unpaired transaction call"));
                }
                let call = inner[cursor].1;
                let returned = inner[cursor + 1].1;
                if call["attempt"] != json!(attempt)
                    || returned["attempt"] != json!(attempt)
                    || call["room"] != first["room"]
                    || returned["room"] != first["room"]
                    || call["callback"] != first["callback"]
                    || returned["callback"] != first["callback"]
                {
                    return Err(invalid("transaction attempt ownership"));
                }
                calls.push((call, returned));
                cursor += 2;
            }
            let projected = attempt_plan(&calls)?;
            if let Some(previous) = &plan
                && previous != &projected
            {
                return Err(invalid("retry changed transaction plan"));
            }
            plan = Some(projected);
            attempt += 1;
        }
        commits.insert(
            *commit_index,
            plan.ok_or_else(|| invalid("missing transaction plan"))?,
        );
    }
    let mut result = Vec::new();
    for (index, record) in records.iter().enumerate() {
        if let Some(plan) = commits.remove(&index) {
            // Preserve actual commit order: an early ACK must remain before the
            // durable effect and fail the native comparison, never be reordered.
            result.push(plan);
        } else if record.get("transaction").is_none() && !bulk_calls.contains(&index) {
            result.push((*record).clone());
        }
    }
    Ok(result)
}

#[cfg(test)]
mod test;
