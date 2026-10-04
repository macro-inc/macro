//! Drawing pages: display lists and rasterization.
//!
//! A page becomes the shared display list (`pptx_engine::render::scene`):
//! text as glyph outlines (one path per run of same-colored glyphs),
//! decorations as rectangles and strokes, pictures as image paints. The same
//! list rasterizes natively (tests, the corpus tool) and in the browser.

mod drawing;
mod shapes;
mod text;

use crate::document::Document;
use crate::layout::inline::Revision;
use crate::layout::{Item, Layout, Page, PlacedLine};
use crate::model::props::{Border, LineStyle};
use pptx_engine::font::FontDb;
use pptx_engine::model::color::Rgba;
use pptx_engine::path::{Path, Point, Rect};
use pptx_engine::render::raster;
use pptx_engine::render::scene::{Group, LineCap, LineJoin, Node, Paint, Raster, Stroke};
use std::collections::HashMap;
use std::sync::Arc;

/// Decoded pictures by part name (`None` = not decodable).
#[derive(Default)]
pub struct ImageCache {
    images: HashMap<String, Option<Arc<Raster>>>,
    metafiles: HashMap<String, Option<Arc<pptx_engine::render::metafile::Metafile>>>,
}

impl ImageCache {
    /// An empty cache.
    pub fn new() -> Self {
        Self::default()
    }

    /// A decoded raster picture.
    pub fn raster(&mut self, doc: &Document, part: &str, fonts: &FontDb) -> Option<Arc<Raster>> {
        if let Some(r) = self.images.get(part) {
            return r.clone();
        }
        let decoded = doc.package().read(part).ok().and_then(|bytes| {
            use pptx_engine::render::image::{Format, decode_raster, sniff};
            match sniff(&bytes) {
                Format::Emf | Format::Wmf => pptx_engine::render::metafile::parse(&bytes, fonts)
                    .ok()
                    .map(|m| Arc::new(metafile_raster(&m))),
                _ => decode_raster(&bytes).ok().map(Arc::new),
            }
        });
        self.images.insert(part.to_owned(), decoded.clone());
        decoded
    }

    /// A parsed metafile picture (drawn as vectors).
    pub fn metafile(
        &mut self,
        doc: &Document,
        part: &str,
        fonts: &FontDb,
    ) -> Option<Arc<pptx_engine::render::metafile::Metafile>> {
        if let Some(m) = self.metafiles.get(part) {
            return m.clone();
        }
        let parsed = doc.package().read(part).ok().and_then(|bytes| {
            use pptx_engine::render::image::{Format, sniff};
            match sniff(&bytes) {
                Format::Emf | Format::Wmf => pptx_engine::render::metafile::parse(&bytes, fonts)
                    .ok()
                    .map(Arc::new),
                _ => None,
            }
        });
        self.metafiles.insert(part.to_owned(), parsed.clone());
        parsed
    }
}

fn metafile_raster(m: &pptx_engine::render::metafile::Metafile) -> Raster {
    let scale = (150.0 / 72.0f32).min(2048.0 / m.width_pt.max(m.height_pt).max(1.0));
    let w = ((m.width_pt * scale).ceil() as u32).max(1);
    let h = ((m.height_pt * scale).ceil() as u32).max(1);
    raster::rasterize(&m.nodes, w, h, scale)
}

/// Renders pages of one layout.
pub struct Renderer<'a> {
    /// The document.
    pub doc: &'a Document,
    /// Fonts.
    pub fonts: &'a FontDb,
    /// Picture cache.
    pub images: &'a mut ImageCache,
}

/// The stroke for a border.
pub(crate) fn border_stroke(b: &Border) -> Stroke {
    let dash = match b.style {
        LineStyle::Dotted => Some(vec![b.width, b.width * 2.0]),
        LineStyle::Dashed => Some(vec![b.width * 4.0, b.width * 3.0]),
        LineStyle::DotDash => Some(vec![b.width * 4.0, b.width * 2.0, b.width, b.width * 2.0]),
        _ => None,
    };
    Stroke {
        width: b.width.max(0.25),
        cap: LineCap::Butt,
        join: LineJoin::Miter,
        miter_limit: 4.0,
        dash,
    }
}

fn border_color(b: &Border) -> Rgba {
    b.color.rgb().unwrap_or(Rgba::BLACK)
}

/// Strokes a border line from (x0, y0) to (x1, y1), drawing double and
/// triple styles as parallel lines.
pub(crate) fn rule_nodes(x0: f32, y0: f32, x1: f32, y1: f32, b: &Border, out: &mut Vec<Node>) {
    let color = border_color(b);
    let lines: Vec<(f32, f32)> = match b.style {
        LineStyle::Double => vec![(-b.width, b.width * 0.8), (b.width, b.width * 0.8)],
        LineStyle::Triple => vec![
            (-2.0 * b.width, b.width * 0.7),
            (0.0, b.width * 0.7),
            (2.0 * b.width, b.width * 0.7),
        ],
        LineStyle::ThinThick => vec![(-b.width * 0.75, b.width * 0.5), (b.width * 0.5, b.width)],
        LineStyle::Thick => vec![(0.0, b.width * 1.5)],
        _ => vec![(0.0, b.width)],
    };
    let (dx, dy) = (x1 - x0, y1 - y0);
    let len = (dx * dx + dy * dy).sqrt().max(1e-6);
    let (nx, ny) = (-dy / len, dx / len);
    for (off, w) in lines {
        let mut p = Path::new();
        p.move_to(Point::new(x0 + nx * off, y0 + ny * off));
        p.line_to(Point::new(x1 + nx * off, y1 + ny * off));
        let mut stroke = border_stroke(b);
        stroke.width = w.max(0.25);
        out.push(Node::Stroke {
            path: p,
            paint: Paint::Solid(color),
            stroke,
        });
    }
}

/// Gap between a change bar and the body's left edge (points).
const CHANGE_BAR_GAP: f32 = 7.0;
/// Width of a change bar (points).
const CHANGE_BAR_WIDTH: f32 = 0.75;

/// Whether a placed line holds a tracked change shown with markup.
fn line_changed(l: &PlacedLine) -> bool {
    let inline = &l.para.inline;
    let line = l.line();
    let last = l.line + 1 == l.para.lines.lines.len();
    inline.props_changed
        || (last && inline.mark_changed)
        || inline.clusters[line.start..line.end]
            .iter()
            .any(|c| inline.runs[c.run as usize].revision != Revision::None)
}

/// Change bars: a rule in the left margin beside every line holding a
/// tracked change, as Word and LibreOffice draw them with markup.
fn change_bars(page: &Page, out: &mut Vec<Node>) {
    let x = page.body.x - CHANGE_BAR_GAP - CHANGE_BAR_WIDTH / 2.0;
    let mut path = Path::new();
    for item in &page.items {
        if let Item::Line(l) = item
            && line_changed(l)
        {
            let rect = Rect::from_xywh(x, l.y, CHANGE_BAR_WIDTH, l.line().height);
            path.extend(&Path::rect(rect));
        }
    }
    if !path.is_empty() {
        out.push(Node::Fill {
            path,
            paint: Paint::Solid(Rgba::BLACK),
            even_odd: false,
        });
    }
}

impl Renderer<'_> {
    /// The display list of a page (scene units are points).
    pub fn page_nodes(&mut self, page: &Page) -> Vec<Node> {
        let mut out = Vec::new();
        out.push(Node::Fill {
            path: Path::rect(Rect::from_xywh(0.0, 0.0, page.width, page.height)),
            paint: Paint::Solid(Rgba::WHITE),
            even_odd: false,
        });
        for item in &page.behind {
            self.item(item, &mut out);
        }
        // Shading and borders go under every line of text.
        for item in &page.items {
            if matches!(item, Item::Fill { .. }) {
                self.item(item, &mut out);
            }
        }
        for item in &page.items {
            if !matches!(item, Item::Fill { .. }) {
                self.item(item, &mut out);
            }
        }
        change_bars(page, &mut out);
        for item in &page.front {
            self.item(item, &mut out);
        }
        out
    }

    fn item(&mut self, item: &Item, out: &mut Vec<Node>) {
        match item {
            Item::Fill { rect, color } => out.push(Node::Fill {
                path: Path::rect(*rect),
                paint: Paint::Solid(*color),
                even_odd: false,
            }),
            Item::Rule {
                x0,
                y0,
                x1,
                y1,
                border,
            } => rule_nodes(*x0, *y0, *x1, *y1, border, out),
            Item::Line(l) => {
                let mut nodes = Vec::new();
                text::line_nodes(self, l, &mut nodes);
                match l.clip {
                    Some(clip) => out.push(
                        Group {
                            children: nodes,
                            opacity: 1.0,
                            clip: Some(Path::rect(clip)),
                            effects: Vec::new(),
                        }
                        .into_node(),
                    ),
                    None => out.extend(nodes),
                }
            }
            Item::Drawing(d) => drawing::drawing_nodes(self, &d.drawing, d.rect, &d.story, out),
            Item::LineNumber {
                text,
                right,
                baseline,
                size,
                font,
            } => text::plain_text(self, text, *right, *baseline, *size, font, out),
        }
    }

    /// Renders one page at `scale` pixels per point.
    pub fn render_page(&mut self, page: &Page, scale: f32) -> Raster {
        let nodes = self.page_nodes(page);
        let w = (page.width * scale).round().max(1.0) as u32;
        let h = (page.height * scale).round().max(1.0) as u32;
        raster::rasterize(&nodes, w, h, scale)
    }

    /// Renders a horizontal band of a page (`top..bottom` in points).
    pub fn render_band(&mut self, page: &Page, scale: f32, top: f32, bottom: f32) -> Raster {
        let nodes = self.page_nodes(page);
        let shifted: Vec<Node> = nodes
            .iter()
            .map(|n| n.transformed(&pptx_engine::path::Affine::translate(0.0, -f64::from(top))))
            .collect();
        let w = (page.width * scale).round().max(1.0) as u32;
        let h = ((bottom - top) * scale).round().max(1.0) as u32;
        raster::rasterize(&shifted, w, h, scale)
    }
}

impl Document {
    /// Renders a strip (`top..bottom` points) of page `index` of `layout`,
    /// at the scale that makes the page `width_px` pixels wide.
    #[allow(clippy::too_many_arguments)]
    pub fn render_band(
        &self,
        layout: &Layout,
        index: usize,
        width_px: u32,
        top: f32,
        bottom: f32,
        fonts: &FontDb,
        images: &mut ImageCache,
    ) -> Option<Raster> {
        let page = layout.pages.get(index)?;
        let scale = width_px.clamp(16, 16_384) as f32 / page.width.max(1.0);
        let top = top.clamp(0.0, page.height);
        let bottom = bottom.clamp(top + 1.0 / scale, page.height.max(top + 1.0 / scale));
        let mut r = Renderer {
            doc: self,
            fonts,
            images,
        };
        Some(r.render_band(page, scale, top, bottom))
    }

    /// Renders page `index` of `layout` `width_px` pixels wide.
    pub fn render_page(
        &self,
        layout: &Layout,
        index: usize,
        width_px: u32,
        fonts: &FontDb,
        images: &mut ImageCache,
    ) -> Option<Raster> {
        let page = layout.pages.get(index)?;
        let scale = width_px.clamp(16, 16_384) as f32 / page.width.max(1.0);
        let mut r = Renderer {
            doc: self,
            fonts,
            images,
        };
        Some(r.render_page(page, scale))
    }
}

#[cfg(test)]
mod test;
