//! Export through the same owned registry and walker used by application copy.
use super::lexical::slot_arg;
use crate::replay::*;
use lexical_model::*;
use serde_json::{Value, json};
mod host;

pub(super) fn generate(
    r: &mut Replayer,
    tx: &mut Transaction<'_>,
    args: &[Value],
) -> Result<Value> {
    if !r.in_callback {
        return Err(ReplayError::NoActiveEditor);
    }
    if args.first().and_then(|value| value["$editor"].as_u64()) != Some(r.editor_id) {
        return Err(fail("HTML export requires the active editor"));
    }
    let selection = args
        .get(1)
        .filter(|value| !value.is_null() && value.get("$undef").is_none())
        .map(|value| -> Result<_> {
            let slot = slot_arg(r, tx, value)?;
            Ok(tx.capture_foreign_selection(slot)?)
        })
        .transpose()?
        .flatten();
    let view = r
        .read_state
        .as_ref()
        .map(EditorState::view)
        .unwrap_or(tx.view());
    let view = selection.as_ref().map_or(view, |argument| {
        view.with_foreign_selection_argument(argument)
    });
    let captured = view.snapshot_for_foreign_read()?;
    let exporter = lexical_html::HtmlExporter::new(
        macro_document_model::html::macro_export_registry(),
        tx.extension::<lexical_html::EditorTheme>()?.clone(),
    );
    let nodes = exporter.generate_dom_from_nodes(
        captured.state(),
        selection.as_ref().map(ForeignSelectionCapture::value),
    )?;
    Ok(json!(host::serialize(&nodes)?))
}
