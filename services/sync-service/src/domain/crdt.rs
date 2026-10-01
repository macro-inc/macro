//! Automerge wire encoding. Revisions are canonical JSON arrays of change hashes;
//! deltas are concatenated native Automerge change chunks (JS `saveSince`).
use automerge::{Change, ChangeHash};

use super::document::{DocumentError, MAX_BINARY_BYTES, MAX_REVISION_BYTES};

pub fn encode_revision(heads: &[ChangeHash]) -> Vec<u8> {
    let mut heads: Vec<_> = heads.iter().map(ToString::to_string).collect();
    heads.sort();
    serde_json::to_vec(&heads).expect("serializing strings cannot fail")
}

pub fn decode_revision(bytes: &[u8]) -> Result<Vec<ChangeHash>, DocumentError> {
    if bytes.len() > MAX_REVISION_BYTES {
        return Err(DocumentError::TooLarge);
    }
    let heads: Vec<String> = serde_json::from_slice(bytes)
        .map_err(|_| DocumentError::Invalid("Invalid Automerge revision."))?;
    let mut heads = heads
        .iter()
        .map(|head| {
            head.parse()
                .map_err(|_| DocumentError::Invalid("Invalid Automerge change hash."))
        })
        .collect::<Result<Vec<ChangeHash>, _>>()?;
    heads.sort();
    heads.dedup();
    Ok(heads)
}

/// Validate every byte before applying anything. `load_incremental` deliberately
/// tolerates truncated input, so it is unsuitable for acknowledging durable writes.
pub fn decode_changes(mut bytes: &[u8]) -> Result<Vec<Change>, DocumentError> {
    if bytes.len() > MAX_BINARY_BYTES {
        return Err(DocumentError::TooLarge);
    }
    let mut changes = Vec::new();
    let mut operations = 0usize;
    while !bytes.is_empty() {
        if bytes.len() < 10 || bytes[..4] != [0x85, 0x6f, 0x4a, 0x83] {
            return Err(DocumentError::Invalid("Invalid Automerge update."));
        }
        // Types 1 and 2 are uncompressed and compressed changes. Never accept
        // document chunks or experimental bundles on the delta endpoint.
        if !matches!(bytes[8], 1 | 2) {
            return Err(DocumentError::Invalid(
                "Send Automerge changes, not a snapshot.",
            ));
        }
        let mut length = 0usize;
        let mut end = 9usize;
        let mut shift = 0;
        loop {
            let byte = *bytes
                .get(end)
                .ok_or(DocumentError::Invalid("Truncated Automerge update."))?;
            if shift >= usize::BITS || (usize::from(byte & 0x7f) > (usize::MAX >> shift)) {
                return Err(DocumentError::TooLarge);
            }
            length |= usize::from(byte & 0x7f) << shift;
            end += 1;
            if byte & 0x80 == 0 {
                break;
            }
            shift += 7;
        }
        let end = end
            .checked_add(length)
            .filter(|end| *end <= bytes.len())
            .ok_or(DocumentError::Invalid("Truncated Automerge update."))?;
        let change = Change::from_bytes(bytes[..end].to_vec())
            .map_err(|_| DocumentError::Invalid("Invalid Automerge change."))?;
        if change.hash().0[..4] != bytes[4..8] {
            return Err(DocumentError::Invalid("Invalid Automerge checksum."));
        }
        operations = operations
            .checked_add(change.len())
            .ok_or(DocumentError::TooLarge)?;
        if operations > 100_000 || changes.len() >= 10_000 {
            return Err(DocumentError::TooLarge);
        }
        changes.push(change);
        bytes = &bytes[end..];
    }
    Ok(changes)
}

/// Materialize the application's stable-object lists for JSON consumers.
/// Binary snapshots retain the native objects and their complete CRDT history.
pub fn materialize_json(value: serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match value {
        Value::Object(mut map)
            if map.get("__macro_automerge_list").and_then(Value::as_str) == Some("v1")
                && map.get("items").is_some_and(Value::is_object)
                && map.get("order").is_some_and(Value::is_array) =>
        {
            let Value::Object(items) = map.remove("items").expect("checked list items") else {
                unreachable!()
            };
            let Value::Array(order) = map.remove("order").expect("checked list order") else {
                unreachable!()
            };
            let mut seen = std::collections::HashSet::new();
            Value::Array(
                order
                    .into_iter()
                    .filter_map(|key| {
                        let key = key.as_str()?;
                        if !seen.insert(key.to_owned()) {
                            return None;
                        }
                        items.get(key).cloned().map(materialize_json)
                    })
                    .collect(),
            )
        }
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, materialize_json(value)))
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(materialize_json).collect()),
        value => value,
    }
}

#[cfg(test)]
mod materialization_tests {
    #[test]
    fn stable_lists_emit_visible_objects_once_in_order() {
        let value = serde_json::json!({"root":{"children":{
            "__macro_automerge_list":"v1",
            "items":{"a":{"text":"A"},"b":{"text":"B"},"deleted":{"text":"hidden"}},
            "order":["b","a","b","missing"]
        }}});
        assert_eq!(
            super::materialize_json(value),
            serde_json::json!({"root":{"children":[{"text":"B"},{"text":"A"}]}})
        );
    }
}
