//! Golden-seeded snapshots with explicit constructor time, entropy and hostname.
use crate::{DocumentContext, Result, notion::NotionLinks};
/// Loro snapshot and the corresponding Macro Markdown returned by Notion import.
#[derive(Clone, Debug)]
pub struct NotionSnapshot {
    /// Binary snapshot descending from the common Markdown ancestor.
    pub snapshot: Vec<u8>,
    /// Macro Markdown using the source combined transformer order.
    pub markdown: String,
}
/// Exact empty input retains the shared ancestor bytes; whitespace is parsed normally.
pub fn markdown_to_loro_snapshot(markdown: &str, context: &DocumentContext) -> Result<Vec<u8>> {
    if markdown.is_empty() {
        return Ok(lexical_loro::golden::MARKDOWN_GOLDEN.to_vec());
    }
    let state = crate::markdown::markdown_to_serialized_editor_state_with_ids(markdown, context)?;
    snapshot_state(&state)
}
/// Notion whitespace uses JavaScript trim semantics and retains the frozen ancestor.
pub fn notion_markdown_to_loro_snapshot(
    markdown: &str,
    links: &NotionLinks,
    context: &DocumentContext,
) -> Result<NotionSnapshot> {
    if lexical_model::js_trim(markdown).is_empty() {
        return Ok(NotionSnapshot {
            snapshot: lexical_loro::golden::MARKDOWN_GOLDEN.to_vec(),
            markdown: String::new(),
        });
    }
    let state =
        crate::notion::notion_markdown_to_serialized_editor_state(markdown, links, context)?;
    Ok(NotionSnapshot {
        snapshot: snapshot_state(&state)?,
        markdown: crate::markdown::serialized_editor_state_to_markdown(&state, context)?,
    })
}

// JSON.stringify omits own undefined properties, while the source mirror inserts
// them as Loro null. Reconstruct that distinction only at this storage boundary.
fn snapshot_state(state: &lexical_model::SerializedEditorState) -> Result<Vec<u8>> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Properties {
        own_undefined: std::collections::BTreeMap<String, Vec<String>>,
    }
    let properties: Properties = serde_json::from_str(include_str!("wire-properties.json"))?;
    let mut raw = serde_json::to_value(state)?;
    restore_undefined(&mut raw["root"], &properties.own_undefined);
    Ok(lexical_loro::snapshot::raw_state_to_loro_snapshot(
        &raw,
        Some(lexical_loro::golden::MARKDOWN_GOLDEN),
    )?)
}
fn restore_undefined(
    node: &mut serde_json::Value,
    fields: &std::collections::BTreeMap<String, Vec<String>>,
) {
    if let Some(own) = node.as_object_mut() {
        if let Some(names) = own
            .get("type")
            .and_then(serde_json::Value::as_str)
            .and_then(|ty| fields.get(ty))
        {
            for name in names {
                own.entry(name).or_insert(serde_json::Value::Null);
            }
        }
        if let Some(children) = own
            .get_mut("children")
            .and_then(serde_json::Value::as_array_mut)
        {
            for child in children {
                restore_undefined(child, fields);
            }
        }
    }
}
