//! The WebAssembly API used by the web app's `.fig` viewer worker.
//!
//! Structured values cross the boundary as JSON strings; pixels as
//! premultiplied RGBA bytes. Every call names a page by index; the worker
//! keeps the most recently used page expanded.
//!
//! A file opens lazily ([`Document::open_lazy`]): what the first page shows
//! is decoded at once, other pages when they are opened, and the rest in
//! slices the worker asks for when idle (`decodeSome`). Rendering and the
//! page-local queries (layers, hit tests, geometry) work on a page that is
//! decoded; everything else decodes the whole file first.

use crate::collab::{Collab, EntryChange};
use crate::document::{Document, NodeIdx};
use crate::edit::{History, Op};
use crate::images::{ImageStore, encode_png};
use crate::inspect;
use crate::model::{Rect, Vec2};
use crate::render::{self, Layers, RenderOptions, Viewport};
use crate::scene::{Scene, SceneIdx};
use serde::{Deserialize, Serialize};
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
    /// The document node's id (pages are its children).
    root_id: String,
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

/// Which layers a render draws (see [`render::Layers`]); everything when
/// absent. A spec mixing these, or with any other field, does not parse.
#[derive(Deserialize)]
#[serde(untagged, deny_unknown_fields)]
enum LayersSpec {
    /// Only these layers (transparent, unclipped by their ancestors), the
    /// first one's origin drawn at `anchor` (page coordinates) wherever the
    /// document has it now.
    Only {
        only: Vec<String>,
        anchor: Option<[f64; 2]>,
    },
    /// Everything but these layers (opaque, as the whole page).
    Skip { skip: Vec<String> },
    /// What paints after `after` (transparent) and before `before`.
    Window {
        after: Option<String>,
        before: Option<String>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EditResult {
    /// Ids of layers the step created (to select them).
    created: Vec<String>,
    /// Page area whose pixels may have changed (the open page).
    dirty: Option<Rect>,
    can_undo: bool,
    can_redo: bool,
    /// The steps undo and redo would act on next (`History::undo_step`).
    undo_step: Option<u64>,
    redo_step: Option<u64>,
    /// The page's layer count changed or layers moved between parents.
    structure: bool,
}

/// An open `.fig` file.
#[wasm_bindgen]
pub struct FigFile {
    doc: Document,
    scene: Option<(usize, Scene)>,
    images: ImageStore,
    /// The file as opened (saving patches it; image fills are read from
    /// it in place).
    original: std::sync::Arc<Vec<u8>>,
    history: History,
    /// Set while the file is edited together with other people.
    collab: Option<Collab>,
    /// Scenes library thumbnails were drawn from.
    thumbnails: crate::library::Thumbnails,
}

#[wasm_bindgen]
impl FigFile {
    /// Opens a `.fig` file, decoding what its first page shows.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<FigFile, JsError> {
        console_error_panic_hook::set_once();
        let original = std::sync::Arc::new(bytes);
        let doc = Document::open_lazy(&original).map_err(js_err)?;
        Ok(FigFile {
            doc,
            scene: None,
            images: ImageStore::default(),
            original,
            history: History::default(),
            collab: None,
            thumbnails: crate::library::Thumbnails::default(),
        })
    }

    /// Whether the whole file is decoded.
    #[wasm_bindgen(js_name = isComplete)]
    pub fn is_complete(&self) -> bool {
        self.doc.is_complete()
    }

    /// Decodes about `nodes` more nodes; returns whether the whole file is
    /// decoded.
    #[wasm_bindgen(js_name = decodeSome)]
    pub fn decode_some(&mut self, nodes: usize) -> Result<bool, JsError> {
        self.doc.decode_some(nodes).map_err(js_err)
    }

    /// Decodes the rest of the file, for what reads more than a page.
    fn complete(&mut self) -> Result<(), JsError> {
        self.doc.complete().map_err(js_err)
    }

    /// A new, empty design (a `.fig` file with one page).
    pub fn blank(name: &str) -> Vec<u8> {
        crate::save::blank(name)
    }

    /// Makes a font available to text layout (TTF, OTF, collection, WOFF,
    /// or WOFF2), named `family` when given; returns the faces it holds
    /// (`RegisteredFace[]` JSON, empty when the file does not parse). Fonts
    /// are shared by every file this worker opens.
    #[wasm_bindgen(js_name = registerFont)]
    pub fn register_font(bytes: Vec<u8>, family: Option<String>) -> Result<String, JsError> {
        to_json(&crate::text::register_font(bytes, family.as_deref()))
    }

    /// The fonts the document's text uses and whether each is available
    /// (`FontUse[]` JSON).
    pub fn fonts(&mut self) -> Result<String, JsError> {
        self.complete()?;
        to_json(&crate::text::document_fonts(&self.doc))
    }

    /// Page-space bounds of everything drawn for `touched` nodes on the
    /// open page.
    fn touched_bounds(&self, touched: &[NodeIdx]) -> Rect {
        let Some((_, scene)) = &self.scene else {
            return Rect::EMPTY;
        };
        scene.bounds_of(&self.doc, touched)
    }

    fn after_edit(
        &mut self,
        page: usize,
        touched: Vec<NodeIdx>,
        created: Vec<String>,
    ) -> Result<String, JsError> {
        self.thumbnails.clear();
        let before = self.touched_bounds(&touched);
        let count_before = self.scene.as_ref().map_or(0, |(_, s)| s.nodes.len());
        // Property edits update the scene in place; tree changes rebuild it.
        let refreshed = match &mut self.scene {
            Some((p, scene)) if *p == page => scene.refresh(&self.doc, &touched),
            _ => false,
        };
        if !refreshed {
            self.scene = None;
        }
        self.scene(page)?;
        let after = self.touched_bounds(&touched);
        let count_after = self.scene.as_ref().map_or(0, |(_, s)| s.nodes.len());
        let dirty = before.union(&after);
        let structure = count_before != count_after
            || touched
                .iter()
                .any(|&i| self.doc.node(i).edits & crate::edit::flags::PARENT != 0);
        to_json(&EditResult {
            created,
            dirty: (!dirty.is_empty()).then_some(dirty),
            can_undo: self.history.can_undo(),
            can_redo: self.history.can_redo(),
            undo_step: self.history.undo_step(),
            redo_step: self.history.redo_step(),
            structure,
        })
    }

    /// Applies edit operations (`Op[]` JSON) as one undoable step. Steps
    /// with the same `coalesce` key in a row (one drag) undo together.
    /// Returns an `EditResult` JSON.
    pub fn apply(
        &mut self,
        page: usize,
        ops: &str,
        coalesce: Option<String>,
    ) -> Result<String, JsError> {
        let ops: Vec<Op> = serde_json::from_str(ops).map_err(js_err)?;
        self.scene(page)?;
        let mut applied = self
            .history
            .apply(&mut self.doc, &ops, coalesce.as_deref())
            .map_err(js_err)?;
        if let Some(collab) = &mut self.collab {
            collab.record(&mut self.doc, &mut applied.touched, false);
        }
        self.after_edit(page, applied.touched, applied.created)
    }

    pub fn undo(&mut self, page: usize) -> Result<String, JsError> {
        self.scene(page)?;
        let mut touched = self.history.undo(&mut self.doc).unwrap_or_default();
        if let Some(collab) = &mut self.collab {
            collab.record(&mut self.doc, &mut touched, true);
        }
        self.after_edit(page, touched, Vec::new())
    }

    pub fn redo(&mut self, page: usize) -> Result<String, JsError> {
        self.scene(page)?;
        let mut touched = self.history.redo(&mut self.doc).unwrap_or_default();
        if let Some(collab) = &mut self.collab {
            collab.record(&mut self.doc, &mut touched, true);
        }
        self.after_edit(page, touched, Vec::new())
    }

    /// Starts editing together with other people: new layers get ids in
    /// `session` (unique per person and visit), and `baseBlobs` is the
    /// shared `figMeta.baseBlobs` when it is set. Returns the
    /// `EntryChange[]` JSON to write (the base count when it was not set).
    #[wasm_bindgen(js_name = enableCollab)]
    pub fn enable_collab(
        &mut self,
        session: u32,
        base_blobs: Option<u32>,
    ) -> Result<String, JsError> {
        // IDs, original blob count and image keys are present in the lazy
        // skeleton. Joining an unedited design must not decode other pages.
        // Applying remote changes and local edits still complete the file.
        let (collab, changes) = Collab::new(&mut self.doc, session, base_blobs);
        self.collab = Some(collab);
        to_json(&changes)
    }

    /// The `EntryChange[]` JSON that brings the shared maps up to date with
    /// this person's edits (including undo and redo) since the last call.
    #[wasm_bindgen(js_name = collabChanges)]
    pub fn collab_changes(&mut self) -> Result<String, JsError> {
        let collab = self
            .collab
            .as_mut()
            .ok_or_else(|| js_err("the file is not shared"))?;
        to_json(&collab.changes(&self.doc))
    }

    /// Applies other people's changes (`EntryChange[]` JSON); they do not
    /// enter the undo history. Returns an `EditResult` JSON.
    #[wasm_bindgen(js_name = applyCollab)]
    pub fn apply_collab(&mut self, page: usize, changes: &str) -> Result<String, JsError> {
        let changes: Vec<EntryChange> = serde_json::from_str(changes).map_err(js_err)?;
        // Pages added or removed elsewhere may have moved the open one.
        let page = page.min(self.doc.pages.len().saturating_sub(1));
        self.scene(page)?;
        let collab = self
            .collab
            .as_mut()
            .ok_or_else(|| js_err("the file is not shared"))?;
        let remote = collab.apply(&mut self.doc, &changes);
        for hash in &remote.images {
            self.images.forget(hash);
        }
        let page = page.min(self.doc.pages.len().saturating_sub(1));
        self.after_edit(page, remote.touched, Vec::new())
    }

    /// Adds an image for image fills under its SHA-1 (hex); returns
    /// `[width, height]` JSON.
    #[wasm_bindgen(js_name = addImage)]
    pub fn add_image(&mut self, hash: &str, bytes: Vec<u8>) -> Result<String, JsError> {
        let (w, h) = self
            .doc
            .add_image(hash, bytes)
            .ok_or_else(|| js_err("this image format is not supported"))?;
        to_json(&[w, h])
    }

    /// The edited file, as `.fig` bytes.
    pub fn save(&mut self) -> Result<Vec<u8>, JsError> {
        self.complete()?;
        crate::save::save(&self.doc, &self.original).map_err(js_err)
    }

    /// Whether anything was edited since the file was opened.
    #[wasm_bindgen(js_name = isEdited)]
    pub fn is_edited(&self) -> bool {
        self.doc.nodes.iter().any(|n| n.edits != 0)
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
            root_id: self
                .doc
                .props(self.doc.root)
                .guid
                .map(|g| g.to_string())
                .unwrap_or_default(),
            version: self.doc.version,
            node_count: self.doc.nodes.len(),
            pages,
        })
    }

    /// The page expanded, for anything: the whole file is decoded first.
    fn scene(&mut self, page: usize) -> Result<&Scene, JsError> {
        self.complete()?;
        self.page_scene(page)
    }

    /// The page expanded, for what reads only the page (rendering, layers,
    /// hit tests): only what the page shows need be decoded.
    fn page_scene(&mut self, page: usize) -> Result<&Scene, JsError> {
        let stale = self.scene.as_ref().is_none_or(|(p, _)| *p != page);
        if stale {
            let &node = self
                .doc
                .pages
                .get(page)
                .ok_or_else(|| js_err(crate::FigError::NoSuchPage(page)))?;
            self.doc.decode_page(node).map_err(js_err)?;
            let mut scene = Scene::build(&self.doc, node);
            // Decoding the page decodes what it shows; should a layer still
            // come from a node that is not decoded, the page is built again
            // from the whole file.
            if !self.doc.is_complete() && scene.nodes.iter().any(|n| !self.doc.is_decoded(n.src)) {
                self.complete()?;
                scene = Scene::build(&self.doc, node);
            }
            self.scene = Some((page, scene));
        }
        Ok(&self.scene.as_ref().expect("scene built above").1)
    }

    fn find(&mut self, page: usize, id: &str) -> Result<SceneIdx, JsError> {
        self.scene(page)?;
        self.find_on_page(page, id)
    }

    /// [`FigFile::find`] for what reads only the page.
    fn find_on_page(&mut self, page: usize, id: &str) -> Result<SceneIdx, JsError> {
        self.page_scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        scene
            .find(&self.doc, id)
            .ok_or_else(|| js_err(crate::FigError::NoSuchNode(id.to_owned())))
    }

    /// Expands a page; returns its bounds and frames (`PageLayout` JSON).
    #[wasm_bindgen(js_name = openPage)]
    pub fn open_page(&mut self, page: usize) -> Result<String, JsError> {
        self.page_scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        to_json(&PageLayout {
            bounds: scene.node(scene.root()).bounds,
            frames: inspect::frames(&self.doc, scene),
            layer_count: scene.nodes.len() - 1,
        })
    }

    /// Renders `width × height` device pixels showing the page from
    /// `(x, y)` at `scale` pixels per unit, on the page color: RGBA, opaque.
    ///
    /// `layers` (`LayersSpec` JSON) draws only some layers: what paints in
    /// a paint-order window, only some layers (the parts `liftPlan`
    /// describes), or all but some. Only some layers, and a window that
    /// does not start at the bottom of the page, are drawn on transparency,
    /// as straight-alpha RGBA.
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
        layers: Option<String>,
    ) -> Result<Vec<u8>, JsError> {
        self.page_scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        let spec: Option<LayersSpec> = layers
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(js_err)?;
        let find = |id: &str| {
            scene
                .find(&self.doc, id)
                .ok_or_else(|| js_err(crate::FigError::NoSuchNode(id.to_owned())))
        };
        let layers = match &spec {
            None => Layers::All,
            Some(LayersSpec::Only { only: ids, anchor }) => {
                let nodes: Vec<SceneIdx> =
                    ids.iter().map(|id| find(id)).collect::<Result<_, _>>()?;
                let shift = match (anchor, nodes.first()) {
                    (Some([x, y]), Some(&first)) => {
                        let world = scene.node(first).world;
                        Vec2::new(x - world.m02, y - world.m12)
                    }
                    _ => Vec2::new(0.0, 0.0),
                };
                Layers::Only { nodes, shift }
            }
            Some(LayersSpec::Skip { skip: ids }) => {
                Layers::Skip(ids.iter().map(|id| find(id)).collect::<Result<_, _>>()?)
            }
            Some(LayersSpec::Window { after, before }) => Layers::Window {
                after: after.as_deref().map(find).transpose()?,
                before: before.as_deref().map(find).transpose()?,
            },
        };
        let opaque = match &layers {
            Layers::All | Layers::Skip(_) => true,
            Layers::Window { after, .. } => after.is_none(),
            Layers::Only { .. } => false,
        };
        let background = opaque.then(|| self.doc.page_background(scene.page));
        let pixmap = render::render_layers(
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
            &layers,
        )
        .ok_or_else(|| js_err("render failed"))?;
        let mut rgba = pixmap.take();
        if !opaque {
            render::straight_alpha(&mut rgba);
        }
        Ok(rgba)
    }

    /// How to move layers (`string[]` JSON of ids) by drawing them apart
    /// from the rest of the page while they are dragged (`LiftPlan` JSON;
    /// see `inspect::lift_plan`).
    #[wasm_bindgen(js_name = liftPlan)]
    pub fn lift_plan(&mut self, page: usize, ids: &str) -> Result<String, JsError> {
        let ids: Vec<String> = serde_json::from_str(ids).map_err(js_err)?;
        self.page_scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        to_json(&inspect::lift_plan(&self.doc, scene, &ids))
    }

    /// Children of a layer (the page when `parent` is absent) for the
    /// layers panel (`LayerRow[]` JSON).
    pub fn layers(&mut self, page: usize, parent: Option<String>) -> Result<String, JsError> {
        let index = match &parent {
            Some(id) => self.find_on_page(page, id)?,
            None => {
                self.page_scene(page)?;
                0
            }
        };
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        to_json(&inspect::layer_rows(&self.doc, scene, index))
    }

    /// The page's flows, screens, and layers with interactions
    /// (`PrototypeInfo` JSON).
    pub fn prototype(&mut self, page: usize) -> Result<String, JsError> {
        self.scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        to_json(&inspect::prototype::prototype(&self.doc, scene))
    }

    /// One layer's properties (`NodeInfo` JSON).
    #[wasm_bindgen(js_name = nodeInfo)]
    pub fn node_info(&mut self, page: usize, id: &str) -> Result<String, JsError> {
        let i = self.find(page, id)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        to_json(&inspect::node_info(&self.doc, scene, i))
    }

    /// One layer's component, variant, property, and style details
    /// (`DesignInfo` JSON).
    #[wasm_bindgen(js_name = designInfo)]
    pub fn design_info(&mut self, page: usize, id: &str) -> Result<String, JsError> {
        let i = self.find(page, id)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        to_json(&inspect::design_info(&self.doc, scene, i))
    }

    /// The file's variable collections (`CollectionInfo[]` JSON).
    pub fn variables(&mut self) -> Result<String, JsError> {
        self.complete()?;
        to_json(&inspect::variables(&self.doc))
    }

    /// The file's shared styles (`StyleInfo[]` JSON).
    pub fn styles(&mut self) -> Result<String, JsError> {
        self.complete()?;
        to_json(&inspect::local_styles(&self.doc))
    }

    /// A text layer's lines and caret stops (`TextGeometry` JSON, `null`
    /// for other layers).
    #[wasm_bindgen(js_name = textGeometry)]
    pub fn text_geometry(&mut self, page: usize, id: &str) -> Result<String, JsError> {
        let i = self.find(page, id)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        to_json(&inspect::text_geometry(&self.doc, scene, i))
    }

    /// Layer rows for several ids (`LayerRow[]` JSON), skipping unknown ids.
    pub fn rows(&mut self, page: usize, ids: &str) -> Result<String, JsError> {
        let ids: Vec<String> = serde_json::from_str(ids).map_err(js_err)?;
        self.page_scene(page)?;
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
        self.page_scene(page)?;
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
        let i = self.find_on_page(page, id)?;
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
        self.page_scene(page)?;
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
        let i = self.find_on_page(page, id)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        Ok(inspect::outline(&self.doc, scene, i))
    }

    /// The file's components, page by page (`ComponentInfo[]` JSON).
    pub fn components(&mut self) -> Result<String, JsError> {
        self.complete()?;
        to_json(&inspect::components(&self.doc))
    }

    /// Layers whose name or text contains `query` (`SearchHit[]` JSON).
    pub fn search(&mut self, page: usize, query: &str, limit: usize) -> Result<String, JsError> {
        self.scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        to_json(&inspect::search(&self.doc, scene, query, limit))
    }

    /// The distinct solid colors the page uses, most used first
    /// (`string[]` JSON of `RRGGBB` or `RRGGBBAA`).
    #[wasm_bindgen(js_name = pageColors)]
    pub fn page_colors(&mut self, page: usize, limit: usize) -> Result<String, JsError> {
        self.scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        to_json(&inspect::page_colors(&self.doc, scene, limit))
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
            Some(id) => self.find_on_page(page, id)?,
            None => {
                self.page_scene(page)?;
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

    /// One layer (and what it holds) as an SVG document.
    #[wasm_bindgen(js_name = exportSvg)]
    pub fn export_svg(&mut self, page: usize, id: &str) -> Result<String, JsError> {
        let i = self.find(page, id)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        crate::svg::export(&self.doc, scene, i)
            .ok_or_else(|| js_err("this layer has nothing to export"))
    }

    /// The points of a layer, in page coordinates, for editing them
    /// (`Network` JSON); `undefined` for layers without points.
    #[wasm_bindgen(js_name = vectorNetwork)]
    pub fn vector_network(&mut self, page: usize, id: &str) -> Result<Option<String>, JsError> {
        self.scene(page)?;
        if id.starts_with('I') {
            return Ok(None);
        }
        let Some(i) = crate::model::Guid::parse(id).and_then(|g| self.doc.find(g)) else {
            return Ok(None);
        };
        let Some(net) = crate::edit::shapes::editable_network(&self.doc, i) else {
            return Ok(None);
        };
        to_json(&net.transformed(&self.doc.world(i))).map(Some)
    }

    /// Copies layers (`string[]` JSON of ids) as Figma's clipboard holds
    /// them: a `.fig` document and a ZIP of the images they use.
    pub fn copy(&mut self, page: usize, ids: &str) -> Result<Clipboard, JsError> {
        let ids: Vec<String> = serde_json::from_str(ids).map_err(js_err)?;
        self.scene(page)?;
        let nodes: Vec<NodeIdx> = ids
            .iter()
            .filter(|id| !id.starts_with('I'))
            .filter_map(|id| crate::model::Guid::parse(id).and_then(|g| self.doc.find(g)))
            .collect();
        let copied = crate::save::copy(&self.doc, &self.original, &nodes).map_err(js_err)?;
        Ok(Clipboard {
            document: copied.document,
            images: copied.images,
        })
    }

    /// Pastes copied layers (a `.fig` document and, optionally, a ZIP of
    /// their images) as one undoable step; `spec` is `PasteSpec` JSON.
    /// Returns an `EditResult` JSON.
    pub fn paste(
        &mut self,
        page: usize,
        document: &[u8],
        images: Option<Vec<u8>>,
        spec: &str,
    ) -> Result<String, JsError> {
        let spec: crate::edit::PasteSpec = serde_json::from_str(spec).map_err(js_err)?;
        self.scene(page)?;
        let mut applied = self
            .history
            .paste(
                &mut self.doc,
                &self.original,
                document,
                images.as_deref(),
                &spec,
            )
            .map_err(js_err)?;
        if let Some(collab) = &mut self.collab {
            collab.record(&mut self.doc, &mut applied.touched, false);
        }
        self.after_edit(page, applied.touched, applied.created)
    }
}

#[wasm_bindgen]
impl FigFile {
    /// What publishing the file as a library would change
    /// (`LibraryStatus` JSON).
    #[wasm_bindgen(js_name = libraryStatus)]
    pub fn library_status(&mut self) -> Result<String, JsError> {
        self.complete()?;
        to_json(&crate::library::status(&self.doc))
    }

    /// The file's published library assets (`PublishedLibrary` JSON).
    #[wasm_bindgen(js_name = libraryAssets)]
    pub fn library_assets(&mut self) -> Result<String, JsError> {
        self.complete()?;
        to_json(&crate::library::published(&self.doc))
    }

    /// The libraries the file uses and its copies of their assets
    /// (`LibraryUse` JSON).
    #[wasm_bindgen(js_name = libraryUses)]
    pub fn library_uses(&mut self) -> Result<String, JsError> {
        self.complete()?;
        to_json(&crate::library::uses(&self.doc))
    }

    /// The assets named by `keys` (`string[]` JSON) with what they use, for
    /// another file to import.
    #[wasm_bindgen(js_name = libraryPackage)]
    pub fn library_package(&mut self, keys: &str) -> Result<Clipboard, JsError> {
        self.complete()?;
        let keys: Vec<String> = serde_json::from_str(keys).map_err(js_err)?;
        let copied = crate::library::package(&self.doc, &self.original, &keys).map_err(js_err)?;
        Ok(Clipboard {
            document: copied.document,
            images: copied.images,
        })
    }

    /// Imports a library package (see `libraryPackage`) as one undoable
    /// step; `spec` is `LibrarySpec` JSON. Returns an `EditResult` JSON.
    #[wasm_bindgen(js_name = importLibrary)]
    pub fn import_library(
        &mut self,
        page: usize,
        document: &[u8],
        images: Option<Vec<u8>>,
        spec: &str,
    ) -> Result<String, JsError> {
        let spec: crate::edit::LibrarySpec = serde_json::from_str(spec).map_err(js_err)?;
        self.scene(page)?;
        let mut applied = self
            .history
            .import_library(
                &mut self.doc,
                &self.original,
                document,
                images.as_deref(),
                &spec,
            )
            .map_err(js_err)?;
        if let Some(collab) = &mut self.collab {
            collab.record(&mut self.doc, &mut applied.touched, false);
        }
        self.after_edit(page, applied.touched, applied.created)
    }

    /// A PNG of a layer on any canvas (library copies included), fitted in
    /// `size` pixels; empty when it draws nothing.
    #[wasm_bindgen(js_name = nodeThumbnail)]
    pub fn node_thumbnail(&mut self, id: &str, size: u32) -> Vec<u8> {
        if self.complete().is_err() {
            return Vec::new();
        }
        crate::model::Guid::parse(id)
            .and_then(|g| self.thumbnails.render(&self.doc, &mut self.images, g, size))
            .unwrap_or_default()
    }
}

/// Copied layers: the `.fig` document and the images ZIP.
#[wasm_bindgen]
pub struct Clipboard {
    document: Vec<u8>,
    images: Vec<u8>,
}

#[wasm_bindgen]
impl Clipboard {
    #[wasm_bindgen(getter)]
    pub fn document(&self) -> Vec<u8> {
        self.document.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn images(&self) -> Vec<u8> {
        self.images.clone()
    }
}

mod handoff;
