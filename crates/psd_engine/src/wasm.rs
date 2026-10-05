//! The WebAssembly API used by the web app's Photoshop editor worker.
//!
//! Structured values cross the boundary as JSON strings; pixels as straight
//! RGBA bytes. The worker holds one document, its undo history, this
//! person's selection, and (when editing together) the shared-map state.

use crate::collab::Collab;
use crate::edit::select::{self, SelectMode};
use crate::edit::{Applied, History, Op, Position};
use crate::model::Document;
use crate::raster::{IRect, Selection};
use crate::render::Renderer;
use crate::{describe, inspect, save};
use serde::{Deserialize, Serialize};
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
    dirty: Option<IRect>,
    all: bool,
    structure: bool,
    can_undo: bool,
    can_redo: bool,
    undo_step: Option<u64>,
    redo_step: Option<u64>,
    /// Shared tile prefixes to pass back (other people's changes only).
    wants: Vec<String>,
}

/// A selection request.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
enum SelectSpec {
    Rect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        #[serde(default)]
        mode: SelectMode,
        #[serde(default)]
        feather: f32,
    },
    Ellipse {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        #[serde(default)]
        mode: SelectMode,
        #[serde(default)]
        feather: f32,
        #[serde(default = "yes")]
        antialias: bool,
    },
    Polygon {
        points: Vec<(f32, f32)>,
        #[serde(default)]
        mode: SelectMode,
        #[serde(default)]
        feather: f32,
        #[serde(default = "yes")]
        antialias: bool,
    },
    Wand {
        x: i32,
        y: i32,
        tolerance: u8,
        contiguous: bool,
        #[serde(default = "yes")]
        antialias: bool,
        /// Samples the merged image rather than `layer`.
        #[serde(default)]
        sample_all: bool,
        layer: Option<u32>,
        #[serde(default)]
        mode: SelectMode,
    },
    All,
    None,
    Invert,
    Feather {
        radius: f32,
    },
    Expand {
        pixels: i32,
    },
    /// A layer's transparency (or its mask's values).
    Layer {
        id: u32,
        #[serde(default)]
        mask: bool,
        #[serde(default)]
        mode: SelectMode,
    },
}

fn yes() -> bool {
    true
}

/// The selection's state for the marching ants.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectionInfo {
    bounds: Option<IRect>,
    outline: Vec<Vec<(f32, f32)>>,
}

/// Points of marching ants outlines at most.
const OUTLINE_POINTS: usize = 20_000;

/// An open Photoshop document.
#[wasm_bindgen]
pub struct PsdFile {
    doc: Document,
    renderer: Renderer,
    history: History,
    selection: Selection,
    collab: Option<Collab>,
    warnings: Vec<String>,
}

#[wasm_bindgen]
impl PsdFile {
    /// Opens a `.psd` or `.psb` file.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<PsdFile, JsError> {
        console_error_panic_hook::set_once();
        let opened = crate::document::open(&bytes, Default::default()).map_err(js_err)?;
        Ok(PsdFile {
            doc: opened.document,
            renderer: Renderer::new(),
            history: History::default(),
            selection: Selection::none(),
            collab: None,
            warnings: opened.warnings,
        })
    }

    /// A new document's file: a white Background, or one transparent layer.
    pub fn blank(width: u32, height: u32, white: bool) -> Result<Vec<u8>, JsError> {
        save::blank_file(width, height, white).map_err(js_err)
    }

    /// Makes a font available to text layout (TTF, OTF, collection, WOFF,
    /// or WOFF2), named `family` when given; returns its faces as JSON.
    #[wasm_bindgen(js_name = registerFont)]
    pub fn register_font(bytes: Vec<u8>, family: Option<String>) -> String {
        to_json(&fig_engine::text::register_font(bytes, family.as_deref()))
    }

    /// The document's summary (`Summary` JSON).
    pub fn summary(&self) -> String {
        to_json(&inspect::summary(&self.doc))
    }

    /// What could not be read in the file (`string[]` JSON).
    pub fn warnings(&self) -> String {
        to_json(&self.warnings)
    }

    /// The layers panel, top to bottom (`LayerRow[]` JSON).
    pub fn layers(&self) -> String {
        to_json(&inspect::layers(&self.doc))
    }

    /// One layer's properties (`LayerInfo` JSON, `null` when unknown).
    #[wasm_bindgen(js_name = layerInfo)]
    pub fn layer_info(&self, id: u32) -> String {
        to_json(&inspect::layer_info(&self.doc, id))
    }

    /// Composites `width × height` pixels of the canvas scaled by
    /// `1/2^level`, from `(x, y)` in that scale's pixels; straight RGBA.
    pub fn render(&mut self, x: i32, y: i32, level: u8, width: u32, height: u32) -> Vec<u8> {
        let rect = IRect::new(x, y, width as i32, height as i32);
        self.renderer.render(&self.doc, rect, level.min(16))
    }

    /// The topmost layer drawing at canvas `(x, y)`.
    #[wasm_bindgen(js_name = hitTest)]
    pub fn hit_test(&mut self, x: i32, y: i32) -> Option<u32> {
        inspect::hit_test(&self.doc, &mut self.renderer, x, y)
    }

    /// The color at canvas `(x, y)` of the merged image or one layer
    /// (straight RGBA).
    pub fn sample(&mut self, x: i32, y: i32, layer: Option<u32>) -> Vec<u8> {
        inspect::sample(&self.doc, &mut self.renderer, x, y, layer).to_vec()
    }

    /// A layer's thumbnail (PNG, empty when it draws nothing).
    pub fn thumbnail(&mut self, id: u32, size: u32) -> Vec<u8> {
        inspect::thumbnail(&self.doc, &mut self.renderer, id, size)
    }

    /// The merged image fitted in `size` pixels (PNG).
    pub fn preview(&mut self, size: u32) -> Vec<u8> {
        inspect::preview(&self.doc, &mut self.renderer, size)
    }

    /// Fonts text layers use and whether each is available (JSON).
    pub fn fonts(&self) -> String {
        to_json(&inspect::fonts(&self.doc))
    }

    /// The document described for search and agents.
    pub fn describe(&self) -> String {
        describe::outline(&self.doc, 60_000)
    }

    fn result(&self, applied: &Applied, wants: Vec<String>) -> String {
        to_json(&EditResult {
            created: applied.created.clone(),
            dirty: applied.dirty,
            all: applied.all,
            structure: applied.structure,
            can_undo: self.history.can_undo(),
            can_redo: self.history.can_redo(),
            undo_step: self.history.undo_step(),
            redo_step: self.history.redo_step(),
            wants,
        })
    }

    fn after_local(&mut self, applied: &Applied) {
        if let Some(collab) = &mut self.collab {
            collab.record(&self.doc, applied);
        }
        if applied.all {
            self.renderer.clear();
        }
    }

    /// Applies operations (`Op[]` JSON) as one undoable step; steps with
    /// the same `coalesce` key in a row undo together. Returns an
    /// `EditResult` JSON.
    pub fn apply(&mut self, ops: &str, coalesce: Option<String>) -> Result<String, JsError> {
        let ops: Vec<Op> = serde_json::from_str(ops).map_err(js_err)?;
        let applied = self
            .history
            .apply(
                &mut self.doc,
                &ops,
                &self.selection,
                &mut self.renderer,
                coalesce.as_deref(),
            )
            .map_err(js_err)?;
        self.after_local(&applied);
        Ok(self.result(&applied, Vec::new()))
    }

    /// Undoes the last step (`EditResult` JSON).
    pub fn undo(&mut self) -> String {
        let applied = self.history.undo(&mut self.doc).unwrap_or_default();
        self.after_local(&applied);
        self.result(&applied, Vec::new())
    }

    /// Redoes the last undone step (`EditResult` JSON).
    pub fn redo(&mut self) -> String {
        let applied = self.history.redo(&mut self.doc).unwrap_or_default();
        self.after_local(&applied);
        self.result(&applied, Vec::new())
    }

    /// Changes the selection (`SelectSpec` JSON); returns its bounds and
    /// outline (JSON).
    pub fn select(&mut self, spec: &str) -> Result<String, JsError> {
        let spec: SelectSpec = serde_json::from_str(spec).map_err(js_err)?;
        let canvas = self.doc.bounds();
        let feathered = |shape: crate::raster::Raster, feather: f32| {
            if feather > 0.0 {
                select::feather(&Selection { mask: shape }, feather).mask
            } else {
                shape
            }
        };
        match spec {
            SelectSpec::Rect {
                x,
                y,
                w,
                h,
                mode,
                feather,
            } => {
                let shape = feathered(select::rect((x, y, w, h)), feather);
                select::combine(&mut self.selection, shape, mode);
            }
            SelectSpec::Ellipse {
                x,
                y,
                w,
                h,
                mode,
                feather,
                antialias,
            } => {
                let shape = feathered(select::ellipse((x, y, w, h), antialias), feather);
                select::combine(&mut self.selection, shape, mode);
            }
            SelectSpec::Polygon {
                points,
                mode,
                feather,
                antialias,
            } => {
                let shape = feathered(select::polygon(&points, antialias), feather);
                select::combine(&mut self.selection, shape, mode);
            }
            SelectSpec::Wand {
                x,
                y,
                tolerance,
                contiguous,
                antialias,
                sample_all,
                layer,
                mode,
            } => {
                let source = match layer
                    .and_then(|id| self.doc.find(id))
                    .filter(|_| !sample_all)
                {
                    Some(i) => self.doc.layer(i).pixels.clone(),
                    None => {
                        let rgba = self.renderer.render(&self.doc, canvas, 0);
                        crate::raster::Raster::from_region(4, canvas, &rgba)
                    }
                };
                let sample = |sx: i32, sy: i32| source.get(sx, sy);
                let shape =
                    select::magic_wand(&sample, canvas, (x, y), tolerance, contiguous, antialias);
                select::combine(&mut self.selection, shape, mode);
            }
            SelectSpec::All => self.selection = select::all(canvas),
            SelectSpec::None => self.selection = Selection::none(),
            SelectSpec::Invert => self.selection = select::invert(&self.selection, canvas),
            SelectSpec::Feather { radius } => {
                self.selection = select::feather(&self.selection, radius);
            }
            SelectSpec::Expand { pixels } => {
                self.selection = select::expand(&self.selection, pixels);
            }
            SelectSpec::Layer { id, mask, mode } => {
                if let Some(i) = self.doc.find(id) {
                    let layer = self.doc.layer(i);
                    let shape = match (&layer.mask, mask) {
                        (Some(m), true) => select::from_alpha(&m.raster).mask,
                        _ => select::from_alpha(&layer.pixels).mask,
                    };
                    select::combine(&mut self.selection, shape, mode);
                }
            }
        }
        Ok(self.selection_info())
    }

    /// The selection's bounds and outline (JSON).
    #[wasm_bindgen(js_name = selectionInfo)]
    pub fn selection_info(&self) -> String {
        to_json(&SelectionInfo {
            bounds: self.selection.bounds(),
            outline: select::outline(&self.selection, OUTLINE_POINTS),
        })
    }

    /// The selected pixels (of a layer, or of the merged image) as PNG, for
    /// the clipboard; the whole layer or canvas without a selection.
    #[wasm_bindgen(js_name = copyPixels)]
    pub fn copy_pixels(&mut self, layer: Option<u32>) -> Vec<u8> {
        let canvas = self.doc.bounds();
        let area = self.selection.bounds().unwrap_or(canvas);
        let mut rgba = match layer.and_then(|id| self.doc.find(id)) {
            Some(i) => self.doc.layer(i).pixels.read_vec(area),
            None => self.renderer.render(&self.doc, area, 0),
        };
        if !self.selection.is_empty() {
            for (k, px) in rgba.chunks_exact_mut(4).enumerate() {
                let x = area.x + (k as i32 % area.w);
                let y = area.y + (k as i32 / area.w);
                let c = u32::from(self.selection.coverage(x, y));
                px[3] = ((u32::from(px[3]) * c + 127) / 255) as u8;
            }
        }
        inspect::encode_png(&rgba, area.w.max(1) as u32, area.h.max(1) as u32)
    }

    /// Places an image (PNG, JPEG, GIF, or WebP) as a new layer, centered
    /// on `(x, y)` or the canvas; returns an `EditResult` JSON.
    #[wasm_bindgen(js_name = placeImage)]
    pub fn place_image(
        &mut self,
        bytes: Vec<u8>,
        name: String,
        x: Option<i32>,
        y: Option<i32>,
        above: Option<u32>,
    ) -> Result<String, JsError> {
        let pixmap = fig_engine::images::decode(&bytes)
            .ok_or_else(|| js_err("not an image this editor can read"))?;
        let (w, h) = (pixmap.width() as i32, pixmap.height() as i32);
        let mut rgba = pixmap.take();
        // Premultiplied to straight alpha.
        for px in rgba.chunks_exact_mut(4) {
            let a = px[3];
            if a != 0 && a != 255 {
                for c in &mut px[..3] {
                    *c = ((u32::from(*c) * 255 + u32::from(a) / 2) / u32::from(a)).min(255) as u8;
                }
            }
        }
        let cx = x.unwrap_or(self.doc.width as i32 / 2);
        let cy = y.unwrap_or(self.doc.height as i32 / 2);
        let rect = IRect::new(cx - w / 2, cy - h / 2, w, h);
        let parent = above
            .and_then(|id| self.doc.find(id))
            .and_then(|i| self.doc.layer(i).parent)
            .map(|p| self.doc.layer(p).id);
        let op = Op::Place {
            name,
            rect,
            rgba: rgba.into(),
            parent,
            position: above.map_or(Position::Top, Position::Above),
        };
        let applied = self
            .history
            .apply(
                &mut self.doc,
                &[op],
                &self.selection,
                &mut self.renderer,
                None,
            )
            .map_err(js_err)?;
        self.after_local(&applied);
        Ok(self.result(&applied, Vec::new()))
    }

    /// One layer (or the merged image) as PNG.
    #[wasm_bindgen(js_name = exportPng)]
    pub fn export_png(&mut self, layer: Option<u32>) -> Vec<u8> {
        match layer.and_then(|id| self.doc.find(id)) {
            Some(i) => {
                let Some(b) = crate::render::visual_bounds(&self.doc, i) else {
                    return Vec::new();
                };
                let rgba = self.renderer.render_layer(&self.doc, i, b, 0, true);
                inspect::encode_png(&rgba, b.w as u32, b.h as u32)
            }
            None => {
                let canvas = self.doc.bounds();
                let rgba = self.renderer.render(&self.doc, canvas, 0);
                inspect::encode_png(&rgba, canvas.w as u32, canvas.h as u32)
            }
        }
    }

    /// The merged image as JPEG over white.
    #[wasm_bindgen(js_name = exportJpeg)]
    pub fn export_jpeg(&mut self, quality: u8) -> Vec<u8> {
        let canvas = self.doc.bounds();
        let mut rgba = self.renderer.render(&self.doc, canvas, 0);
        for px in rgba.chunks_exact_mut(4) {
            let a = u32::from(px[3]);
            for c in &mut px[..3] {
                *c = ((u32::from(*c) * a + 255 * (255 - a) + 127) / 255) as u8;
            }
            px[3] = 255;
        }
        fig_engine::export::jpeg::encode(
            &rgba,
            canvas.w as u32,
            canvas.h as u32,
            quality.clamp(1, 100),
        )
    }

    /// The edited file, as `.psd` bytes.
    pub fn save(&mut self) -> Result<Vec<u8>, JsError> {
        save::save(&self.doc, &mut self.renderer).map_err(js_err)
    }

    /// Whether anything was edited since the file was opened.
    #[wasm_bindgen(js_name = isEdited)]
    pub fn is_edited(&self) -> bool {
        self.doc.edits != 0 || self.doc.layers.iter().any(|l| l.edits != 0)
    }

    /// Starts editing together: new layers get ids in `session`, `layers`
    /// is the shared `layers:<fingerprint>` of the opened file when there
    /// is one, and `seed` asks for every layer's state (the first person in
    /// a new shared document). Returns `EntryChange[]` JSON to write.
    #[wasm_bindgen(js_name = enableCollab)]
    pub fn enable_collab(&mut self, session: u16, layers: Option<String>, seed: bool) -> String {
        let mut collab = Collab::new(&mut self.doc, session, layers.as_deref());
        let changes = if seed {
            collab.seed(&self.doc)
        } else {
            Vec::new()
        };
        self.collab = Some(collab);
        self.renderer.clear();
        to_json(&changes)
    }

    /// The `EntryChange[]` JSON that brings the shared maps up to date with
    /// this person's steps since the last call.
    #[wasm_bindgen(js_name = collabChanges)]
    pub fn collab_changes(&mut self) -> String {
        match &mut self.collab {
            Some(c) => to_json(&c.changes(&self.doc)),
            None => "[]".into(),
        }
    }

    /// Applies other people's changes (`EntryChange[]` JSON); they do not
    /// enter the undo history. Returns an `EditResult` JSON whose `wants`
    /// lists tile key prefixes to pass back.
    #[wasm_bindgen(js_name = applyCollab)]
    pub fn apply_collab(&mut self, changes: &str) -> Result<String, JsError> {
        let changes: Vec<crate::collab::EntryChange> =
            serde_json::from_str(changes).map_err(js_err)?;
        let Some(collab) = &mut self.collab else {
            return Err(js_err("not editing together"));
        };
        let remote = collab.apply(&mut self.doc, &changes);
        if remote.all {
            self.renderer.clear();
        }
        let applied = Applied {
            touched: remote.touched.clone(),
            created: Vec::new(),
            dirty: remote.dirty,
            all: remote.all,
            structure: remote.structure,
        };
        Ok(self.result(&applied, remote.wants))
    }

    /// The `layers:<fingerprint>` value for the file `save` writes now.
    #[wasm_bindgen(js_name = fileLayers)]
    pub fn file_layers(&self) -> String {
        match &self.collab {
            Some(c) => c.file_layers(&self.doc),
            None => "{}".into(),
        }
    }
}
