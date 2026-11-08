//! Development-only raw-model facades for core and rich differential conformance.
//! WP-14 adds EditorCore and the session codec; WP-54 adds the foreign-node shim.
#![deny(missing_docs)]
use lexical_model::*;
use serde::Deserialize;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;
mod corpus;
pub use corpus::corpus_route;
mod gate;
pub use gate::gate_compare;
mod rich;
pub use rich::RichHandle;
mod command;
mod snapshot;
use command::Command;
#[derive(Debug, thiserror::Error)]
enum BoundaryError {
    #[error("v0 supports only the upstream profile")]
    UnsupportedProfile,
    #[error(transparent)]
    Build(#[from] BuildError),
    #[error(transparent)]
    Model(#[from] Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Rich(#[from] lexical_rich_nodes::Error),
    #[error(transparent)]
    Markdown(#[from] lexical_markdown::Error),
}

/// Pinned upstream version shared with the recorder.
#[wasm_bindgen]
pub fn upstream_version() -> String {
    env!("LEXICAL_UPSTREAM_VERSION").into()
}

/// Raw model transactions for the upstream text/paragraph profile.
#[wasm_bindgen]
pub struct CoreHandle {
    editor: Editor,
    #[cfg(feature = "js-nodes")]
    view_editor: Editor,
}
#[wasm_bindgen]
impl CoreHandle {
    /// Build one isolated editor. Version zero supports the upstream profile only.
    #[wasm_bindgen(constructor)]
    pub fn new(profile: &str, seed_state_json: Option<String>) -> Result<CoreHandle, JsError> {
        Self::create(profile, seed_state_json.as_deref()).map_err(|e| JsError::new(&e.to_string()))
    }
    /// Apply one version-zero JSON command atomically; return the complete comparison record.
    pub fn apply(&mut self, input: &str, now_ms: f64) -> Result<String, JsError> {
        if !now_ms.is_finite() || now_ms < 0.0 {
            return Err(JsError::new("invalid monotonic time"));
        }
        self.apply_json(input)
            .map_err(|e| JsError::new(&e.to_string()))
    }
    /// Export key-free upstream editor JSON.
    pub fn state_json(&self) -> Result<String, JsError> {
        self.editor
            .state()
            .to_json()
            .and_then(|v| serde_json::to_value(v).map_err(Into::into))
            .map(|v| to_js_json_string(&v))
            .map_err(|e| JsError::new(&e.to_string()))
    }
    /// Export the same path-based range selection as the differential oracle.
    pub fn selection_json(&self) -> Result<String, JsError> {
        snapshot::selection(self.editor.state())
            .map(|v| to_js_json_string(&v))
            .map_err(|e| JsError::new(&e.to_string()))
    }
    /// Full state, selection, identities and text before the first step.
    pub fn snapshot(&self) -> Result<String, JsError> {
        snapshot::capture(self.editor.state(), None)
            .map(|v| to_js_json_string(&v))
            .map_err(|e| JsError::new(&e.to_string()))
    }
}
impl CoreHandle {
    fn create(profile: &str, seed: Option<&str>) -> Result<Self, BoundaryError> {
        if profile != "upstream" {
            return Err(BoundaryError::UnsupportedProfile);
        }
        let mut editor = Editor::builder(EditorMode::Headless).build()?;
        if let Some(seed) = seed {
            let state = editor.parse_editor_state_str(seed)?;
            editor.set_editor_state(state, TagSet::default())?;
        } else {
            editor.update(|tx| {
                let p = tx.create(Paragraph::default())?;
                tx.append(NodeKey::ROOT, &[p.key()])?;
                tx.select_start(p)?;
                Ok(())
            })?;
        }
        #[cfg(feature = "js-nodes")]
        let view_editor = editor.create_conformance_peer(EditorMode::ViewAttached)?;
        Ok(Self {
            editor,
            #[cfg(feature = "js-nodes")]
            view_editor,
        })
    }
    fn apply_json(&mut self, input: &str) -> Result<String, BoundaryError> {
        let command: Command = serde_json::from_str(input)?;
        #[cfg(feature = "js-nodes")]
        if command.is_view_input() {
            Self::transfer_state(&mut self.view_editor, self.editor.state().clone())?;
            let value = Self::execute(&mut self.view_editor, &command)?;
            Self::transfer_state(&mut self.editor, self.view_editor.state().clone())?;
            return Ok(to_js_json_string(&value));
        }
        Self::execute(&mut self.editor, &command).map(|value| to_js_json_string(&value))
    }
    #[cfg(feature = "js-nodes")]
    fn transfer_state(editor: &mut Editor, state: EditorState) -> Result<(), BoundaryError> {
        if state.is_empty_state() {
            let root = state.view().export_json(NodeKey::ROOT)?;
            editor.update(|tx| {
                tx.clear(NodeKey::ROOT)?;
                tx.update_from_json(NodeKey::ROOT, &root)?;
                tx.set_selection(state.selection().cloned())
            })?;
        } else {
            editor.set_editor_state(state, TagSet::default())?;
        }
        Ok(())
    }
    fn execute(editor: &mut Editor, command: &Command) -> Result<Value, BoundaryError> {
        let result = editor.update(|tx| command.apply(tx));
        let (commit, error) = match result {
            Ok(((), commit)) => (Some(commit), None),
            Err(error) => (None, Some(error.to_string())),
        };
        let mut value =
            snapshot::capture(editor.state(), commit.as_ref().filter(|c| !c.is_noop()))?;
        value["error"] = json!(error);
        Ok(value)
    }
}
#[cfg(test)]
mod test;
