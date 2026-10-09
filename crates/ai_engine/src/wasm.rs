//! The WebAssembly API used by the web app's Illustrator editor worker.
//!
//! Structured values cross the boundary as JSON strings; pixels as straight
//! RGBA bytes. The worker holds one document, its undo history, and (when
//! editing together) the shared-map state.

use crate::collab::{Collab, EntryChange};
use crate::edit::{Applied, History, Op};
use crate::geom::{Point, Rect};
use crate::model::{AddedImage, Document};
use crate::render::{Options, Renderer, View};
use crate::{describe, inspect, save};
use serde::Serialize;
use wasm_bindgen::prelude::*;

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn to_json(v: &impl Serialize) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "null".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EditResult {
    created: Vec<u32>,
    dirty: Option<Rect>,
    structure: bool,
    can_undo: bool,
    can_redo: bool,
    undo_step: Option<u64>,
    redo_step: Option<u64>,
}

/// An open Illustrator document.
#[wasm_bindgen]
pub struct AiFile {
    doc: Document,
    renderer: Renderer,
    history: History,
    collab: Option<Collab>,
    warnings: Vec<String>,
}

#[wasm_bindgen]
impl AiFile {
    /// Opens an `.ai` (or `.pdf`) file.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<AiFile, JsError> {
        console_error_panic_hook::set_once();
        let opened = crate::build::open(&bytes).map_err(js_err)?;
        Ok(AiFile {
            doc: opened.document,
            renderer: Renderer::new(),
            history: History::new(),
            collab: None,
            warnings: opened.warnings,
        })
    }

    /// A new document's file: one artboard of `width × height` points.
    pub fn blank(width: f64, height: f64) -> Result<Vec<u8>, JsError> {
        save::blank_file(width, height).map_err(js_err)
    }

    /// Makes a font available to text layout (TTF, OTF, collection, WOFF,
    /// or WOFF2), named `family` when given; returns its faces as JSON.
    #[wasm_bindgen(js_name = registerFont)]
    pub fn register_font(bytes: Vec<u8>, family: Option<String>) -> String {
        let faces = fig_engine::text::register_font(bytes, family.as_deref());
        crate::text::clear_fonts();
        to_json(&faces)
    }

    /// The document's summary (`Summary` JSON).
    pub fn summary(&self) -> String {
        to_json(&inspect::summary(&self.doc))
    }

    /// What could not be read faithfully (`string[]` JSON).
    pub fn warnings(&self) -> String {
        to_json(&self.warnings)
    }

    /// The layers panel, top to bottom (`Row[]` JSON).
    pub fn rows(&self) -> String {
        to_json(&inspect::rows(&self.doc))
    }

    /// One node's properties (`Info` JSON, `null` when unknown).
    pub fn info(&self, id: u32) -> String {
        to_json(&inspect::info(&self.doc, id))
    }

    /// Draws `width × height` pixels of the canvas from `(x, y)` (canvas
    /// units) at `scale` pixels per unit; straight RGBA. `artboards` fills
    /// artboards white; `outline` draws paths as thin lines.
    #[expect(clippy::too_many_arguments, reason = "a view and how to draw it")]
    pub fn render(
        &mut self,
        x: f64,
        y: f64,
        scale: f64,
        width: u32,
        height: u32,
        artboards: bool,
        outline: bool,
    ) -> Vec<u8> {
        let view = View {
            x,
            y,
            scale: scale.clamp(1e-4, 1e4),
            width: width.clamp(1, 8192),
            height: height.clamp(1, 8192),
        };
        self.renderer
            .render(&self.doc, &view, &Options { artboards, outline })
    }

    /// One node alone, fitted in `size` pixels (PNG; empty when it draws
    /// nothing).
    pub fn thumbnail(&mut self, id: u32, size: u32) -> Vec<u8> {
        let Some(i) = self.doc.find(id) else {
            return Vec::new();
        };
        let Some(b) = crate::build::node_bounds(&self.doc, i) else {
            return Vec::new();
        };
        let scale = f64::from(size.max(1)) / b.width().max(b.height()).max(1e-6);
        let (w, h) = (
            (b.width() * scale).ceil().max(1.0) as u32,
            (b.height() * scale).ceil().max(1.0) as u32,
        );
        let view = View {
            x: b.x0,
            y: b.y0,
            scale,
            width: w,
            height: h,
        };
        let rgba = self.renderer.render_node(&self.doc, i, &view);
        inspect::encode_png(w, h, &rgba).unwrap_or_default()
    }

    /// An artboard (or the whole canvas) as PNG at `scale` pixels per
    /// point, over white unless `transparent`.
    #[wasm_bindgen(js_name = exportPng)]
    pub fn export_png(&mut self, artboard: Option<u32>, scale: f64, transparent: bool) -> Vec<u8> {
        let rect = artboard
            .and_then(|id| self.doc.artboard(id))
            .map_or_else(|| self.doc.canvas(), |a| a.rect);
        let scale = scale.clamp(0.01, 16.0);
        let (w, h) = (
            (rect.width() * scale).round().clamp(1.0, 16384.0) as u32,
            (rect.height() * scale).round().clamp(1.0, 16384.0) as u32,
        );
        let view = View {
            x: rect.x0,
            y: rect.y0,
            scale,
            width: w,
            height: h,
        };
        let rgba = self.renderer.render(
            &self.doc,
            &view,
            &Options {
                artboards: !transparent,
                outline: false,
            },
        );
        inspect::encode_png(w, h, &rgba).unwrap_or_default()
    }

    /// The topmost object at canvas `(x, y)`: the object itself (`deep`)
    /// or the outermost group holding it. `scale` is the view's pixels per
    /// unit.
    #[wasm_bindgen(js_name = hitTest)]
    pub fn hit_test(&self, x: f64, y: f64, scale: f64, deep: bool) -> Option<u32> {
        inspect::hit_test(&self.doc, x, y, scale, deep)
    }

    /// The objects a canvas rectangle touches (`number[]` JSON).
    #[wasm_bindgen(js_name = inRect)]
    pub fn in_rect(&self, x: f64, y: f64, w: f64, h: f64, deep: bool) -> String {
        to_json(&inspect::in_rect(
            &self.doc,
            Rect::from_xywh(x, y, w, h),
            deep,
        ))
    }

    /// The canvas bounds of nodes together (`Rect` JSON or `null`).
    pub fn bounds(&self, ids: &str) -> String {
        let ids: Vec<u32> = serde_json::from_str(ids).unwrap_or_default();
        to_json(&inspect::bounds(&self.doc, &ids))
    }

    /// Fonts text objects use (`FontUse[]` JSON).
    pub fn fonts(&self) -> String {
        to_json(&inspect::fonts(&self.doc))
    }

    /// The character index nearest a canvas point in a text object.
    #[wasm_bindgen(js_name = textHit)]
    pub fn text_hit(&self, id: u32, x: f64, y: f64) -> Option<usize> {
        let i = self.doc.find(id)?;
        let n = self.doc.node(i);
        let crate::model::NodeKind::Text(t) = &n.kind else {
            return None;
        };
        let local = n.transform.invert()?.apply(Point::new(x, y));
        Some(crate::text::hit(t, local))
    }

    /// A text object's lines and caret stops for the type tool
    /// (`TextGeometry` JSON, `null` for other nodes).
    #[wasm_bindgen(js_name = textGeometry)]
    pub fn text_geometry(&self, id: u32) -> String {
        let geometry = self.doc.find(id).and_then(|i| {
            let n = self.doc.node(i);
            match &n.kind {
                crate::model::NodeKind::Text(t) if !n.removed => {
                    Some(crate::text::geometry(t, n.transform))
                }
                _ => None,
            }
        });
        to_json(&geometry)
    }

    /// The document described for search and agents.
    pub fn describe(&self) -> String {
        describe::outline(&self.doc, 60_000)
    }

    fn result(&self, applied: &Applied) -> String {
        to_json(&EditResult {
            created: applied.created.clone(),
            dirty: applied.dirty,
            structure: applied.structure,
            can_undo: self.history.can_undo(),
            can_redo: self.history.can_redo(),
            undo_step: self.history.undo_step(),
            redo_step: self.history.redo_step(),
        })
    }

    fn after_local(&mut self, applied: &Applied) {
        if let Some(collab) = &mut self.collab {
            collab.record(&self.doc, applied);
        }
    }

    /// Applies operations (`Op[]` JSON) as one undoable step; steps with
    /// the same `coalesce` key in a row undo together. Returns an
    /// `EditResult` JSON.
    pub fn apply(&mut self, ops: &str, coalesce: Option<String>) -> Result<String, JsError> {
        let ops: Vec<Op> = serde_json::from_str(ops).map_err(js_err)?;
        let applied = self
            .history
            .apply(&mut self.doc, &ops, coalesce.as_deref())
            .map_err(js_err)?;
        self.after_local(&applied);
        Ok(self.result(&applied))
    }

    /// Undoes the last step (`EditResult` JSON).
    pub fn undo(&mut self) -> String {
        let applied = self.history.undo(&mut self.doc).unwrap_or_default();
        self.after_local(&applied);
        self.result(&applied)
    }

    /// Redoes the last undone step (`EditResult` JSON).
    pub fn redo(&mut self) -> String {
        let applied = self.history.redo(&mut self.doc).unwrap_or_default();
        self.after_local(&applied);
        self.result(&applied)
    }

    /// Places an image (PNG, JPEG, GIF, or WebP) filling a canvas
    /// rectangle (its pixel size at `(x, y)` when `w` is zero); returns an
    /// `EditResult` JSON.
    #[wasm_bindgen(js_name = placeImage)]
    #[expect(clippy::too_many_arguments, reason = "an image and where it goes")]
    pub fn place_image(
        &mut self,
        bytes: Vec<u8>,
        name: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        parent: Option<u32>,
    ) -> Result<String, JsError> {
        let (width, height, rgba) = inspect::decode_image(&bytes)
            .ok_or_else(|| js_err("not an image this editor can read"))?;
        let jpeg = bytes.starts_with(&[0xff, 0xd8]) && rgba.chunks_exact(4).all(|p| p[3] == 255);
        let hash = format!("{:016x}", content_hash(&bytes));
        let rect = if w > 0.0 && h > 0.0 {
            Rect::from_xywh(x, y, w, h)
        } else {
            Rect::from_xywh(x, y, f64::from(width), f64::from(height))
        };
        let op = Op::PlaceImage {
            name,
            rect,
            parent,
            hash,
            image: Some(AddedImage {
                width,
                height,
                rgba: rgba.into(),
                jpeg: jpeg.then(|| bytes.into()),
            }),
        };
        let applied = self
            .history
            .apply(&mut self.doc, &[op], None)
            .map_err(js_err)?;
        self.after_local(&applied);
        Ok(self.result(&applied))
    }

    /// The edited file, as `.ai` (PDF) bytes.
    pub fn save(&mut self) -> Result<Vec<u8>, JsError> {
        save::save(&self.doc).map_err(js_err)
    }

    /// Whether anything was edited since the file was opened.
    #[wasm_bindgen(js_name = isEdited)]
    pub fn is_edited(&self) -> bool {
        self.doc.edits != 0 || self.doc.nodes.iter().any(|n| n.edits != 0)
    }

    /// Starts editing together: new nodes get ids in `session`
    /// (`1..=4095`), and `seed` asks for the document's state (the first
    /// person in a new shared document). Returns `EntryChange[]` JSON to
    /// write.
    #[wasm_bindgen(js_name = enableCollab)]
    pub fn enable_collab(&mut self, session: u16, seed: bool) -> String {
        let mut collab = Collab::new(&mut self.doc, session);
        let changes = if seed {
            collab.seed(&self.doc)
        } else {
            Vec::new()
        };
        self.collab = Some(collab);
        to_json(&changes)
    }

    /// The entry changes since the last call (`EntryChange[]` JSON).
    #[wasm_bindgen(js_name = collabChanges)]
    pub fn collab_changes(&mut self) -> String {
        match &mut self.collab {
            Some(c) => to_json(&c.changes(&self.doc)),
            None => "[]".into(),
        }
    }

    /// Applies other people's entry changes (`EntryChange[]` JSON);
    /// returns an `EditResult` JSON of what changed.
    #[wasm_bindgen(js_name = applyCollab)]
    pub fn apply_collab(&mut self, changes: &str) -> Result<String, JsError> {
        let changes: Vec<EntryChange> = serde_json::from_str(changes).map_err(js_err)?;
        let Some(collab) = &mut self.collab else {
            return Err(js_err("collaboration is not on"));
        };
        let remote = collab.apply(&mut self.doc, &changes);
        Ok(to_json(&EditResult {
            created: Vec::new(),
            dirty: remote.dirty,
            structure: remote.structure,
            can_undo: self.history.can_undo(),
            can_redo: self.history.can_redo(),
            undo_step: self.history.undo_step(),
            redo_step: self.history.redo_step(),
        }))
    }
}

/// FNV-1a of bytes (placed images are shared by it).
fn content_hash(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h = (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3);
    }
    h
}
