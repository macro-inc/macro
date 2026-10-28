//! What Figma's SVG export options change: `id`s named after layers, and
//! text written as `<text>` elements instead of outlines.

use super::{Writer, escape, font_weight, hex, matrix, num};
use crate::model::{Paint, PaintKind};
use crate::scene::SceneIdx;
use std::fmt::Write;

impl Writer<'_> {
    /// An XML id for a layer named `name`: the name with spaces as
    /// underscores, numbered from the second use on (`Icon_2`).
    pub(super) fn layer_id(&mut self, name: &str) -> String {
        let base: String = name
            .trim()
            .chars()
            .map(|c| if c.is_whitespace() { '_' } else { c })
            .collect();
        let base = if base.is_empty() {
            "layer".to_owned()
        } else {
            base
        };
        let n = self.names.entry(base.clone()).or_insert(0);
        *n += 1;
        if *n == 1 { base } else { format!("{base}_{n}") }
    }

    /// A text layer as `<text>`, one `<tspan>` per line, in its font: what
    /// Figma writes with "Outline text" off.
    pub(super) fn text_elements(&mut self, i: SceneIdx, out: &mut String) {
        let p = self.props(i).clone();
        let (Some(content), Some(layout)) = (p.text_content.clone(), p.text_layout.clone()) else {
            return;
        };
        let style = p.text_style.clone().unwrap_or_default();
        let fill = p
            .fills()
            .iter()
            .filter(|f| f.is_visible())
            .find_map(|f: &Paint| match f.kind {
                PaintKind::Solid(c) => Some((c, c.a * f.opacity)),
                _ => None,
            });
        let mut attrs = String::new();
        match fill {
            Some((c, a)) => {
                let _ = write!(attrs, " fill=\"{}\"", hex(c));
                if a < 1.0 {
                    let _ = write!(attrs, " fill-opacity=\"{}\"", num(f64::from(a)));
                }
            }
            None => attrs.push_str(" fill=\"none\""),
        }
        let family = style.font_family.as_deref().unwrap_or("Inter");
        let size = style.font_size.unwrap_or(12.0);
        let _ = write!(
            attrs,
            " xml:space=\"preserve\" style=\"white-space: pre\" font-family=\"{}\" font-size=\"{}\" font-weight=\"{}\"",
            escape(family),
            num(f64::from(size)),
            font_weight(style.font_style.as_deref().unwrap_or("Regular"))
        );
        if style
            .font_style
            .as_deref()
            .is_some_and(|s| s.to_ascii_lowercase().contains("italic"))
        {
            attrs.push_str(" font-style=\"italic\"");
        }
        if let Some((v, unit)) = &style.letter_spacing
            && *v != 0.0
        {
            let px = if unit == "PERCENT" {
                v / 100.0 * size
            } else {
                *v
            };
            let _ = write!(attrs, " letter-spacing=\"{}px\"", num(f64::from(px)));
        }
        let units: Vec<u16> = content.characters.encode_utf16().collect();
        let mut lines = String::new();
        for line in layout.baselines.iter() {
            let end = (line.end_char as usize).min(units.len());
            let start = (line.first_char as usize).min(end);
            let text = String::from_utf16_lossy(&units[start..end]);
            let text = text.trim_end_matches(['\n', '\r', '\u{2028}']);
            let _ = write!(
                lines,
                "<tspan x=\"{}\" y=\"{}\">{}</tspan>",
                num(f64::from(line.x)),
                num(f64::from(line.y)),
                escape(text)
            );
        }
        if lines.is_empty() {
            // No stored lines: fall back to outlines.
            self.text(i, out);
            return;
        }
        let _ = writeln!(
            out,
            "<text transform=\"{}\"{attrs}>{lines}</text>",
            matrix(&self.world(i))
        );
    }
}
