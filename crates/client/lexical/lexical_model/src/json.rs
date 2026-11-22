//! Import policy shared by node types and transactions.
mod coercion;
mod parse;
mod write;
pub use coercion::{js_string, js_to_number};
/// Serialized field containing extensible node state.
pub const NODE_STATE_KEY: &str = "$";
/// The deepest a node may sit below the root, on every path that builds a tree: local
/// edits, JSON and clipboard import, and Loro reads. The release wasm build, with its
/// 1 MiB stack, first traps at about 1,300 nested elements in its recursive transform,
/// export and projection paths. Upstream has no such cap; a deeper tree fails with
/// [`Error::NestingTooDeep`] instead of trapping.
pub const MAX_NODE_DEPTH: usize = 512;
/// Deepest JSON nesting accepted before deserializing: two levels per nested node plus
/// the envelope and field values, so that [`MAX_NODE_DEPTH`] decides document depth.
/// Upstream `JSON.parse` has no 128-level cap; this bound keeps hostile input off the
/// stack.
pub const MAX_JSON_DEPTH: usize = 2 * MAX_NODE_DEPTH + 16;
/// Fail when any node of `state`'s tree sits deeper than [`MAX_NODE_DEPTH`]. Iterative, so
/// it is safe on a tree of any depth.
pub fn check_tree_depth(state: &EditorState) -> Result<(), Error> {
    let view = state.view();
    let mut stack = vec![(NodeKey::ROOT, 0usize)];
    while let Some((key, depth)) = stack.pop() {
        if depth > MAX_NODE_DEPTH {
            return Err(Error::NestingTooDeep {
                limit: MAX_NODE_DEPTH,
            });
        }
        stack.extend(view.children(key).map(|child| (child, depth + 1)));
    }
    Ok(())
}
/// Deserialize document JSON past serde_json's 128-level default, up to `MAX_JSON_DEPTH`.
pub fn from_json_str<'input, T: serde::Deserialize<'input>>(text: &'input str) -> Result<T, Error> {
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for byte in text.bytes() {
        if in_string {
            match byte {
                _ if escaped => escaped = false,
                b'\\' => escaped = true,
                b'"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match byte {
            b'"' => in_string = true,
            b'[' | b'{' => {
                depth += 1;
                if depth > MAX_JSON_DEPTH {
                    return Err(Error::Json(serde::de::Error::custom(format!(
                        "JSON nesting deeper than {MAX_JSON_DEPTH} levels"
                    ))));
                }
            }
            b']' | b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    let mut deserializer = serde_json::Deserializer::from_str(text);
    deserializer.disable_recursion_limit();
    let value = T::deserialize(&mut deserializer)?;
    deserializer.end()?;
    Ok(value)
}
/// Controls which fields a custom node importer accepts.
#[derive(Clone, Copy, Debug)]
pub struct JsonImport {
    /// State names to preserve.
    pub state: StateImportFilter,
    /// Import framework fields through virtual setters.
    pub base_fields: bool,
    /// Import user payload fields.
    pub own_fields: bool,
}
impl JsonImport {
    /// All state, base and own fields.
    pub const FULL: Self = Self {
        state: StateImportFilter::All,
        base_fields: true,
        own_fields: true,
    };
}
/// Extensible node state filtering during import.
#[derive(Clone, Copy, Debug)]
pub enum StateImportFilter {
    /// Keep every state name.
    All,
    /// Keep only the listed names.
    Only(&'static [&'static str]),
    /// Drop all imported state.
    None,
}

use crate::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
/// Pinned upstream semantics version.
pub const LEXICAL_VERSION: &str = "0.45.0";
/// An editor document; selection is intentionally not serialized.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SerializedEditorState {
    /// Serialized root and its descendants.
    pub root: SerializedNode,
}
/// Host-supplied epoch milliseconds; the model reads no clock.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct HistoryTime(pub u64);
/// The portable `@lexical/file` envelope.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedDocument {
    /// Document tree.
    pub editor_state: SerializedEditorState,
    /// Epoch milliseconds at save time.
    pub last_saved: u64,
    /// Origin of the document.
    pub source: String,
    /// Upstream semantics version.
    pub version: String,
}
impl SerializedDocument {
    /// Export with JavaScript's falsy fallback behavior for source and timestamp.
    pub fn from_state(
        state: &EditorState,
        source: Option<&str>,
        last_saved: Option<u64>,
        now: HistoryTime,
    ) -> Result<Self, Error> {
        Ok(Self {
            editor_state: state.to_json()?,
            last_saved: last_saved.filter(|time| *time != 0).unwrap_or(now.0),
            source: source
                .filter(|source| !source.is_empty())
                .unwrap_or("Lexical")
                .to_owned(),
            version: LEXICAL_VERSION.to_owned(),
        })
    }
}
impl EditorState {
    /// Export one document using JavaScript property ordering and number formatting.
    pub fn to_json_string(&self) -> Result<String, Error> {
        write::editor_state(self)
    }

    /// Export the root recursively, omitting the transient selection.
    pub fn to_json(&self) -> Result<SerializedEditorState, Error> {
        Ok(SerializedEditorState {
            root: self.view().export_node(NodeKey::ROOT)?,
        })
    }
}
impl Editor {
    /// Parse in an isolated pending state; errors leave the committed document intact.
    /// Parsing consumes keys but runs neither transforms nor normalization.
    pub fn parse_editor_state(
        &mut self,
        json: &SerializedEditorState,
    ) -> Result<EditorState, Error> {
        let report = self.parse_editor_state_report(json)?;
        if let Some(error) = report.error {
            return Err(error);
        }
        check_tree_depth(&report.state)?;
        Ok(report.state)
    }
    /// Parse without publishing, retaining the partial state alongside its import diagnostic.
    /// Hosts with a logging error handler may inspect this report; the ordinary parser remains strict.
    pub fn parse_editor_state_report(
        &mut self,
        json: &SerializedEditorState,
    ) -> Result<ParsedEditorState, Error> {
        if json.root.get("type").and_then(Value::as_str) != Some("root") {
            return Err(Error::ExpectedSerializedRoot);
        }
        let mut tx = self.json_transaction()?;
        let error = tx.import_node(&json.root).err();
        Ok(ParsedEditorState {
            state: tx.pending.clone(),
            error,
        })
    }
    fn json_transaction(&mut self) -> Result<Transaction<'_>, Error> {
        let mut tx = self.transaction();
        let shared = tx.pending.shared_state_configs.clone();
        tx.pending = EditorState::empty(tx.pending.registry.clone())?;
        tx.pending.shared_state_configs = shared;
        #[cfg(feature = "foreign-nodes")]
        {
            tx.pending.foreign_instances = tx.editor.foreign_instances.clone();
        }
        Ok(tx)
    }
    /// Parse a JSON document string without modifying the committed state.
    pub fn parse_editor_state_str(&mut self, json: &str) -> Result<EditorState, Error> {
        parse::editor_state(self, json)
    }
    /// Parse the document tree from a file envelope.
    pub fn state_from_serialized_document(
        &mut self,
        document: &SerializedDocument,
    ) -> Result<EditorState, Error> {
        self.parse_editor_state(&document.editor_state)
    }
    /// Decode a file envelope and parse its tree.
    pub fn state_from_serialized_document_str(
        &mut self,
        document: &str,
    ) -> Result<EditorState, Error> {
        self.state_from_serialized_document(&from_json_str(document)?)
    }
}
/// Match JavaScript truthiness for JSON-representable values.
pub fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value
            .as_f64()
            .is_some_and(|value| value != 0.0 && !value.is_nan()),
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}
/// Represent finite integral doubles exactly as JSON integers where possible.
/// Non-finite doubles stringify as null in JavaScript.
pub fn js_number(value: f64) -> Value {
    if !value.is_finite() {
        Value::Null
    } else if value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_992.0 {
        Value::from(value as i64)
    } else {
        Value::from(value)
    }
}
/// Serde adapter for user-owned floating point fields.
pub fn serialize_js_number<S: serde::Serializer>(
    value: &f64,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    js_number(*value).serialize(serializer)
}
/// Match JSON.stringify ordering, floating point notation and string escapes.
pub fn to_js_json_string(value: &Value) -> String {
    write::value(value)
}
#[cfg(test)]
mod test;

/// Non-publishing parse result for a host that handles import diagnostics explicitly.
pub struct ParsedEditorState {
    /// Complete state on success, or the state reached before the first import error.
    pub state: EditorState,
    /// First import failure, if the parse stopped early.
    pub error: Option<Error>,
}
