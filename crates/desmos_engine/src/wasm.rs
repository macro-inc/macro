//! WebAssembly API used by the Desmos block worker.

use crate::document::GraphDocument;
use crate::plot::plot;
use wasm_bindgen::prelude::*;

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// One open graphing document.
#[wasm_bindgen]
pub struct DesmosGraph {
    document: GraphDocument,
}

#[wasm_bindgen]
impl DesmosGraph {
    /// Open stored JSON, or a blank graph when empty.
    #[wasm_bindgen(constructor)]
    pub fn new(json: &str) -> Result<DesmosGraph, JsError> {
        console_error_panic_hook::set_once();
        Ok(Self {
            document: GraphDocument::from_json(json).map_err(js_err)?,
        })
    }

    /// A blank graph's JSON.
    #[wasm_bindgen(js_name = blankJson)]
    pub fn blank_json() -> String {
        GraphDocument::default()
            .to_json()
            .unwrap_or_else(|_| "{\"version\":1}".into())
    }

    /// Current document JSON.
    pub fn to_json(&self) -> Result<String, JsError> {
        self.document.to_json().map_err(js_err)
    }

    /// `PlotScene` JSON for the current window.
    pub fn plot(&self) -> String {
        serde_json::to_string(&plot(&self.document)).unwrap_or_else(|_| "null".into())
    }

    /// Set one row's source.
    #[wasm_bindgen(js_name = setLatex)]
    pub fn set_latex(&mut self, id: &str, latex: &str) -> Result<(), JsError> {
        self.document
            .set_latex(id, latex.to_string())
            .map_err(js_err)
    }

    /// Set a row's color.
    #[wasm_bindgen(js_name = setColor)]
    pub fn set_color(&mut self, id: &str, color: &str) -> Result<(), JsError> {
        self.document
            .set_color(id, color.to_string())
            .map_err(js_err)
    }

    /// Hide or show a row.
    #[wasm_bindgen(js_name = setHidden)]
    pub fn set_hidden(&mut self, id: &str, hidden: bool) -> Result<(), JsError> {
        let expr = self
            .document
            .expressions
            .iter_mut()
            .find(|e| e.id == id)
            .ok_or_else(|| js_err(format!("unknown expression {id}")))?;
        expr.hidden = hidden;
        Ok(())
    }

    /// Append an empty row and return its id.
    #[wasm_bindgen(js_name = addExpression)]
    pub fn add_expression(&mut self) -> String {
        self.document.add_expression()
    }

    /// Remove a row.
    pub fn remove(&mut self, id: &str) -> Result<(), JsError> {
        let before = self.document.expressions.len();
        self.document.expressions.retain(|e| e.id != id);
        if self.document.expressions.len() == before {
            return Err(js_err(format!("unknown expression {id}")));
        }
        if self.document.expressions.is_empty() {
            self.document.add_expression();
        }
        Ok(())
    }

    /// Move the window.
    #[wasm_bindgen(js_name = setViewport)]
    pub fn set_viewport(&mut self, xmin: f64, xmax: f64, ymin: f64, ymax: f64) {
        if xmax > xmin && ymax > ymin {
            self.document.viewport.xmin = xmin;
            self.document.viewport.xmax = xmax;
            self.document.viewport.ymin = ymin;
            self.document.viewport.ymax = ymax;
        }
    }

    /// Set a slider by rewriting its assignment.
    #[wasm_bindgen(js_name = setSlider)]
    pub fn set_slider(&mut self, id: &str, value: f64) -> Result<(), JsError> {
        self.document.set_slider(id, value).map_err(js_err)
    }

    /// Add a missing parameter as `name=1` with a slider.
    #[wasm_bindgen(js_name = addSlider)]
    pub fn add_slider(&mut self, name: &str) -> Result<String, JsError> {
        let id = self.document.add_expression();
        self.document
            .set_latex(&id, format!("{name}=1"))
            .map_err(js_err)?;
        Ok(id)
    }
}
