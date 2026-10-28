//! Drawings in runs: pictures, shapes, text boxes, charts (DrawingML in
//! `w:drawing`, VML in `w:pict`/`w:object`), their size and placement.

use crate::units::{emu, twips};
use crate::xml::{NodeId, Ns, SnippetContext, XmlTree, parse_int, parse_on_off};
use std::sync::Arc;

/// What a horizontal or vertical position is relative to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RelFrom {
    /// The page edge.
    Page,
    /// The margin (text area).
    Margin,
    /// The column.
    Column,
    /// The anchoring character / paragraph / line.
    Text,
    /// The left/top margin area.
    LeftMargin,
    /// The right/bottom margin area.
    RightMargin,
    /// Inside margin (mirrored pages).
    InsideMargin,
    /// Outside margin.
    OutsideMargin,
}

/// Position along one axis.
#[derive(Clone, Debug, PartialEq)]
pub struct AxisPos {
    /// Relative to.
    pub from: RelFrom,
    /// Alignment keyword (`left`, `center`, `right`, `top`, `bottom`, `inside`...).
    pub align: Option<String>,
    /// Offset in points.
    pub offset: f32,
    /// For vertical positions relative to text: relative to the line (else paragraph).
    pub line: bool,
}

/// How text wraps around a floating object.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Wrap {
    /// No wrapping: in front of or behind text.
    None,
    /// Text flows around the bounding box.
    Square,
    /// Text flows around the outline (treated as the box).
    Tight,
    /// Text above and below only.
    TopAndBottom,
}

/// Placement of a floating (anchored) drawing.
#[derive(Clone, Debug, PartialEq)]
pub struct Anchor {
    /// Horizontal position.
    pub h: AxisPos,
    /// Vertical position.
    pub v: AxisPos,
    /// Text wrapping.
    pub wrap: Wrap,
    /// Which sides text may wrap on (`bothSides`, `left`, `right`, `largest`).
    pub wrap_side: String,
    /// Behind the text.
    pub behind: bool,
    /// Distance from text: top, bottom, left, right (points).
    pub dist: [f32; 4],
    /// Z-order.
    pub z: i64,
    /// Positioned within the table cell holding its anchor (rather than
    /// the page's column) when it is in one.
    pub in_cell: bool,
}

/// What a drawing shows.
#[derive(Clone, Debug, PartialEq)]
pub enum Graphic {
    /// A picture (relationship id of the image).
    Picture,
    /// A shape (possibly with a text box).
    Shape,
    /// A group of shapes and pictures.
    Group,
    /// A chart (relationship id of the chart part).
    Chart(String),
    /// Something else (SmartArt, ink...): drawn from its fallback, if any.
    Other,
}

/// A drawing found in a run.
#[derive(Clone, Debug)]
pub struct Drawing {
    /// Width (points).
    pub width: f32,
    /// Height (points).
    pub height: f32,
    /// Extra space for effects: left, top, right, bottom (points).
    pub effect: [f32; 4],
    /// Placement when floating.
    pub anchor: Option<Anchor>,
    /// Content kind.
    pub graphic: Graphic,
    /// The parsed XML of the object.
    pub tree: Arc<XmlTree>,
    /// The element holding the graphic (`wp:inline`/`wp:anchor`, or the VML shape).
    pub node: NodeId,
    /// VML rather than DrawingML.
    pub vml: bool,
}

/// Where text goes vertically in a text box.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextAnchor {
    /// At the top.
    Top,
    /// Centered.
    Middle,
    /// At the bottom.
    Bottom,
}

/// The text of a shape: its content and where it goes in the shape.
#[derive(Clone, Copy, Debug)]
pub struct TextBox {
    /// The `w:txbxContent` element (in the drawing's tree).
    pub content: NodeId,
    /// Distances of the text from the shape's edges: left, top, right,
    /// bottom (points).
    pub insets: [f32; 4],
    /// Vertical placement of the text.
    pub anchor: TextAnchor,
}

/// Default text box insets: 0.1in left and right, 0.05in top and bottom.
const TEXT_INSETS: [f32; 4] = [7.2, 3.6, 7.2, 3.6];

impl Drawing {
    /// The text box of a shape (not of a shape in a group), if it holds
    /// text.
    pub fn text_box(&self) -> Option<TextBox> {
        let t = &self.tree;
        if self.graphic != Graphic::Shape {
            return None;
        }
        if self.vml {
            let tb = t.children(self.node).find(|&c| t.is(c, Ns::V, "textbox"))?;
            let content = t.children(tb).find(|&c| t.is_w(c, "txbxContent"))?;
            let mut insets = TEXT_INSETS;
            if let Some(v) = t.attr(tb, Ns::NONE, "inset") {
                for (i, part) in v.split(',').take(4).enumerate() {
                    if let Some(len) = css_length(part) {
                        insets[i] = len;
                    }
                }
            }
            let style = t.attr(self.node, Ns::NONE, "style").unwrap_or("");
            let anchor = match css_prop(style, "v-text-anchor") {
                Some(a) if a.starts_with("middle") => TextAnchor::Middle,
                Some(a) if a.starts_with("bottom") => TextAnchor::Bottom,
                _ => TextAnchor::Top,
            };
            return Some(TextBox {
                content,
                insets,
                anchor,
            });
        }
        let wsp = t
            .descendants(self.node)
            .into_iter()
            .find(|&d| t.is(d, Ns::WPS, "wsp"))?;
        let content = t
            .child(wsp, Ns::WPS, "txbx")
            .and_then(|tb| t.children(tb).find(|&c| t.is_w(c, "txbxContent")))?;
        let body = t.child(wsp, Ns::WPS, "bodyPr");
        let inset = |name: &str, default: f32| {
            body.and_then(|b| t.attr(b, Ns::NONE, name))
                .and_then(parse_int)
                .map_or(default, emu)
        };
        let insets = [
            inset("lIns", TEXT_INSETS[0]),
            inset("tIns", TEXT_INSETS[1]),
            inset("rIns", TEXT_INSETS[2]),
            inset("bIns", TEXT_INSETS[3]),
        ];
        let anchor = match body.and_then(|b| t.attr(b, Ns::NONE, "anchor")) {
            Some("ctr") => TextAnchor::Middle,
            Some("b") => TextAnchor::Bottom,
            _ => TextAnchor::Top,
        };
        Some(TextBox {
            content,
            insets,
            anchor,
        })
    }
}

fn rel_from(v: Option<&str>) -> RelFrom {
    match v.unwrap_or("column") {
        "page" => RelFrom::Page,
        "margin" => RelFrom::Margin,
        "column" => RelFrom::Column,
        "leftMargin" | "topMargin" => RelFrom::LeftMargin,
        "rightMargin" | "bottomMargin" => RelFrom::RightMargin,
        "insideMargin" => RelFrom::InsideMargin,
        "outsideMargin" => RelFrom::OutsideMargin,
        _ => RelFrom::Text,
    }
}

fn read_axis(t: &XmlTree, n: Option<NodeId>, vertical: bool) -> AxisPos {
    let Some(n) = n else {
        return AxisPos {
            from: RelFrom::Text,
            align: None,
            offset: 0.0,
            line: false,
        };
    };
    let from_attr = t.attr(n, Ns::NONE, "relativeFrom");
    let line = vertical && from_attr == Some("line");
    let align = t
        .child(n, Ns::WP, "align")
        .map(|a| t.text(a).trim().to_owned());
    let offset = t
        .child(n, Ns::WP, "posOffset")
        .and_then(|o| parse_int(&t.text(o)))
        .map_or(0.0, emu);
    AxisPos {
        from: rel_from(from_attr),
        align,
        offset,
        line,
    }
}

/// The supported branch of an `mc:AlternateContent`, or its fallback.
pub fn alternate_choice(t: &XmlTree, ac: NodeId) -> Option<NodeId> {
    const UNDERSTOOD: &[&str] = &[
        "wps", "wpg", "wp14", "w14", "w15", "a14", "wpc", "v", "o", "c14", "w10",
    ];
    for c in t.children(ac) {
        if t.is(c, Ns::MC, "Choice") {
            let requires = t.attr(c, Ns::NONE, "Requires").unwrap_or("");
            if requires.split_whitespace().all(|r| UNDERSTOOD.contains(&r)) {
                return Some(c);
            }
        } else if t.is(c, Ns::MC, "Fallback") {
            return Some(c);
        }
    }
    None
}

/// Parses a length in a VML `style` (`width:72pt;height:1in`) to points.
pub fn css_length(v: &str) -> Option<f32> {
    let v = v.trim();
    let (num, unit) = v
        .find(|c: char| c.is_ascii_alphabetic() || c == '%')
        .map_or((v, ""), |i| (&v[..i], &v[i..]));
    let n: f32 = num.trim().parse().ok()?;
    Some(match unit {
        "pt" | "" => n,
        "in" => n * 72.0,
        "cm" => n * 72.0 / 2.54,
        "mm" => n * 72.0 / 25.4,
        "px" => n * 0.75,
        "pc" => n * 12.0,
        "emu" => n / 12_700.0,
        _ => return None,
    })
}

/// Reads one property from a VML `style` attribute.
pub fn css_prop<'a>(style: &'a str, name: &str) -> Option<&'a str> {
    style.split(';').find_map(|decl| {
        let (k, v) = decl.split_once(':')?;
        (k.trim().eq_ignore_ascii_case(name)).then_some(v.trim())
    })
}

/// Parses a run object (`w:drawing`, `w:pict`, `w:object`,
/// `mc:AlternateContent`) into a drawing, if it is one.
pub fn parse_drawing(xml: &str, snippets: &SnippetContext) -> Option<Drawing> {
    let tree = Arc::new(snippets.parse(xml).ok()?);
    let root = tree.root();
    find_drawing(&tree, root)
}

fn find_drawing(t: &Arc<XmlTree>, n: NodeId) -> Option<Drawing> {
    if t.is(n, Ns::MC, "AlternateContent") {
        let branch = alternate_choice(t, n)?;
        return t.children(branch).find_map(|c| find_drawing(t, c));
    }
    if t.is_w(n, "drawing") {
        let holder = t
            .children(n)
            .find(|&c| t.is(c, Ns::WP, "inline") || t.is(c, Ns::WP, "anchor"))?;
        return drawingml(t, holder);
    }
    if t.is_w(n, "pict") || t.is_w(n, "object") {
        // The first VML shape with a size.
        let shape = t.descendants(n).into_iter().find(|&d| {
            t.ns(d) == Ns::V
                && matches!(
                    t.local(d),
                    "shape" | "rect" | "roundrect" | "oval" | "line" | "group" | "image"
                )
        })?;
        return vml(t, n, shape);
    }
    None
}

fn drawingml(t: &Arc<XmlTree>, holder: NodeId) -> Option<Drawing> {
    let inline = t.is(holder, Ns::WP, "inline");
    let extent = t.child(holder, Ns::WP, "extent")?;
    let cx = t
        .attr(extent, Ns::NONE, "cx")
        .and_then(parse_int)
        .unwrap_or(0);
    let cy = t
        .attr(extent, Ns::NONE, "cy")
        .and_then(parse_int)
        .unwrap_or(0);
    let effect = t
        .child(holder, Ns::WP, "effectExtent")
        .map_or([0.0; 4], |e| {
            let v = |n: &str| t.attr(e, Ns::NONE, n).and_then(parse_int).map_or(0.0, emu);
            [v("l"), v("t"), v("r"), v("b")]
        });
    let graphic_data = t
        .child(holder, Ns::A, "graphic")
        .and_then(|g| t.child(g, Ns::A, "graphicData"));
    let uri = graphic_data
        .and_then(|g| t.attr(g, Ns::NONE, "uri"))
        .unwrap_or("");
    let graphic = if uri.ends_with("/picture") {
        Graphic::Picture
    } else if uri.ends_with("wordprocessingShape") {
        Graphic::Shape
    } else if uri.ends_with("wordprocessingGroup") || uri.ends_with("wordprocessingCanvas") {
        Graphic::Group
    } else if uri.ends_with("/chart") {
        graphic_data
            .and_then(|g| t.child(g, Ns::C, "chart"))
            .and_then(|c| t.attr(c, Ns::R, "id"))
            .map_or(Graphic::Other, |id| Graphic::Chart(id.to_owned()))
    } else {
        Graphic::Other
    };
    let anchor = (!inline).then(|| {
        let dist = |n: &str| {
            t.attr(holder, Ns::NONE, n)
                .and_then(parse_int)
                .map_or(0.0, emu)
        };
        let wrap_el = t
            .children(holder)
            .find(|&c| t.ns(c) == Ns::WP && t.local(c).starts_with("wrap"));
        let wrap = match wrap_el.map(|w| t.local(w)) {
            Some("wrapSquare") => Wrap::Square,
            Some("wrapTight") | Some("wrapThrough") => Wrap::Tight,
            Some("wrapTopAndBottom") => Wrap::TopAndBottom,
            _ => Wrap::None,
        };
        let simple = t
            .attr(holder, Ns::NONE, "simplePos")
            .is_some_and(|v| parse_on_off(Some(v)));
        let (h, v) = if simple {
            let sp = t.child(holder, Ns::WP, "simplePos");
            let x = sp
                .and_then(|s| t.attr(s, Ns::NONE, "x"))
                .and_then(parse_int)
                .map_or(0.0, emu);
            let y = sp
                .and_then(|s| t.attr(s, Ns::NONE, "y"))
                .and_then(parse_int)
                .map_or(0.0, emu);
            (
                AxisPos {
                    from: RelFrom::Page,
                    align: None,
                    offset: x,
                    line: false,
                },
                AxisPos {
                    from: RelFrom::Page,
                    align: None,
                    offset: y,
                    line: false,
                },
            )
        } else {
            (
                read_axis(t, t.child(holder, Ns::WP, "positionH"), false),
                read_axis(t, t.child(holder, Ns::WP, "positionV"), true),
            )
        };
        Anchor {
            h,
            v,
            wrap,
            wrap_side: wrap_el
                .and_then(|w| t.attr(w, Ns::NONE, "wrapText"))
                .unwrap_or("bothSides")
                .to_owned(),
            behind: t
                .attr(holder, Ns::NONE, "behindDoc")
                .is_some_and(|v| parse_on_off(Some(v))),
            dist: [dist("distT"), dist("distB"), dist("distL"), dist("distR")],
            z: t.attr(holder, Ns::NONE, "relativeHeight")
                .and_then(parse_int)
                .unwrap_or(0),
            in_cell: t
                .attr(holder, Ns::NONE, "layoutInCell")
                .is_none_or(|v| parse_on_off(Some(v))),
        }
    });
    Some(Drawing {
        width: emu(cx),
        height: emu(cy),
        effect,
        anchor,
        graphic,
        tree: Arc::clone(t),
        node: holder,
        vml: false,
    })
}

fn vml(t: &Arc<XmlTree>, object: NodeId, shape: NodeId) -> Option<Drawing> {
    let style = t.attr(shape, Ns::NONE, "style").unwrap_or("");
    let mut width = css_prop(style, "width").and_then(css_length);
    let mut height = css_prop(style, "height").and_then(css_length);
    if t.is_w(object, "object") {
        // OLE objects record their natural size in twips.
        if let Some(w) = t.w_attr(object, "dxaOrig").and_then(parse_int) {
            width = width.or(Some(twips(w)));
        }
        if let Some(h) = t.w_attr(object, "dyaOrig").and_then(parse_int) {
            height = height.or(Some(twips(h)));
        }
    }
    let (width, height) = (width?, height?);
    let absolute = css_prop(style, "position").is_some_and(|p| p.eq_ignore_ascii_case("absolute"));
    let anchor = absolute.then(|| {
        let left = css_prop(style, "margin-left")
            .or_else(|| css_prop(style, "left"))
            .and_then(css_length)
            .unwrap_or(0.0);
        let top = css_prop(style, "margin-top")
            .or_else(|| css_prop(style, "top"))
            .and_then(css_length)
            .unwrap_or(0.0);
        let h_from = match css_prop(style, "mso-position-horizontal-relative") {
            Some("page") => RelFrom::Page,
            Some("margin") => RelFrom::Margin,
            Some("char") | Some("text") => RelFrom::Text,
            _ => RelFrom::Column,
        };
        let v_from = match css_prop(style, "mso-position-vertical-relative") {
            Some("page") => RelFrom::Page,
            Some("margin") => RelFrom::Margin,
            Some("line") => RelFrom::Text,
            _ => RelFrom::Text,
        };
        let wrap = t
            .descendants(shape)
            .into_iter()
            .find(|&d| t.is(d, Ns::W10, "wrap"))
            .and_then(|w| t.attr(w, Ns::NONE, "type"))
            .map_or(Wrap::None, |ty| match ty {
                "square" => Wrap::Square,
                "tight" | "through" => Wrap::Tight,
                "topAndBottom" => Wrap::TopAndBottom,
                _ => Wrap::None,
            });
        let z = css_prop(style, "z-index")
            .and_then(|z| z.trim().parse::<i64>().ok())
            .unwrap_or(0);
        Anchor {
            h: AxisPos {
                from: h_from,
                align: css_prop(style, "mso-position-horizontal").map(str::to_owned),
                offset: left,
                line: false,
            },
            v: AxisPos {
                from: v_from,
                align: css_prop(style, "mso-position-vertical").map(str::to_owned),
                offset: top,
                line: false,
            },
            wrap,
            wrap_side: "bothSides".into(),
            behind: z < 0,
            dist: [0.0; 4],
            z,
            in_cell: t
                .attr(shape, Ns::O, "allowincell")
                .is_none_or(|v| parse_on_off(Some(v))),
        }
    });
    let has_image = t
        .descendants(shape)
        .into_iter()
        .any(|d| t.is(d, Ns::V, "imagedata"));
    Some(Drawing {
        width,
        height,
        effect: [0.0; 4],
        anchor,
        graphic: if has_image {
            Graphic::Picture
        } else {
            Graphic::Shape
        },
        tree: Arc::clone(t),
        node: shape,
        vml: true,
    })
}
