//! Gallery previews: a layout's sample diagram (without text) drawn with a
//! color variation and style as SVG paths, and the catalog of layouts,
//! color variations, and styles the galleries list.

use super::catalog::{self, Kind, STYLES, color_variations, find_layout, supported_layouts};
use super::colors::{self, ColorsDef};
use super::insert::sample;
use super::layout::{Diagram, Geom, LNode, Measure, TextBox, lay_out};
use super::quick_style::{self, StyleDef};
use crate::geometry::{self, PathFill};
use crate::model::color::{ColorContext, ColorMap, ColorScheme, Rgba, SCHEME_SLOTS, parse_color};
use crate::path::{Affine, Path, PathEl, Point};
use crate::units::EMU_PER_PT;
use crate::xml::XmlDoc;
use serde::{Deserialize, Serialize};

/// One path of a preview.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewPath {
    /// SVG path data in preview coordinates.
    pub d: String,
    /// Fill as `#RRGGBB` (none: unfilled).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    /// Fill opacity (0-1).
    pub fill_opacity: f32,
    /// Outline as `#RRGGBB` (none: no outline).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke: Option<String>,
    /// Outline width in preview units.
    pub stroke_width: f32,
}

/// What to preview.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PreviewSpec {
    /// Layout id, short id, or name.
    pub layout: String,
    /// Color variation (the default when empty).
    pub colors: Option<String>,
    /// Style (the default when empty).
    pub style: Option<String>,
    /// Preview width.
    pub width: f32,
    /// Preview height.
    pub height: f32,
    /// Theme colors by slot name (`accent1` → `#4472C4`); Office's when missing.
    pub theme: std::collections::HashMap<String, String>,
}

/// Measures nothing: previews have no text, and each box is one line tall.
struct NoText;

impl Measure for NoText {
    fn height(&mut self, text: &TextBox, _width: f32, size: f32) -> Option<f32> {
        let [_, t, _, b] = text.insets(size);
        Some(size * 1.1 + t + b)
    }
}

fn hex(c: Rgba) -> String {
    format!("#{}", c.to_hex())
}

fn svg(path: &Path) -> String {
    use std::fmt::Write;
    let pt = |p: Point| format!("{:.1} {:.1}", p.x, p.y);
    let mut d = String::new();
    for el in &path.els {
        let _ = match el {
            PathEl::MoveTo(p) => write!(d, "M{}", pt(*p)),
            PathEl::LineTo(p) => write!(d, "L{}", pt(*p)),
            PathEl::QuadTo(c, p) => write!(d, "Q{} {}", pt(*c), pt(*p)),
            PathEl::CubicTo(a, b, p) => write!(d, "C{} {} {}", pt(*a), pt(*b), pt(*p)),
            PathEl::Close => write!(d, "Z"),
        };
    }
    d
}

/// The sample diagram of a layout.
fn sample_diagram(kind: Kind) -> Diagram {
    let mut nodes: Vec<LNode> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    for (i, (level, asst)) in sample(kind).into_iter().enumerate() {
        let depth = usize::from(level);
        stack.truncate(depth - 1);
        let parent = stack.last().copied();
        if let Some(p) = parent {
            nodes[p].children.push(i);
        }
        nodes.push(LNode {
            id: i.to_string(),
            asst,
            parent,
            children: Vec::new(),
            depth,
        });
        stack.push(i);
    }
    Diagram { nodes }
}

/// The preview of a layout in a color variation and style.
pub fn preview(spec: &PreviewSpec) -> Option<Vec<PreviewPath>> {
    let info = find_layout(&spec.layout).filter(|l| l.kind.is_some())?;
    let kind = info.kind?;
    let (w, h) = (spec.width.max(1.0), spec.height.max(1.0));
    let d = sample_diagram(kind);
    // Lay out at slide size, then scale: font-relative sizes stay sensible.
    let scale = 640.0 / w;
    let laid = lay_out(kind, &d, w * scale, h * scale, &mut NoText);
    let colors_xml = colors::builtin_xml(
        spec.colors
            .as_deref()
            .filter(|c| !c.is_empty())
            .unwrap_or(catalog::DEFAULT_COLORS),
    )?
    .1;
    let colors = ColorsDef::parse(&XmlDoc::parse(colors_xml.as_bytes(), "colors").ok()?);
    let style_xml = quick_style::builtin_xml(
        spec.style
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(catalog::DEFAULT_STYLE),
    )?
    .1;
    let style = StyleDef::parse(&XmlDoc::parse(style_xml.as_bytes(), "style").ok()?);
    let mut scheme = ColorScheme::default();
    for (i, slot) in SCHEME_SLOTS.iter().enumerate() {
        if let Some(c) = spec
            .theme
            .get(*slot)
            .and_then(|v| Rgba::from_hex(v.trim_start_matches('#')))
        {
            scheme.colors[i] = c;
        }
    }
    let map = ColorMap::default();
    let ctx = ColorContext {
        scheme: &scheme,
        map: &map,
        ph_clr: None,
    };
    let resolve = |xml: &str| -> Option<Rgba> {
        let wrapped = format!(
            "<a:r xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">{xml}</a:r>"
        );
        let doc = XmlDoc::parse(wrapped.as_bytes(), "color").ok()?;
        parse_color(&doc, doc.first_child(doc.root())?, &ctx)
    };
    let mut out = Vec::new();
    for p in &laid.shapes {
        let refs = style.refs(&p.label);
        let label = colors.label(&p.label);
        let (i, n) = p.color;
        let pick = |l: Option<&colors::ClrList>| l.and_then(|l| l.pick(i, n, &ctx));
        let lines = matches!(p.geom, Geom::Lines(_));
        let fill = (!lines && refs.fill != 0)
            .then(|| pick(label.map(|l| &l.fill)))
            .flatten()
            .and_then(|x| resolve(&x));
        let stroke = (refs.line != 0)
            .then(|| pick(label.map(|l| &l.line)))
            .flatten()
            .and_then(|x| resolve(&x));
        let stroke_width = match refs.line {
            1 => 0.75,
            3 => 2.0,
            _ => 1.25,
        } / scale;
        let place = Affine::scale(1.0 / f64::from(scale), 1.0 / f64::from(scale))
            .pre_concat(&Affine::translate(
                f64::from(p.rect.x + p.rect.w / 2.0),
                f64::from(p.rect.y + p.rect.h / 2.0),
            ))
            .pre_concat(&Affine::rotate(f64::from(p.rot)))
            .pre_concat(&Affine::translate(
                -f64::from(p.rect.w / 2.0),
                -f64::from(p.rect.h / 2.0),
            ));
        let mut push = |path: Path, filled: bool, stroked: bool| {
            out.push(PreviewPath {
                d: svg(&path.transform(&place)),
                fill: if filled { fill.map(hex) } else { None },
                fill_opacity: fill.map_or(1.0, |c| c.a),
                stroke: if stroked { stroke.map(hex) } else { None },
                stroke_width,
            });
        };
        match &p.geom {
            Geom::Preset(name, adj) => {
                let adj: Vec<geometry::Adjust> = adj
                    .iter()
                    .map(|(k, v)| ((*k).to_owned(), *v as f64))
                    .collect();
                let (gw, gh) = (
                    f64::from(p.rect.w) * EMU_PER_PT,
                    f64::from(p.rect.h) * EMU_PER_PT,
                );
                let Some(g) = geometry::preset(name, gw, gh, &adj) else {
                    continue;
                };
                for gp in g.paths {
                    push(gp.path, gp.fill != PathFill::None, gp.stroke);
                }
            }
            Geom::Lines(lines) => {
                for l in lines {
                    let mut path = Path::new();
                    for (k, (x, y)) in l.iter().enumerate() {
                        let pt = Point::new(*x, *y);
                        if k == 0 {
                            path.move_to(pt);
                        } else {
                            path.line_to(pt);
                        }
                    }
                    push(path, false, true);
                }
            }
        }
    }
    Some(out)
}

/// A layout in the catalog.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogLayout {
    /// Full id.
    pub id: String,
    /// Short id (`process1`).
    pub short: String,
    /// Display name.
    pub name: String,
    /// Gallery categories (`list`, `process`, `cycle`, `hierarchy`,
    /// `relationship`, `pyramid`).
    pub categories: Vec<String>,
}

/// A color variation or style in the catalog.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    /// Full id.
    pub id: String,
    /// Short id.
    pub short: String,
    /// Display name.
    pub name: String,
    /// Gallery group.
    pub category: String,
}

/// What the SmartArt galleries list.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    /// Layouts the engine lays out, in gallery order.
    pub layouts: Vec<CatalogLayout>,
    /// Color variations in gallery order.
    pub colors: Vec<CatalogItem>,
    /// SmartArt styles in gallery order.
    pub styles: Vec<CatalogItem>,
}

/// The catalog.
pub fn catalog() -> Catalog {
    Catalog {
        layouts: supported_layouts()
            .map(|l| CatalogLayout {
                id: l.id(),
                short: l.short.to_owned(),
                name: l.name.to_owned(),
                categories: l.categories.iter().map(|c| (*c).to_owned()).collect(),
            })
            .collect(),
        colors: color_variations()
            .into_iter()
            .map(|c| CatalogItem {
                id: c.id(),
                short: c.short,
                name: c.name,
                category: c.category,
            })
            .collect(),
        styles: STYLES
            .iter()
            .map(|s| CatalogItem {
                id: s.id(),
                short: s.short.to_owned(),
                name: s.name.to_owned(),
                category: "simple".to_owned(),
            })
            .collect(),
    }
}
