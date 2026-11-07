//! SmartArt color variations (`dgm:colorsDef`): the fill, line, and text
//! colors of each style label, and how a list of colors is spread over the
//! shapes that share a label.
//!
//! Built-in variations are generated here from PowerPoint's patterns (one
//! accent, the colorful ranges, the primary theme colors), and parsed back
//! like any other colors part, so drawings use exactly what the file says.

use super::catalog::{COLORS_PREFIX, ColorsInfo, find_colors};
use super::data::{A_URI, DGM_URI};
use crate::model::color::{ColorContext, Rgba, parse_color, rgb_to_hsl};
use crate::xml::{NodeId, Ns, XmlDoc};
use std::collections::HashMap;

/// How a color list is spread over the shapes of a label.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Meth {
    /// Interpolated from the first color to the last.
    Span,
    /// Interpolated from the first color to the last and back.
    Cycle,
    /// The colors in turn.
    Repeat,
}

/// One color of a list, as written (`schemeClr` with transforms).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Clr {
    /// Element name (`schemeClr`, `srgbClr`...).
    pub element: String,
    /// `val`.
    pub val: String,
    /// Transforms (`tint`, `alpha`...) with their values.
    pub mods: Vec<(String, String)>,
}

impl Clr {
    fn xml(&self, extra: &str) -> String {
        let mods: String = self
            .mods
            .iter()
            .map(|(k, v)| format!("<a:{k} val=\"{v}\"/>"))
            .collect();
        format!(
            "<a:{e} val=\"{v}\">{mods}{extra}</a:{e}>",
            e = self.element,
            v = self.val
        )
    }

    fn resolve(&self, ctx: &ColorContext<'_>) -> Option<Rgba> {
        let xml = format!("<a:root xmlns:a=\"{A_URI}\">{}</a:root>", self.xml(""));
        let doc = XmlDoc::parse(xml.as_bytes(), "color").ok()?;
        let el = doc.first_child(doc.root())?;
        parse_color(&doc, el, ctx)
    }
}

/// A color list of a label.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ClrList {
    /// How the list is applied.
    pub meth: Meth,
    /// Hue interpolation goes counterclockwise.
    pub ccw: bool,
    /// The colors.
    pub colors: Vec<Clr>,
}

impl ClrList {
    fn empty() -> Self {
        Self {
            meth: Meth::Repeat,
            ccw: false,
            colors: Vec::new(),
        }
    }

    /// The color element for shape `index` of `count`, as DrawingML XML
    /// (interpolated colors carry hue, saturation, luminance, and alpha
    /// offsets from the first color, as PowerPoint writes them).
    pub fn pick(&self, index: usize, count: usize, ctx: &ColorContext<'_>) -> Option<String> {
        let first = self.colors.first()?;
        if self.colors.len() == 1 || self.meth == Meth::Repeat {
            let c = &self.colors[index % self.colors.len()];
            return Some(c.xml(OFFSETS_ZERO));
        }
        let n = count.max(1);
        let t = match self.meth {
            Meth::Span if n > 1 => index as f64 / (n - 1) as f64,
            Meth::Cycle if n > 1 => 1.0 - (1.0 - 2.0 * index as f64 / n as f64).abs(),
            _ => 0.0,
        };
        let segments = self.colors.len() - 1;
        let pos = t.clamp(0.0, 1.0) * segments as f64;
        let k = (pos.floor() as usize).min(segments - 1);
        let local = pos - k as f64;
        let (a, b) = (&self.colors[k], &self.colors[k + 1]);
        let (Some(ra), Some(rb)) = (a.resolve(ctx), b.resolve(ctx)) else {
            return Some(first.xml(OFFSETS_ZERO));
        };
        let (ha, sa, la) = rgb_to_hsl(f64::from(ra.r), f64::from(ra.g), f64::from(ra.b));
        let (hb, sb, lb) = rgb_to_hsl(f64::from(rb.r), f64::from(rb.g), f64::from(rb.b));
        // Hues of grays are meaningless: keep the other color's.
        let (ha, hb) = match (sa < 1e-6, sb < 1e-6) {
            (true, false) => (hb, hb),
            (false, true) => (ha, ha),
            _ => (ha, hb),
        };
        let dh = if self.ccw {
            (hb - ha).rem_euclid(360.0)
        } else {
            -(ha - hb).rem_euclid(360.0)
        };
        let off = |v: f64| (v * local * 100_000.0).round() as i64;
        let extra = format!(
            "<a:hueOff val=\"{}\"/><a:satOff val=\"{}\"/><a:lumOff val=\"{}\"/><a:alphaOff val=\"{}\"/>",
            (dh * local * 60_000.0).round() as i64,
            off(sb - sa),
            off(lb - la),
            off(f64::from(rb.a - ra.a)),
        );
        Some(a.xml(&extra))
    }
}

const OFFSETS_ZERO: &str =
    "<a:hueOff val=\"0\"/><a:satOff val=\"0\"/><a:lumOff val=\"0\"/><a:alphaOff val=\"0\"/>";

/// The colors of one style label.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LabelColors {
    /// Shape fills.
    pub fill: ClrList,
    /// Shape outlines.
    pub line: ClrList,
    /// Text.
    pub text: ClrList,
}

/// A parsed colors definition.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ColorsDef {
    labels: HashMap<String, LabelColors>,
}

impl ColorsDef {
    /// Reads a `dgm:colorsDef` part.
    pub fn parse(doc: &XmlDoc) -> Self {
        let mut labels = HashMap::new();
        for s in doc.children_named(doc.root(), Ns::DGM, "styleLbl") {
            let Some(name) = doc.attr(s, "name") else {
                continue;
            };
            let list = |local: &str| {
                doc.child(s, Ns::DGM, local)
                    .map_or_else(ClrList::empty, |l| parse_list(doc, l))
            };
            labels.insert(
                name.to_owned(),
                LabelColors {
                    fill: list("fillClrLst"),
                    line: list("linClrLst"),
                    text: list("txFillClrLst"),
                },
            );
        }
        Self { labels }
    }

    /// The colors of a label (falling back to `node1`'s, then nothing).
    pub fn label(&self, name: &str) -> Option<&LabelColors> {
        self.labels.get(name).or_else(|| self.labels.get("node1"))
    }
}

fn parse_list(doc: &XmlDoc, list: NodeId) -> ClrList {
    let meth = match doc.attr(list, "meth") {
        Some("cycle") => Meth::Cycle,
        Some("repeat") => Meth::Repeat,
        _ => Meth::Span,
    };
    let colors = doc
        .children(list)
        .filter(|&c| doc.ns(c) == Ns::A)
        .map(|c| Clr {
            element: doc.local(c).to_owned(),
            val: doc.attr(c, "val").unwrap_or_default().to_owned(),
            mods: doc
                .children(c)
                .map(|m| {
                    (
                        doc.local(m).to_owned(),
                        doc.attr(m, "val").unwrap_or_default().to_owned(),
                    )
                })
                .collect(),
        })
        .collect();
    ClrList {
        meth,
        ccw: doc.attr(list, "hueDir") == Some("ccw"),
        colors,
    }
}

/// Every label a colors definition lists, in PowerPoint's order.
const LABELS: &[&str] = &[
    "node0",
    "alignNode1",
    "node1",
    "lnNode1",
    "vennNode1",
    "node2",
    "node3",
    "node4",
    "fgImgPlace1",
    "alignImgPlace1",
    "bgImgPlace1",
    "sibTrans2D1",
    "fgSibTrans2D1",
    "bgSibTrans2D1",
    "sibTrans1D1",
    "callout",
    "asst0",
    "asst1",
    "asst2",
    "asst3",
    "asst4",
    "parChTrans2D1",
    "parChTrans2D2",
    "parChTrans2D3",
    "parChTrans2D4",
    "parChTrans1D1",
    "parChTrans1D2",
    "parChTrans1D3",
    "parChTrans1D4",
    "fgAcc1",
    "conFgAcc1",
    "alignAcc1",
    "trAlignAcc1",
    "bgAcc1",
    "solidFgAcc1",
    "solidAlignAcc1",
    "solidBgAcc1",
    "fgAccFollowNode1",
    "alignAccFollowNode1",
    "bgAccFollowNode1",
    "fgAcc0",
    "fgAcc2",
    "fgAcc3",
    "fgAcc4",
    "bgShp",
    "dkBgShp",
    "trBgShp",
    "fgShp",
    "revTx",
];

/// A label's lists in the compact form `meth:color color`, where each
/// color is `name` or `name(mod=val,mod=val)` and meth is `r` (repeat),
/// `s` (span), or `c` (cycle); `""` is an empty list.
struct Spec {
    fill: String,
    line: String,
    text: String,
}

fn spec(fill: &str, line: &str, text: &str) -> Spec {
    Spec {
        fill: fill.to_owned(),
        line: line.to_owned(),
        text: text.to_owned(),
    }
}

fn list_xml(tag: &str, spec: &str) -> String {
    let spec = spec.trim();
    if spec.is_empty() {
        return format!("<dgm:{tag}/>");
    }
    let (meth, colors) = spec.split_once(':').unwrap_or(("r", spec));
    let meth = match meth {
        "s" => "span",
        "c" => "cycle",
        _ => "repeat",
    };
    let mut body = String::new();
    for c in colors.split_whitespace() {
        let (name, mods) = match c.split_once('(') {
            Some((n, rest)) => (n, rest.trim_end_matches(')')),
            None => (c, ""),
        };
        body.push_str(&format!("<a:schemeClr val=\"{name}\""));
        if mods.is_empty() {
            body.push_str("/>");
            continue;
        }
        body.push('>');
        for m in mods.split(',') {
            if let Some((k, v)) = m.split_once('=') {
                body.push_str(&format!("<a:{k} val=\"{v}\"/>"));
            }
        }
        body.push_str("</a:schemeClr>");
    }
    format!("<dgm:{tag} meth=\"{meth}\">{body}</dgm:{tag}>")
}

/// The XML of a built-in color variation, by id or short id.
pub(crate) fn builtin_xml(key: &str) -> Option<(ColorsInfo, String)> {
    let info = find_colors(key)?;
    let specs = builtin_specs(&info.short)?;
    let pri = match info.category.as_str() {
        "mainScheme" => 10100,
        "colorful" => 10300,
        _ => 11200,
    };
    let mut s = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<dgm:colorsDef xmlns:dgm=\"{DGM_URI}\" xmlns:a=\"{A_URI}\" uniqueId=\"{COLORS_PREFIX}{}\"><dgm:title val=\"\"/><dgm:desc val=\"\"/><dgm:catLst><dgm:cat type=\"{}\" pri=\"{pri}\"/></dgm:catLst>",
        info.short, info.category
    );
    for label in LABELS {
        let Some(sp) = specs.get(label) else {
            continue;
        };
        s.push_str(&format!(
            "<dgm:styleLbl name=\"{label}\">{}{}<dgm:effectClrLst/><dgm:txLinClrLst/>{}<dgm:txEffectClrLst/></dgm:styleLbl>",
            list_xml("fillClrLst", &sp.fill),
            list_xml("linClrLst", &sp.line),
            list_xml("txFillClrLst", &sp.text),
        ));
    }
    s.push_str("</dgm:colorsDef>");
    Some((info, s))
}

fn accent(n: i32) -> String {
    format!("accent{}", (n - 1).rem_euclid(6) + 1)
}

/// The label table of a built-in variation.
fn builtin_specs(short: &str) -> Option<HashMap<&'static str, Spec>> {
    if let Some(rest) = short.strip_prefix("colorful") {
        let n: i32 = rest.parse().ok()?;
        return (1..=5).contains(&n).then(|| colorful(n));
    }
    let rest = short.strip_prefix("accent")?;
    let (a, k) = rest.split_once('_')?;
    let (a, k): (i32, i32) = (a.parse().ok()?, k.parse().ok()?);
    match (a, k) {
        (0, 1..=3) => Some(primary(k)),
        (1..=6, 1..=5) => Some(one_accent(&accent(a), k)),
        _ => None,
    }
}

/// The parts every variation shares, given the colors of nodes,
/// transitions, and accents.
struct Palette {
    /// Node fills (node1, alignNode1, lnNode1).
    node: String,
    /// The first (root) node's fill.
    node0: String,
    /// Venn fills.
    venn: String,
    /// Node outlines.
    node_line: String,
    /// Node text (empty: the style's).
    node_text: String,
    /// Fills of nodes 2-4 (hierarchy levels).
    levels: [String; 3],
    /// Assistant fills.
    asst: [String; 5],
    /// 2-D transition (arrow) fill and line.
    trans2d: String,
    trans2d_line: String,
    /// 1-D transition (connector line).
    trans1d: String,
    /// Parent-child connector lines by level.
    par_ch_1d: [String; 4],
    /// The single accent the accents use.
    a: String,
    /// Accent shape outlines.
    acc_line: String,
    /// Accent follow-node fills.
    follow: String,
    /// Image placeholders.
    img: String,
}

fn table(p: &Palette) -> HashMap<&'static str, Spec> {
    let mut m = HashMap::new();
    let a = &p.a;
    m.insert("node0", spec(&p.node0, &p.node_line, &p.node_text));
    let align_line = if p.node_line == "r:lt1" {
        p.node.clone()
    } else {
        p.node_line.clone()
    };
    m.insert("alignNode1", spec(&p.node, &align_line, &p.node_text));
    m.insert("node1", spec(&p.node, &p.node_line, &p.node_text));
    m.insert("lnNode1", spec(&p.node, &p.node_line, &p.node_text));
    m.insert("vennNode1", spec(&p.venn, &p.node_line, ""));
    for (i, l) in ["node2", "node3", "node4"].into_iter().enumerate() {
        m.insert(l, spec(&p.levels[i], &p.node_line, &p.node_text));
    }
    for l in ["fgImgPlace1", "alignImgPlace1", "bgImgPlace1"] {
        m.insert(l, spec(&p.img, "r:lt1", "r:lt1"));
    }
    for l in ["sibTrans2D1", "fgSibTrans2D1", "bgSibTrans2D1"] {
        m.insert(l, spec(&p.trans2d, &p.trans2d_line, ""));
    }
    m.insert("sibTrans1D1", spec(&p.trans1d, &p.trans1d, "r:tx1"));
    m.insert(
        "callout",
        spec(&format!("r:{a}"), &format!("r:{a}(tint=50000)"), "r:tx1"),
    );
    for (i, l) in ["asst0", "asst1", "asst2", "asst3", "asst4"]
        .into_iter()
        .enumerate()
    {
        m.insert(l, spec(&p.asst[i], &p.node_line, &p.node_text));
    }
    m.insert("parChTrans2D1", spec(&p.trans2d, &p.trans2d_line, "r:lt1"));
    for l in ["parChTrans2D2", "parChTrans2D3", "parChTrans2D4"] {
        m.insert(l, spec(&format!("r:{a}"), &format!("r:{a}"), "r:lt1"));
    }
    for (i, l) in [
        "parChTrans1D1",
        "parChTrans1D2",
        "parChTrans1D3",
        "parChTrans1D4",
    ]
    .into_iter()
    .enumerate()
    {
        m.insert(l, spec(&format!("r:{a}"), &p.par_ch_1d[i], "r:tx1"));
    }
    for l in ["fgAcc1", "conFgAcc1", "alignAcc1", "bgAcc1"] {
        m.insert(l, spec("r:lt1(alpha=90000)", &p.acc_line, "r:dk1"));
    }
    m.insert(
        "trAlignAcc1",
        spec("r:lt1(alpha=40000)", &format!("r:{a}"), "r:dk1"),
    );
    for l in ["solidFgAcc1", "solidAlignAcc1", "solidBgAcc1"] {
        m.insert(l, spec("r:lt1", &p.acc_line, "r:dk1"));
    }
    for l in [
        "fgAccFollowNode1",
        "alignAccFollowNode1",
        "bgAccFollowNode1",
    ] {
        m.insert(l, spec(&p.follow, &p.follow, "r:dk1"));
    }
    for l in ["fgAcc0", "fgAcc2", "fgAcc3", "fgAcc4"] {
        m.insert(l, spec("r:lt1(alpha=90000)", &format!("r:{a}"), "r:dk1"));
    }
    m.insert(
        "bgShp",
        spec(&format!("r:{a}(tint=40000)"), &format!("r:{a}"), "r:dk1"),
    );
    m.insert(
        "dkBgShp",
        spec(&format!("r:{a}(shade=80000)"), &format!("r:{a}"), "r:lt1"),
    );
    m.insert(
        "trBgShp",
        spec(
            &format!("r:{a}(tint=50000,alpha=40000)"),
            &format!("r:{a}"),
            "r:lt1",
        ),
    );
    m.insert(
        "fgShp",
        spec(&format!("r:{a}(tint=60000)"), "r:lt1", "r:dk1"),
    );
    m.insert("revTx", spec("r:lt1(alpha=0)", "r:dk1(alpha=0)", "r:tx1"));
    m
}

/// One accent: 1 Colored Outline, 2 Colored Fill, 3 Gradient Range,
/// 4 Gradient Loop, 5 Transparent Gradient Range.
fn one_accent(a: &str, k: i32) -> HashMap<&'static str, Spec> {
    let dark = format!("{a}(shade=50000)");
    let light = format!("{a}(tint=55000)");
    let (node, node0, venn, node_line, node_text) = match k {
        1 => (
            "r:lt1".to_owned(),
            "r:lt1".to_owned(),
            format!("r:{a}(alpha=50000)"),
            format!("r:{a}"),
            "r:dk1".to_owned(),
        ),
        3 => (
            format!("s:{dark} {light}"),
            format!("r:{dark}"),
            format!("s:{a}(shade=50000,alpha=50000) {a}(tint=55000,alpha=50000)"),
            "r:lt1".to_owned(),
            String::new(),
        ),
        4 => (
            format!("c:{dark} {light}"),
            format!("r:{a}(shade=60000)"),
            format!("c:{a}(shade=80000,alpha=50000) {a}(tint=50000,alpha=50000)"),
            "r:lt1".to_owned(),
            String::new(),
        ),
        5 => (
            format!("s:{a}(alpha=90000) {a}(alpha=40000)"),
            format!("r:{a}(alpha=90000)"),
            format!("s:{a}(alpha=50000) {a}(alpha=20000)"),
            "r:lt1".to_owned(),
            String::new(),
        ),
        _ => (
            format!("r:{a}"),
            format!("r:{a}"),
            format!("r:{a}(alpha=50000)"),
            "r:lt1".to_owned(),
            String::new(),
        ),
    };
    let level = |shade: &str| match k {
        1 => "r:lt1".to_owned(),
        2 => format!("r:{a}"),
        _ => format!("r:{a}({shade})"),
    };
    let trans2d = match k {
        1 => format!("r:{a}(tint=60000)"),
        3 | 4 => format!("c:{a}(shade=90000) {a}(tint=50000)"),
        5 => format!("r:{a}(tint=60000,alpha=60000)"),
        _ => format!("r:{a}(tint=60000)"),
    };
    table(&Palette {
        node,
        node0,
        venn,
        node_line,
        node_text,
        levels: [
            level("shade=80000"),
            level("tint=99000"),
            level("tint=70000"),
        ],
        asst: [
            level("shade=80000"),
            level("shade=80000"),
            level("tint=90000"),
            level("tint=70000"),
            level("tint=50000"),
        ],
        trans2d: trans2d.clone(),
        trans2d_line: trans2d,
        trans1d: format!("r:{a}"),
        par_ch_1d: [
            format!("r:{a}(shade=60000)"),
            format!("r:{a}(shade=60000)"),
            format!("r:{a}(shade=80000)"),
            format!("r:{a}(shade=80000)"),
        ],
        a: a.to_owned(),
        acc_line: format!("r:{a}"),
        follow: format!("r:{a}(alpha=90000,tint=40000)"),
        img: format!("r:{a}(tint=50000)"),
    })
}

/// Colorful: 1 is every accent in turn from accent 2; `n` = 2-5 spans
/// accent `n` to accent `n + 1`.
fn colorful(n: i32) -> HashMap<&'static str, Spec> {
    if n == 1 {
        let all = "r:accent2 accent3 accent4 accent5 accent6".to_owned();
        let mut m = table(&Palette {
            node: all.clone(),
            node0: "r:accent1".into(),
            venn: "r:accent2(alpha=50000) accent3(alpha=50000) accent4(alpha=50000) accent5(alpha=50000) accent6(alpha=50000)".into(),
            node_line: "r:lt1".into(),
            node_text: String::new(),
            levels: ["r:accent2".into(), "r:accent3".into(), "r:accent4".into()],
            asst: [
                "r:accent1".into(),
                "r:accent2".into(),
                "r:accent3".into(),
                "r:accent4".into(),
                "r:accent5".into(),
            ],
            trans2d: all.clone(),
            trans2d_line: "r:lt1".into(),
            trans1d: all.clone(),
            par_ch_1d: [
                "r:accent1".into(),
                "r:accent2".into(),
                "r:accent3".into(),
                "r:accent4".into(),
            ],
            a: "accent2".into(),
            acc_line: all.clone(),
            follow: "r:accent2(tint=40000,alpha=90000) accent3(tint=40000,alpha=90000) accent4(tint=40000,alpha=90000) accent5(tint=40000,alpha=90000) accent6(tint=40000,alpha=90000)".into(),
            img: "r:accent2(tint=50000) accent3(tint=50000) accent4(tint=50000) accent5(tint=50000) accent6(tint=50000)".into(),
        });
        m.insert("alignNode1", spec(&all, &all, ""));
        return m;
    }
    let (p, a, b, c, d) = (
        accent(n - 1),
        accent(n),
        accent(n + 1),
        accent(n + 2),
        accent(n + 3),
    );
    let range = format!("s:{a} {b}");
    let mut m = table(&Palette {
        node: range.clone(),
        node0: format!("r:{p}"),
        venn: format!("s:{a}(alpha=50000) {b}(alpha=50000)"),
        node_line: "r:lt1".into(),
        node_text: String::new(),
        levels: [format!("r:{b}"), format!("r:{c}"), format!("r:{d}")],
        asst: [
            format!("r:{a}"),
            format!("r:{b}"),
            format!("r:{c}"),
            format!("r:{d}"),
            format!("r:{}", accent(n + 4)),
        ],
        trans2d: range.clone(),
        trans2d_line: "r:lt1".into(),
        trans1d: range.clone(),
        par_ch_1d: [
            format!("r:{a}"),
            format!("r:{b}"),
            format!("r:{c}"),
            format!("r:{d}"),
        ],
        a: a.clone(),
        acc_line: range.clone(),
        follow: format!("s:{a}(tint=40000,alpha=90000) {b}(tint=40000,alpha=90000)"),
        img: format!("s:{a}(tint=50000) {b}(tint=50000)"),
    });
    m.insert("alignNode1", spec(&range, &range, ""));
    m.insert("sibTrans1D1", spec("", &range, "r:tx1"));
    m
}

/// The primary theme colors: 1 Dark 1 Outline, 2 Dark 2 Outline, 3 Dark 2 Fill.
fn primary(k: i32) -> HashMap<&'static str, Spec> {
    let (node, line, text, a) = match k {
        1 => ("r:lt1", "r:dk1", "r:dk1", "dk1"),
        2 => ("r:lt1", "r:dk2", "r:dk2", "dk2"),
        _ => ("r:dk2", "r:lt2", "r:lt2", "dk2"),
    };
    table(&Palette {
        node: node.into(),
        node0: node.into(),
        venn: format!("{node}(alpha=50000)"),
        node_line: line.into(),
        node_text: text.into(),
        levels: [node.into(), node.into(), node.into()],
        asst: [
            node.into(),
            node.into(),
            node.into(),
            node.into(),
            node.into(),
        ],
        trans2d: format!("r:{a}(tint=60000)"),
        trans2d_line: format!("r:{a}(tint=60000)"),
        trans1d: format!("r:{a}"),
        par_ch_1d: [
            format!("r:{a}"),
            format!("r:{a}"),
            format!("r:{a}"),
            format!("r:{a}"),
        ],
        a: a.into(),
        acc_line: format!("r:{a}"),
        follow: format!("r:{a}(alpha=90000,tint=40000)"),
        img: format!("r:{a}(tint=50000)"),
    })
}
