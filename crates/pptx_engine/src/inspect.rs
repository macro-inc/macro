//! Read-only views of a presentation for editors and AI tools: the deck
//! outline (slides, shapes, text, tables, notes) and text layouts with caret
//! stops for in-place text editing.

use crate::edit::group::{Frame, GroupSpace};
use crate::edit::{CellRef, link_string, notes_text};
use crate::error::{Error, Result};
use crate::font::FontDb;
use crate::model::fill::Fill;
use crate::model::presentation::{PartRef, Presentation, SlideContext, SlideEntry};
use crate::model::shape::{
    GeometryRef, Graphic, Inherit, Shape, ShapeKind, WalkCtx, resolve_tree, sp_tree,
};
use crate::model::table::{Table, deck_table_styles, table_style_name};
use crate::model::table_style::{builtin_style, builtin_styles};
use crate::model::text::{
    Align, Anchor, BulletKind, Link, Paragraph, RunKind, RunProps, Strike, Underline, read_link,
};
use crate::opc::rel_type;
use crate::path::Affine;
use crate::render::build::{shape_geometry, text_frame};
use crate::render::table::{cell_text_layout, layout_table, table_style_id, table_styles_part};
use crate::render::text::{LayoutParams, LineBox, layout};
use crate::units::emu_to_pt;
use crate::xml::{NodeId, Ns, XmlDoc};
use serde::Serialize;
use std::collections::HashMap;

pub use crate::edit::LayoutInfo;
pub use crate::edit::guides::GuideOutline;
pub use animation::AnimationOutline;

mod animation;

pub use links::LinkRegion;
pub use media::MediaOutline;

mod links;
mod masters;
mod media;

pub use masters::{MasterLayoutOutline, MasterOutline};

pub use picture::{
    CropOutline, EffectsOutline, GlowOutline, PictureOutline, ReflectionOutline, ShadowOutline,
    SoftEdgeOutline,
};

mod picture;

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
    /// Cells by row and grid column.
    pub cells: Vec<Vec<CellOutline>>,
    /// Row heights as drawn (points), after rows grew to fit their text. Cell
    /// `(r, c)` starts at the frame's top-left corner plus the sums of the
    /// first `c` column widths and the first `r` of these heights.
    pub laid_out_row_heights: Vec<f32>,
    /// The table style, when one is set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<TableStyleOutline>,
}

/// One grid cell of a table.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellOutline {
    /// Rows the cell spans (1 unless merged).
    pub row_span: usize,
    /// Grid columns the cell spans (1 unless merged).
    pub col_span: usize,
    /// Covered by another cell's span (not drawn; edits go to that cell).
    pub merged: bool,
    /// Solid fill as `#RRGGBB`, from the cell or the table style.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    /// Vertical text alignment: `top`, `middle`, or `bottom`.
    pub anchor: &'static str,
    /// Margins `[left, top, right, bottom]` (points).
    pub margins: [f32; 4],
    /// Text direction as `formatBody` takes it (`vert`, `vert270`,
    /// `wordArtVert`...), when not horizontal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_direction: Option<&'static str>,
}

/// A table's style and the parts it emphasizes.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStyleOutline {
    /// Style id (a GUID).
    pub id: String,
    /// Display name ("Medium Style 2 - Accent 1").
    pub name: String,
    /// Header row emphasized.
    pub first_row: bool,
    /// Total row emphasized.
    pub last_row: bool,
    /// First column emphasized.
    pub first_col: bool,
    /// Last column emphasized.
    pub last_col: bool,
    /// Banded rows.
    pub band_row: bool,
    /// Banded columns.
    pub band_col: bool,
}

/// A table style tables in the deck can use.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStyleInfo {
    /// Style id (a GUID).
    pub id: String,
    /// Display name.
    pub name: String,
    /// Gallery group: `custom` (defined by the deck), `light`, `medium`, or `dark`.
    pub category: &'static str,
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
    /// Placeholder index (`p:ph/@idx`, 0 when absent), if a placeholder. A
    /// slide placeholder takes its position and text style from the layout
    /// placeholder with the same index (else the same type).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder_index: Option<u32>,
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
    /// The shape's own hyperlink (clicking the shape in a slide show), as
    /// `setShapeLink` takes it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    /// The shape link's ScreenTip.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_tip: Option<String>,
    /// The clip a video or audio shape plays.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media: Option<MediaOutline>,
    /// Preset geometry name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geometry: Option<String>,
    /// Solid fill as `#RRGGBB`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    /// Whether the shape can hold text (text ops apply).
    pub text_editable: bool,
    /// Text direction as `formatBody` takes it (`vert`, `vert270`,
    /// `wordArtVert`, `eaVert`, `mongolianVert`, `wordArtVertRtl`), when the
    /// text is not horizontal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_direction: Option<&'static str>,
    /// Text paragraphs.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub paragraphs: Vec<ParagraphOutline>,
    /// Table content.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table: Option<TableOutline>,
    /// Chart summary (charts only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart: Option<ChartOutline>,
    /// Crop and adjustments (pictures only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<PictureOutline>,
    /// Shadow, glow, soft edges, and reflection, when the shape has any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effects: Option<EffectsOutline>,
    /// Group members, back to front. Their box, rotation, and flips are in
    /// slide space: where each would sit directly on the slide (what
    /// `setTransform` takes and ungrouping gives it).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<ShapeOutline>,
}

/// A slide (or, read by its id, a slide master or layout: Slide Master view).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideOutline {
    /// Stable slide id (a master's or layout's id for those).
    pub id: u32,
    /// 0-based position (a master's or layout's position in Slide Master
    /// view order: each master, then its layouts).
    pub index: usize,
    /// Layout name (a master's or layout's own name for those).
    pub layout: String,
    /// The layout's id (see `DeckOutline::masters`); absent for a master.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout_id: Option<u32>,
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
    /// The transition into the slide.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transition: Option<TransitionOutline>,
    /// Animations of the main sequence, in playback order.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub animations: Vec<AnimationOutline>,
    /// The slide number, date, and footer the slide shows (absent: none).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_footer: Option<HeaderFooterOutline>,
    /// Drawing guides the slide's layout and master define (shown over the
    /// slide; `setGuides` does not change them).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub layout_guides: Vec<GuideOutline>,
}

/// What a slide shows of PowerPoint's Header & Footer elements: the slide
/// number, date, and footer placeholders it carries.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderFooterOutline {
    /// Shows the slide number.
    pub slide_number: bool,
    /// Shows a date.
    pub date: bool,
    /// The fixed date text, when the date is fixed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_text: Option<String>,
    /// The format of an automatic date (`datetime1`-`datetime13`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_format: Option<String>,
    /// Shows a footer.
    pub footer: bool,
    /// The footer text, when it shows a footer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub footer_text: Option<String>,
}

/// A slide transition.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionOutline {
    /// Effect: `none` (advance settings only), `cut`, `fade`, `push`, `wipe`,
    /// `split`, `reveal`, `randomBar`, `shape`, `uncover`, `cover`, `zoom`,
    /// `dissolve`, `flash`, `morph`, or the element name of another effect
    /// (`vortex`, `wheel`...), which `setTransition` cannot write.
    pub kind: String,
    /// Duration in milliseconds.
    pub duration_ms: u32,
    /// Effect option (see `setTransition`), when the effect has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    /// Whether a click advances to the next slide.
    pub advance_on_click: bool,
    /// Automatic advance after this many milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub advance_after_ms: Option<u32>,
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
    /// Slide masters with their layouts (PowerPoint's Slide Master view), in
    /// order. Their ids address them in edit operations and reads as slide
    /// ids do.
    pub masters: Vec<MasterOutline>,
    /// The first master's theme colors as `[slot, #RRGGBB]` (`dk1`, `lt1`, `accent1`...).
    pub theme_colors: Vec<(String, String)>,
    /// The first master's theme fonts (what `+mj-lt` and `+mn-lt` name).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_fonts: Option<ThemeFonts>,
    /// Table styles to offer: the deck's own, then PowerPoint's built-in ones.
    pub table_styles: Vec<TableStyleInfo>,
    /// Sections in order (absent when the deck has none). Every slide is in
    /// exactly one; a section may be empty.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sections: Option<Vec<SectionOutline>>,
    /// The drawing guides shown over every slide (View ▸ Guides), as
    /// `setGuides` takes them (absent when there are none).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub guides: Vec<GuideOutline>,
}

/// A named run of consecutive slides (PowerPoint's slide sections).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionOutline {
    /// Section id (a GUID such as `{8D2E61C4-0B1F-4E6A-9C3B-2A1D5F7E9B10}`).
    pub id: String,
    /// Section name.
    pub name: String,
    /// Ids of the section's slides, in deck order.
    pub slide_ids: Vec<u32>,
}

/// A theme's heading and body Latin typefaces.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeFonts {
    /// Headings (`+mj-lt`).
    pub major: String,
    /// Body text (`+mn-lt`).
    pub minor: String,
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
    /// Baseline shift in percent (positive = superscript, negative = subscript).
    pub baseline: f32,
    /// Character spacing in points (0 = normal).
    pub spacing: f32,
    /// Highlight color as `#RRGGBB`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highlight: Option<String>,
    /// Text shadow and glow (WordArt effects), when the text has any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effects: Option<EffectsOutline>,
    /// Hyperlink, as `formatText` takes it (an address, `#slide=<id>`, or a
    /// slide show jump such as `#nextslide`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    /// The hyperlink's ScreenTip.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_tip: Option<String>,
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
        laid_out_row_heights: row_heights.clone(),
        row_heights,
        cells: Vec::new(),
        style: None,
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

/// Pixel sizes of picture images by part name.
type ImageSizes = HashMap<String, (u32, u32)>;

/// Reads the pixel size of every picture's image among `shapes` (and their
/// group members) from its header.
fn image_sizes(pres: &Presentation, shapes: &[Shape], out: &mut ImageSizes) {
    for s in shapes {
        match &s.kind {
            ShapeKind::Group(members) => image_sizes(pres, members, out),
            ShapeKind::Picture(Some(img)) => {
                if let Some(part) = img.part.as_deref()
                    && !out.contains_key(part)
                    && let Some(size) = crate::edit::picture::natural_size(pres, part)
                {
                    out.insert(part.to_owned(), size);
                }
            }
            _ => {}
        }
    }
}

/// What a shape outline needs beyond the shape: chart outlines and picture sizes.
struct Media {
    charts: Charts,
    image_sizes: ImageSizes,
    /// The deck's slides, for links to them.
    slides: Vec<SlideEntry>,
}

/// `groups` are the spaces of the groups around `s`, outermost first.
fn shape_outline(s: &Shape, groups: &[GroupSpace], media: &Media) -> ShapeOutline {
    let doc = &s.part.doc;
    // Group members report the frame they have in slide space (what
    // `setTransform` takes and ungrouping gives them).
    let frame = groups
        .iter()
        .rev()
        .fold(Frame::from_xfrm(&s.xfrm), |f, g| g.bake(&f));
    let (x, y, w, h) = (
        frame.x as f32,
        frame.y as f32,
        frame.w as f32,
        frame.h as f32,
    );
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
            let mut inner = groups.to_vec();
            inner.push(GroupSpace::from_xfrm(&s.xfrm));
            members
                .iter()
                .map(|c| shape_outline(c, &inner, media))
                .collect()
        }
        _ => Vec::new(),
    };
    let chart = match &s.kind {
        ShapeKind::Frame(Graphic::Chart(name)) => media.charts.get(name).cloned(),
        _ => None,
    };
    let picture = match &s.kind {
        ShapeKind::Picture(img) => {
            let natural = img
                .as_ref()
                .and_then(|i| i.part.as_deref())
                .and_then(|p| media.image_sizes.get(p).copied());
            crate::edit::picture::outline(doc, s.node, natural)
        }
        _ => None,
    };
    let effects = crate::edit::effects::outline(
        &s.effects,
        !crate::edit::effects::has_own_effects(doc, s.node),
    );
    let link = crate::model::shape::c_nv_pr(doc, s.node)
        .and_then(|nv| doc.child(nv, Ns::A, "hlinkClick"))
        .and_then(|h| read_link(&s.part, h));
    let clip = match &s.kind {
        ShapeKind::Picture(_) => media::media_outline(doc, &s.part, s.node),
        _ => None,
    };
    ShapeOutline {
        media: clip,
        link: link.as_ref().and_then(|l| link_string(&media.slides, l)),
        link_tip: link.and_then(|l| l.tooltip),
        id: s.id,
        name: s.name.clone(),
        kind,
        placeholder: s.placeholder.as_ref().map(|p| p.kind.clone()),
        placeholder_index: s.placeholder.as_ref().map(|p| p.idx),
        x,
        y,
        w,
        h,
        rotation: frame.rot as f32,
        flip_h: frame.flip_h,
        flip_v: frame.flip_v,
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
        text_direction: s
            .text
            .as_ref()
            .map(|t| t.body.vert)
            .filter(|v| v.is_vertical())
            .map(|v| v.as_str()),
        paragraphs: tx_body.map(|b| paragraphs_of(doc, b)).unwrap_or_default(),
        table,
        chart,
        picture,
        effects,
        children,
    }
}

impl Presentation {
    /// The outline of the slide at `index`. Table text is measured without
    /// fonts, so rows that wrapped text grows are reported short; editors use
    /// [`Presentation::slide_outline_with_fonts`].
    pub fn slide_outline(&mut self, index: usize) -> Result<SlideOutline> {
        self.slide_outline_with_fonts(index, &FontDb::new())
    }

    /// The outline of the slide at `index`, with table rows measured with
    /// `fonts` exactly as the renderer measures them. `index` may instead be
    /// the id of a slide master or layout, which outlines that page.
    pub fn slide_outline_with_fonts(
        &mut self,
        index: usize,
        fonts: &FontDb,
    ) -> Result<SlideOutline> {
        let page = self.page(index)?;
        let ctx = self.page_context(index)?;
        let walk = WalkCtx {
            ctx: &ctx,
            inherit: Inherit::Slide,
        };
        let shapes = sp_tree(&ctx.slide.doc)
            .map(|t| resolve_tree(&walk, &ctx.slide, t))
            .unwrap_or_default();
        let mut media = Media {
            charts: Charts::new(),
            image_sizes: ImageSizes::new(),
            slides: self.slides.clone(),
        };
        chart_outlines(self, &ctx, &shapes, &mut media.charts);
        image_sizes(self, &shapes, &mut media.image_sizes);
        let mut outlines: Vec<ShapeOutline> = shapes
            .iter()
            .map(|s| shape_outline(s, &[], &media))
            .collect();
        let styles = table_styles_part(&ctx).and_then(|n| self.part(&n).ok());
        complete_tables(&ctx, styles.as_ref(), &shapes, &mut outlines, fonts);
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
        let hidden = ctx.slide.doc.attr_bool(ctx.slide.doc.root(), "show") == Some(false);
        let layout_guides = [ctx.layout.as_ref(), ctx.master.as_ref()]
            .into_iter()
            .flatten()
            .flat_map(|p| crate::edit::guides::read_part(&p.doc))
            .collect();
        let (index, layout, layout_id) = match page.slide {
            Some(index) => {
                let layout = ctx.layout.as_ref().map(|l| l.name.clone());
                let layout_id = match &layout {
                    Some(part) => masters::layout_id(self, part)?,
                    None => None,
                };
                let name = ctx.layout.as_ref().map(masters::page_name);
                (index, name.unwrap_or_default(), layout_id)
            }
            None => masters::page_position(self, &ctx, page.id)?,
        };
        Ok(SlideOutline {
            layout_guides,
            id: page.id,
            index,
            layout,
            layout_id,
            hidden,
            title,
            shapes: outlines,
            notes: match page.slide {
                Some(_) => notes_text(self, page.id)?,
                None => None,
            },
            transition: crate::edit::transition::read(&ctx.slide.doc),
            animations: crate::edit::animation::read(&ctx.slide.doc),
            header_footer: crate::edit::header_footer::read(&ctx.slide.doc),
        })
    }

    /// The outline of the whole deck. Table text is measured without fonts;
    /// editors use [`Presentation::outline_with_fonts`].
    pub fn outline(&mut self) -> Result<DeckOutline> {
        self.outline_with_fonts(&FontDb::new())
    }

    /// The outline of the whole deck, with table rows measured with `fonts`
    /// exactly as the renderer measures them.
    pub fn outline_with_fonts(&mut self, fonts: &FontDb) -> Result<DeckOutline> {
        let slides = (0..self.slides.len())
            .map(|i| self.slide_outline_with_fonts(i, fonts))
            .collect::<Result<Vec<_>>>()?;
        let (theme_colors, theme_fonts) = match self.slides.first() {
            Some(_) => {
                let ctx = self.slide_context(0)?;
                let colors = crate::model::color::SCHEME_SLOTS
                    .iter()
                    .zip(ctx.theme.colors.colors.iter())
                    .map(|(slot, c)| {
                        (
                            (*slot).to_owned(),
                            hex(&Fill::Solid(*c)).unwrap_or_default(),
                        )
                    })
                    .collect();
                let fonts = ThemeFonts {
                    major: ctx.theme.resolve_typeface("+mj-lt").to_owned(),
                    minor: ctx.theme.resolve_typeface("+mn-lt").to_owned(),
                };
                (colors, Some(fonts))
            }
            None => (Vec::new(), None),
        };
        Ok(DeckOutline {
            width: emu_to_pt(self.size.0 as f64),
            height: emu_to_pt(self.size.1 as f64),
            slides,
            layouts: crate::edit::layouts(self)?,
            masters: masters::outline(self)?,
            theme_colors,
            theme_fonts,
            table_styles: self.table_style_gallery()?,
            sections: crate::edit::sections::read(&*self.xml(&self.main_part.clone())?),
            guides: crate::edit::guides::deck_guides(self)?,
        })
    }

    /// The table styles the deck defines that are not built in, then the built-in ones.
    fn table_style_gallery(&mut self) -> Result<Vec<TableStyleInfo>> {
        let main = self.main_part.clone();
        let rels = self.part_rels(&main)?;
        let styles = rels
            .first_of_type(rel_type::TABLE_STYLES)
            .map(|r| rels.resolve(r))
            .and_then(|n| self.part(&n).ok());
        let custom = deck_table_styles(styles.as_ref())
            .into_iter()
            .filter(|(id, _)| builtin_style(id).is_none())
            .map(|(id, name)| TableStyleInfo {
                name: if name.is_empty() { id.clone() } else { name },
                id,
                category: "custom",
            });
        let builtin = builtin_styles().into_iter().map(|b| TableStyleInfo {
            id: b.id.to_owned(),
            name: b.name,
            category: b.category,
        });
        Ok(custom.chain(builtin).collect())
    }

    /// Lays out the text of a shape (or table cell) for caret placement.
    /// `index` is the slide's position, or a slide master's or layout's id.
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
        if let Some(cell) = cell {
            return self.cell_text_layout(index, shape, cell, fonts);
        }
        let ctx = self.page_context(index)?;
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
            .map(|p| paragraph_style(&s.part.doc, &self.slides, p))
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

    /// Lays out the text of a table cell (a merged cell's anchor) exactly
    /// where the renderer draws it: in the cell's rectangle, with rows grown
    /// to fit their text, inside the cell's margins and at its anchor. An
    /// empty cell lays out the empty paragraph that typing into it creates.
    fn cell_text_layout(
        &mut self,
        index: usize,
        shape: u32,
        cell: CellRef,
        fonts: &FontDb,
    ) -> Result<Option<TextLayoutInfo>> {
        let ctx = self.page_context(index)?;
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
        let ShapeKind::Frame(Graphic::Table(tbl)) = &s.kind else {
            return Ok(None);
        };
        let styles = table_styles_part(&ctx).and_then(|n| self.part(&n).ok());
        let mut part = s.part.clone();
        let mut grid = layout_table(&ctx, styles.as_ref(), &part, *tbl, fonts);
        let (nrows, ncols) = (grid.table.rows.len(), grid.table.cols.len());
        if cell.row >= nrows || cell.col >= ncols {
            return Err(Error::NotFound(format!(
                "cell ({}, {}) of a table with {nrows} rows × {ncols} columns",
                cell.row, cell.col
            )));
        }
        let (r, c) = merge_anchors(&grid.table)[cell.row][cell.col];
        let Some(node) = grid.table.rows[r].cells.get(c).map(|x| x.node) else {
            return Ok(None);
        };
        let empty = grid.table.rows[r].cells[c]
            .text
            .as_ref()
            .is_none_or(|t| t.paragraphs.is_empty());
        if empty {
            let mut doc = (*part.doc).clone();
            add_empty_paragraph(&mut doc, node);
            part.doc = std::sync::Arc::new(doc);
            grid = layout_table(&ctx, styles.as_ref(), &part, *tbl, fonts);
        }
        let cell = &grid.table.rows[r].cells[c];
        let Some(body) = &cell.text else {
            return Ok(None);
        };
        let rect = grid.cell_rect(cell);
        let lay = cell_text_layout(body, rect, fonts);
        let t = parent
            .pre_concat(&s.xfrm.local_to_parent())
            .pre_concat(&Affine::translate(f64::from(rect.x), f64::from(rect.y)))
            .pre_concat(&lay.transform);
        Ok(Some(TextLayoutInfo {
            transform: [t.a, t.b, t.c, t.d, t.e, t.f],
            size: [rect.w, rect.h],
            paragraphs: body
                .paragraphs
                .iter()
                .map(crate::render::text::paragraph_text)
                .collect(),
            lines: lay.lines,
            styles: body
                .paragraphs
                .iter()
                .map(|p| paragraph_style(&part.doc, &self.slides, p))
                .collect(),
        }))
    }
}

/// Gives a table cell (`a:tc`) a text body with one empty paragraph, as an
/// edit typing into it would.
fn add_empty_paragraph(doc: &mut XmlDoc, tc: NodeId) {
    let body = match doc.child(tc, Ns::A, "txBody") {
        Some(b) => b,
        None => {
            let b = doc.create_element(Ns::A, "txBody");
            for name in ["bodyPr", "lstStyle"] {
                let e = doc.create_element(Ns::A, name);
                doc.append_child(b, e);
            }
            doc.insert_child(tc, 0, b);
            b
        }
    };
    let p = doc.create_element(Ns::A, "p");
    let end = doc.create_element(Ns::A, "endParaRPr");
    doc.set_attr(end, "lang", "en-US");
    doc.append_child(p, end);
    doc.append_child(body, p);
}

/// For each grid position, the top-left cell of the merged cell covering it
/// (the position itself when it is not covered).
fn merge_anchors(t: &Table) -> Vec<Vec<(usize, usize)>> {
    let (nrows, ncols) = (t.rows.len(), t.cols.len());
    let mut map: Vec<Vec<(usize, usize)>> = (0..nrows)
        .map(|r| (0..ncols).map(|c| (r, c)).collect())
        .collect();
    let mut covered = vec![vec![false; ncols]; nrows];
    for cell in t.rows.iter().flat_map(|row| row.cells.iter()) {
        let (r, c) = (cell.row, cell.col);
        if cell.h_merge || cell.v_merge || c >= ncols || covered[r][c] {
            continue;
        }
        for rr in r..(r + cell.row_span).min(nrows) {
            for cc in c..(c + cell.grid_span).min(ncols) {
                if (rr, cc) != (r, c) {
                    map[rr][cc] = (r, c);
                    covered[rr][cc] = true;
                }
            }
        }
    }
    map
}

fn anchor_name(a: Anchor) -> &'static str {
    match a {
        Anchor::Top => "top",
        Anchor::Middle => "middle",
        Anchor::Bottom => "bottom",
    }
}

/// The cells of a laid-out table, by row and grid column.
fn cell_outlines(t: &Table) -> Vec<Vec<CellOutline>> {
    let anchors = merge_anchors(t);
    let plain = CellOutline {
        row_span: 1,
        col_span: 1,
        merged: false,
        fill: None,
        anchor: "top",
        margins: [7.2, 3.6, 7.2, 3.6],
        text_direction: None,
    };
    let mut out = vec![vec![plain; t.cols.len()]; t.rows.len()];
    for cell in t.rows.iter().flat_map(|row| row.cells.iter()) {
        let (r, c) = (cell.row, cell.col);
        let Some(slot) = out.get_mut(r).and_then(|row| row.get_mut(c)) else {
            continue;
        };
        let merged = cell.h_merge || cell.v_merge || anchors[r][c] != (r, c);
        let (rows, cols) = if merged {
            (1, 1)
        } else {
            (
                cell.row_span.min(t.rows.len() - r),
                cell.grid_span.min(t.cols.len() - c),
            )
        };
        *slot = CellOutline {
            row_span: rows,
            col_span: cols,
            merged,
            fill: hex(&cell.fill),
            anchor: anchor_name(cell.anchor),
            margins: cell.margins,
            text_direction: cell.vert.is_vertical().then(|| cell.vert.as_str()),
        };
    }
    out
}

/// Fills in what a table outline needs the resolved, laid-out table for:
/// cells, drawn row heights, and the style.
fn complete_tables(
    ctx: &SlideContext,
    styles: Option<&PartRef>,
    shapes: &[Shape],
    outlines: &mut [ShapeOutline],
    fonts: &FontDb,
) {
    for (s, o) in shapes.iter().zip(outlines.iter_mut()) {
        match &s.kind {
            ShapeKind::Group(children) => {
                complete_tables(ctx, styles, children, &mut o.children, fonts);
            }
            ShapeKind::Frame(Graphic::Table(tbl)) => {
                let Some(table) = o.table.as_mut() else {
                    continue;
                };
                let grid = layout_table(ctx, styles, &s.part, *tbl, fonts);
                table.cells = cell_outlines(&grid.table);
                table.laid_out_row_heights = grid.row_heights();
                let flags = grid.table.flags;
                table.style = table_style_id(&s.part.doc, *tbl).map(|id| TableStyleOutline {
                    name: table_style_name(styles, &id).unwrap_or_else(|| id.clone()),
                    id,
                    first_row: flags.first_row,
                    last_row: flags.last_row,
                    first_col: flags.first_col,
                    last_col: flags.last_col,
                    band_row: flags.band_row,
                    band_col: flags.band_col,
                });
            }
            _ => {}
        }
    }
}

fn run_style(props: &RunProps, start: usize, end: usize) -> RunStyle {
    linked_run_style(props, None, &[], start, end)
}

fn linked_run_style(
    props: &RunProps,
    link: Option<&Link>,
    slides: &[SlideEntry],
    start: usize,
    end: usize,
) -> RunStyle {
    RunStyle {
        link: link.and_then(|l| link_string(slides, l)),
        link_tip: link.and_then(|l| l.tooltip.clone()),
        start,
        end,
        bold: props.bold,
        italic: props.italic,
        underline: props.underline != Underline::None,
        strike: props.strike != Strike::None,
        size: props.size,
        color: hex(&props.fill),
        font: props.latin.clone(),
        baseline: props.baseline,
        spacing: props.spacing,
        highlight: props.highlight.and_then(|c| hex(&Fill::Solid(c))),
        effects: crate::edit::effects::outline(&props.effects, false),
    }
}

fn paragraph_style(doc: &XmlDoc, slides: &[SlideEntry], p: &Paragraph) -> ParagraphStyle {
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
            let style = linked_run_style(&r.props, r.link.as_ref(), slides, offset, offset + len);
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
