//! Exporting layers as files, the way Figma's Export section does: each
//! preset (PNG, JPG, SVG, or PDF at a scale or a fixed width or height)
//! makes one file named after the layer and the preset's suffix, and
//! several files come as one ZIP. "Export frames to PDF" writes a page's
//! top-level frames as one multi-page PDF.

use crate::document::Document;
use crate::images::{ImageStore, encode_png};
use crate::model::{ExportConstraint, ExportFormat, ExportSetting, NodeType};
use crate::render::{self, RenderOptions};
use crate::scene::{Scene, SceneIdx};
use crate::svg::{self, SvgOptions};

pub mod jpeg;
pub mod pdf;

/// A file made by an export.
#[derive(Clone, Debug, PartialEq)]
pub struct ExportedFile {
    /// The file name; inside ZIPs, `/` in a layer's name makes folders, as
    /// in Figma.
    pub name: String,
    pub mime: &'static str,
    pub bytes: Vec<u8>,
}

/// The scale a preset renders `node` at.
pub fn scale_for(scene: &Scene, node: SceneIdx, s: &ExportSetting) -> f64 {
    let b = scene.node(node).bounds;
    let value = f64::from(s.value).max(0.01);
    let scale = match s.constraint {
        ExportConstraint::ContentScale => value,
        ExportConstraint::ContentWidth if b.w > 0.0 => value / b.w,
        ExportConstraint::ContentHeight if b.h > 0.0 => value / b.h,
        _ => 1.0,
    };
    scale.clamp(0.01, 64.0)
}

/// What a preset appends to the name: its suffix, or `@2x` for a scaled
/// image without one (as Figma names them).
fn suffix(s: &ExportSetting) -> String {
    if !s.suffix.is_empty() {
        return s.suffix.clone();
    }
    let raster = matches!(s.format, ExportFormat::Png | ExportFormat::Jpeg);
    match s.constraint {
        ExportConstraint::ContentScale if raster && (s.value - 1.0).abs() > 1e-6 => {
            let v = (s.value * 100.0).round() / 100.0;
            format!("@{v}x")
        }
        ExportConstraint::ContentWidth if raster => format!("@{}w", s.value.round()),
        ExportConstraint::ContentHeight if raster => format!("@{}h", s.value.round()),
        _ => String::new(),
    }
}

/// A layer name as a file path: characters file systems reject become
/// dashes, and empty path parts are dropped.
fn safe_path(name: &str) -> String {
    let parts: Vec<String> = name
        .split('/')
        .map(|part| {
            part.chars()
                .map(|c| match c {
                    '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
                    c if c.is_control() => '-',
                    c => c,
                })
                .collect::<String>()
                .trim()
                .to_owned()
        })
        .filter(|p| !p.is_empty() && p != "." && p != "..")
        .collect();
    if parts.is_empty() {
        "Untitled".into()
    } else {
        parts.join("/")
    }
}

/// The file name a preset gives a layer named `layer`.
pub fn file_name(layer: &str, s: &ExportSetting) -> String {
    format!("{}{}.{}", safe_path(layer), suffix(s), s.format.extension())
}

/// One layer exported with one preset; `None` when it draws nothing.
pub fn export_one(
    doc: &Document,
    scene: &Scene,
    images: &mut ImageStore,
    node: SceneIdx,
    s: &ExportSetting,
) -> Option<ExportedFile> {
    let bytes = match s.format {
        ExportFormat::Png | ExportFormat::Jpeg => {
            let scale = scale_for(scene, node, s);
            let pixmap =
                render::render_node(doc, scene, images, node, scale, RenderOptions::default())?;
            if s.format == ExportFormat::Png {
                encode_png(&pixmap)
            } else {
                jpeg::encode(pixmap.data(), pixmap.width(), pixmap.height(), s.quality)
            }
        }
        ExportFormat::Svg => svg::export_with(
            doc,
            scene,
            node,
            SvgOptions {
                outline_text: s.svg_outline_text,
                include_ids: s.svg_include_id,
            },
        )?
        .into_bytes(),
        ExportFormat::Pdf => pdf::export(doc, scene, images, &[node])?,
    };
    Some(ExportedFile {
        name: file_name(scene.props(doc, node).name(), s),
        mime: s.format.mime(),
        bytes,
    })
}

/// Every `(layer, preset)` exported: one file as it is, several as a ZIP
/// called `zip_name` (repeated names numbered). `None` when nothing draws.
pub fn export_files(
    doc: &Document,
    scene: &Scene,
    images: &mut ImageStore,
    requests: &[(SceneIdx, ExportSetting)],
    zip_name: &str,
) -> Option<ExportedFile> {
    let mut files: Vec<ExportedFile> = requests
        .iter()
        .filter_map(|(node, s)| export_one(doc, scene, images, *node, s))
        .collect();
    if files.len() <= 1 {
        return files.pop().map(|mut f| {
            // A single download has no folders.
            f.name = f.name.replace('/', "-");
            f
        });
    }
    let mut seen: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for f in &mut files {
        let count = seen.entry(f.name.clone()).or_insert(0);
        *count += 1;
        if *count > 1 {
            let (stem, ext) = f.name.rsplit_once('.').unwrap_or((&f.name, ""));
            f.name = format!("{stem} {count}.{ext}");
        }
    }
    let entries: Vec<(&str, &[u8])> = files
        .iter()
        .map(|f| (f.name.as_str(), f.bytes.as_slice()))
        .collect();
    Some(ExportedFile {
        name: format!("{}.zip", safe_path(zip_name).replace('/', "-")),
        mime: "application/zip",
        bytes: crate::zip::write_stored(&entries),
    })
}

/// "Export frames to PDF": the page's visible top-level frames (and
/// sections, components, and instances), one PDF page each.
pub fn frames_pdf(doc: &Document, scene: &Scene, images: &mut ImageStore) -> Option<Vec<u8>> {
    let frames: Vec<SceneIdx> = scene
        .node(scene.root())
        .children
        .iter()
        .copied()
        .filter(|&c| {
            let p = scene.props(doc, c);
            p.visible() && p.node_type().is_frame_like() && p.node_type() != NodeType::Section
        })
        .collect();
    pdf::export(doc, scene, images, &frames)
}

#[cfg(test)]
mod test;
