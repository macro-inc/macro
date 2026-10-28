//! Measures SmartArt text with the renderer's own text layout, so the
//! fitted font sizes are exactly what the slide shows.

use super::drawing::{Source, append_text, probe_xml};
use super::layout::{Diagram, Measure, TextBox};
use crate::font::FontDb;
use crate::model::presentation::{PartRef, SlideContext};
use crate::model::shape::{Inherit, WalkCtx, resolve_shape};
use crate::opc::Relationships;
use crate::render::build::{shape_geometry, text_frame};
use crate::render::text::{LayoutParams, TextLayout, layout, paragraph_text};
use crate::xml::{Ns, XmlDoc};
use std::collections::HashMap;
use std::sync::Arc;

/// Text measurement against a slide's theme and the bundled fonts.
pub(crate) struct Measurer<'a> {
    /// The slide's context (theme fonts and default text styles).
    pub ctx: &'a SlideContext,
    /// Fonts.
    pub fonts: &'a FontDb,
    /// The nodes' text.
    pub src: &'a Source<'a>,
    /// The nodes.
    pub d: &'a Diagram,
    cache: HashMap<String, Option<f32>>,
}

impl<'a> Measurer<'a> {
    /// A measurer.
    pub fn new(
        ctx: &'a SlideContext,
        fonts: &'a FontDb,
        src: &'a Source<'a>,
        d: &'a Diagram,
    ) -> Self {
        Self {
            ctx,
            fonts,
            src,
            d,
            cache: HashMap::new(),
        }
    }
}

/// Whether a line break falls inside a word (PowerPoint shrinks text
/// rather than breaking words).
fn breaks_word(lay: &TextLayout, texts: &[Vec<char>]) -> bool {
    lay.lines.windows(2).any(|pair| {
        let (a, b) = (&pair[0], &pair[1]);
        if a.paragraph != b.paragraph {
            return false;
        }
        let Some(start) = b.stops.first().map(|s| s.index) else {
            return false;
        };
        let chars = &texts[b.paragraph.min(texts.len().saturating_sub(1))];
        let at = |i: usize| chars.get(i).copied();
        match (start.checked_sub(1).and_then(at), at(start)) {
            (Some(prev), Some(next)) => {
                !prev.is_whitespace() && !next.is_whitespace() && prev != '-' && prev != '\u{b}'
            }
            _ => false,
        }
    })
}

impl Measure for Measurer<'_> {
    fn height(&mut self, text: &TextBox, width: f32, size: f32) -> Option<f32> {
        let key = format!(
            "{:?}|{}|{}|{:?}|{:?}",
            text.source,
            width.to_bits(),
            size.to_bits(),
            text.margins,
            text.pad
        );
        if let Some(v) = self.cache.get(&key) {
            return *v;
        }
        let result = self.measure(text, width, size);
        self.cache.insert(key, result);
        result
    }
}

impl Measurer<'_> {
    fn measure(&self, text: &TextBox, width: f32, size: f32) -> Option<f32> {
        const TALL: f32 = 100_000.0;
        let xml = probe_xml(0.0, 0.0, width.max(1.0), TALL);
        let mut doc = XmlDoc::parse(xml.as_bytes(), "SmartArt probe").ok()?;
        let tree = doc.child(doc.root(), Ns::DSP, "spTree")?;
        let sp = doc.child(tree, Ns::DSP, "sp")?;
        append_text(&mut doc, sp, self.src, self.d, text, size, true).ok()?;
        let part = PartRef {
            name: "/ppt/diagrams/probe.xml".into(),
            doc: Arc::new(doc),
            rels: Arc::new(Relationships::empty("/ppt/diagrams/probe.xml")),
        };
        let walk = WalkCtx {
            ctx: self.ctx,
            inherit: Inherit::Master,
        };
        let sp = part.doc.child(tree, Ns::DSP, "sp")?;
        let shape = resolve_shape(&walk, &part, sp)?;
        let body = shape.text.as_ref()?;
        let geom = shape_geometry(&shape);
        let frame = text_frame(&shape, &geom, body, &crate::path::Affine::IDENTITY);
        let lay = layout(
            body,
            frame.w,
            frame.h,
            self.fonts,
            LayoutParams::from_body(body),
        );
        let texts: Vec<Vec<char>> = body
            .paragraphs
            .iter()
            .map(|p| paragraph_text(p).chars().collect())
            .collect();
        if breaks_word(&lay, &texts) || lay.content_width > frame.w + 0.5 {
            return None;
        }
        Some(lay.content_height)
    }
}
