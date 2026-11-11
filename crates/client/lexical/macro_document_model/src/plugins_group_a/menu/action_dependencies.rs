//! Source hasNodes metadata for the actual native editor registry.
use lexical_model::{EditorState, Error};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    types: Vec<String>,
}

pub(crate) fn query(
    name: &str,
    data: &Value,
    generation: u32,
    state: &EditorState,
) -> Result<Option<Value>, Error> {
    if name != "group-a.action-dependencies" {
        return Ok(None);
    }
    if generation != state.max_key().generation() {
        return Err(Error::Invariant("application query generation"));
    }
    if !data.is_object() {
        return Err(Error::Invariant("action dependencies object payload"));
    }
    let input: Input = serde_json::from_value(data.clone())?;
    let view = state.view();
    Ok(Some(json!({
        "available": input.types.iter().all(|name| view.registered_node_kind(name).is_some()),
    })))
}

#[cfg(test)]
mod test;
