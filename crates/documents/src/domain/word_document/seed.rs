//! The first collaborative snapshot of an uploaded DOCX, written exactly as
//! the web editor writes it when it seeds a document
//! (`apps/web/src/features/block-write/core/docx-loro.ts`, `writeCollabState`).
//! Block ids are assigned in document order, so every peer that seeds the same
//! upload derives the same ids and only one seed is ever stored.

use docx_engine::Document;
use docx_engine::collab::{CollabState, FORMAT_VERSION, container};
use docx_engine::model::content::DeltaOp;
use loro::{ExpandType, LoroDoc, LoroMap, LoroText, LoroValue, StyleConfig, TextDelta};
use std::collections::BTreeMap;

/// The Loro snapshot of `docx` as the editor's shared document.
pub fn seed_snapshot(docx: Vec<u8>) -> anyhow::Result<Vec<u8>> {
    let state = Document::open(docx)?.collab_state()?;
    let doc = LoroDoc::new();
    write_collab_state(&doc, &state)?;
    Ok(doc.export(loro::ExportMode::Snapshot)?)
}

fn write_collab_state(doc: &LoroDoc, state: &CollabState) -> anyhow::Result<()> {
    // A mark never grows over text typed next to it: the engine states the
    // full formatting of every insertion.
    doc.config_default_text_style(Some(StyleConfig {
        expand: ExpandType::None,
    }));
    for (name, entries) in [
        (container::PARTS, &state.parts),
        (container::TYPES, &state.types),
        (container::RELS, &state.rels),
    ] {
        let map = doc.get_map(name);
        for (key, value) in entries {
            map.insert(key, value.as_str())?;
        }
    }
    let blocks = doc.get_map(container::BLOCKS);
    for record in &state.blocks {
        let block = blocks.insert_container(record.id.as_str(), LoroMap::new())?;
        block.insert("k", record.k.as_str())?;
        block.insert("p", record.p.as_str())?;
        block.insert("o", record.o.as_str())?;
        block.insert("a", record.a.as_str())?;
        block.insert("x", record.x.as_str())?;
        if let Some(delta) = &record.t {
            let text = block.insert_container("t", LoroText::new())?;
            if !delta.is_empty() {
                text.apply_delta(&delta.iter().map(text_delta).collect::<Vec<_>>())?;
            }
        }
    }
    // JavaScript numbers are doubles; store the version the way the editor does.
    doc.get_map(container::META)
        .insert("formatVersion", f64::from(FORMAT_VERSION))?;
    doc.commit();
    Ok(())
}

fn text_delta(op: &DeltaOp) -> TextDelta {
    let marks = |attributes: &BTreeMap<String, serde_json::Value>| {
        (!attributes.is_empty()).then(|| {
            attributes
                .iter()
                .map(|(key, value)| (key.clone(), loro_value(value)))
                .collect()
        })
    };
    match op {
        DeltaOp::Insert { insert, attributes } => TextDelta::Insert {
            insert: insert.clone(),
            attributes: marks(attributes),
        },
        DeltaOp::Delete { delete } => TextDelta::Delete { delete: *delete },
        DeltaOp::Retain { retain, attributes } => TextDelta::Retain {
            retain: *retain,
            attributes: marks(attributes),
        },
    }
}

/// A JSON value as the web editor's Loro bindings store it.
fn loro_value(value: &serde_json::Value) -> LoroValue {
    match value {
        serde_json::Value::Null => LoroValue::Null,
        serde_json::Value::Bool(flag) => LoroValue::Bool(*flag),
        serde_json::Value::Number(number) => {
            number.as_f64().map_or(LoroValue::Null, LoroValue::Double)
        }
        serde_json::Value::String(text) => LoroValue::from(text.as_str()),
        serde_json::Value::Array(items) => {
            LoroValue::from(items.iter().map(loro_value).collect::<Vec<_>>())
        }
        serde_json::Value::Object(fields) => LoroValue::from(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), loro_value(value)))
                .collect::<std::collections::HashMap<_, _>>(),
        ),
    }
}

#[cfg(test)]
mod test;
