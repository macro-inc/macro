//! Document version policy; notifications are projected from root state by the view.
use super::*;
use serde_json::{Value, json};
use std::sync::{Arc, LazyLock};

static DEFAULT_METADATA: LazyLock<Arc<Value>> = LazyLock::new(|| Arc::new(json!({"version": -1})));

/// Current stored document schema version, synchronized with the web version counter.
pub const DOCUMENT_VERSION: f64 = 10.0;
/// Source-compatible document metadata parser, isolated to live application surfaces.
pub static DOCUMENT_METADATA: StateKey<Arc<Value>> = StateKey::new("documentMetadata", |value| {
    let Some(value) = value.filter(|value| value.is_object() || value.is_array()) else {
        return Arc::clone(&DEFAULT_METADATA);
    };
    let version = value
        .get("version")
        .filter(|value| value.is_number())
        .cloned()
        .unwrap_or(json!(-1));
    let tags = value
        .get("environmentTags")
        .and_then(Value::as_array)
        .map(|tags| Value::Array(tags.iter().filter(|tag| tag.is_string()).cloned().collect()))
        .unwrap_or(Value::Null);
    Arc::new(json!({"version": version, "environmentTags": tags}))
});

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder
        .state_export_order::<Root>(&["id", "documentMetadata"])
        .plugin(Metadata)
}
struct Metadata;
impl Plugin for Metadata {
    fn name(&self) -> &'static str {
        "group-b.document-metadata"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        let current = tx.get_state(NodeKey::ROOT, &DOCUMENT_METADATA)?;
        if tx.is_initializing() || commit.changes.mutations.is_empty() {
            return Ok(());
        }
        let previous = commit
            .prev
            .view()
            .get_state(NodeKey::ROOT, &DOCUMENT_METADATA)?;
        if previous
            .get("version")
            .and_then(Value::as_f64)
            .unwrap_or(-1.0)
            < DOCUMENT_VERSION
        {
            // The source schedules a follow-up even when another update upgraded metadata.
            // Avoid a redundant identity-only state write once the value is current.
            if current.get("version").and_then(Value::as_f64) != Some(DOCUMENT_VERSION) {
                let mut metadata = current
                    .as_object()
                    .cloned()
                    .ok_or(Error::Invariant("document metadata object"))?;
                metadata.insert("version".into(), lexical_model::js_number(DOCUMENT_VERSION));
                tx.add_tag(UpdateTag::HistoryMerge);
                tx.set_state(
                    NodeKey::ROOT,
                    &DOCUMENT_METADATA,
                    Arc::new(Value::Object(metadata)),
                )?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod parser_test;
