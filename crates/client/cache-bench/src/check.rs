//! Replays a generated dataset through the engine's projection validation, so
//! a dataset the engine would refuse (or silently mark incomplete) is caught
//! before it is measured.
use cache_core::predicate::ProjectionMutation;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

/// Prints, per op, how many records project complete and which do not.
/// Returns whether every op projected cleanly.
pub fn run(dir: &Path) -> Result<bool, rootcause::Report> {
    let docs: BTreeMap<String, String> =
        serde_json::from_slice(&std::fs::read(dir.join("docs.json")).map_err(crate::io)?)
            .map_err(crate::io)?;
    let schema = cache_core::meta::bundled_schema_ref();
    let mut clean = true;
    for file in ["seed.ndjson", "foreground.ndjson"] {
        let text = std::fs::read_to_string(dir.join(file)).map_err(crate::io)?;
        for (index, line) in text.lines().enumerate() {
            let op: Value = serde_json::from_str(line).map_err(crate::io)?;
            let doc = op["doc"].as_str().unwrap_or_default();
            let lane = op["lane"].as_str().unwrap_or_default();
            let Some(query) = docs.get(doc) else {
                println!("{file}#{index} {doc}: missing document");
                clean = false;
                continue;
            };
            let result = soup_filter_cache_adapter::authoritative_projection_mutations(
                schema,
                query,
                op["operationName"].as_str(),
                &op["data"],
            );
            let mutations = match result {
                Ok(mutations) => mutations,
                Err(error) => {
                    println!("{file}#{index} {doc} [{lane}]: refused: {error}");
                    clean = false;
                    // Re-run under a name the backfill gate skips, to name what was incomplete.
                    match soup_filter_cache_adapter::authoritative_projection_mutations(
                        schema,
                        query,
                        None,
                        &op["data"],
                    ) {
                        Ok(mutations) => mutations,
                        Err(error) => {
                            println!("  diagnosis refused too: {error}");
                            continue;
                        }
                    }
                }
            };
            let incomplete: Vec<_> = mutations
                .iter()
                .filter_map(|mutation| match mutation {
                    ProjectionMutation::MarkIncomplete {
                        record_key, kind, ..
                    } => Some((record_key.as_str().to_owned(), format!("{kind:?}"))),
                    _ => None,
                })
                .collect();
            println!(
                "{file}#{index} {doc} [{lane}]: {} projections, {} incomplete",
                mutations.len(),
                incomplete.len()
            );
            if let Some((key, kind)) = incomplete.first() {
                clean = false;
                let id = key.split_once(':').map_or("", |(_, id)| id);
                println!("  first: {key} ({kind})");
                if let Some(object) = find(&op["data"], id) {
                    println!("  {}", summarize(object));
                }
            }
        }
    }
    Ok(clean)
}

fn find<'a>(value: &'a Value, id: &str) -> Option<&'a Value> {
    match value {
        Value::Object(map) => {
            if map.get("id").and_then(Value::as_str) == Some(id) && map.contains_key("__typename") {
                return Some(value);
            }
            map.values().find_map(|child| find(child, id))
        }
        Value::Array(items) => items.iter().find_map(|child| find(child, id)),
        _ => None,
    }
}

fn summarize(object: &Value) -> String {
    let Value::Object(map) = object else {
        return String::new();
    };
    map.iter()
        .map(|(key, value)| {
            let text = value.to_string();
            let text = if text.chars().count() > 60 {
                format!("{}…", text.chars().take(60).collect::<String>())
            } else {
                text
            };
            format!("{key}={text}")
        })
        .collect::<Vec<_>>()
        .join("\n    ")
}
