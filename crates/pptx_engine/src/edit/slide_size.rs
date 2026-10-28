//! Slide size (Design ▸ Slide Size): `p:sldSz`, and scaling the content of
//! every slide, layout, and master to a new size the way PowerPoint's
//! "Ensure Fit" and "Maximize" do: one factor for both axes, content
//! centered, and text sizes, margins, line widths, and table grids scaled by
//! the same factor. Group members keep their group coordinates (only a
//! group's own frame moves), and speaker notes keep their size.

use super::ops::SlideScale;
use super::slides::{PRESENTATION_ORDER, layouts};
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::model::shape::sp_tree;
use crate::opc::{TargetMode, rel_type};
use crate::units::pt_to_emu;
use crate::xml::{NodeId, Ns, XmlDoc};

/// The slide side range PowerPoint allows, in points (1 to 56 inches).
const MIN_SIDE_PT: f32 = 72.0;
const MAX_SIDE_PT: f32 = 4032.0;
/// How near (in EMU) a size must be to a named size to take its `type`: half a point.
const NAMED_SIZE_TOLERANCE: i64 = 6_350;

/// PowerPoint's named slide sizes (`p:sldSz/@type`), landscape, in EMU.
/// Sizes are written exactly; of several names for one size, the deck's
/// current one is kept, else the first is written. Others are custom (no
/// `type`, as PowerPoint writes Widescreen).
const NAMED_SIZES: &[(&str, i64, i64)] = &[
    ("screen4x3", 9_144_000, 6_858_000),
    ("letter", 9_144_000, 6_858_000),
    ("overhead", 9_144_000, 6_858_000),
    ("screen16x9", 9_144_000, 5_143_500),
    ("screen16x10", 9_144_000, 5_715_000),
    ("A4", 9_906_000, 6_858_000),
    ("A3", 12_801_600, 9_601_200),
    ("B4ISO", 10_826_750, 8_120_063),
    ("B5ISO", 7_169_150, 5_376_863),
    ("35mm", 10_287_000, 6_858_000),
    ("banner", 7_315_200, 914_400),
];

/// Attributes of DrawingML elements holding lengths that scale with the
/// content.
struct Lengths {
    /// The elements.
    elements: &'static [&'static str],
    /// The attributes.
    attrs: &'static [&'static str],
    /// The range the schema allows (`None`: unbounded).
    range: Option<(i64, i64)>,
}

const PARAGRAPH_PROPERTIES: &[&str] = &[
    "pPr", "defPPr", "lvl1pPr", "lvl2pPr", "lvl3pPr", "lvl4pPr", "lvl5pPr", "lvl6pPr", "lvl7pPr",
    "lvl8pPr", "lvl9pPr",
];
const RUN_PROPERTIES: &[&str] = &["rPr", "defRPr", "endParaRPr"];

const LENGTHS: &[Lengths] = &[
    // Font sizes and character spacing, in hundredths of a point.
    Lengths {
        elements: RUN_PROPERTIES,
        attrs: &["sz"],
        range: Some((100, 400_000)),
    },
    Lengths {
        elements: RUN_PROPERTIES,
        attrs: &["spc"],
        range: Some((-400_000, 400_000)),
    },
    Lengths {
        elements: &["buSzPts"],
        attrs: &["val"],
        range: Some((100, 400_000)),
    },
    Lengths {
        elements: &["spcPts"],
        attrs: &["val"],
        range: Some((0, 158_400)),
    },
    // Paragraph margins, indents, and tab stops (EMU).
    Lengths {
        elements: PARAGRAPH_PROPERTIES,
        attrs: &["marL", "marR", "indent", "defTabSz"],
        range: None,
    },
    Lengths {
        elements: &["tab"],
        attrs: &["pos"],
        range: None,
    },
    // Text insets and table cell margins.
    Lengths {
        elements: &["bodyPr"],
        attrs: &["lIns", "tIns", "rIns", "bIns"],
        range: None,
    },
    Lengths {
        elements: &["tcPr"],
        attrs: &["marL", "marR", "marT", "marB"],
        range: None,
    },
    // Table grids.
    Lengths {
        elements: &["gridCol"],
        attrs: &["w"],
        range: None,
    },
    Lengths {
        elements: &["tr"],
        attrs: &["h"],
        range: None,
    },
    // Line widths, table borders, and underlines.
    Lengths {
        elements: &[
            "ln", "lnL", "lnR", "lnT", "lnB", "lnTlToBr", "lnBlToTr", "uLn",
        ],
        attrs: &["w"],
        range: Some((0, 20_116_800)),
    },
    // Shadow, glow, soft edge, and reflection distances.
    Lengths {
        elements: &["outerShdw", "innerShdw", "prstShdw", "reflection"],
        attrs: &["blurRad", "dist"],
        range: None,
    },
    Lengths {
        elements: &["glow", "softEdge"],
        attrs: &["rad"],
        range: None,
    },
];

/// The named size (and its exact EMU) `cx` × `cy` matches, in either
/// orientation, preferring `current`.
fn named_size(current: Option<&str>, cx: i64, cy: i64) -> (Option<&'static str>, (i64, i64)) {
    let near = |a: i64, b: i64| (a - b).abs() <= NAMED_SIZE_TOLERANCE;
    let fit = |&(name, w, h): &(&'static str, i64, i64)| {
        if near(cx, w) && near(cy, h) {
            Some((Some(name), (w, h)))
        } else if near(cx, h) && near(cy, w) {
            Some((Some(name), (h, w)))
        } else {
            None
        }
    };
    NAMED_SIZES
        .iter()
        .filter(|(name, ..)| Some(*name) == current)
        .chain(NAMED_SIZES)
        .find_map(fit)
        .unwrap_or((None, (cx, cy)))
}

/// Sets the slide size (points) and scales content as `scale` says.
pub(super) fn set_slide_size(
    pres: &mut Presentation,
    width: f32,
    height: f32,
    scale: SlideScale,
) -> Result<()> {
    for (side, value) in [("width", width), ("height", height)] {
        if !value.is_finite() || !(MIN_SIDE_PT..=MAX_SIDE_PT).contains(&value) {
            return Err(Error::InvalidEdit(format!(
                "slide {side} {value} pt is outside {MIN_SIDE_PT}-{MAX_SIDE_PT} pt (1-56 inches)"
            )));
        }
    }
    let (old_w, old_h) = pres.size;
    let main = pres.main_part.clone();
    let current = {
        let doc = pres.xml(&main)?;
        doc.child(doc.root(), Ns::P, "sldSz")
            .and_then(|s| doc.attr(s, "type"))
            .map(str::to_owned)
    };
    let (kind, (cx, cy)) = named_size(
        current.as_deref(),
        pt_to_emu(f64::from(width)),
        pt_to_emu(f64::from(height)),
    );
    if (cx, cy) == (old_w, old_h) {
        // Same size: nothing to scale, and the deck keeps its size's name.
        return Ok(());
    }
    let (rx, ry) = (cx as f64 / old_w as f64, cy as f64 / old_h as f64);
    let factor = match scale {
        SlideScale::None => None,
        SlideScale::Fit => Some(rx.min(ry)),
        SlideScale::Maximize => Some(rx.max(ry)),
    };
    let doc = pres.xml_mut(&main)?;
    let root = doc.root();
    let sz = doc.ensure_child(root, Ns::P, "sldSz", PRESENTATION_ORDER);
    doc.set_attr(sz, "cx", &cx.to_string());
    doc.set_attr(sz, "cy", &cy.to_string());
    match kind {
        Some(kind) => doc.set_attr(sz, "type", kind),
        None => doc.remove_attr(sz, "type"),
    }
    if let Some(s) = factor {
        if let Some(style) = doc.child(root, Ns::P, "defaultTextStyle") {
            scale_lengths(doc, style, s);
        }
        let offset = (
            (cx as f64 - old_w as f64 * s) / 2.0,
            (cy as f64 - old_h as f64 * s) / 2.0,
        );
        for (part, content) in content_parts(pres)? {
            scale_part(pres.xml_mut(&part)?, content, s, offset);
        }
    }
    pres.reload_structure()
}

/// How a part's content scales.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Content {
    /// A slide, layout, or master: frames scale about the slide's corner and
    /// shift to center the content.
    Slide,
    /// A SmartArt drawing: frames are relative to the diagram's frame, so
    /// they only scale.
    Drawing,
    /// A chart: text sizes and line widths scale.
    Chart,
}

/// Every slide, layout, and master part, and the charts and SmartArt
/// drawings they show, each once.
fn content_parts(pres: &mut Presentation) -> Result<Vec<(String, Content)>> {
    let mut parts: Vec<String> = pres.slides.iter().map(|s| s.part.clone()).collect();
    let main = pres.main_part.clone();
    let rels = pres.part_rels(&main)?;
    let masters = rels
        .iter()
        .filter(|r| r.rel_type == rel_type::SLIDE_MASTER)
        .map(|r| rels.resolve(r));
    let layouts = layouts(pres)?.into_iter().map(|l| l.part);
    for part in masters.chain(layouts).collect::<Vec<_>>() {
        if !parts.contains(&part) && pres.package().has_part(&part) {
            parts.push(part);
        }
    }
    let mut out: Vec<(String, Content)> =
        parts.iter().map(|p| (p.clone(), Content::Slide)).collect();
    for part in parts {
        let rels = pres.part_rels(&part)?;
        for r in rels.iter().filter(|r| r.mode == TargetMode::Internal) {
            let content = match r.rel_type.as_str() {
                rel_type::CHART => Content::Chart,
                rel_type::DIAGRAM_DRAWING => Content::Drawing,
                _ => continue,
            };
            let target = rels.resolve(r);
            if pres.package().has_part(&target) && !out.iter().any(|(p, _)| *p == target) {
                out.push((target, content));
            }
        }
    }
    Ok(out)
}

/// Scales a part's content (see [`Content`]).
fn scale_part(doc: &mut XmlDoc, content: Content, s: f64, offset: (f64, f64)) {
    let tree = match content {
        Content::Slide => sp_tree(doc),
        Content::Drawing => doc.children(doc.root()).find(|&c| doc.local(c) == "spTree"),
        Content::Chart => None,
    };
    let offset = if content == Content::Slide {
        offset
    } else {
        (0.0, 0.0)
    };
    if let Some(tree) = tree {
        let mut items: Vec<NodeId> = Vec::new();
        for c in doc.children(tree) {
            if doc.is(c, Ns::MC, "AlternateContent") {
                // Every branch: applications pick different ones.
                for branch in doc.children(c) {
                    items.extend(doc.children(branch));
                }
            } else {
                items.push(c);
            }
        }
        for item in items {
            for xfrm in frames_of(doc, item) {
                scale_frame(doc, xfrm, s, offset);
            }
        }
    }
    let root = doc.root();
    scale_lengths(doc, root, s);
}

/// The transform elements of a top-level shape (a SmartArt shape's text
/// frame too).
fn frames_of(doc: &XmlDoc, shape: NodeId) -> Vec<NodeId> {
    let child = |parent: NodeId, local: &str| doc.children(parent).find(|&c| doc.local(c) == local);
    match doc.local(shape) {
        "sp" | "pic" | "cxnSp" => child(shape, "spPr")
            .and_then(|p| doc.child(p, Ns::A, "xfrm"))
            .into_iter()
            .chain(child(shape, "txXfrm"))
            .collect(),
        "grpSp" => child(shape, "grpSpPr")
            .and_then(|p| doc.child(p, Ns::A, "xfrm"))
            .into_iter()
            .collect(),
        "graphicFrame" => child(shape, "xfrm").into_iter().collect(),
        _ => Vec::new(),
    }
}

fn scaled(value: i64, s: f64) -> i64 {
    (value as f64 * s).round() as i64
}

/// Scales a frame's offset and extent (not a group's child space) about the
/// slide's top-left corner, then shifts it by `offset`.
fn scale_frame(doc: &mut XmlDoc, xfrm: NodeId, s: f64, (dx, dy): (f64, f64)) {
    if let Some(off) = doc.child(xfrm, Ns::A, "off") {
        for (attr, shift) in [("x", dx), ("y", dy)] {
            if let Some(v) = doc.attr_i64(off, attr) {
                let moved = (v as f64 * s + shift).round() as i64;
                doc.set_attr(off, attr, &moved.to_string());
            }
        }
    }
    if let Some(ext) = doc.child(xfrm, Ns::A, "ext") {
        for attr in ["cx", "cy"] {
            if let Some(v) = doc.attr_i64(ext, attr) {
                doc.set_attr(ext, attr, &scaled(v, s).max(0).to_string());
            }
        }
    }
}

/// Scales the lengths in [`LENGTHS`] on `root` and its descendants.
fn scale_lengths(doc: &mut XmlDoc, root: NodeId, s: f64) {
    let mut nodes = vec![root];
    nodes.extend(doc.descendants(root));
    for n in nodes {
        if doc.ns(n) != Ns::A {
            continue;
        }
        let local = doc.local(n).to_owned();
        for lengths in LENGTHS {
            if !lengths.elements.contains(&local.as_str()) {
                continue;
            }
            for attr in lengths.attrs {
                let Some(v) = doc.attr_i64(n, attr) else {
                    continue;
                };
                let mut v = scaled(v, s);
                if let Some((lo, hi)) = lengths.range {
                    v = v.clamp(lo, hi);
                }
                doc.set_attr(n, attr, &v.to_string());
            }
        }
    }
}

#[cfg(test)]
mod test;
