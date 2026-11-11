//! Observe history from actual model state, independently of history metadata.
use super::*;

pub(super) fn observe(
    name: &ClientName,
    session: doc_sync_core::SessionId,
    editor: &document_session::DocumentSession<document_session::EditorSurface>,
    op: Option<&EditorOp>,
    changed: bool,
) -> Result<Fact, Failure> {
    let state = editor
        .conformance_synced_state()
        .map_err(|error| Failure::new("redo_restores_selection", error))?;
    let bytes = serde_json::to_vec(&state)
        .map_err(|error| Failure::new("redo_restores_selection", error))?;
    let selection = match (
        editor.surface().state().selection(),
        editor.surface().selection_cursors(),
    ) {
        (Some(selection), Some(cursors)) => {
            let (anchor, focus) = match selection {
                lexical_model::Selection::Range(range) => (range.anchor, range.focus),
                lexical_model::Selection::Table(table) => (table.anchor, table.focus),
                lexical_model::Selection::Node(_) => {
                    unreachable!("node selections have no cursors")
                }
            };
            serde_json::json!([
                [
                    cursors.anchor.node_id,
                    matches!(anchor, lexical_model::Point::Text { .. }),
                    anchor.offset()
                ],
                [
                    cursors.focus.node_id,
                    matches!(focus, lexical_model::Point::Text { .. }),
                    focus.offset()
                ],
            ])
        }
        (None, _) => serde_json::Value::Null,
        (Some(_), None) => {
            return Err(Failure::new(
                "redo_restores_selection",
                "selected editor has no inspectable durable endpoints",
            ));
        }
    };
    Ok(Fact::EditorSelectionObserved {
        client: name.clone(),
        session,
        state: xxhash_rust::xxh3::xxh3_64(&bytes),
        selection,
        undo_depth: editor.surface().history_depths().0,
        redo_depth: editor.surface().history_depths().1,
        history: match op {
            Some(EditorOp::Undo) => 1,
            Some(EditorOp::Redo) => 2,
            _ => 0,
        },
        changed,
    })
}
