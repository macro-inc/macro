//! Text written from the model: glyphs the file placed (in the file's
//! fonts), and edited text, written as outlines (so every application shows
//! it as laid out here) with an invisible copy of its characters (for
//! search and copying) inside `/MacroText` marked content that reads back
//! as editable text.

use super::objects::Objects;
use super::paint::{alpha_mask_ops, alpha_ops, cm, has_alpha, paint_ops, stroke_ops};
use super::resources::Resources;
use crate::file::SourceFile;
use crate::geom::Affine;
use crate::model::{Node, TextNode};
use crate::pdf::content::Op;
use crate::pdf::{Dict, ObjRef, Object};
use std::collections::HashMap;

fn op(name: &str, operands: Vec<Object>) -> Op {
    Op::new(name, operands)
}

fn num(v: f64) -> Object {
    Object::number(v)
}

/// The render mode for a fill and a stroke.
fn render_mode(fill: bool, stroke: bool) -> i64 {
    match (fill, stroke) {
        (true, false) => 0,
        (false, true) => 1,
        (true, true) => 2,
        (false, false) => 3,
    }
}

/// Text with the file's glyphs, in the file's fonts.
pub fn runs(
    n: &Node,
    t: &TextNode,
    to_page: &Affine,
    file: Option<&SourceFile>,
    ops: &mut Vec<Op>,
    res: &mut Resources,
    objects: &mut Objects,
) {
    let (Some(runs), Some(file)) = (&t.runs, file) else {
        return;
    };
    ops.push(op("q", Vec::new()));
    ops.push(cm(to_page));
    ops.extend(alpha_ops(n.opacity, n.blend, res));
    ops.push(op("BT", Vec::new()));
    for (k, v) in [("Tc", 0.0), ("Tw", 0.0), ("Tz", 100.0), ("Ts", 0.0)] {
        ops.push(op(k, vec![num(v)]));
    }
    for run in runs {
        let Some(num_str) = run.font.strip_prefix("obj:") else {
            continue;
        };
        let Ok(obj) = num_str.parse::<u32>() else {
            continue;
        };
        let font = res.copy(
            objects,
            &file.pdf,
            "Font",
            &Object::Ref(ObjRef {
                num: obj,
                generation: 0,
            }),
        );
        ops.push(op(
            "Tr",
            vec![Object::Int(render_mode(
                run.fill.is_some(),
                run.stroke.is_some(),
            ))],
        ));
        if let Some(f) = &run.fill {
            ops.extend(paint_ops(f, false, to_page, res, objects));
        }
        if let Some(s) = &run.stroke {
            ops.extend(stroke_ops(s, to_page, res, objects));
        }
        ops.push(op("Tf", vec![Object::Name(font), num(1.0)]));
        ops.push(op("Tm", run.matrix.0.iter().map(|&v| num(v)).collect()));
        let mut prev = 0.0;
        for (k, g) in run.glyphs.iter().enumerate() {
            if k > 0 {
                ops.push(op("Td", vec![num(g.x - prev), num(0.0)]));
            }
            prev = g.x;
            let len = usize::from(g.len.clamp(1, 4));
            let bytes = g.code.to_be_bytes()[4 - len..].to_vec();
            ops.push(op("Tj", vec![Object::String(bytes)]));
        }
    }
    ops.push(op("ET", Vec::new()));
    ops.push(op("Q", Vec::new()));
}

/// The font invisible text is written in: a composite font that is not
/// embedded, whose codes are characters by its `ToUnicode` map.
pub struct InvisibleFont {
    font: Option<ObjRef>,
    chars: Vec<char>,
    cids: HashMap<char, u16>,
}

impl Default for InvisibleFont {
    fn default() -> Self {
        InvisibleFont::new()
    }
}

impl InvisibleFont {
    /// No characters yet.
    pub fn new() -> InvisibleFont {
        InvisibleFont {
            font: None,
            chars: Vec::new(),
            cids: HashMap::new(),
        }
    }

    /// The font's object (reserved on first use).
    fn font(&mut self, objects: &mut Objects) -> ObjRef {
        *self.font.get_or_insert_with(|| objects.reserve())
    }

    /// A character's code.
    fn cid(&mut self, c: char) -> u16 {
        if let Some(&k) = self.cids.get(&c) {
            return k;
        }
        if self.chars.len() >= 0xFFFE {
            return 0;
        }
        self.chars.push(c);
        let k = self.chars.len() as u16;
        self.cids.insert(c, k);
        k
    }

    /// Writes the font when it was used.
    pub fn finish(self, objects: &mut Objects) {
        let Some(font) = self.font else { return };
        let mut cmap = String::from(
            "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n",
        );
        for chunk in self.chars.chunks(100).enumerate() {
            let (block, chars) = chunk;
            cmap.push_str(&format!("{} beginbfchar\n", chars.len()));
            for (k, c) in chars.iter().enumerate() {
                let cid = block * 100 + k + 1;
                let mut units = [0u16; 2];
                let hex: String = c
                    .encode_utf16(&mut units)
                    .iter()
                    .map(|u| format!("{u:04X}"))
                    .collect();
                cmap.push_str(&format!("<{cid:04X}> <{hex}>\n"));
            }
            cmap.push_str("endbfchar\n");
        }
        cmap.push_str("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
        let to_unicode = objects.add(Object::Stream(super::compressed(
            Dict::new(),
            cmap.as_bytes(),
        )));
        let mut desc = Dict::new();
        desc.set("Type", Object::name("FontDescriptor"));
        desc.set("FontName", Object::name("Helvetica"));
        desc.set("Flags", 32);
        desc.set(
            "FontBBox",
            Object::Array(vec![num(-200.0), num(-250.0), num(1200.0), num(950.0)]),
        );
        desc.set("ItalicAngle", 0);
        desc.set("Ascent", 900);
        desc.set("Descent", -250);
        desc.set("CapHeight", 700);
        desc.set("StemV", 80);
        let desc = objects.add(Object::Dict(desc));
        let mut info = Dict::new();
        info.set("Registry", Object::String(b"Adobe".to_vec()));
        info.set("Ordering", Object::String(b"Identity".to_vec()));
        info.set("Supplement", 0);
        let mut cid = Dict::new();
        cid.set("Type", Object::name("Font"));
        cid.set("Subtype", Object::name("CIDFontType2"));
        cid.set("BaseFont", Object::name("Helvetica"));
        cid.set("CIDSystemInfo", Object::Dict(info));
        cid.set("FontDescriptor", Object::Ref(desc));
        cid.set("DW", 500);
        cid.set("CIDToGIDMap", Object::name("Identity"));
        let cid = objects.add(Object::Dict(cid));
        let mut d = Dict::new();
        d.set("Type", Object::name("Font"));
        d.set("Subtype", Object::name("Type0"));
        d.set("BaseFont", Object::name("Helvetica"));
        d.set("Encoding", Object::name("Identity-H"));
        d.set("DescendantFonts", Object::Array(vec![Object::Ref(cid)]));
        d.set("ToUnicode", Object::Ref(to_unicode));
        objects.set(font, Object::Dict(d));
    }
}

/// Edited text: outlines, an invisible copy, marked as editable text.
pub fn laid_out(
    n: &Node,
    t: &TextNode,
    to_page: &Affine,
    ops: &mut Vec<Op>,
    res: &mut Resources,
    objects: &mut Objects,
    invisible: &mut InvisibleFont,
) {
    ops.push(op("q", Vec::new()));
    ops.extend(alpha_ops(n.opacity, n.blend, res));
    let props = crate::marks::text_props(t, to_page);
    ops.push(op(
        "BDC",
        vec![Object::name(crate::marks::TEXT), Object::Dict(props)],
    ));
    ops.push(cm(to_page));
    let outlines = crate::text::outlines(t);
    let masked = t.fill.as_ref().is_some_and(has_alpha)
        || t.stroke.as_ref().is_some_and(|s| has_alpha(&s.paint));
    if outlines.is_empty() {
        // Nothing shows; the invisible copy below still carries the text.
    } else if masked {
        // Fill and stroke each under their gradient's soft mask.
        let bounds = outlines.bounds().unwrap_or_default();
        if let Some(f) = &t.fill {
            ops.push(op("q", Vec::new()));
            ops.extend(alpha_mask_ops(f, bounds, res, objects));
            ops.extend(paint_ops(f, false, to_page, res, objects));
            ops.extend(super::emit::path_ops(&outlines));
            ops.push(op("f", Vec::new()));
            ops.push(op("Q", Vec::new()));
        }
        if let Some(s) = &t.stroke {
            let reach = s.width / 2.0 * s.miter_limit.max(1.0) + 1.0;
            ops.push(op("q", Vec::new()));
            ops.extend(alpha_mask_ops(&s.paint, bounds.outset(reach), res, objects));
            ops.extend(stroke_ops(s, to_page, res, objects));
            ops.extend(super::emit::path_ops(&outlines));
            ops.push(op("S", Vec::new()));
            ops.push(op("Q", Vec::new()));
        }
    } else if t.fill.is_some() || t.stroke.is_some() {
        if let Some(f) = &t.fill {
            ops.extend(paint_ops(f, false, to_page, res, objects));
        }
        if let Some(s) = &t.stroke {
            ops.extend(stroke_ops(s, to_page, res, objects));
        }
        ops.extend(super::emit::path_ops(&outlines));
        ops.push(op(
            match (t.fill.is_some(), t.stroke.is_some()) {
                (true, true) => "B",
                (true, false) => "f",
                _ => "S",
            },
            Vec::new(),
        ));
    }
    // The characters, invisible, line by line over where they show.
    let layout = crate::text::layout(t);
    let font = invisible.font(objects);
    let font_name = res.name("Font", Object::Ref(font));
    let chars: Vec<char> = t.text.chars().collect();
    let size = t.size.max(0.01);
    ops.push(op("BT", Vec::new()));
    ops.push(op("Tr", vec![Object::Int(3)]));
    ops.push(op("Tf", vec![Object::Name(font_name), num(size)]));
    for line in &layout.lines {
        let text: Vec<char> = chars
            .get(line.start..line.end.min(chars.len()))
            .unwrap_or_default()
            .iter()
            .copied()
            .filter(|c| *c != '\n')
            .collect();
        if text.is_empty() {
            continue;
        }
        // Stretch the copy over the line (each code advances half an em).
        let natural = text.len() as f64 * 0.5 * size;
        let scale = ((line.x1 - line.x0) / natural * 100.0).clamp(1.0, 1000.0);
        ops.push(op("Tz", vec![num(scale)]));
        ops.push(op(
            "Tm",
            vec![
                num(1.0),
                num(0.0),
                num(0.0),
                num(-1.0),
                num(line.x0),
                num(line.baseline),
            ],
        ));
        let mut bytes = Vec::with_capacity(text.len() * 2);
        for c in text {
            bytes.extend(invisible.cid(c).to_be_bytes());
        }
        ops.push(op("Tj", vec![Object::String(bytes)]));
    }
    ops.push(op("ET", Vec::new()));
    ops.push(op("EMC", Vec::new()));
    ops.push(op("Q", Vec::new()));
}
