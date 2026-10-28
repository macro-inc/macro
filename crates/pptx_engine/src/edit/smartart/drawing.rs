//! Writes the drawing part (`dsp:drawing`): the laid-out shapes with their
//! fills, lines, and effects expanded from the theme's format styles in the
//! diagram's colors (as PowerPoint writes it, so other readers draw the same
//! thing), and their text at the fitted sizes.

use super::colors::ColorsDef;
use super::data::{A_URI, DGM_URI, IdGen, Model, PtKind};
use super::layout::{Align, Anchor, Diagram, Geom, Laid, TextBox, TextSource};
use super::quick_style::StyleDef;
use crate::error::{Error, Result};
use crate::model::presentation::SlideContext;
use crate::model::theme::Theme;
use crate::path::Rect;
use crate::units::pt_to_emu;
use crate::xml::{NodeId, Ns, STANDARD_DECLARATION, XmlDoc};

/// The drawing namespace URI.
pub(crate) const DSP_URI: &str = "http://schemas.microsoft.com/office/drawing/2008/diagram";

/// Text shown in empty nodes while fitting (PowerPoint's prompt).
pub(crate) const PROMPT: &str = "[Text]";

/// The paragraphs of each node's text.
pub(crate) struct Source<'a> {
    /// The data part.
    pub doc: &'a XmlDoc,
    /// `a:p` elements of each node, by diagram index.
    pub paras: Vec<Vec<NodeId>>,
    /// Whether each node has no text.
    pub empty: Vec<bool>,
}

impl<'a> Source<'a> {
    /// Reads the text of every node of `d` from the data part.
    pub fn new(doc: &'a XmlDoc, model: &Model, d: &Diagram) -> Self {
        let mut paras = Vec::new();
        let mut empty = Vec::new();
        for n in &d.nodes {
            let ps: Vec<NodeId> = model
                .point(&n.id)
                .and_then(|p| doc.child(p.el, Ns::DGM, "t"))
                .map(|t| doc.children_named(t, Ns::A, "p").collect())
                .unwrap_or_default();
            let text: String = ps
                .iter()
                .map(|&p| super::data::paragraph_text(doc, p))
                .collect();
            empty.push(text.trim().is_empty());
            paras.push(ps);
        }
        Self { doc, paras, empty }
    }
}

/// Builds the diagram's node list from the model's tree.
pub(crate) fn diagram_of(model: &Model) -> Diagram {
    let tree = model.tree();
    let order = tree.preorder();
    let index: std::collections::HashMap<&str, usize> = order
        .iter()
        .enumerate()
        .map(|(i, (id, _))| (id.as_str(), i))
        .collect();
    let nodes = order
        .iter()
        .map(|(id, depth)| super::layout::LNode {
            id: id.clone(),
            asst: tree.kinds.get(id) == Some(&PtKind::Asst),
            parent: tree
                .parent(id)
                .filter(|p| *p != tree.root)
                .and_then(|p| index.get(p).copied()),
            children: tree
                .kids(id)
                .iter()
                .filter_map(|c| index.get(c.as_str()).copied())
                .collect(),
            depth: *depth,
        })
        .collect();
    Diagram { nodes }
}

fn emu(v: f32) -> i64 {
    pt_to_emu(f64::from(v))
}

/// Parses a fragment in the drawing namespaces and imports it into `doc`.
pub(crate) fn import(doc: &mut XmlDoc, xml: &str) -> Result<NodeId> {
    let wrapped =
        format!("<w xmlns:dsp=\"{DSP_URI}\" xmlns:a=\"{A_URI}\" xmlns:dgm=\"{DGM_URI}\">{xml}</w>");
    let frag = XmlDoc::parse(wrapped.as_bytes(), "SmartArt drawing fragment")?;
    let first = frag
        .first_child(frag.root())
        .ok_or_else(|| Error::InvalidEdit("empty fragment".into()))?;
    Ok(doc.import(&frag, first))
}

/// The paragraphs a text box shows: (node, its paragraph, outline level).
fn paragraphs(
    d: &Diagram,
    src: &Source<'_>,
    source: TextSource,
) -> Vec<(usize, Option<NodeId>, usize)> {
    let mut out = Vec::new();
    let push_node = |i: usize, lvl: usize, out: &mut Vec<_>| {
        if src.paras[i].is_empty() {
            out.push((i, None, lvl));
        }
        for &p in &src.paras[i] {
            out.push((i, Some(p), lvl));
        }
    };
    let (own, below) = match source {
        TextSource::Node(i) => (Some(i), None),
        TextSource::NodeAndBelow(i) => (Some(i), Some(i)),
        TextSource::Below(i) => (None, Some(i)),
    };
    if let Some(i) = own {
        push_node(i, 0, &mut out);
    }
    if let Some(i) = below {
        let base = d.nodes[i].depth;
        for c in d.descendants(i) {
            push_node(c, d.nodes[c].depth - base, &mut out);
        }
    }
    out
}

/// Appends a `dsp:txBody` showing `tb` at `size` to `sp`. With `prompt`,
/// empty nodes show PowerPoint's "[Text]" prompt (used while fitting).
pub(crate) fn append_text(
    out: &mut XmlDoc,
    sp: NodeId,
    src: &Source<'_>,
    d: &Diagram,
    tb: &TextBox,
    size: f32,
    prompt: bool,
) -> Result<NodeId> {
    let [l, t, r, b] = tb.insets(size).map(emu);
    let anchor = match tb.anchor {
        Anchor::Top => "t",
        Anchor::Middle => "ctr",
    };
    let body = import(
        out,
        &format!(
            "<dsp:txBody><a:bodyPr spcFirstLastPara=\"0\" vert=\"horz\" wrap=\"square\" lIns=\"{l}\" tIns=\"{t}\" rIns=\"{r}\" bIns=\"{b}\" numCol=\"1\" spcCol=\"1270\" anchor=\"{anchor}\" anchorCtr=\"0\"><a:noAutofit/></a:bodyPr><a:lstStyle/></dsp:txBody>"
        ),
    )?;
    out.append_child(sp, body);
    let sz = ((size * 100.0).round() as i64).max(100).to_string();
    let tab = emu(size * 3.5);
    let paras = paragraphs(d, src, tb.source);
    let bullets_only = matches!(tb.source, TextSource::Below(_));
    for (node, para, lvl) in paras {
        let p = match para {
            Some(p) => out.import(src.doc, p),
            None => out.create_element(Ns::A, "p"),
        };
        let keep_algn = out
            .child(p, Ns::A, "pPr")
            .and_then(|ppr| out.attr(ppr, "algn").map(str::to_owned));
        out.remove_children_named(p, Ns::A, "pPr");
        let bulleted = lvl > 0 || bullets_only;
        let ppr_xml = if bulleted {
            let indent = emu(size * 0.85);
            let level = lvl.max(1);
            format!(
                "<a:pPr marL=\"{}\" lvl=\"{level}\" indent=\"-{indent}\" algn=\"l\" defTabSz=\"{tab}\"><a:lnSpc><a:spcPct val=\"90000\"/></a:lnSpc><a:spcBef><a:spcPct val=\"0\"/></a:spcBef><a:spcAft><a:spcPct val=\"15000\"/></a:spcAft><a:buChar char=\"\u{2022}\"/></a:pPr>",
                indent * level as i64
            )
        } else {
            let algn = keep_algn.unwrap_or_else(|| {
                match tb.align {
                    Align::Center => "ctr",
                    Align::Left => "l",
                }
                .to_owned()
            });
            format!(
                "<a:pPr marL=\"0\" lvl=\"0\" indent=\"0\" algn=\"{algn}\" defTabSz=\"{tab}\"><a:lnSpc><a:spcPct val=\"90000\"/></a:lnSpc><a:spcBef><a:spcPct val=\"0\"/></a:spcBef><a:spcAft><a:spcPct val=\"35000\"/></a:spcAft><a:buNone/></a:pPr>"
            )
        };
        let ppr = import(out, &ppr_xml)?;
        out.insert_child(p, 0, ppr);
        if prompt && src.empty[node] {
            let run = import(
                out,
                &format!("<a:r><a:rPr lang=\"en-US\"/><a:t>{PROMPT}</a:t></a:r>"),
            )?;
            out.insert_after(ppr, run);
        }
        set_sizes(out, p, &sz);
        out.append_child(body, p);
    }
    if out.child(body, Ns::A, "p").is_none() {
        let p = import(
            out,
            &format!("<a:p><a:endParaRPr lang=\"en-US\" sz=\"{sz}\" kern=\"1200\"/></a:p>"),
        )?;
        out.append_child(body, p);
    }
    Ok(body)
}

/// Gives every run, break, field, and paragraph end of `p` the font size.
fn set_sizes(doc: &mut XmlDoc, p: NodeId, sz: &str) {
    let items: Vec<NodeId> = doc.children(p).collect();
    for c in items {
        match doc.local(c) {
            "r" | "fld" | "br" => {
                let rpr = match doc.child(c, Ns::A, "rPr") {
                    Some(r) => r,
                    None => {
                        let r = doc.create_element(Ns::A, "rPr");
                        doc.set_attr(r, "lang", "en-US");
                        doc.insert_child(c, 0, r);
                        r
                    }
                };
                doc.set_attr(rpr, "sz", sz);
                doc.set_attr(rpr, "kern", "1200");
            }
            "endParaRPr" => {
                doc.set_attr(c, "sz", sz);
                doc.set_attr(c, "kern", "1200");
            }
            _ => {}
        }
    }
    if doc.child(p, Ns::A, "endParaRPr").is_none() {
        let e = doc.create_element(Ns::A, "endParaRPr");
        doc.set_attr(e, "lang", "en-US");
        doc.set_attr(e, "sz", sz);
        doc.set_attr(e, "kern", "1200");
        doc.append_child(p, e);
    }
}

/// The XML of `a:xfrm` (or `dsp:txXfrm`) for a box.
fn xfrm_xml(tag: &str, r: Rect, rot: f32, [flip_h, flip_v]: [bool; 2]) -> String {
    let Rect { x, y, w, h } = r;
    let mut attrs = String::new();
    let rot = (rot.rem_euclid(360.0) * 60_000.0).round() as i64;
    if rot != 0 {
        attrs.push_str(&format!(" rot=\"{rot}\""));
    }
    if flip_h {
        attrs.push_str(" flipH=\"1\"");
    }
    if flip_v {
        attrs.push_str(" flipV=\"1\"");
    }
    format!(
        "<{tag}{attrs}><a:off x=\"{}\" y=\"{}\"/><a:ext cx=\"{}\" cy=\"{}\"/></{tag}>",
        emu(x),
        emu(y),
        emu(w.max(0.0)),
        emu(h.max(0.0))
    )
}

/// A theme format style (`fillStyleLst`, `lnStyleLst` entry or an
/// effect list) with its placeholder color replaced by `color`, as XML.
fn themed(theme: &Theme, node: NodeId, color: &str) -> Option<String> {
    let mut frag = theme.doc.fragment(node);
    // Picture fills point into the theme's relationships; use the color.
    let has_blip = frag
        .descendants(frag.root())
        .into_iter()
        .any(|n| frag.local(n) == "blip");
    if has_blip {
        return None;
    }
    let ph: Vec<NodeId> = frag
        .descendants(frag.root())
        .into_iter()
        .filter(|&n| frag.local(n) == "schemeClr" && frag.attr(n, "val") == Some("phClr"))
        .collect();
    for n in ph {
        let Ok(c) = super::data::import(&mut frag, color) else {
            continue;
        };
        for k in frag.child_nodes(n).to_vec() {
            frag.detach(k);
            frag.append_child(c, k);
        }
        frag.insert_before(n, c);
        frag.detach(n);
    }
    String::from_utf8(frag.to_bytes()).ok()
}

/// Colors and styles that paint a laid-out diagram.
pub(crate) struct Paint<'a> {
    /// The slide's context (theme and color map).
    pub ctx: &'a SlideContext,
    /// The colors definition.
    pub colors: &'a ColorsDef,
    /// The style definition.
    pub style: &'a StyleDef,
}

impl Paint<'_> {
    /// The fill, line, and effect XML and the text color of a shape.
    pub(crate) fn shape_style(
        &self,
        label: &str,
        color: (usize, usize),
        lines: bool,
    ) -> (String, String, String, Option<String>, [u32; 3]) {
        let theme = &self.ctx.theme;
        let colors = self.ctx.colors();
        let refs = self.style.refs(label);
        let label = self.colors.label(label);
        let (i, n) = color;
        let pick = |list: Option<&super::colors::ClrList>| list.and_then(|l| l.pick(i, n, &colors));
        let fill_color = pick(label.map(|l| &l.fill))
            .unwrap_or_else(|| "<a:schemeClr val=\"accent1\"/>".to_owned());
        let line_color =
            pick(label.map(|l| &l.line)).unwrap_or_else(|| "<a:schemeClr val=\"lt1\"/>".to_owned());
        let fill = if lines || refs.fill == 0 {
            "<a:noFill/>".to_owned()
        } else {
            theme
                .fill_style(refs.fill)
                .and_then(|n| themed(theme, n, &fill_color))
                .unwrap_or_else(|| format!("<a:solidFill>{fill_color}</a:solidFill>"))
        };
        let line = if refs.line == 0 {
            "<a:ln><a:noFill/></a:ln>".to_owned()
        } else {
            theme
                .line_style(refs.line)
                .and_then(|n| themed(theme, n, &line_color))
                .unwrap_or_else(|| {
                    format!("<a:ln w=\"12700\"><a:solidFill>{line_color}</a:solidFill></a:ln>")
                })
        };
        let effect = theme
            .effect_style(refs.effect)
            .and_then(|n| theme.doc.child(n, Ns::A, "effectLst"))
            .and_then(|n| themed(theme, n, &fill_color))
            .unwrap_or_else(|| "<a:effectLst/>".to_owned());
        let text = pick(label.map(|l| &l.text)).or_else(|| {
            refs.font
                .as_ref()
                .map(|c| format!("<a:schemeClr val=\"{c}\"/>"))
        });
        (
            fill,
            line,
            effect,
            text,
            [refs.line, refs.fill, refs.effect],
        )
    }
}

/// Writes the drawing part for a laid-out diagram. `model_ids` gives the
/// `modelId` of each shape (the node id for a node's main shape).
pub(crate) fn write(
    laid: &Laid,
    d: &Diagram,
    src: &Source<'_>,
    paint: &Paint<'_>,
    seed: &str,
) -> Result<XmlDoc> {
    let mut ids = IdGen::fresh(None, seed);
    let mut xml = format!(
        "{STANDARD_DECLARATION}<dsp:drawing xmlns:dgm=\"{DGM_URI}\" xmlns:dsp=\"{DSP_URI}\" xmlns:a=\"{A_URI}\"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id=\"0\" name=\"\"/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>"
    );
    for p in &laid.shapes {
        let model_id = match (p.primary, p.node) {
            (true, Some(n)) => d.nodes[n].id.clone(),
            _ => ids.next(),
        };
        let lines = matches!(p.geom, Geom::Lines(_));
        let (fill, line, effect, text_color, [ln, fl, ef]) =
            paint.shape_style(&p.label, p.color, lines);
        let geom = match &p.geom {
            Geom::Preset(name, adj) => {
                let gds: String = adj
                    .iter()
                    .map(|(n, v)| format!("<a:gd name=\"{n}\" fmla=\"val {v}\"/>"))
                    .collect();
                format!("<a:prstGeom prst=\"{name}\"><a:avLst>{gds}</a:avLst></a:prstGeom>")
            }
            Geom::Lines(lines) => {
                let mut paths = String::new();
                for l in lines {
                    paths.push_str("<a:path>");
                    for (k, (x, y)) in l.iter().enumerate() {
                        let tag = if k == 0 { "moveTo" } else { "lnTo" };
                        paths.push_str(&format!(
                            "<a:{tag}><a:pt x=\"{}\" y=\"{}\"/></a:{tag}>",
                            emu(*x),
                            emu(*y)
                        ));
                    }
                    paths.push_str("</a:path>");
                }
                format!(
                    "<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l=\"0\" t=\"0\" r=\"0\" b=\"0\"/><a:pathLst>{paths}</a:pathLst></a:custGeom>"
                )
            }
        };
        let font = match &text_color {
            Some(c) => format!("<a:fontRef idx=\"minor\">{c}</a:fontRef>"),
            None => "<a:fontRef idx=\"minor\"/>".to_owned(),
        };
        let black = "<a:scrgbClr r=\"0\" g=\"0\" b=\"0\"/>";
        xml.push_str(&format!(
            "<dsp:sp modelId=\"{model_id}\"><dsp:nvSpPr><dsp:cNvPr id=\"0\" name=\"\"/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr>{}{geom}{fill}{line}{effect}</dsp:spPr><dsp:style><a:lnRef idx=\"{ln}\">{black}</a:lnRef><a:fillRef idx=\"{fl}\">{black}</a:fillRef><a:effectRef idx=\"{ef}\">{black}</a:effectRef>{font}</dsp:style></dsp:sp>",
            xfrm_xml("a:xfrm", p.rect, p.rot, [p.flip_h, p.flip_v])
        ));
    }
    xml.push_str("</dsp:spTree></dsp:drawing>");
    let mut doc = XmlDoc::parse(xml.as_bytes(), "SmartArt drawing")?;
    let tree = doc
        .child(doc.root(), Ns::DSP, "spTree")
        .ok_or_else(|| Error::InvalidEdit("SmartArt drawing without a shape tree".into()))?;
    let sps: Vec<NodeId> = doc.children_named(tree, Ns::DSP, "sp").collect();
    for (p, sp) in laid.shapes.iter().zip(sps) {
        let Some(tb) = &p.text else {
            continue;
        };
        append_text(&mut doc, sp, src, d, tb, laid.sizes.of(tb.group), false)?;
        let r = tb.rect;
        let tx = import(&mut doc, &xfrm_xml("dsp:txXfrm", r, 0.0, [false; 2]))?;
        doc.append_child(sp, tx);
    }
    Ok(doc)
}

/// The XML of a measuring drawing holding one text shape over `rect`.
pub(crate) fn probe_xml(x: f32, y: f32, w: f32, h: f32) -> String {
    format!(
        "<dsp:drawing xmlns:dgm=\"{DGM_URI}\" xmlns:dsp=\"{DSP_URI}\" xmlns:a=\"{A_URI}\"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id=\"0\" name=\"\"/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/><dsp:sp modelId=\"probe\"><dsp:nvSpPr><dsp:cNvPr id=\"0\" name=\"\"/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr>{}<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></dsp:spPr><dsp:style><a:lnRef idx=\"0\"><a:scrgbClr r=\"0\" g=\"0\" b=\"0\"/></a:lnRef><a:fillRef idx=\"0\"><a:scrgbClr r=\"0\" g=\"0\" b=\"0\"/></a:fillRef><a:effectRef idx=\"0\"><a:scrgbClr r=\"0\" g=\"0\" b=\"0\"/></a:effectRef><a:fontRef idx=\"minor\"/></dsp:style></dsp:sp></dsp:spTree></dsp:drawing>",
        xfrm_xml("a:xfrm", Rect::from_xywh(x, y, w, h), 0.0, [false; 2])
    )
}
