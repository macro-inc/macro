//! Text bodies: body properties, paragraphs, runs, and style inheritance.
//!
//! Paragraph and run properties are inherited, highest priority first, from:
//! the run/paragraph itself, the shape's own list style, the shape style's
//! `fontRef`, the layout and master placeholder list styles, the master's
//! title/body/other text style, and the presentation's default text style.

use super::color::{ColorContext, Rgba, find_color, percent};
use super::fill::{Effects, Fill, LineProps, find_fill, parse_effects, parse_line};
use super::presentation::{PartRef, SlideContext};
use super::shape::{Inherit, Placeholder};
use crate::units::emu_to_pt;
use crate::xml::{NodeId, Ns, XmlDoc};

mod types;

pub use types::*;

// ---- partial properties -------------------------------------------------

#[derive(Clone, Debug, Default)]
struct PRun {
    sz: Option<f32>,
    b: Option<bool>,
    i: Option<bool>,
    u: Option<Underline>,
    strike: Option<Strike>,
    cap: Option<Caps>,
    baseline: Option<f32>,
    spc: Option<f32>,
    kern: Option<f32>,
    fill: Option<Fill>,
    ln: Option<LineProps>,
    highlight: Option<Rgba>,
    effects: Option<Effects>,
    latin: Option<String>,
    ea: Option<String>,
    cs: Option<String>,
    sym: Option<String>,
    lang: Option<String>,
}

impl PRun {
    fn inherit(&mut self, o: &PRun) {
        macro_rules! take {
            ($($f:ident),*) => { $( if self.$f.is_none() { self.$f = o.$f.clone(); } )* };
        }
        take!(
            sz, b, i, u, strike, cap, baseline, spc, kern, fill, ln, highlight, effects, latin, ea,
            cs, sym, lang
        );
    }
}

#[derive(Clone, Debug)]
enum BuColor {
    Text,
    Color(Rgba),
}

#[derive(Clone, Debug)]
enum BuFont {
    Text,
    Face(String),
}

#[derive(Clone, Debug, Default)]
struct PPara {
    algn: Option<Align>,
    mar_l: Option<f32>,
    mar_r: Option<f32>,
    indent: Option<f32>,
    ln_spc: Option<Spacing>,
    spc_bef: Option<Spacing>,
    spc_aft: Option<Spacing>,
    bu_clr: Option<BuColor>,
    bu_sz: Option<BulletSize>,
    bu_font: Option<BuFont>,
    bu_kind: Option<BulletKind>,
    tabs: Option<Vec<TabStop>>,
    def_tab: Option<f32>,
    rtl: Option<bool>,
    latin_ln_brk: Option<bool>,
    def_rpr: PRun,
}

impl PPara {
    fn inherit(&mut self, o: &PPara) {
        macro_rules! take {
            ($($f:ident),*) => { $( if self.$f.is_none() { self.$f = o.$f.clone(); } )* };
        }
        take!(
            algn,
            mar_l,
            mar_r,
            indent,
            ln_spc,
            spc_bef,
            spc_aft,
            bu_clr,
            bu_sz,
            bu_font,
            bu_kind,
            tabs,
            def_tab,
            rtl,
            latin_ln_brk
        );
        self.def_rpr.inherit(&o.def_rpr);
    }
}

struct Parse<'a> {
    colors: ColorContext<'a>,
    theme: &'a super::theme::Theme,
}

fn spacing(doc: &XmlDoc, node: Option<NodeId>) -> Option<Spacing> {
    let n = node?;
    if let Some(p) = doc.child(n, Ns::A, "spcPct") {
        return Some(Spacing::Percent(
            doc.attr(p, "val").map_or(1.0, |v| percent(v) as f32),
        ));
    }
    doc.child(n, Ns::A, "spcPts")
        .map(|p| Spacing::Points(doc.attr_f64(p, "val").map_or(0.0, |v| (v / 100.0) as f32)))
}

impl Parse<'_> {
    fn typeface(&self, doc: &XmlDoc, node: NodeId, name: &str) -> Option<String> {
        let tf = doc
            .child(node, Ns::A, name)
            .and_then(|c| doc.attr(c, "typeface"))?;
        let resolved = self.theme.resolve_typeface(tf);
        (!resolved.is_empty()).then(|| resolved.to_owned())
    }

    fn rpr(&self, part: &PartRef, node: NodeId) -> PRun {
        let doc = &part.doc;
        let rels = part.rels.clone();
        let resolver = move |id: &str| rels.target_part(id);
        PRun {
            sz: doc.attr_f64(node, "sz").map(|v| (v / 100.0) as f32),
            b: doc.attr_bool(node, "b"),
            i: doc.attr_bool(node, "i"),
            u: doc.attr(node, "u").map(|u| match u {
                "none" => Underline::None,
                "dbl" => Underline::Double,
                "heavy" => Underline::Heavy,
                "dotted" | "dottedHeavy" => Underline::Dotted,
                "dash" | "dashHeavy" | "dashLong" | "dashLongHeavy" | "dotDash"
                | "dotDashHeavy" | "dotDotDash" | "dotDotDashHeavy" => Underline::Dash,
                "wavy" | "wavyHeavy" | "wavyDbl" => Underline::Wavy,
                _ => Underline::Single,
            }),
            strike: doc.attr(node, "strike").map(|s| match s {
                "sngStrike" => Strike::Single,
                "dblStrike" => Strike::Double,
                _ => Strike::None,
            }),
            cap: doc.attr(node, "cap").map(|c| match c {
                "small" => Caps::Small,
                "all" => Caps::All,
                _ => Caps::None,
            }),
            baseline: doc.attr(node, "baseline").map(|v| percent(v) as f32),
            spc: doc.attr_f64(node, "spc").map(|v| (v / 100.0) as f32),
            kern: doc.attr_f64(node, "kern").map(|v| (v / 100.0) as f32),
            fill: find_fill(doc, node, &self.colors, &resolver),
            ln: doc
                .child(node, Ns::A, "ln")
                .map(|l| parse_line(doc, l, &self.colors, &resolver)),
            highlight: doc
                .child(node, Ns::A, "highlight")
                .and_then(|h| find_color(doc, h, &self.colors)),
            effects: doc
                .child(node, Ns::A, "effectLst")
                .map(|e| parse_effects(doc, e, &self.colors)),
            latin: self.typeface(doc, node, "latin"),
            ea: self.typeface(doc, node, "ea"),
            cs: self.typeface(doc, node, "cs"),
            sym: self.typeface(doc, node, "sym"),
            lang: doc.attr(node, "lang").map(str::to_owned),
        }
    }

    fn ppr(&self, part: &PartRef, node: NodeId) -> PPara {
        let doc = &part.doc;
        let pt = |a: &str| doc.attr_f64(node, a).map(emu_to_pt);
        let mut p = PPara {
            algn: doc.attr(node, "algn").map(|a| match a {
                "ctr" => Align::Center,
                "r" => Align::Right,
                "just" | "justLow" => Align::Justify,
                "dist" | "thaiDist" => Align::Distributed,
                _ => Align::Left,
            }),
            mar_l: pt("marL"),
            mar_r: pt("marR"),
            indent: pt("indent"),
            def_tab: pt("defTabSz"),
            rtl: doc.attr_bool(node, "rtl"),
            latin_ln_brk: doc.attr_bool(node, "latinLnBrk"),
            ln_spc: spacing(doc, doc.child(node, Ns::A, "lnSpc")),
            spc_bef: spacing(doc, doc.child(node, Ns::A, "spcBef")),
            spc_aft: spacing(doc, doc.child(node, Ns::A, "spcAft")),
            ..Default::default()
        };
        for c in doc.children(node) {
            match doc.local(c) {
                "buClrTx" => p.bu_clr = Some(BuColor::Text),
                "buClr" => p.bu_clr = find_color(doc, c, &self.colors).map(BuColor::Color),
                "buSzTx" => p.bu_sz = Some(BulletSize::FollowText),
                "buSzPct" => {
                    p.bu_sz = Some(BulletSize::Percent(
                        doc.attr(c, "val").map_or(1.0, |v| percent(v) as f32),
                    ))
                }
                "buSzPts" => {
                    p.bu_sz = Some(BulletSize::Points(
                        doc.attr_f64(c, "val").map_or(0.0, |v| (v / 100.0) as f32),
                    ));
                }
                "buFontTx" => p.bu_font = Some(BuFont::Text),
                "buFont" => {
                    p.bu_font = doc
                        .attr(c, "typeface")
                        .map(|t| BuFont::Face(self.theme.resolve_typeface(t).to_owned()));
                }
                "buNone" => p.bu_kind = Some(BulletKind::None),
                "buChar" => {
                    // Only the first character shows (SmartArt drawings
                    // often write the bullet twice).
                    let ch = doc
                        .attr(c, "char")
                        .and_then(|s| s.chars().next())
                        .unwrap_or('\u{2022}');
                    p.bu_kind = Some(BulletKind::Char(ch.to_string()))
                }
                "buAutoNum" => {
                    p.bu_kind = Some(BulletKind::AutoNum {
                        scheme: doc.attr(c, "type").unwrap_or("arabicPeriod").to_owned(),
                        start: doc.attr_i64(c, "startAt").unwrap_or(1).max(0) as u32,
                    });
                }
                "buBlip" => {
                    let target = doc
                        .descendants(c)
                        .into_iter()
                        .find(|&b| doc.local(b) == "blip")
                        .and_then(|b| doc.attr_ns(b, Ns::R, "embed"))
                        .and_then(|id| part.target(id));
                    p.bu_kind = Some(BulletKind::Picture(target));
                }
                "tabLst" => {
                    p.tabs = Some(
                        doc.children_named(c, Ns::A, "tab")
                            .map(|t| TabStop {
                                pos: doc.attr_f64(t, "pos").map_or(0.0, emu_to_pt),
                                align: match doc.attr(t, "algn") {
                                    Some("ctr") => TabAlign::Center,
                                    Some("r") => TabAlign::Right,
                                    Some("dec") => TabAlign::Decimal,
                                    _ => TabAlign::Left,
                                },
                            })
                            .collect(),
                    );
                }
                "defRPr" => p.def_rpr = self.rpr(part, c),
                _ => {}
            }
        }
        p
    }

    /// Paragraph properties for `level` from a list-style element (`lstStyle`, `titleStyle`...).
    fn list_level(&self, part: &PartRef, list: NodeId, level: u8) -> PPara {
        let doc = &part.doc;
        let name = format!("lvl{}pPr", level + 1);
        let mut p = doc
            .child(list, Ns::A, &name)
            .map(|n| self.ppr(part, n))
            .unwrap_or_default();
        if let Some(def) = doc.child(list, Ns::A, "defPPr") {
            p.inherit(&self.ppr(part, def));
        }
        p
    }
}

fn tx_body(doc: &XmlDoc, shape: NodeId) -> Option<NodeId> {
    doc.children(shape).find(|&c| doc.local(c) == "txBody")
}

/// Text formatting a table style contributes to a cell (`a:tcTxStyle`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CellTextStyle {
    /// Bold.
    pub bold: Option<bool>,
    /// Italic.
    pub italic: Option<bool>,
    /// Text color.
    pub color: Option<Rgba>,
    /// Latin typeface.
    pub latin: Option<String>,
}

impl CellTextStyle {
    /// Fills unset fields from `lower`.
    pub fn inherit(&mut self, lower: &CellTextStyle) {
        self.bold = self.bold.or(lower.bold);
        self.italic = self.italic.or(lower.italic);
        self.color = self.color.or(lower.color);
        if self.latin.is_none() {
            self.latin.clone_from(&lower.latin);
        }
    }
}

/// Resolves the text of a table cell (`a:tc`) with its table-style formatting.
pub fn resolve_cell_text(
    ctx: &SlideContext,
    part: &PartRef,
    tc: NodeId,
    style: &CellTextStyle,
    margins: [f32; 4],
    anchor: Anchor,
    vert: Vert,
) -> Option<TextBody> {
    let extra = PRun {
        b: style.bold,
        i: style.italic,
        fill: style.color.map(Fill::Solid),
        latin: style.latin.clone(),
        ..Default::default()
    };
    let chain = [(part.clone(), tc)];
    let mut body = resolve_inner(ctx, &chain, None, Some(extra))?;
    body.body.insets = margins;
    body.body.anchor = anchor;
    body.body.vert = vert;
    body.body.wrap = true;
    body.body.autofit = Autofit::None;
    Some(body)
}

/// Resolves the text body of a shape given its placeholder inheritance chain.
pub fn resolve_text_body(
    ctx: &SlideContext,
    chain: &[(PartRef, NodeId)],
    placeholder: Option<&Placeholder>,
    font_ref: Option<(&XmlDoc, NodeId)>,
    _inherit: Inherit,
) -> Option<TextBody> {
    let parse = Parse {
        colors: ctx.colors(),
        theme: &ctx.theme,
    };
    // `fontRef` sits between the shape's own list style and the inherited ones.
    let font_ref_run = font_ref.map(|(doc, fr)| {
        let collection = match doc.attr(fr, "idx") {
            Some("major") => Some(&ctx.theme.major),
            Some("minor") => Some(&ctx.theme.minor),
            _ => None,
        };
        PRun {
            latin: collection
                .map(|c| c.latin.clone())
                .filter(|s| !s.is_empty()),
            ea: collection.map(|c| c.ea.clone()).filter(|s| !s.is_empty()),
            cs: collection.map(|c| c.cs.clone()).filter(|s| !s.is_empty()),
            fill: find_color(doc, fr, &parse.colors).map(Fill::Solid),
            ..Default::default()
        }
    });
    resolve_inner(ctx, chain, placeholder, font_ref_run)
}

fn resolve_inner(
    ctx: &SlideContext,
    chain: &[(PartRef, NodeId)],
    placeholder: Option<&Placeholder>,
    font_ref_run: Option<PRun>,
) -> Option<TextBody> {
    let (own_part, own_node) = chain.first()?;
    let body_node = tx_body(&own_part.doc, *own_node)?;
    let parse = Parse {
        colors: ctx.colors(),
        theme: &ctx.theme,
    };

    // Body properties: attribute-wise inheritance along the chain.
    let body_prs: Vec<(&PartRef, NodeId)> = chain
        .iter()
        .filter_map(|(p, n)| {
            let tb = tx_body(&p.doc, *n)?;
            p.doc.child(tb, Ns::A, "bodyPr").map(|b| (p, b))
        })
        .collect();
    let body = resolve_body_props(&body_prs);

    // List styles: own, (fontRef), layout, master, master text style, presentation default.
    let mut lists: Vec<(&PartRef, NodeId)> = chain
        .iter()
        .filter_map(|(p, n)| {
            let tb = tx_body(&p.doc, *n)?;
            p.doc.child(tb, Ns::A, "lstStyle").map(|l| (p, l))
        })
        .collect();
    let family = placeholder.map_or("other", Placeholder::style_family);
    let master_style = ctx.master.as_ref().and_then(|m| {
        let style = match family {
            "title" => "titleStyle",
            "body" => "bodyStyle",
            _ => "otherStyle",
        };
        m.doc
            .path(m.doc.root(), Ns::P, &["txStyles", style])
            .map(|n| (m, n))
    });
    if let Some(ms) = master_style {
        lists.push(ms);
    }
    let pres_default = ctx
        .presentation
        .doc
        .child(ctx.presentation.doc.root(), Ns::P, "defaultTextStyle")
        .map(|n| (&ctx.presentation, n));
    if let Some(pd) = pres_default {
        lists.push(pd);
    }
    // Titles take no bullet from the presentation-wide default style (as in
    // PowerPoint and LibreOffice); their own chain may still set one.
    let unbulleted_default = (family == "title" && pres_default.is_some()).then(|| lists.len() - 1);
    let own_list_count = usize::from(
        tx_body(&own_part.doc, *own_node)
            .and_then(|tb| own_part.doc.child(tb, Ns::A, "lstStyle"))
            .is_some(),
    );

    let doc = &own_part.doc;
    let mut paragraphs = Vec::new();
    for p in doc.children_named(body_node, Ns::A, "p") {
        let ppr_node = doc.child(p, Ns::A, "pPr");
        let level = ppr_node
            .and_then(|n| doc.attr_i64(n, "lvl"))
            .unwrap_or(0)
            .clamp(0, 8) as u8;
        // Inherited paragraph defaults for this level.
        let mut inherited = PPara::default();
        for (i, (lp, ln)) in lists.iter().enumerate() {
            if i == own_list_count
                && let Some(fr) = &font_ref_run
            {
                inherited.def_rpr.inherit(fr);
            }
            let mut props = parse.list_level(lp, *ln, level);
            if Some(i) == unbulleted_default {
                props.bu_kind = None;
            }
            inherited.inherit(&props);
        }
        if lists.len() <= own_list_count
            && let Some(fr) = &font_ref_run
        {
            inherited.def_rpr.inherit(fr);
        }
        let mut pp = ppr_node.map(|n| parse.ppr(own_part, n)).unwrap_or_default();
        // The paragraph's own defRPr (as written by python-pptx's `paragraph.font`)
        // styles its runs just below their own rPr, as LibreOffice and the spec have it.
        pp.inherit(&inherited);
        let props = finish_para(&pp, level);

        let mut runs = Vec::new();
        for r in doc.children(p) {
            let kind = match doc.local(r) {
                "r" => RunKind::Text,
                "br" => RunKind::Break,
                "fld" => RunKind::Field(doc.attr(r, "type").unwrap_or("").to_owned()),
                _ => continue,
            };
            let mut rp = doc
                .child(r, Ns::A, "rPr")
                .map(|n| parse.rpr(own_part, n))
                .unwrap_or_default();
            rp.inherit(&pp.def_rpr);
            let hlink = doc
                .child(r, Ns::A, "rPr")
                .and_then(|n| doc.child(n, Ns::A, "hlinkClick"));
            let link = hlink.and_then(|h| read_link(own_part, h));
            let mut props = finish_run(&rp, &parse.colors);
            if hlink.is_some_and(|h| !hyperlink_uses_text_color(doc, h)) {
                if let Some(c) = parse.colors.scheme_color("hlink") {
                    props.fill = Fill::Solid(c);
                }
                if props.underline == Underline::None {
                    props.underline = Underline::Single;
                }
            }
            let cached = || {
                doc.child(r, Ns::A, "t")
                    .map(|t| doc.text(t))
                    .unwrap_or_default()
            };
            let text = match &kind {
                RunKind::Break => String::new(),
                RunKind::Field(t) if t == "slidenum" => ctx.number.to_string(),
                RunKind::Field(t) => ctx
                    .clock
                    .and_then(|now| now.format(t))
                    .unwrap_or_else(cached),
                RunKind::Text => cached(),
            };
            runs.push(Run {
                text,
                props,
                kind,
                link,
                node: r,
            });
        }
        let mut end = doc
            .child(p, Ns::A, "endParaRPr")
            .map(|n| parse.rpr(own_part, n))
            .unwrap_or_default();
        end.inherit(&pp.def_rpr);
        paragraphs.push(Paragraph {
            props,
            runs,
            end_props: finish_run(&end, &parse.colors),
            node: p,
        });
    }
    Some(TextBody {
        body,
        paragraphs,
        node: body_node,
    })
}

/// Reads an `a:hlinkClick` (on a run or a shape's `p:cNvPr`) of `part`.
/// Actions other than slide jumps (macros, programs, OLE verbs) read as no
/// link.
pub fn read_link(part: &PartRef, hlink: NodeId) -> Option<Link> {
    let doc = &part.doc;
    let rel = doc
        .attr_ns(hlink, Ns::R, "id")
        .filter(|id| !id.is_empty())
        .and_then(|id| part.rels.get(id));
    let target = match doc.attr(hlink, "action").unwrap_or("") {
        "" => {
            let rel = rel?;
            match rel.mode {
                crate::opc::TargetMode::External => LinkTarget::Url(rel.target.clone()),
                crate::opc::TargetMode::Internal => LinkTarget::Url(part.rels.resolve(rel)),
            }
        }
        "ppaction://hlinksldjump" => LinkTarget::Slide(part.rels.resolve(rel?)),
        action => LinkTarget::Jump(
            action
                .strip_prefix("ppaction://hlinkshowjump?jump=")?
                .to_owned(),
        ),
    };
    Some(Link {
        target,
        tooltip: doc
            .attr(hlink, "tooltip")
            .filter(|t| !t.is_empty())
            .map(str::to_owned),
    })
}

fn hyperlink_uses_text_color(doc: &XmlDoc, hlink: NodeId) -> bool {
    doc.descendants(hlink)
        .into_iter()
        .any(|n| doc.local(n) == "hlinkClr" && doc.attr(n, "val") == Some("tx"))
}

fn resolve_body_props(sources: &[(&PartRef, NodeId)]) -> BodyProps {
    let get = |name: &str| {
        sources
            .iter()
            .find_map(|(p, n)| p.doc.attr(*n, name).map(str::to_owned))
    };
    let num = |name: &str| get(name).and_then(|v| v.trim().parse::<f64>().ok());
    let d = BodyProps::default();
    let autofit = sources
        .iter()
        .find_map(|(p, n)| {
            let doc = &p.doc;
            doc.children(*n).find_map(|c| match doc.local(c) {
                "noAutofit" => Some(Autofit::None),
                "spAutoFit" => Some(Autofit::Shape),
                "normAutofit" => Some(Autofit::Normal {
                    font_scale: doc.attr(c, "fontScale").map_or(1.0, |v| percent(v) as f32),
                    line_reduction: doc
                        .attr(c, "lnSpcReduction")
                        .map_or(0.0, |v| percent(v) as f32),
                }),
                _ => None,
            })
        })
        .unwrap_or(Autofit::None);
    BodyProps {
        insets: [
            num("lIns").map_or(d.insets[0], emu_to_pt),
            num("tIns").map_or(d.insets[1], emu_to_pt),
            num("rIns").map_or(d.insets[2], emu_to_pt),
            num("bIns").map_or(d.insets[3], emu_to_pt),
        ],
        anchor: match get("anchor").as_deref() {
            Some("ctr") => Anchor::Middle,
            Some("b") => Anchor::Bottom,
            _ => Anchor::Top,
        },
        anchor_ctr: get("anchorCtr")
            .and_then(|v| crate::xml::parse_bool(&v))
            .unwrap_or(false),
        wrap: get("wrap").is_none_or(|w| w != "none"),
        vert: match get("vert").as_deref() {
            Some("vert") => Vert::Vert,
            Some("vert270") => Vert::Vert270,
            Some("eaVert") | Some("mongolianVert") => Vert::EaVert,
            Some("wordArtVert") | Some("wordArtVertRtl") => Vert::Stacked,
            _ => Vert::Horz,
        },
        rot: num("rot").map_or(0.0, |v| (v / 60000.0) as f32),
        num_col: num("numCol").map_or(1, |v| v.clamp(1.0, 16.0) as u32),
        spc_col: num("spcCol").map_or(0.0, emu_to_pt),
        autofit,
        clip_overflow: matches!(
            get("vertOverflow").as_deref(),
            Some("clip") | Some("ellipsis")
        ),
    }
}

fn finish_para(p: &PPara, level: u8) -> ParaProps {
    ParaProps {
        align: p.algn.unwrap_or(Align::Left),
        mar_l: p.mar_l.unwrap_or(0.0),
        mar_r: p.mar_r.unwrap_or(0.0),
        indent: p.indent.unwrap_or(0.0),
        line_spacing: p.ln_spc.unwrap_or(Spacing::Percent(1.0)),
        space_before: p.spc_bef.unwrap_or(Spacing::Points(0.0)),
        space_after: p.spc_aft.unwrap_or(Spacing::Points(0.0)),
        bullet: Bullet {
            kind: p.bu_kind.clone().unwrap_or(BulletKind::None),
            font: match &p.bu_font {
                Some(BuFont::Face(f)) => Some(f.clone()),
                _ => None,
            },
            size: p.bu_sz.unwrap_or(BulletSize::FollowText),
            color: match &p.bu_clr {
                Some(BuColor::Color(c)) => Some(*c),
                _ => None,
            },
        },
        tabs: p.tabs.clone().unwrap_or_default(),
        default_tab: p.def_tab.filter(|t| *t > 0.0).unwrap_or(72.0),
        rtl: p.rtl.unwrap_or(false),
        level,
        latin_line_break: p.latin_ln_brk.unwrap_or(false),
    }
}

fn finish_run(r: &PRun, colors: &ColorContext<'_>) -> RunProps {
    RunProps {
        size: r.sz.filter(|s| *s > 0.0).unwrap_or(18.0),
        bold: r.b.unwrap_or(false),
        italic: r.i.unwrap_or(false),
        underline: r.u.unwrap_or(Underline::None),
        strike: r.strike.unwrap_or(Strike::None),
        caps: r.cap.unwrap_or(Caps::None),
        baseline: r.baseline.unwrap_or(0.0),
        spacing: r.spc.unwrap_or(0.0),
        kern: r.kern.unwrap_or(0.0),
        latin: r.latin.clone().unwrap_or_else(|| "Calibri".into()),
        ea: r.ea.clone().unwrap_or_default(),
        cs: r.cs.clone().unwrap_or_default(),
        sym: r.sym.clone().unwrap_or_default(),
        fill: r
            .fill
            .clone()
            .unwrap_or_else(|| Fill::Solid(colors.scheme_color("tx1").unwrap_or(Rgba::BLACK))),
        outline: r.ln.clone(),
        highlight: r.highlight,
        effects: r.effects.clone().unwrap_or_default(),
        lang: r.lang.clone().unwrap_or_default(),
    }
}

#[cfg(test)]
mod test;
