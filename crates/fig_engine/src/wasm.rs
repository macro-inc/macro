//! The WebAssembly API used by the web app's `.fig` viewer worker.
//!
//! Structured values cross the boundary as JSON strings; pixels as
//! premultiplied RGBA bytes. Every call names a page by index; the worker
//! keeps the most recently used page expanded.

use crate::document::Document;
use crate::images::{ImageStore, encode_png};
use crate::inspect;
use crate::model::{Rect, Vec2};
use crate::render::{self, RenderOptions, Viewport};
use crate::scene::{Scene, SceneIdx};
use serde::Serialize;
use wasm_bindgen::prelude::*;

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn to_json(v: &impl Serialize) -> Result<String, JsError> {
    serde_json::to_string(v).map_err(js_err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PageSummary {
    index: usize,
    id: String,
    name: String,
    /// Canvas color, straight RGBA in 0..1.
    background: [f32; 4],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileSummary {
    file_name: Option<String>,
    version: u32,
    node_count: usize,
    pages: Vec<PageSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PageLayout {
    /// Bounds of everything on the page.
    bounds: Rect,
    frames: Vec<inspect::FrameRow>,
    layer_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeGeometry {
    id: String,
    /// Corners of the node's frame, clockwise from its top left.
    corners: [Vec2; 4],
    bounds: Rect,
}

/// An open `.fig` file.
#[wasm_bindgen]
pub struct FigFile {
    doc: Document,
    scene: Option<(usize, Scene)>,
    images: ImageStore,
}

#[wasm_bindgen]
impl FigFile {
    /// Opens a `.fig` file.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> Result<FigFile, JsError> {
        console_error_panic_hook::set_once();
        let doc = Document::open(bytes).map_err(js_err)?;
        Ok(FigFile {
            doc,
            scene: None,
            images: ImageStore::default(),
        })
    }

    /// Pages and file details (`FileSummary` JSON).
    pub fn summary(&self) -> Result<String, JsError> {
        let pages = self
            .doc
            .pages
            .iter()
            .enumerate()
            .map(|(index, &p)| {
                let bg = self.doc.page_background(p);
                PageSummary {
                    index,
                    id: self
                        .doc
                        .props(p)
                        .guid
                        .map(|g| g.to_string())
                        .unwrap_or_default(),
                    name: self.doc.props(p).name().to_owned(),
                    background: [bg.r, bg.g, bg.b, bg.a],
                }
            })
            .collect();
        to_json(&FileSummary {
            file_name: self.doc.file_name.clone(),
            version: self.doc.version,
            node_count: self.doc.nodes.len(),
            pages,
        })
    }

    fn scene(&mut self, page: usize) -> Result<&Scene, JsError> {
        let stale = self.scene.as_ref().is_none_or(|(p, _)| *p != page);
        if stale {
            let &node = self
                .doc
                .pages
                .get(page)
                .ok_or_else(|| js_err(crate::FigError::NoSuchPage(page)))?;
            self.scene = Some((page, Scene::build(&self.doc, node)));
        }
        Ok(&self.scene.as_ref().expect("scene built above").1)
    }

    fn find(&mut self, page: usize, id: &str) -> Result<SceneIdx, JsError> {
        self.scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        scene
            .find(&self.doc, id)
            .ok_or_else(|| js_err(crate::FigError::NoSuchNode(id.to_owned())))
    }

    /// Expands a page; returns its bounds and frames (`PageLayout` JSON).
    #[wasm_bindgen(js_name = openPage)]
    pub fn open_page(&mut self, page: usize) -> Result<String, JsError> {
        self.scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        to_json(&PageLayout {
            bounds: scene.node(scene.root()).bounds,
            frames: inspect::frames(&self.doc, scene),
            layer_count: scene.nodes.len() - 1,
        })
    }

    /// Renders `width × height` device pixels showing the page from
    /// `(x, y)` at `scale` pixels per unit, on the page color. Premultiplied
    /// RGBA.
    #[allow(clippy::too_many_arguments)]
    pub fn render(
        &mut self,
        page: usize,
        x: f64,
        y: f64,
        scale: f64,
        width: u32,
        height: u32,
        outline: bool,
    ) -> Result<Vec<u8>, JsError> {
        self.scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        let background = Some(self.doc.page_background(scene.page));
        let pixmap = render::render(
            &self.doc,
            scene,
            &mut self.images,
            &Viewport {
                x,
                y,
                scale,
                width,
                height,
            },
            RenderOptions {
                outline,
                background,
            },
        )
        .ok_or_else(|| js_err("render failed"))?;
        Ok(pixmap.take())
    }

    /// Children of a layer (the page when `parent` is absent) for the
    /// layers panel (`LayerRow[]` JSON).
    pub fn layers(&mut self, page: usize, parent: Option<String>) -> Result<String, JsError> {
        let index = match &parent {
            Some(id) => self.find(page, id)?,
            None => {
                self.scene(page)?;
                0
            }
        };
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        to_json(&inspect::layer_rows(&self.doc, scene, index))
    }

    /// One layer's properties (`NodeInfo` JSON).
    #[wasm_bindgen(js_name = nodeInfo)]
    pub fn node_info(&mut self, page: usize, id: &str) -> Result<String, JsError> {
        let i = self.find(page, id)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        to_json(&inspect::node_info(&self.doc, scene, i))
    }

    /// Layer rows for several ids (`LayerRow[]` JSON), skipping unknown ids.
    pub fn rows(&mut self, page: usize, ids: &str) -> Result<String, JsError> {
        let ids: Vec<String> = serde_json::from_str(ids).map_err(js_err)?;
        self.scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        let rows: Vec<_> = ids
            .iter()
            .filter_map(|id| scene.find(&self.doc, id))
            .map(|i| inspect::layer_row(&self.doc, scene, i))
            .collect();
        to_json(&rows)
    }

    /// Layers under a page point, from the page's child down to the deepest
    /// (`LayerRow[]` JSON).
    #[wasm_bindgen(js_name = hitTest)]
    pub fn hit_test(
        &mut self,
        page: usize,
        x: f64,
        y: f64,
        tolerance: f64,
    ) -> Result<String, JsError> {
        self.scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        let chain = inspect::hit_test(&self.doc, scene, Vec2::new(x, y), tolerance);
        let rows: Vec<_> = chain
            .iter()
            .map(|&i| inspect::layer_row(&self.doc, scene, i))
            .collect();
        to_json(&rows)
    }

    /// Layers from the page's child down to `id` (`LayerRow[]` JSON).
    pub fn ancestry(&mut self, page: usize, id: &str) -> Result<String, JsError> {
        let i = self.find(page, id)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        let rows: Vec<_> = scene
            .ancestry(i)
            .iter()
            .map(|&a| inspect::layer_row(&self.doc, scene, a))
            .collect();
        to_json(&rows)
    }

    /// Frame corners and bounds of layers (`NodeGeometry[]` JSON).
    pub fn geometry(&mut self, page: usize, ids: &str) -> Result<String, JsError> {
        let ids: Vec<String> = serde_json::from_str(ids).map_err(js_err)?;
        self.scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        let out: Vec<NodeGeometry> = ids
            .iter()
            .filter_map(|id| {
                let i = scene.find(&self.doc, id)?;
                Some(NodeGeometry {
                    id: id.clone(),
                    corners: scene.frame_corners(&self.doc, i),
                    bounds: scene.frame_bounds(&self.doc, i),
                })
            })
            .collect();
        to_json(&out)
    }

    /// SVG path data of a layer's outline in page coordinates.
    pub fn outline(&mut self, page: usize, id: &str) -> Result<String, JsError> {
        let i = self.find(page, id)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        Ok(inspect::outline(&self.doc, scene, i))
    }

    /// Layers whose name or text contains `query` (`SearchHit[]` JSON).
    pub fn search(&mut self, page: usize, query: &str, limit: usize) -> Result<String, JsError> {
        self.scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        to_json(&inspect::search(&self.doc, scene, query, limit))
    }

    /// Children of `parent` (the page when absent) whose frames intersect a
    /// page rectangle (`string[]` JSON).
    #[wasm_bindgen(js_name = inRect)]
    pub fn in_rect(
        &mut self,
        page: usize,
        parent: Option<String>,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<String, JsError> {
        let index = match &parent {
            Some(id) => self.find(page, id)?,
            None => {
                self.scene(page)?;
                0
            }
        };
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        let ids: Vec<String> =
            inspect::in_rect(&self.doc, scene, index, &Rect::new(x, y, width, height))
                .iter()
                .map(|&i| scene.id(&self.doc, i))
                .collect();
        to_json(&ids)
    }

    /// A PNG of one layer at `scale`, with a transparent background.
    #[wasm_bindgen(js_name = exportPng)]
    pub fn export_png(&mut self, page: usize, id: &str, scale: f64) -> Result<Vec<u8>, JsError> {
        let i = self.find(page, id)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        let pixmap = render::render_node(
            &self.doc,
            scene,
            &mut self.images,
            i,
            scale,
            RenderOptions::default(),
        )
        .ok_or_else(|| js_err("this layer has nothing to export"))?;
        Ok(encode_png(&pixmap))
    }

    /// Figma's thumbnail of the file, if it has one (PNG).
    pub fn thumbnail(&self) -> Option<Vec<u8>> {
        self.doc.thumbnail.clone()
    }
}
