//! Read-only views of a presentation for editors and AI tools: the deck
//! outline (slides, shapes, text, tables, notes) and text layouts with caret
//! stops for in-place text editing.

use crate::edit::{CellRef, notes_text};
use crate::error::{Error, Result};
use crate::font::FontDb;
use crate::model::fill::Fill;
use crate::model::presentation::{Presentation, SlideContext};
use crate::model::shape::{
    GeometryRef, Graphic, Inherit, Shape, ShapeKind, WalkCtx, resolve_tree, sp_tree,
};
use crate::model::text::{Align, BulletKind, Paragraph, RunKind, RunProps, Strike, Underline};
use crate::path::{Affine, Point, Rect};
use crate::render::build::{shape_geometry, text_frame};
use crate::render::text::{LayoutParams, LineBox, layout};
use crate::units::emu_to_pt;
use crate::xml::{NodeId, Ns, XmlDoc};
use serde::Serialize;
use std::collections::HashMap;

pub use crate::edit::LayoutInfo;

/// What kind of object a shape is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ShapeKindName {
    /// A shape with editable text (text box or placeholder).
    Text,
    /// A drawn shape (may hold text).
    Shape,
    /// A line or connector.
    Connector,
    /// A picture.
    Picture,
    /// A table.
    Table,
    /// A chart.
    Chart,
    /// SmartArt.
    Diagram,
    /// An embedded object (shown through its preview).
    Object,
    /// A group.
    Group,
    /// Anything else.
    Other,
}

/// One paragraph of a shape's text.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphOutline {
    /// Text (`\u{b}` marks line breaks).
    pub text: String,
    /// Outline level (0-8).
    pub level: u8,
}

/// A table's cell text and grid.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableOutline {
    /// Cell text by row (merged-over cells are empty).
    pub rows: Vec<Vec<String>>,
    /// Column widths (points).
    pub column_widths: Vec<f32>,
    /// Row heights (points).
    pub row_heights: Vec<f32>,
}

/// A chart's type, labels, and cached data.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartOutline {
    /// `bar` (horizontal), `column`, `line`, `pie`, `doughnut`, `area`, `scatter`,
    /// `radar`, `bubble`, `stock`, `surface`, `other` (the first plot's type).
    pub kind: String,
    /// `clustered`, `stacked`, `percentStacked`, or `standard` (lines/areas), when the plot has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grouping: Option<String>,
    /// Title text when a title is shown (auto titles: the single series' name).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Legend position `right`, `left`, `top`, `bottom`, `topRight`, or None when there is no legend.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legend: Option<String>,
    /// Whether any series shows value data labels.
    pub data_labels: bool,
    /// Category labels (from the first series that has categories).
    pub categories: Vec<String>,
    /// Series in plot order.
    pub series: Vec<ChartSeriesOutline>,
    /// Whether setChartData/setChartType can rewrite this chart (single plot
    /// of bar/column/line/pie/doughnut/area with cached or literal data).
    /// Combo charts, scatter/bubble/stock/surface/radar, and charts without
    /// data caches are false.
    pub editable: bool,
}

/// One series of a chart.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartSeriesOutline {
    /// Series name.
    pub name: String,
    /// Values per category (`null` for blanks).
    pub values: Vec<Option<f64>>,
    /// Series fill/line color as `#RRGGBB` when explicit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// A shape on a slide.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeOutline {
    /// Shape id (unique within the slide).
    pub id: u32,
    /// Shape name.
    pub name: String,
    /// Kind.
    pub kind: ShapeKindName,
    /// Placeholder type (`title`, `body`, `ctrTitle`...), if a placeholder.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    /// Left in slide coordinates (points).
    pub x: f32,
    /// Top.
    pub y: f32,
    /// Width.
    pub w: f32,
    /// Height.
    pub h: f32,
    /// Clockwise rotation in degrees.
    pub rotation: f32,
    /// Mirrored horizontally.
    pub flip_h: bool,
    /// Mirrored vertically.
    pub flip_v: bool,
    /// Hidden shapes are not rendered.
    pub hidden: bool,
    /// Alt text.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub alt_text: String,
    /// Preset geometry name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geometry: Option<String>,
    /// Solid fill as `#RRGGBB`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    /// Whether the shape can hold text (text ops apply).
    pub text_editable: bool,
    /// Text paragraphs.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub paragraphs: Vec<ParagraphOutline>,
    /// Table content.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table: Option<TableOutline>,
    /// Chart summary (charts only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart: Option<ChartOutline>,
    /// Group members.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<ShapeOutline>,
}

/// A slide.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideOutline {
    /// Stable slide id.
    pub id: u32,
    /// 0-based position.
    pub index: usize,
    /// Layout name.
    pub layout: String,
    /// Hidden from slideshows.
    pub hidden: bool,
    /// Title placeholder text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Shapes in z-order (back to front).
    pub shapes: Vec<ShapeOutline>,
    /// Speaker notes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// The whole deck.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckOutline {
    /// Slide width (points).
    pub width: f32,
    /// Slide height (points).
    pub height: f32,
    /// Slides in order.
    pub slides: Vec<SlideOutline>,
    /// Layouts available to new slides.
    pub layouts: Vec<LayoutInfo>,
    /// The first master's theme colors as `[slot, #RRGGBB]` (`dk1`, `lt1`, `accent1`...).
    pub theme_colors: Vec<(String, String)>,
}

/// The resolved formatting of a stretch of text (for toolbar state).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStyle {
    /// First character (paragraph offset).
    pub start: usize,
    /// End (exclusive).
    pub end: usize,
    /// Bold.
    pub bold: bool,
    /// Italic.
    pub italic: bool,
    /// Underlined.
    pub underline: bool,
    /// Struck through.
    pub strike: bool,
    /// Size in points.
    pub size: f32,
    /// Solid text color as `#RRGGBB`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Latin typeface.
    pub font: String,
}

/// The resolved formatting of a paragraph.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphStyle {
    /// `left`, `center`, `right`, `justify`, or `distributed`.
    pub align: &'static str,
    /// Outline level.
    pub level: u8,
    /// Whether the paragraph has a bullet or number.
    pub bullet: bool,
    /// Runs (line breaks included, one character each).
    pub runs: Vec<RunStyle>,
    /// The formatting new text typed at the paragraph end gets.
    pub end: RunStyle,
}

/// A laid-out text body, for carets, selections, and hit testing.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLayoutInfo {
    /// Layout space → slide space (`[a, b, c, d, e, f]`, points).
    pub transform: [f64; 6],
    /// Width and height of the layout box.
    pub size: [f32; 2],
    /// Paragraph texts (`\u{b}` = line break), indexed like caret stops.
    pub paragraphs: Vec<String>,
    /// Lines with caret stops.
    pub lines: Vec<LineBox>,
    /// Paragraph and run formatting, indexed like `paragraphs`.
    pub styles: Vec<ParagraphStyle>,
}

/// Plain text of an `a:p` (`a:br` = `\u{b}`).
pub fn dom_paragraph_text(doc: &XmlDoc, p: NodeId) -> String {
    doc.children(p)
        .filter_map(|c| match doc.local(c) {
            "r" | "fld" => doc.child(c, Ns::A, "t").map(|t| doc.text(t)),
            "br" => Some("\u{b}".to_owned()),
            _ => None,
        })
        .collect()
}

fn paragraphs_of(doc: &XmlDoc, body: NodeId) -> Vec<ParagraphOutline> {
    doc.children_named(body, Ns::A, "p")
        .map(|p| ParagraphOutline {
            text: dom_paragraph_text(doc, p),
            level: doc
                .child(p, Ns::A, "pPr")
                .and_then(|pr| doc.attr_i64(pr, "lvl"))
                .unwrap_or(0)
                .clamp(0, 8) as u8,
        })
        .collect()
}

fn table_outline(doc: &XmlDoc, tbl: NodeId) -> TableOutline {
    let column_widths = doc
        .child(tbl, Ns::A, "tblGrid")
        .map(|g| {
            doc.children_named(g, Ns::A, "gridCol")
                .map(|c| doc.attr_f64(c, "w").map_or(0.0, emu_to_pt))
                .collect()
        })
        .unwrap_or_default();
    let mut rows = Vec::new();
    let mut row_heights = Vec::new();
    for tr in doc.children_named(tbl, Ns::A, "tr") {
        row_heights.push(doc.attr_f64(tr, "h").map_or(0.0, emu_to_pt));
        rows.push(
            doc.children_named(tr, Ns::A, "tc")
                .map(|tc| {
                    doc.child(tc, Ns::A, "txBody")
                        .map(|b| {
                            doc.children_named(b, Ns::A, "p")
                                .map(|p| dom_paragraph_text(doc, p))
                                .collect::<Vec<_>>()
                                .join("\n")
                        })
                        .unwrap_or_default()
                })
                .collect(),
        );
    }
    TableOutline {
        rows,
        column_widths,
        row_heights,
    }
}

fn hex(fill: &Fill) -> Option<String> {
    match fill {
        Fill::Solid(c) => {
            let ch = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
            Some(format!("#{:02X}{:02X}{:02X}", ch(c.r), ch(c.g), ch(c.b)))
        }
        _ => None,
    }
}

/// Axis-aligned bounds of a box under a transform.
fn bounds(t: &Affine, r: Rect) -> Rect {
    let pts = [
        Point::new(r.x, r.y),
        Point::new(r.right(), r.y),
        Point::new(r.right(), r.bottom()),
        Point::new(r.x, r.bottom()),
    ]
    .map(|p| t.apply(p));
    let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for p in pts {
        x0 = x0.min(p.x);
        y0 = y0.min(p.y);
        x1 = x1.max(p.x);
        y1 = y1.max(p.y);
    }
    Rect::from_ltrb(x0, y0, x1, y1)
}

/// Chart outlines by chart part name.
type Charts = HashMap<String, ChartOutline>;

/// Outlines every chart among `shapes` (and their group members).
fn chart_outlines(pres: &mut Presentation, ctx: &SlideContext, shapes: &[Shape], out: &mut Charts) {
    for s in shapes {
        match &s.kind {
            ShapeKind::Group(members) => chart_outlines(pres, ctx, members, out),
            ShapeKind::Frame(Graphic::Chart(name)) if !out.contains_key(name) => {
                let Ok(part) = pres.part(name) else {
                    continue;
                };
                if let Some(mut outline) = crate::render::chart::chart_outline(pres, ctx, &part) {
                    outline.editable = crate::edit::chart::is_editable(&part.doc);
                    out.insert(name.clone(), outline);
                }
            }
            _ => {}
        }
    }
}

fn shape_outline(s: &Shape, parent: &Affine, charts: &Charts) -> ShapeOutline {
    let doc = &s.part.doc;
    // Top-level shapes report their own box; group members report it mapped to the slide.
    let (x, y, w, h) = if *parent == Affine::IDENTITY {
        (s.xfrm.x, s.xfrm.y, s.xfrm.w, s.xfrm.h)
    } else {
        let b = bounds(parent, s.xfrm.rect());
        (b.x, b.y, b.w, b.h)
    };
    let tx_body = doc.children(s.node).find(|&c| doc.local(c) == "txBody");
    let (kind, table) = match &s.kind {
        ShapeKind::Group(_) => (ShapeKindName::Group, None),
        ShapeKind::Connector => (ShapeKindName::Connector, None),
        ShapeKind::Picture(_) => (ShapeKindName::Picture, None),
        ShapeKind::Frame(Graphic::Table(tbl)) => {
            (ShapeKindName::Table, Some(table_outline(doc, *tbl)))
        }
        ShapeKind::Frame(Graphic::Chart(_)) => (ShapeKindName::Chart, None),
        ShapeKind::Frame(Graphic::Diagram(_)) => (ShapeKindName::Diagram, None),
        ShapeKind::Frame(Graphic::Ole { .. }) => (ShapeKindName::Object, None),
        ShapeKind::Frame(Graphic::Unknown) => (ShapeKindName::Other, None),
        ShapeKind::Shape => {
            let text_box = doc
                .path(s.node, Ns::P, &["nvSpPr", "cNvSpPr"])
                .and_then(|c| doc.attr_bool(c, "txBox"))
                .unwrap_or(false);
            let kind = if s.placeholder.is_some() || text_box {
                ShapeKindName::Text
            } else {
                ShapeKindName::Shape
            };
            (kind, None)
        }
    };
    let children = match &s.kind {
        ShapeKind::Group(members) => {
            let child_parent = parent
                .pre_concat(&s.xfrm.local_to_parent())
                .pre_concat(&s.xfrm.child_to_local());
            members
                .iter()
                .map(|c| shape_outline(c, &child_parent, charts))
                .collect()
        }
        _ => Vec::new(),
    };
    let chart = match &s.kind {
        ShapeKind::Frame(Graphic::Chart(name)) => charts.get(name).cloned(),
        _ => None,
    };
    ShapeOutline {
        id: s.id,
        name: s.name.clone(),
        kind,
        placeholder: s.placeholder.as_ref().map(|p| p.kind.clone()),
        x,
        y,
        w,
        h,
        rotation: s.xfrm.rot,
        flip_h: s.xfrm.flip_h,
        flip_v: s.xfrm.flip_v,
        hidden: s.hidden,
        alt_text: s.descr.clone(),
        geometry: match &s.geometry {
            GeometryRef::Preset(name, _)
                if !matches!(kind, ShapeKindName::Group | ShapeKindName::Table) =>
            {
                Some(name.clone())
            }
            _ => None,
        },
        fill: hex(&s.fill),
        text_editable: doc.local(s.node) == "sp",
        paragraphs: tx_body.map(|b| paragraphs_of(doc, b)).unwrap_or_default(),
        table,
        chart,
        children,
    }
}

impl Presentation {
    /// The outline of the slide at `index`.
    pub fn slide_outline(&mut self, index: usize) -> Result<SlideOutline> {
        let entry = self
            .slides
            .get(index)
            .cloned()
            .ok_or_else(|| Error::NotFound(format!("slide {index}")))?;
        let ctx = self.slide_context(index)?;
        let walk = WalkCtx {
            ctx: &ctx,
            inherit: Inherit::Slide,
        };
        let shapes = sp_tree(&ctx.slide.doc)
            .map(|t| resolve_tree(&walk, &ctx.slide, t))
            .unwrap_or_default();
        let mut charts = Charts::new();
        chart_outlines(self, &ctx, &shapes, &mut charts);
        let outlines: Vec<ShapeOutline> = shapes
            .iter()
            .map(|s| shape_outline(s, &Affine::IDENTITY, &charts))
            .collect();
        let title = outlines
            .iter()
            .find(|s| matches!(s.placeholder.as_deref(), Some("title" | "ctrTitle")))
            .map(|s| {
                s.paragraphs
                    .iter()
                    .map(|p| p.text.replace('\u{b}', " "))
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .filter(|t| !t.trim().is_empty());
        let layout = ctx
            .layout
            .as_ref()
            .and_then(|l| {
                l.doc
                    .child(l.doc.root(), Ns::P, "cSld")
                    .and_then(|c| l.doc.attr(c, "name"))
                    .map(str::to_owned)
            })
            .unwrap_or_default();
        let hidden = ctx.slide.doc.attr_bool(ctx.slide.doc.root(), "show") == Some(false);
        Ok(SlideOutline {
            id: entry.id,
            index,
            layout,
            hidden,
            title,
            shapes: outlines,
            notes: notes_text(self, entry.id)?,
        })
    }

    /// The outline of the whole deck.
    pub fn outline(&mut self) -> Result<DeckOutline> {
        let slides = (0..self.slides.len())
            .map(|i| self.slide_outline(i))
            .collect::<Result<Vec<_>>>()?;
        let theme_colors = match self.slides.first() {
            Some(_) => {
                let ctx = self.slide_context(0)?;
                crate::model::color::SCHEME_SLOTS
                    .iter()
                    .zip(ctx.theme.colors.colors.iter())
                    .map(|(slot, c)| {
                        (
                            (*slot).to_owned(),
                            hex(&Fill::Solid(*c)).unwrap_or_default(),
                        )
                    })
                    .collect()
            }
            None => Vec::new(),
        };
        Ok(DeckOutline {
            width: emu_to_pt(self.size.0 as f64),
            height: emu_to_pt(self.size.1 as f64),
            slides,
            layouts: crate::edit::layouts(self)?,
            theme_colors,
        })
    }

    /// Lays out the text of a shape (or table cell) for caret placement.
    ///
    /// Returns `None` when the shape cannot hold text. Shapes inside groups
    /// are supported; their transform includes the group's.
    pub fn text_layout(
        &mut self,
        index: usize,
        shape: u32,
        cell: Option<CellRef>,
        fonts: &FontDb,
    ) -> Result<Option<TextLayoutInfo>> {
        if cell.is_some() {
            return Ok(None);
        }
        let ctx = self.slide_context(index)?;
        let walk = WalkCtx {
            ctx: &ctx,
            inherit: Inherit::Slide,
        };
        let shapes = sp_tree(&ctx.slide.doc)
            .map(|t| resolve_tree(&walk, &ctx.slide, t))
            .unwrap_or_default();
        let Some((s, parent)) = find_resolved(&shapes, shape, Affine::IDENTITY) else {
            return Err(Error::NotFound(format!("shape {shape}")));
        };
        if !matches!(s.kind, ShapeKind::Shape) {
            return Ok(None);
        }
        let Some(body) = s.text.clone() else {
            return Ok(None);
        };
        if body.paragraphs.is_empty() {
            return Ok(None);
        }
        let geom = shape_geometry(s);
        let frame = text_frame(s, &geom, &body, &parent);
        let lay = layout(
            &body,
            frame.w,
            frame.h,
            fonts,
            LayoutParams::from_body(&body),
        );
        let t = frame.transform.pre_concat(&lay.transform);
        let styles = body
            .paragraphs
            .iter()
            .map(|p| paragraph_style(&s.part.doc, p))
            .collect();
        Ok(Some(TextLayoutInfo {
            transform: [t.a, t.b, t.c, t.d, t.e, t.f],
            size: [frame.w, frame.h],
            paragraphs: body
                .paragraphs
                .iter()
                .map(crate::render::text::paragraph_text)
                .collect(),
            lines: lay.lines,
            styles,
        }))
    }
}

fn run_style(props: &RunProps, start: usize, end: usize) -> RunStyle {
    RunStyle {
        start,
        end,
        bold: props.bold,
        italic: props.italic,
        underline: props.underline != Underline::None,
        strike: props.strike != Strike::None,
        size: props.size,
        color: hex(&props.fill),
        font: props.latin.clone(),
    }
}

fn paragraph_style(doc: &XmlDoc, p: &Paragraph) -> ParagraphStyle {
    let mut offset = 0;
    let runs = p
        .runs
        .iter()
        .map(|r| {
            let len = if r.kind == RunKind::Break {
                1
            } else {
                r.text.chars().count()
            };
            let style = run_style(&r.props, offset, offset + len);
            offset += len;
            style
        })
        .collect();
    ParagraphStyle {
        align: match p.props.align {
            Align::Left => "left",
            Align::Center => "center",
            Align::Right => "right",
            Align::Justify => "justify",
            Align::Distributed => "distributed",
        },
        level: doc
            .child(p.node, Ns::A, "pPr")
            .and_then(|pr| doc.attr_i64(pr, "lvl"))
            .unwrap_or(0)
            .clamp(0, 8) as u8,
        bullet: !matches!(p.props.bullet.kind, BulletKind::None),
        runs,
        end: run_style(&p.end_props, offset, offset),
    }
}

/// Finds a resolved shape by id, with the transform of its parent group.
fn find_resolved(shapes: &[Shape], id: u32, parent: Affine) -> Option<(&Shape, Affine)> {
    for s in shapes {
        if s.id == id {
            return Some((s, parent));
        }
        if let ShapeKind::Group(children) = &s.kind {
            let child_parent = parent
                .pre_concat(&s.xfrm.local_to_parent())
                .pre_concat(&s.xfrm.child_to_local());
            if let Some(found) = find_resolved(children, id, child_parent) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg(test)]
mod test;
