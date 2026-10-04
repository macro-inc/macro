//! The WebAssembly API used by the browser editor's worker.
//!
//! Structured values cross the boundary as JSON strings (parsed once on the
//! JavaScript side) and pixels as straight-alpha RGBA bytes ready for
//! `ImageData`. Positions and sizes are in points.

use crate::Document;
use crate::collab::{CollabState, V1State};
use crate::edit::{EditOp, FindOptions, Pos, RemoteChange, Session};
use crate::render::ImageCache;
use pptx_engine::font::FontDb;
use serde::Serialize;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

thread_local! {
    /// Fonts shared by every open document (the bundled set plus registered extras).
    static FONTS: RefCell<FontDb> = RefCell::new(bundled_fonts());
}

fn bundled_fonts() -> FontDb {
    let mut db = FontDb::new();
    for data in pptx_engine::font::embedded::FONTS {
        db.register(data.to_vec());
    }
    db
}

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn to_json(v: &impl Serialize) -> Result<String, JsError> {
    serde_json::to_string(v).map_err(js_err)
}

/// Registers an extra font file (TTF, OTF, or TTC) for every document.
/// The current time as Word writes revision dates (whole seconds, UTC).
fn now_iso() -> String {
    let iso: String = js_sys::Date::new_0().to_iso_string().into();
    match iso.split_once('.') {
        Some((head, _)) => format!("{head}Z"),
        None => iso,
    }
}

#[wasm_bindgen(js_name = registerFont)]
pub fn register_font(bytes: Vec<u8>) -> usize {
    FONTS.with(|f| f.borrow_mut().register(bytes).len())
}

/// A paragraph style offered in the style picker.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StyleInfo {
    id: String,
    name: String,
    quick: bool,
    priority: i64,
}

/// An open document with its editing session.
#[wasm_bindgen]
pub struct DocxDocument {
    session: Session,
    images: ImageCache,
}

impl DocxDocument {
    fn wrap(session: Session) -> Self {
        Self {
            session,
            images: ImageCache::new(),
        }
    }
}

#[wasm_bindgen]
impl DocxDocument {
    /// Opens a `.docx` file.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<DocxDocument, JsError> {
        console_error_panic_hook::set_once();
        let doc = Document::open(bytes).map_err(js_err)?;
        Ok(Self::wrap(Session::new(doc)))
    }

    /// Opens the document shared state describes (`CollabState` JSON).
    /// `seed` makes this peer's new ids unique.
    #[wasm_bindgen(js_name = fromCollab)]
    pub fn from_collab(state: &str, seed: f64) -> Result<DocxDocument, JsError> {
        console_error_panic_hook::set_once();
        let state: CollabState = serde_json::from_str(state).map_err(js_err)?;
        let session = Session::from_collab(&state, seed as u64).map_err(js_err)?;
        Ok(Self::wrap(session))
    }

    /// Opens a document stored in the first shared format (`V1State` JSON).
    #[wasm_bindgen(js_name = fromV1)]
    pub fn from_v1(state: &str) -> Result<DocxDocument, JsError> {
        console_error_panic_hook::set_once();
        let state: V1State = serde_json::from_str(state).map_err(js_err)?;
        let doc = Document::from_v1(&state).map_err(js_err)?;
        Ok(Self::wrap(Session::new(doc)))
    }

    /// The shared state of the document (`CollabState` JSON).
    #[wasm_bindgen(js_name = collabState)]
    pub fn collab_state(&self) -> Result<String, JsError> {
        to_json(&self.session.collab_state().map_err(js_err)?)
    }

    /// Leaves undo history to the caller (the shared document's).
    #[wasm_bindgen(js_name = setExternalUndo)]
    pub fn set_external_undo(&mut self, external: bool) {
        self.session.set_external_undo(external);
    }

    /// The name tracked changes are recorded under.
    #[wasm_bindgen(js_name = setAuthor)]
    pub fn set_author(&mut self, author: &str) {
        self.session.set_author(author);
    }

    /// Applies a JSON array of operations; returns the `EditResult` JSON.
    /// Batches with the same `group` merge into one undo step (typing).
    pub fn apply(&mut self, ops: &str, group: Option<String>) -> Result<String, JsError> {
        let ops: Vec<EditOp> = serde_json::from_str(ops).map_err(js_err)?;
        self.session.set_now(&now_iso());
        let result = FONTS
            .with(|f| self.session.apply(&ops, group.as_deref(), &f.borrow()))
            .map_err(js_err)?;
        to_json(&result)
    }

    /// Applies other peers' changes (`RemoteChange[]` JSON); returns the
    /// `EditResult` JSON.
    #[wasm_bindgen(js_name = applyRemote)]
    pub fn apply_remote(&mut self, changes: &str) -> Result<String, JsError> {
        let changes: Vec<RemoteChange> = serde_json::from_str(changes).map_err(js_err)?;
        let result = FONTS
            .with(|f| self.session.apply_remote(&changes, &f.borrow()))
            .map_err(js_err)?;
        to_json(&result)
    }

    /// The selection, its geometry and the pages (`EditResult` JSON).
    pub fn state(&mut self) -> Result<String, JsError> {
        let result = FONTS.with(|f| self.session.state(&f.borrow()));
        to_json(&result)
    }

    /// Pages with sizes and fingerprints (`PageInfo[]` JSON).
    pub fn pages(&mut self) -> Result<String, JsError> {
        let pages = FONTS.with(|f| self.session.pages(&f.borrow()));
        to_json(&pages)
    }

    /// Renders a page; returns straight-alpha RGBA rows (`width × height × 4`).
    pub fn render(&mut self, page: usize, width: u32) -> Result<Vec<u8>, JsError> {
        let width = width.clamp(16, 8192);
        FONTS.with(|f| {
            let fonts = f.borrow();
            let layout = self.session.layout(&fonts);
            let raster = self
                .session
                .document()
                .render_page(&layout, page, width, &fonts, &mut self.images)
                .ok_or_else(|| JsError::new("no such page"))?;
            Ok(raster.to_straight_rgba())
        })
    }

    /// The position at a point on a page (`Pos` JSON or `null`).
    #[wasm_bindgen(js_name = hitTest)]
    pub fn hit_test(&mut self, page: usize, x: f32, y: f32) -> Result<String, JsError> {
        let pos = FONTS.with(|f| self.session.hit_test(page, x, y, &f.borrow()));
        to_json(&pos)
    }

    /// The caret rectangle for a position (`CaretRect` JSON or `null`).
    #[wasm_bindgen(js_name = caretAt)]
    pub fn caret_at(&mut self, pos: &str) -> Result<String, JsError> {
        let pos: Pos = serde_json::from_str(pos).map_err(js_err)?;
        let caret = FONTS.with(|f| self.session.caret_at(&pos, &f.borrow()));
        to_json(&caret)
    }

    /// Highlight rectangles between two positions (`PageRect[]` JSON).
    #[wasm_bindgen(js_name = rangeRects)]
    pub fn range_rects(&mut self, from: &str, to: &str) -> Result<String, JsError> {
        let a: Pos = serde_json::from_str(from).map_err(js_err)?;
        let b: Pos = serde_json::from_str(to).map_err(js_err)?;
        let rects = FONTS.with(|f| self.session.range_rects(&a, &b, &f.borrow()));
        to_json(&rects)
    }

    /// The selection for the clipboard (`Clip` JSON: paragraphs, HTML, text).
    #[wasm_bindgen(js_name = copySelection)]
    pub fn copy_selection(&mut self) -> Result<String, JsError> {
        to_json(&self.session.copy_selection())
    }

    /// The matches of a search in the body (`FindResult` JSON); `options`
    /// is `FindOptions` JSON.
    pub fn find(&mut self, query: &str, options: &str) -> Result<String, JsError> {
        let options: FindOptions = serde_json::from_str(options).map_err(js_err)?;
        let result = FONTS.with(|f| self.session.find(query, &options, &f.borrow()));
        to_json(&result)
    }

    /// The selected text, for the clipboard.
    #[wasm_bindgen(js_name = selectedText)]
    pub fn selected_text(&mut self) -> String {
        self.session.selected_text()
    }

    /// The comments stored in the document, Word's (`DocComment[]` JSON).
    #[wasm_bindgen(js_name = documentComments)]
    pub fn document_comments(&self) -> Result<String, JsError> {
        to_json(&self.session.document_comments())
    }

    /// Paragraph ids and texts in document order (`ParagraphText[]` JSON).
    pub fn paragraphs(&self) -> Result<String, JsError> {
        to_json(&self.session.paragraphs())
    }

    /// Paragraph styles for the style picker (JSON).
    pub fn styles(&self) -> Result<String, JsError> {
        let styles = &self.session.document().parts().styles;
        let mut out: Vec<StyleInfo> = styles
            .all()
            .filter(|s| s.kind == crate::model::styles::StyleKind::Paragraph && !s.hidden)
            .map(|s| StyleInfo {
                id: s.id.clone(),
                name: s.name.clone(),
                quick: s.q_format,
                priority: s.ui_priority.unwrap_or(99),
            })
            .collect();
        out.sort_by(|a, b| (a.priority, &a.name).cmp(&(b.priority, &b.name)));
        to_json(&out)
    }

    /// Shows tracked changes inline (`true`) or the final text; returns the
    /// `EditResult` JSON.
    #[wasm_bindgen(js_name = setMarkup)]
    pub fn set_markup(&mut self, markup: bool) -> Result<String, JsError> {
        self.session.set_markup(markup);
        self.state()
    }

    /// Renders a strip of a page (`top..bottom` in points) at the page width
    /// `width`; returns straight-alpha RGBA rows.
    #[wasm_bindgen(js_name = renderBand)]
    pub fn render_band(
        &mut self,
        page: usize,
        width: u32,
        top: f32,
        bottom: f32,
    ) -> Result<Vec<u8>, JsError> {
        let width = width.clamp(16, 8192);
        FONTS.with(|f| {
            let fonts = f.borrow();
            let layout = self.session.layout(&fonts);
            let raster = self
                .session
                .document()
                .render_band(&layout, page, width, top, bottom, &fonts, &mut self.images)
                .ok_or_else(|| JsError::new("no such page"))?;
            Ok(raster.to_straight_rgba())
        })
    }

    /// Ends the current typing group.
    #[wasm_bindgen(js_name = breakGroup)]
    pub fn break_group(&mut self) {
        self.session.break_group();
    }

    /// Undoes one step (`EditResult` JSON), or `None` when there is none.
    pub fn undo(&mut self) -> Result<Option<String>, JsError> {
        FONTS
            .with(|f| self.session.undo(&f.borrow()))
            .map(|r| to_json(&r))
            .transpose()
    }

    /// Redoes one step.
    pub fn redo(&mut self) -> Result<Option<String>, JsError> {
        FONTS
            .with(|f| self.session.redo(&f.borrow()))
            .map(|r| to_json(&r))
            .transpose()
    }

    /// Whether undo is possible.
    #[wasm_bindgen(js_name = canUndo)]
    pub fn can_undo(&self) -> bool {
        self.session.can_undo()
    }

    /// Whether redo is possible.
    #[wasm_bindgen(js_name = canRedo)]
    pub fn can_redo(&self) -> bool {
        self.session.can_redo()
    }

    /// Serializes the current state to `.docx` bytes.
    pub fn save(&mut self) -> Result<Vec<u8>, JsError> {
        self.session.save().map_err(js_err)
    }

    /// Font families the document asked for that are not available (JSON array).
    #[wasm_bindgen(js_name = missingFonts)]
    pub fn missing_fonts(&self) -> Result<String, JsError> {
        FONTS.with(|f| to_json(&f.borrow().missing_families()))
    }
}
