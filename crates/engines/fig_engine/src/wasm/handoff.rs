//! Exports and layout aids for the worker.

use super::{FigFile, js_err, to_json};
use crate::export::{self, ExportedFile};
use crate::model::ExportSetting;
use serde::Deserialize;
use wasm_bindgen::prelude::*;

/// What to export: layers, each with presets (its own when absent).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportRequest {
    items: Vec<ExportItem>,
    /// The name of the ZIP several files come in.
    #[serde(default)]
    zip_name: Option<String>,
}

#[derive(Deserialize)]
struct ExportItem {
    id: String,
    settings: Option<Vec<ExportSetting>>,
}

#[wasm_bindgen]
impl FigFile {
    /// Exports layers with export presets (`ExportRequest` JSON): one
    /// file, or a ZIP of several.
    #[wasm_bindgen(js_name = exportFiles)]
    pub fn export_files(&mut self, page: usize, request: &str) -> Result<ExportFile, JsError> {
        let request: ExportRequest = serde_json::from_str(request).map_err(js_err)?;
        let mut jobs = Vec::new();
        for item in &request.items {
            let i = self.find(page, &item.id)?;
            let (_, scene) = self.scene.as_ref().expect("scene built above");
            let settings = match &item.settings {
                Some(s) => s.clone(),
                None => scene
                    .props(&self.doc, i)
                    .export_settings
                    .as_deref()
                    .unwrap_or(&[])
                    .to_vec(),
            };
            jobs.extend(settings.into_iter().map(|s| (i, s)));
        }
        self.scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        let zip = request.zip_name.as_deref().unwrap_or("Export");
        let file = export::export_files(&self.doc, scene, &mut self.images, &jobs, zip)
            .ok_or_else(|| js_err("nothing to export"))?;
        Ok(ExportFile(file))
    }

    /// "Export frames to PDF": the page's top-level frames, a page each.
    #[wasm_bindgen(js_name = exportFramesPdf)]
    pub fn export_frames_pdf(&mut self, page: usize) -> Result<Vec<u8>, JsError> {
        self.scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        export::frames_pdf(&self.doc, scene, &mut self.images)
            .ok_or_else(|| js_err("this page has no frames to export"))
    }

    /// A layer and the layers inside it with export presets
    /// (`Exportable[]` JSON).
    pub fn exportables(&mut self, page: usize, id: &str) -> Result<String, JsError> {
        let i = self.find(page, id)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        to_json(&crate::inspect::exportables(&self.doc, scene, i))
    }

    /// The page's guides and its frames' grids and guides (`LayoutAids`
    /// JSON).
    #[wasm_bindgen(js_name = layoutAids)]
    pub fn layout_aids(&mut self, page: usize) -> Result<String, JsError> {
        self.page_scene(page)?;
        let (_, scene) = self.scene.as_ref().expect("scene built above");
        to_json(&crate::inspect::layout_aids(&self.doc, scene))
    }
}

/// An exported file.
#[wasm_bindgen]
pub struct ExportFile(ExportedFile);

#[wasm_bindgen]
impl ExportFile {
    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        self.0.name.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn mime(&self) -> String {
        self.0.mime.to_owned()
    }

    #[wasm_bindgen(getter)]
    pub fn bytes(&self) -> Vec<u8> {
        self.0.bytes.clone()
    }
}
