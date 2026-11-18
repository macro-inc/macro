//! Shared raw-state serialization for production string and cold-query reads.
use crate::BoundaryError;
use lexical_model::EditorState;

pub(crate) fn serialize(state: &EditorState) -> Result<String, BoundaryError> {
    let _span = tracing::info_span!("editor.json.serialize").entered();
    Ok(state.to_json_string()?)
}

#[cfg(test)]
mod test;
