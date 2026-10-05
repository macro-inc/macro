//! SmartArt styles (`dgm:styleDef`, PowerPoint's SmartArt Styles gallery):
//! which theme line, fill, and effect each style label uses, and its text
//! color.

use super::catalog::{STYLE_PREFIX, StyleInfo, find_style};
use super::data::{A_URI, DGM_URI};
use crate::xml::{Ns, XmlDoc};
use std::collections::HashMap;

/// The theme style references of one label.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Refs {
    /// `lnRef` index (0 = no line).
    pub line: u32,
    /// `fillRef` index (0 = no fill).
    pub fill: u32,
    /// `effectRef` index (0 = no effect).
    pub effect: u32,
    /// The `fontRef` color (`lt1`...), as a scheme color name.
    pub font: Option<String>,
}

/// A parsed style definition.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct StyleDef {
    labels: HashMap<String, Refs>,
}

impl StyleDef {
    /// Reads a `dgm:styleDef` part.
    pub fn parse(doc: &XmlDoc) -> Self {
        let mut labels = HashMap::new();
        for s in doc.children_named(doc.root(), Ns::DGM, "styleLbl") {
            let (Some(name), Some(style)) = (doc.attr(s, "name"), doc.child(s, Ns::DGM, "style"))
            else {
                continue;
            };
            let idx = |local: &str| {
                doc.child(style, Ns::A, local)
                    .and_then(|r| doc.attr_i64(r, "idx"))
                    .unwrap_or(0)
                    .clamp(0, 9999) as u32
            };
            let font = doc
                .child(style, Ns::A, "fontRef")
                .and_then(|f| doc.child(f, Ns::A, "schemeClr"))
                .and_then(|c| doc.attr(c, "val"))
                .map(str::to_owned);
            labels.insert(
                name.to_owned(),
                Refs {
                    line: idx("lnRef"),
                    fill: idx("fillRef"),
                    effect: idx("effectRef"),
                    font,
                },
            );
        }
        Self { labels }
    }

    /// The references of a label (`node1`'s when the style lacks it).
    pub fn refs(&self, label: &str) -> Refs {
        self.labels
            .get(label)
            .or_else(|| self.labels.get("node1"))
            .cloned()
            .unwrap_or_else(|| refs_for("simple1", label))
    }
}

/// Labels drawn like nodes (filled, white text in the simple styles).
fn node_like(label: &str) -> bool {
    matches!(
        label,
        "node0"
            | "node1"
            | "node2"
            | "node3"
            | "node4"
            | "asst0"
            | "asst1"
            | "asst2"
            | "asst3"
            | "asst4"
    )
}

/// The references of `label` in a built-in style.
fn refs_for(style: &str, label: &str) -> Refs {
    let r = |line, fill, effect, font: Option<&str>| Refs {
        line,
        fill,
        effect,
        font: font.map(str::to_owned),
    };
    let trans2d = matches!(label, "sibTrans2D1" | "fgSibTrans2D1" | "bgSibTrans2D1");
    let par2d = label.starts_with("parChTrans2D");
    let par1d = label.starts_with("parChTrans1D");
    let img = label.ends_with("ImgPlace1");
    let acc = label.contains("Acc");
    match style {
        "simple3" => match label {
            l if node_like(l) => r(0, 2, 1, Some("dk1")),
            "lnNode1" => r(1, 2, 0, Some("dk1")),
            "vennNode1" => r(0, 2, 0, Some("tx1")),
            "alignNode1" => r(1, 2, 1, Some("dk1")),
            _ if img => r(1, 1, 1, None),
            _ if trans2d => r(0, 2, 1, Some("dk1")),
            "sibTrans1D1" => r(1, 0, 0, None),
            "callout" => r(1, 2, 1, None),
            _ if par2d => r(1, 2, 1, Some("dk1")),
            _ if par1d => r(2, 0, 0, None),
            "solidFgAcc1" => r(1, 2, 0, None),
            _ if acc => r(1, 1, 0, None),
            "bgShp" | "dkBgShp" => r(0, 1, 1, None),
            "trBgShp" => r(0, 1, 0, None),
            "fgShp" => r(1, 2, 1, None),
            _ => r(0, 0, 0, None),
        },
        "simple4" => match label {
            l if node_like(l) => r(0, 3, 2, Some("lt1")),
            "lnNode1" | "alignNode1" => r(1, 3, 2, Some("lt1")),
            "vennNode1" => r(0, 3, 0, Some("tx1")),
            _ if img => r(0, 1, 2, None),
            _ if trans2d => r(0, 3, 2, Some("lt1")),
            "sibTrans1D1" => r(1, 0, 0, None),
            "callout" => r(2, 1, 1, None),
            "parChTrans2D1" | "parChTrans2D2" => r(0, 3, 2, Some("lt1")),
            _ if par2d => r(1, 3, 2, Some("lt1")),
            _ if par1d => r(1, 0, 0, None),
            _ if acc => r(1, 1, 0, None),
            "bgShp" | "dkBgShp" => r(0, 1, 2, None),
            "trBgShp" => r(0, 1, 0, None),
            "fgShp" => r(0, 3, 2, None),
            _ => r(0, 0, 0, None),
        },
        "simple5" => match label {
            l if node_like(l) => r(0, 3, 3, Some("lt1")),
            "lnNode1" => r(0, 3, 3, Some("lt1")),
            "vennNode1" => r(0, 3, 3, Some("tx1")),
            "alignNode1" => r(1, 3, 3, Some("lt1")),
            _ if img => r(0, 1, 3, None),
            _ if trans2d || par2d => r(0, 3, 3, Some("lt1")),
            "sibTrans1D1" => r(1, 0, 0, None),
            "callout" => r(1, 0, 1, None),
            _ if par1d => r(2, 0, 0, None),
            "trAlignAcc1" => r(1, 1, 0, None),
            "solidAlignAcc1" | "solidBgAcc1" => r(1, 1, 3, None),
            _ if acc => r(1, 1, 2, None),
            "bgShp" => r(0, 1, 2, None),
            "dkBgShp" => r(0, 1, 3, None),
            "trBgShp" => r(0, 1, 0, None),
            "fgShp" => r(0, 3, 3, None),
            _ => r(0, 0, 0, None),
        },
        // simple1 (Simple Fill) and simple2 (White Outline, a heavier line).
        _ => {
            let node_line = if style == "simple2" { 3 } else { 2 };
            match label {
                l if node_like(l) || matches!(l, "lnNode1" | "alignNode1") => {
                    r(node_line, 1, 0, Some("lt1"))
                }
                _ if par2d => r(node_line, 1, 0, Some("lt1")),
                "vennNode1" => r(node_line, 1, 0, Some("tx1")),
                _ if trans2d => r(0, 1, 0, Some("lt1")),
                "sibTrans1D1" => r(1, 0, 0, None),
                _ if par1d => r(2, 0, 0, None),
                "trAlignAcc1" => r(1, 1, 0, None),
                "bgShp" | "dkBgShp" | "trBgShp" => r(0, 1, 0, None),
                "revTx" => r(0, 0, 0, None),
                _ => r(2, 1, 0, None),
            }
        }
    }
}

/// Labels a style definition lists, in PowerPoint's order.
const LABELS: &[&str] = &[
    "node0",
    "lnNode1",
    "vennNode1",
    "alignNode1",
    "node1",
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

const FLAT_SCENE: &str = "<dgm:scene3d><a:camera prst=\"orthographicFront\"/><a:lightRig rig=\"threePt\" dir=\"t\"/></dgm:scene3d>";

/// The XML of a built-in style, by id, short id, or name.
pub(crate) fn builtin_xml(key: &str) -> Option<(StyleInfo, String)> {
    let info = *find_style(key)?;
    let mut s = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<dgm:styleDef xmlns:dgm=\"{DGM_URI}\" xmlns:a=\"{A_URI}\" uniqueId=\"{STYLE_PREFIX}{}\"><dgm:title val=\"\"/><dgm:desc val=\"\"/><dgm:catLst><dgm:cat type=\"simple\" pri=\"{}\"/></dgm:catLst>{FLAT_SCENE}",
        info.short,
        10100 + 100 * style_index(info.short)
    );
    for label in LABELS {
        let refs = refs_for(info.short, label);
        let bevel = info.short == "simple3"
            && (node_like(label) || matches!(*label, "lnNode1" | "vennNode1" | "fgShp"));
        let (scene, sp3d) = if bevel {
            (
                "<dgm:scene3d><a:camera prst=\"orthographicFront\"/><a:lightRig rig=\"flat\" dir=\"t\"/></dgm:scene3d>",
                "<dgm:sp3d prstMaterial=\"dkEdge\"><a:bevelT w=\"8200\" h=\"38100\"/></dgm:sp3d>",
            )
        } else {
            (FLAT_SCENE, "<dgm:sp3d/>")
        };
        let font = match &refs.font {
            Some(c) => format!("<a:fontRef idx=\"minor\"><a:schemeClr val=\"{c}\"/></a:fontRef>"),
            None => "<a:fontRef idx=\"minor\"/>".to_owned(),
        };
        let black = "<a:scrgbClr r=\"0\" g=\"0\" b=\"0\"/>";
        s.push_str(&format!(
            "<dgm:styleLbl name=\"{label}\">{scene}{sp3d}<dgm:txPr/><dgm:style><a:lnRef idx=\"{}\">{black}</a:lnRef><a:fillRef idx=\"{}\">{black}</a:fillRef><a:effectRef idx=\"{}\">{black}</a:effectRef>{font}</dgm:style></dgm:styleLbl>",
            refs.line, refs.fill, refs.effect
        ));
    }
    s.push_str("</dgm:styleDef>");
    Some((info, s))
}

fn style_index(short: &str) -> usize {
    super::catalog::STYLES
        .iter()
        .position(|s| s.short == short)
        .unwrap_or(0)
}
