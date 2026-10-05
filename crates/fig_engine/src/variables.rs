//! Resolves variable values for both scene rendering and editing.

use crate::document::Document;
use crate::model::{Guid, VariableValue};

/// Aliases followed at most this deep (guards against cycles).
const MAX_ALIAS_DEPTH: usize = 16;

/// The value of variable `var` where `modes` (nearest first: each a
/// layer's `(collection, mode)` choices) apply; a collection no layer
/// picks a mode for uses its first mode.
pub(crate) fn resolve(
    doc: &Document,
    var: Guid,
    modes: &[&[(Guid, Guid)]],
) -> Option<VariableValue> {
    let mut var = var;
    for _ in 0..MAX_ALIAS_DEPTH {
        let v = doc.props(doc.find(var)?).variable.clone()?;
        let set = v.set;
        let mode = set
            .and_then(|s| {
                modes
                    .iter()
                    .find_map(|m| m.iter().find(|(c, _)| *c == s).map(|(_, mode)| *mode))
            })
            .or_else(|| {
                let first = doc
                    .props(doc.find(set?)?)
                    .variable_modes
                    .as_ref()?
                    .first()?
                    .id;
                Some(first)
            });
        let value = mode
            .and_then(|m| v.values.iter().find(|(id, _)| *id == m))
            .or_else(|| v.values.first())
            .map(|(_, value)| value.clone())?;
        match value {
            VariableValue::Alias(next) => var = next,
            other => return Some(other),
        }
    }
    None
}
