//! Theme parts: color scheme, font scheme, and the format-style matrix.

use super::color::{ColorContext, ColorMap};
use super::color::{ColorScheme, SCHEME_SLOTS, find_color};
use crate::xml::{NodeId, Ns, XmlDoc};
use std::sync::Arc;

/// Typefaces of one font collection (`majorFont` or `minorFont`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FontCollection {
    /// Latin typeface.
    pub latin: String,
    /// East Asian typeface.
    pub ea: String,
    /// Complex-script typeface.
    pub cs: String,
    /// Per-script overrides (`Jpan`, `Hans`, `Arab`...).
    pub scripts: Vec<(String, String)>,
}

/// A parsed theme.
#[derive(Clone, Debug)]
pub struct Theme {
    /// Theme name.
    pub name: String,
    /// Color scheme.
    pub colors: ColorScheme,
    /// Heading fonts.
    pub major: FontCollection,
    /// Body fonts.
    pub minor: FontCollection,
    /// The theme XML (format styles are resolved lazily against it).
    pub doc: Arc<XmlDoc>,
    /// `fillStyleLst` entries.
    pub fill_styles: Vec<NodeId>,
    /// `lnStyleLst` entries.
    pub line_styles: Vec<NodeId>,
    /// `effectStyleLst` entries (`effectStyle` elements).
    pub effect_styles: Vec<NodeId>,
    /// `bgFillStyleLst` entries.
    pub bg_fill_styles: Vec<NodeId>,
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            name: "Office".into(),
            colors: ColorScheme::default(),
            major: FontCollection {
                latin: "Calibri Light".into(),
                ..Default::default()
            },
            minor: FontCollection {
                latin: "Calibri".into(),
                ..Default::default()
            },
            doc: Arc::new(XmlDoc::new_root(Ns::A, "theme")),
            fill_styles: Vec::new(),
            line_styles: Vec::new(),
            effect_styles: Vec::new(),
            bg_fill_styles: Vec::new(),
        }
    }
}

impl Theme {
    /// Parses a theme part (or `themeOverride`).
    pub fn parse(doc: Arc<XmlDoc>) -> Self {
        let root = doc.root();
        let elements = doc.child(root, Ns::A, "themeElements").unwrap_or(root);
        let mut theme = Theme {
            name: doc.attr(root, "name").unwrap_or("").to_owned(),
            doc: Arc::clone(&doc),
            ..Default::default()
        };
        if let Some(cs) = doc.child(elements, Ns::A, "clrScheme") {
            let map = ColorMap::default();
            let base = ColorScheme::default();
            let ctx = ColorContext {
                scheme: &base,
                map: &map,
                ph_clr: None,
            };
            for (i, slot) in SCHEME_SLOTS.iter().enumerate() {
                if let Some(c) = doc
                    .child(cs, Ns::A, slot)
                    .and_then(|n| find_color(&doc, n, &ctx))
                {
                    theme.colors.colors[i] = c;
                }
            }
        }
        if let Some(fs) = doc.child(elements, Ns::A, "fontScheme") {
            for (name, target) in [
                ("majorFont", &mut theme.major),
                ("minorFont", &mut theme.minor),
            ] {
                let Some(f) = doc.child(fs, Ns::A, name) else {
                    continue;
                };
                let face = |n: &str| {
                    doc.child(f, Ns::A, n)
                        .and_then(|c| doc.attr(c, "typeface"))
                        .unwrap_or("")
                        .to_owned()
                };
                target.latin = face("latin");
                target.ea = face("ea");
                target.cs = face("cs");
                target.scripts = doc
                    .children_named(f, Ns::A, "font")
                    .filter_map(|c| {
                        Some((
                            doc.attr(c, "script")?.to_owned(),
                            doc.attr(c, "typeface")?.to_owned(),
                        ))
                    })
                    .collect();
            }
        }
        if let Some(fmt) = doc.child(elements, Ns::A, "fmtScheme") {
            let list = |name: &str| -> Vec<NodeId> {
                doc.child(fmt, Ns::A, name)
                    .map(|l| doc.children(l).collect())
                    .unwrap_or_default()
            };
            theme.fill_styles = list("fillStyleLst");
            theme.line_styles = list("lnStyleLst");
            theme.effect_styles = list("effectStyleLst");
            theme.bg_fill_styles = list("bgFillStyleLst");
        }
        theme
    }

    /// Resolves a theme font reference (`+mj-lt`, `+mn-ea`...) or returns the name.
    pub fn resolve_typeface<'a>(&'a self, typeface: &'a str) -> &'a str {
        let (collection, kind) = match typeface {
            "+mj-lt" => (&self.major, 0),
            "+mj-ea" => (&self.major, 1),
            "+mj-cs" => (&self.major, 2),
            "+mn-lt" => (&self.minor, 0),
            "+mn-ea" => (&self.minor, 1),
            "+mn-cs" => (&self.minor, 2),
            _ => return typeface,
        };
        match kind {
            0 => &collection.latin,
            1 => &collection.ea,
            _ => &collection.cs,
        }
    }

    /// The fill-style entry for a `fillRef`/`bgRef` index (1-3 fills, 1001+ backgrounds).
    pub fn fill_style(&self, idx: u32) -> Option<NodeId> {
        match idx {
            0 => None,
            1000.. => self.bg_fill_styles.get((idx - 1001) as usize).copied(),
            n => self.fill_styles.get((n - 1) as usize).copied(),
        }
    }

    /// The line-style entry for an `lnRef` index.
    pub fn line_style(&self, idx: u32) -> Option<NodeId> {
        idx.checked_sub(1)
            .and_then(|i| self.line_styles.get(i as usize).copied())
    }

    /// The `effectStyle` entry for an `effectRef` index.
    pub fn effect_style(&self, idx: u32) -> Option<NodeId> {
        idx.checked_sub(1)
            .and_then(|i| self.effect_styles.get(i as usize).copied())
    }
}
