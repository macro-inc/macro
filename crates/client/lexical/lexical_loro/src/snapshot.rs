//! Server-created snapshots descending from the frozen Markdown ancestor.
use super::*;
/// Export an arbitrary raw editor state, optionally seeding the shared ancestor.
/// Recorded timestamps intentionally remain enabled for parity with server snapshots;
/// live session documents use the separate timestamp-disabled projection constructor.
pub fn raw_state_to_loro_snapshot(
    state: &serde_json::Value,
    base: Option<&[u8]>,
) -> Result<Vec<u8>> {
    let doc = LoroDoc::new();
    doc.set_record_timestamp(true);
    if let Some(base) = base {
        doc.import(base)?;
    }
    let root = state.get("root").ok_or_else(|| schema_error("root"))?;
    mirror::set_state(&doc, root)?;
    Ok(doc.export(loro::ExportMode::Snapshot)?)
}
/// Seed a serialized editor state from the original common ancestor.
pub fn serialized_editor_state_to_loro_snapshot(state: &SerializedEditorState) -> Result<Vec<u8>> {
    raw_state_to_loro_snapshot(
        &serde_json::json!({"root":state.root}),
        Some(golden::MARKDOWN_GOLDEN),
    )
}

#[cfg(test)]
mod test;
