//! The WebAssembly API used by the browser editor's worker.
//!
//! Structured values cross the boundary as JSON strings (parsed once on the
//! JavaScript side) and pixels as straight-alpha RGBA bytes ready for
//! `ImageData`.

use crate::edit::{EditOp, Editor};
use crate::font::FontDb;
use crate::model::presentation::Presentation;
use crate::render::Layer;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

thread_local! {
    /// Fonts shared by every open document (the bundled set plus registered extras).
    static FONTS: RefCell<FontDb> = RefCell::new(bundled_fonts());
}

fn bundled_fonts() -> FontDb {
    let mut db = FontDb::new();
    for data in crate::font::embedded::FONTS {
        db.register(data.to_vec());
    }
    db
}

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn to_json(v: &impl serde::Serialize) -> Result<String, JsError> {
    serde_json::to_string(v).map_err(js_err)
}

/// Registers an extra font file (TTF, OTF, or TTC) for every document.
#[wasm_bindgen(js_name = registerFont)]
pub fn register_font(bytes: Vec<u8>) -> usize {
    FONTS.with(|f| f.borrow_mut().register(bytes).len())
}

/// An open presentation with undo history.
#[wasm_bindgen]
pub struct PptxDocument {
    editor: Editor,
}

#[wasm_bindgen]
impl PptxDocument {
    /// Opens a `.pptx` file.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<PptxDocument, JsError> {
        console_error_panic_hook::set_once();
        let pres = Presentation::open(bytes).map_err(js_err)?;
        Ok(Self { editor: Editor::new(pres) })
    }

    fn pres(&mut self) -> &mut Presentation {
        self.editor.presentation_mut()
    }

    /// Number of slides.
    #[wasm_bindgen(js_name = slideCount)]
    pub fn slide_count(&self) -> usize {
        self.editor.presentation().slides().len()
    }

    /// Slide size in points, `[width, height]`.
    #[wasm_bindgen(js_name = slideSize)]
    pub fn slide_size(&self) -> Vec<f64> {
        let (w, h) = self.editor.presentation().slide_size();
        vec![w as f64 / 12_700.0, h as f64 / 12_700.0]
    }

    /// The deck outline as JSON (`DeckOutline`).
    pub fn outline(&mut self) -> Result<String, JsError> {
        let o = self.pres().outline().map_err(js_err)?;
        to_json(&o)
    }

    /// One slide's outline as JSON (`SlideOutline`).
    #[wasm_bindgen(js_name = slideOutline)]
    pub fn slide_outline(&mut self, index: usize) -> Result<String, JsError> {
        let o = self.pres().slide_outline(index).map_err(js_err)?;
        to_json(&o)
    }

    /// Renders a slide; returns straight-alpha RGBA rows (`width × height × 4` bytes).
    pub fn render(&mut self, index: usize, width: u32) -> Result<Vec<u8>, JsError> {
        let width = width.clamp(16, 8192);
        let raster = FONTS.with(|f| self.pres().render_slide(index, width, &f.borrow())).map_err(js_err)?;
        Ok(raster.to_straight_rgba())
    }

    /// Renders one layer of a slide: `mode` is `"without"` (everything except
    /// the shape) or `"only"` (the shape alone over transparency).
    #[wasm_bindgen(js_name = renderLayer)]
    pub fn render_layer(&mut self, index: usize, width: u32, mode: &str, shape: u32) -> Result<Vec<u8>, JsError> {
        let layer = match mode {
            "without" => Layer::Without(shape),
            "only" => Layer::Only(shape),
            other => return Err(JsError::new(&format!("unknown layer mode `{other}`"))),
        };
        let width = width.clamp(16, 8192);
        let raster = FONTS.with(|f| self.pres().render_layer(index, layer, width, &f.borrow())).map_err(js_err)?;
        Ok(raster.to_straight_rgba())
    }

    /// Lays out a shape's text for carets as JSON (`TextLayoutInfo`, or `null`).
    #[wasm_bindgen(js_name = textLayout)]
    pub fn text_layout(&mut self, index: usize, shape: u32) -> Result<String, JsError> {
        let lay = FONTS.with(|f| self.pres().text_layout(index, shape, None, &f.borrow())).map_err(js_err)?;
        to_json(&lay)
    }

    /// Applies a JSON array of edit operations atomically; returns the `EditResult` as JSON.
    ///
    /// Batches with the same `group` merge into one undo step (typing).
    pub fn apply(&mut self, ops: &str, group: Option<String>) -> Result<String, JsError> {
        let ops: Vec<EditOp> = serde_json::from_str(ops).map_err(js_err)?;
        let result = FONTS.with(|f| self.editor.apply(&ops, group.as_deref(), &f.borrow())).map_err(js_err)?;
        to_json(&result)
    }

    /// Ends the current typing group.
    #[wasm_bindgen(js_name = breakGroup)]
    pub fn break_group(&mut self) {
        self.editor.break_group();
    }

    /// Undoes one step; returns the `EditResult` JSON, or `None` when there is nothing to undo.
    pub fn undo(&mut self) -> Result<Option<String>, JsError> {
        self.editor.undo().map(|r| to_json(&r)).transpose()
    }

    /// Redoes one step.
    pub fn redo(&mut self) -> Result<Option<String>, JsError> {
        self.editor.redo().map(|r| to_json(&r)).transpose()
    }

    /// Whether undo is possible.
    #[wasm_bindgen(js_name = canUndo)]
    pub fn can_undo(&self) -> bool {
        self.editor.can_undo()
    }

    /// Whether redo is possible.
    #[wasm_bindgen(js_name = canRedo)]
    pub fn can_redo(&self) -> bool {
        self.editor.can_redo()
    }

    /// Serializes the current state to `.pptx` bytes.
    pub fn save(&mut self) -> Result<Vec<u8>, JsError> {
        self.editor.save().map_err(js_err)
    }

    /// Font families the document asked for that are not available (JSON array).
    #[wasm_bindgen(js_name = missingFonts)]
    pub fn missing_fonts(&self) -> Result<String, JsError> {
        FONTS.with(|f| to_json(&f.borrow().missing_families()))
    }
}
