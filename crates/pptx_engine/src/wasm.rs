//! The WebAssembly API used by the browser editor's worker.
//!
//! Structured values cross the boundary as JSON strings (parsed once on the
//! JavaScript side) and pixels as straight-alpha RGBA bytes ready for
//! `ImageData`.

use crate::collab::{Entries, EntryChange};
use crate::edit::{CellRef, EditOp, Editor, FindOptions};
use crate::font::FontDb;
use crate::model::field::FieldTime;
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

/// The browser's local time, which automatic date fields show.
fn local_now() -> FieldTime {
    let d = js_sys::Date::new_0();
    FieldTime {
        year: d.get_full_year() as i32,
        month: (d.get_month() + 1) as u8,
        day: d.get_date() as u8,
        hour: d.get_hours() as u8,
        minute: d.get_minutes() as u8,
        second: d.get_seconds() as u8,
    }
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

/// A preset shape's outline at `w`×`h` points as JSON `[{d, fill, stroke}]`
/// (SVG path data), or `null` for an unknown preset. For shape galleries.
#[wasm_bindgen(js_name = presetPaths)]
pub fn preset_paths(name: &str, w: f64, h: f64) -> Result<String, JsError> {
    to_json(&crate::geometry::preset_svg(name, w, h))
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
        let mut pres = Presentation::open(bytes).map_err(js_err)?;
        pres.set_clock(Some(local_now()));
        Ok(Self {
            editor: Editor::new(pres),
        })
    }

    /// Opens the presentation that shared collaborative entries describe
    /// (`Entries` JSON). `seed` makes this peer's new names and ids unique.
    #[wasm_bindgen(js_name = fromEntries)]
    pub fn from_entries(entries: &str, seed: f64) -> Result<PptxDocument, JsError> {
        console_error_panic_hook::set_once();
        let entries: Entries = serde_json::from_str(entries).map_err(js_err)?;
        let mut pres = Presentation::from_entries(entries, seed as u64).map_err(js_err)?;
        pres.set_clock(Some(local_now()));
        Ok(Self {
            editor: Editor::new(pres),
        })
    }

    /// Starts collaborative editing of a file opened with the constructor;
    /// the next `collabChanges` describes the whole presentation.
    #[wasm_bindgen(js_name = enableCollab)]
    pub fn enable_collab(&mut self, seed: f64) {
        self.pres().enable_collab(seed as u64);
    }

    /// Entry changes the shared maps need after local edits since the last
    /// call (JSON `EntryChange[]`).
    #[wasm_bindgen(js_name = collabChanges)]
    pub fn collab_changes(&mut self) -> Result<String, JsError> {
        let changes = self.pres().collab_changes().map_err(js_err)?;
        to_json(&changes)
    }

    /// Applies entry changes from the shared maps (other peers, undo, redo);
    /// returns the `EditResult` as JSON.
    #[wasm_bindgen(js_name = applyCollab)]
    pub fn apply_collab(&mut self, changes: &str) -> Result<String, JsError> {
        let changes: Vec<EntryChange> = serde_json::from_str(changes).map_err(js_err)?;
        let result = self.pres().apply_collab_changes(&changes).map_err(js_err)?;
        to_json(&result)
    }

    fn pres(&mut self) -> &mut Presentation {
        self.editor.presentation_mut()
    }

    /// Brings the time automatic date fields show up to date (an undo may
    /// have restored an older one).
    fn tick(&mut self) {
        self.pres().set_clock(Some(local_now()));
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
        let o = FONTS
            .with(|f| self.pres().outline_with_fonts(&f.borrow()))
            .map_err(js_err)?;
        to_json(&o)
    }

    /// One slide's outline as JSON (`SlideOutline`).
    #[wasm_bindgen(js_name = slideOutline)]
    pub fn slide_outline(&mut self, index: usize) -> Result<String, JsError> {
        let o = FONTS
            .with(|f| self.pres().slide_outline_with_fonts(index, &f.borrow()))
            .map_err(js_err)?;
        to_json(&o)
    }

    /// Renders a slide; returns straight-alpha RGBA rows (`width × height × 4` bytes).
    pub fn render(&mut self, index: usize, width: u32) -> Result<Vec<u8>, JsError> {
        self.tick();
        let width = width.clamp(16, 8192);
        let raster = FONTS
            .with(|f| self.pres().render_slide(index, width, &f.borrow()))
            .map_err(js_err)?;
        Ok(raster.to_straight_rgba())
    }

    /// Renders one layer of a slide: `mode` is `"without"` (everything except
    /// the shape) or `"only"` (the shape alone over transparency).
    #[wasm_bindgen(js_name = renderLayer)]
    pub fn render_layer(
        &mut self,
        index: usize,
        width: u32,
        mode: &str,
        shape: u32,
    ) -> Result<Vec<u8>, JsError> {
        let layer = match mode {
            "without" => Layer::Without(shape),
            "only" => Layer::Only(shape),
            other => return Err(JsError::new(&format!("unknown layer mode `{other}`"))),
        };
        self.tick();
        let width = width.clamp(16, 8192);
        let raster = FONTS
            .with(|f| self.pres().render_layer(index, layer, width, &f.borrow()))
            .map_err(js_err)?;
        Ok(raster.to_straight_rgba())
    }

    /// Renders the top-level slide shapes at z-order positions `start..end`
    /// (see `Layer::Span`), over the background and inherited shapes when
    /// `backdrop`.
    #[wasm_bindgen(js_name = renderSpan)]
    pub fn render_span(
        &mut self,
        index: usize,
        width: u32,
        start: usize,
        end: usize,
        backdrop: bool,
    ) -> Result<Vec<u8>, JsError> {
        self.tick();
        let width = width.clamp(16, 8192);
        let layer = Layer::Span {
            start,
            end,
            backdrop,
        };
        let raster = FONTS
            .with(|f| self.pres().render_layer(index, layer, width, &f.borrow()))
            .map_err(js_err)?;
        Ok(raster.to_straight_rgba())
    }

    /// Lays out a shape's text for carets as JSON (`TextLayoutInfo`, or `null`);
    /// with `row` and `col`, the text of that table cell.
    #[wasm_bindgen(js_name = textLayout)]
    pub fn text_layout(
        &mut self,
        index: usize,
        shape: u32,
        row: Option<usize>,
        col: Option<usize>,
    ) -> Result<String, JsError> {
        let cell = match (row, col) {
            (Some(row), Some(col)) => Some(CellRef { row, col }),
            (None, None) => None,
            _ => return Err(JsError::new("give both `row` and `col` for a table cell")),
        };
        let lay = FONTS
            .with(|f| self.pres().text_layout(index, shape, cell, &f.borrow()))
            .map_err(js_err)?;
        to_json(&lay)
    }

    /// A slide's clickable areas as JSON (`LinkRegion[]`): linked text, then
    /// linked shapes.
    #[wasm_bindgen(js_name = linkRegions)]
    pub fn link_regions(&mut self, index: usize) -> Result<String, JsError> {
        let regions = FONTS
            .with(|f| self.pres().link_regions(index, &f.borrow()))
            .map_err(js_err)?;
        to_json(&regions)
    }

    /// Applies a JSON array of edit operations atomically; returns the `EditResult` as JSON.
    ///
    /// Batches with the same `group` merge into one undo step (typing).
    pub fn apply(&mut self, ops: &str, group: Option<String>) -> Result<String, JsError> {
        let ops: Vec<EditOp> = serde_json::from_str(ops).map_err(js_err)?;
        self.tick();
        // Collaborative undo runs on the shared maps, not on local snapshots.
        let result = if self.editor.presentation().is_collaborative() {
            FONTS.with(|f| self.pres().apply(&ops, &f.borrow()))
        } else {
            FONTS.with(|f| self.editor.apply(&ops, group.as_deref(), &f.borrow()))
        }
        .map_err(js_err)?;
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

    /// Copies shapes of slide `index` (`ids`: JSON array of shape ids) as a
    /// clipboard payload (JSON) for the `pasteShapes` operation.
    #[wasm_bindgen(js_name = copyShapes)]
    pub fn copy_shapes(&mut self, index: usize, ids: &str) -> Result<String, JsError> {
        let ids: Vec<u32> = serde_json::from_str(ids).map_err(js_err)?;
        let payload = self.pres().copy_shapes(index, &ids).map_err(js_err)?;
        to_json(&payload)
    }

    /// Copies slides (`ids`: JSON array of slide ids) with their notes as a
    /// clipboard payload (JSON) for the `pasteSlides` operation.
    #[wasm_bindgen(js_name = copySlides)]
    pub fn copy_slides(&mut self, ids: &str) -> Result<String, JsError> {
        let ids: Vec<u32> = serde_json::from_str(ids).map_err(js_err)?;
        let payload = self.pres().copy_slides(&ids).map_err(js_err)?;
        to_json(&payload)
    }

    /// Finds text in every slide (`options`: `FindOptions` JSON); returns
    /// `TextMatch[]` JSON.
    #[wasm_bindgen(js_name = findText)]
    pub fn find_text(&mut self, query: &str, options: &str) -> Result<String, JsError> {
        let options: FindOptions = if options.trim().is_empty() {
            FindOptions::default()
        } else {
            serde_json::from_str(options).map_err(js_err)?
        };
        let matches = self.pres().find_text(query, options).map_err(js_err)?;
        to_json(&matches)
    }
}
