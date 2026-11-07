//! Development-only transaction facade for Tier C text/paragraph conformance.
//! WP-14 adds EditorCore and the session codec; WP-54 adds the foreign-node shim.
#![deny(missing_docs)]
use lexical_model::*;
use serde::Deserialize;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;
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
}

/// Pinned upstream version shared with the recorder.
#[wasm_bindgen]
pub fn upstream_version() -> String {
    "0.45.0".into()
}

/// Raw model transactions for the upstream text/paragraph profile.
#[wasm_bindgen]
pub struct CoreHandle {
    editor: Editor,
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
        Ok(Self { editor })
    }
    fn apply_json(&mut self, input: &str) -> Result<String, BoundaryError> {
        let command: Command = serde_json::from_str(input)?;
        #[cfg(feature = "js-nodes")]
        self.editor
            .set_conformance_mode(if command.is_view_input() {
                EditorMode::ViewAttached
            } else {
                EditorMode::Headless
            });
        let result = self.editor.update(|tx| command.apply(tx));
        let (commit, error) = match result {
            Ok(((), commit)) => (Some(commit), None),
            Err(error) => (None, Some(error.to_string())),
        };
        let mut value = snapshot::capture(
            self.editor.state(),
            commit.as_ref().filter(|c| !c.is_noop()),
        )?;
        value["error"] = json!(error);
        Ok(to_js_json_string(&value))
    }
}
#[cfg(test)]
mod test;
