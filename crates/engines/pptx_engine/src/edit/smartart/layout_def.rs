//! Layout definitions (`dgm:layoutDef`) for the layouts the engine lays
//! out, written from the DrawingML diagram schema: the layout node tree
//! (algorithms, shapes, constraints, and rules) PowerPoint runs to arrange
//! the nodes, which a package must carry next to each diagram.

use super::catalog::{Kind, LayoutInfo};
use super::data::{A_URI, DGM_URI};
use crate::xml::STANDARD_DECLARATION;

const R_URI: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// A layout node: `name`, optional style label, and its content.
fn node(name: &str, style: Option<&str>, body: &str) -> String {
    match style {
        Some(s) => {
            format!("<dgm:layoutNode name=\"{name}\" styleLbl=\"{s}\">{body}</dgm:layoutNode>")
        }
        None => format!("<dgm:layoutNode name=\"{name}\">{body}</dgm:layoutNode>"),
    }
}

/// An algorithm with parameters.
fn alg(ty: &str, params: &[(&str, &str)]) -> String {
    if params.is_empty() {
        return format!("<dgm:alg type=\"{ty}\"/>");
    }
    let p: String = params
        .iter()
        .map(|(t, v)| format!("<dgm:param type=\"{t}\" val=\"{v}\"/>"))
        .collect();
    format!("<dgm:alg type=\"{ty}\">{p}</dgm:alg>")
}

/// A shape (`None`: no geometry), with adjust values.
fn shape(ty: Option<&str>, extra: &str, adj: &[(u32, &str)]) -> String {
    let ty = ty.map(|t| format!(" type=\"{t}\"")).unwrap_or_default();
    let adj: String = adj
        .iter()
        .map(|(i, v)| format!("<dgm:adj idx=\"{i}\" val=\"{v}\"/>"))
        .collect();
    format!("<dgm:shape{ty}{extra} r:blip=\"\"><dgm:adjLst>{adj}</dgm:adjLst></dgm:shape>")
}

/// `presOf` (attributes as written, `""` for none).
fn pres_of(attrs: &str) -> String {
    format!("<dgm:presOf{attrs}/>")
}

/// A constraint list from attribute strings.
fn constrs(items: &[&str]) -> String {
    if items.is_empty() {
        return "<dgm:constrLst/>".to_owned();
    }
    let c: String = items.iter().map(|a| format!("<dgm:constr {a}/>")).collect();
    format!("<dgm:constrLst>{c}</dgm:constrLst>")
}

/// A rule list from attribute strings.
fn rules(items: &[&str]) -> String {
    if items.is_empty() {
        return "<dgm:ruleLst/>".to_owned();
    }
    let c: String = items
        .iter()
        .map(|a| format!("<dgm:rule {a} fact=\"NaN\" max=\"NaN\"/>"))
        .collect();
    format!("<dgm:ruleLst>{c}</dgm:ruleLst>")
}

/// A variable list (children in schema order).
fn vars(items: &[&str]) -> String {
    format!("<dgm:varLst>{}</dgm:varLst>", items.concat())
}

/// A `forEach`.
fn for_each(name: &str, attrs: &str, body: &str) -> String {
    format!("<dgm:forEach name=\"{name}\" {attrs}>{body}</dgm:forEach>")
}

/// `dir`-dependent algorithms: `norm` then reversed.
fn by_dir(name: &str, norm: &str, rev: &str) -> String {
    format!(
        "<dgm:choose name=\"{name}\"><dgm:if name=\"{name}a\" func=\"var\" arg=\"dir\" op=\"equ\" val=\"norm\">{norm}</dgm:if><dgm:else name=\"{name}b\">{rev}</dgm:else></dgm:choose>"
    )
}

/// The four text margins as a factor of the font size.
fn margins(f: &str) -> [String; 4] {
    ["lMarg", "rMarg", "tMarg", "bMarg"]
        .map(|m| format!("type=\"{m}\" refType=\"primFontSz\" fact=\"{f}\""))
}

/// A text node: a shape showing `presOf` text, margins at `margin` × font size.
fn text_node(
    name: &str,
    style: Option<&str>,
    geom: &str,
    adj: &[(u32, &str)],
    presof: &str,
    margin: &str,
    extra_constrs: &[&str],
) -> String {
    let m = margins(margin);
    let mut c: Vec<&str> = m.iter().map(String::as_str).collect();
    c.extend_from_slice(extra_constrs);
    node(
        name,
        style,
        &format!(
            "{}{}{}{}{}{}",
            vars(&["<dgm:bulletEnabled val=\"1\"/>"]),
            alg("tx", &[]),
            shape(Some(geom), "", adj),
            pres_of(presof),
            constrs(&c),
            rules(&["type=\"primFontSz\" val=\"5\""])
        ),
    )
}

/// A spacer between nodes (the sibling transition).
fn spacer(name: &str) -> String {
    for_each(
        &format!("{name}Each"),
        "axis=\"followSib\" ptType=\"sibTrans\" cnt=\"1\"",
        &node(
            name,
            None,
            &format!(
                "{}{}{}{}{}",
                alg("sp", &[]),
                shape(None, "", &[]),
                pres_of(""),
                constrs(&[]),
                rules(&[])
            ),
        ),
    )
}

/// A connector arrow on the sibling transition with its own text.
fn sib_arrow(style: &str, height_fact: &str) -> String {
    let text = node(
        "connectorText",
        None,
        &format!(
            "{}{}{}{}{}",
            alg("tx", &[("autoTxRot", "grav")]),
            shape(Some("conn"), " hideGeom=\"1\" lkTxEntry=\"1\"", &[]),
            pres_of(" axis=\"self\""),
            constrs(&[
                "type=\"lMarg\"",
                "type=\"rMarg\"",
                "type=\"tMarg\"",
                "type=\"bMarg\"",
            ]),
            rules(&[])
        ),
    );
    for_each(
        "sibTransEach",
        "axis=\"followSib\" ptType=\"sibTrans\" cnt=\"1\"",
        &node(
            "sibTrans",
            Some(style),
            &format!(
                "{}{}{}{}{}{}",
                alg("conn", &[]),
                shape(Some("conn"), "", &[]),
                pres_of(" axis=\"self\""),
                constrs(&[
                    &format!("type=\"h\" refType=\"w\" fact=\"{height_fact}\""),
                    "type=\"connDist\"",
                    "type=\"begPad\" refType=\"connDist\" fact=\"0.25\"",
                    "type=\"endPad\" refType=\"connDist\" fact=\"0.22\"",
                ]),
                rules(&[]),
                text
            ),
        ),
    )
}

/// Sample data: `count` top-level nodes, each with `children` children.
fn sample(count: usize, children: usize) -> String {
    let mut pts = String::from("<dgm:pt modelId=\"0\" type=\"doc\"/>");
    let mut cxns = String::new();
    let mut next = 100;
    for i in 1..=count {
        pts.push_str(&format!(
            "<dgm:pt modelId=\"{i}\"><dgm:prSet phldr=\"1\"/></dgm:pt>"
        ));
        cxns.push_str(&format!(
            "<dgm:cxn modelId=\"{}\" srcId=\"0\" destId=\"{i}\" srcOrd=\"{}\" destOrd=\"0\"/>",
            next,
            i - 1
        ));
        next += 1;
        for k in 1..=children {
            let id = i * 10 + k;
            pts.push_str(&format!(
                "<dgm:pt modelId=\"{id}\"><dgm:prSet phldr=\"1\"/></dgm:pt>"
            ));
            cxns.push_str(&format!(
                "<dgm:cxn modelId=\"{next}\" srcId=\"{i}\" destId=\"{id}\" srcOrd=\"{}\" destOrd=\"0\"/>",
                k - 1
            ));
            next += 1;
        }
    }
    format!(
        "<dgm:dataModel><dgm:ptLst>{pts}</dgm:ptLst><dgm:cxnLst>{cxns}</dgm:cxnLst><dgm:bg/><dgm:whole/></dgm:dataModel>"
    )
}

/// The `dgm:layoutDef` XML of a supported layout.
pub(crate) fn xml(info: &LayoutInfo) -> String {
    let kind = info.kind.unwrap_or(Kind::BlockList);
    let cats: String = info
        .categories
        .iter()
        .enumerate()
        .map(|(i, c)| format!("<dgm:cat type=\"{c}\" pri=\"{}\"/>", (i + 1) * 1000))
        .collect();
    let (samp, style_data, clr_data) = match kind {
        Kind::VerticalBullets => (sample(2, 1), sample(2, 0), sample(4, 0)),
        Kind::HorizontalBullets => (sample(3, 2), sample(2, 0), sample(4, 0)),
        Kind::Radial | Kind::Hierarchy | Kind::OrgChart => {
            (sample(1, 4), sample(1, 2), sample(1, 4))
        }
        Kind::BlockList | Kind::Cycle => (sample(5, 0), sample(2, 0), sample(6, 0)),
        _ => (sample(3, 0), sample(2, 0), sample(6, 0)),
    };
    let body = match kind {
        Kind::BlockList => block_list(),
        Kind::VerticalBullets => vertical_bullets(),
        Kind::HorizontalBullets => horizontal_bullets(),
        Kind::Process => process(),
        Kind::Chevron => chevron(),
        Kind::Cycle => cycle(),
        Kind::Radial => radial(),
        Kind::Venn => venn(),
        Kind::Pyramid => pyramid(),
        Kind::Hierarchy => hierarchy(false),
        Kind::OrgChart => hierarchy(true),
    };
    format!(
        "{STANDARD_DECLARATION}<dgm:layoutDef xmlns:dgm=\"{DGM_URI}\" xmlns:a=\"{A_URI}\" xmlns:r=\"{R_URI}\" uniqueId=\"{}\"><dgm:title val=\"\"/><dgm:desc val=\"\"/><dgm:catLst>{cats}</dgm:catLst><dgm:sampData>{samp}</dgm:sampData><dgm:styleData>{style_data}</dgm:styleData><dgm:clrData>{clr_data}</dgm:clrData>{body}</dgm:layoutDef>",
        info.id()
    )
}

/// The root node's usual variables (`extra` goes between `dir` and
/// `resizeHandles`, where `animOne` and `animLvl` belong).
fn root_vars(extra: &[&str]) -> String {
    let mut v: Vec<&str> = vec!["<dgm:dir/>"];
    v.extend_from_slice(extra);
    v.push("<dgm:resizeHandles val=\"exact\"/>");
    vars(&v)
}

fn block_list() -> String {
    let inner = format!(
        "{}{}",
        text_node(
            "node",
            None,
            "rect",
            &[],
            " axis=\"desOrSelf\" ptType=\"node\"",
            "0.3",
            &[]
        ),
        spacer("sibTrans")
    );
    node(
        "diagram",
        None,
        &format!(
            "{}{}{}{}{}{}{}",
            root_vars(&[]),
            by_dir(
                "Name0",
                &alg(
                    "snake",
                    &[
                        ("grDir", "tL"),
                        ("flowDir", "row"),
                        ("contDir", "sameDir"),
                        ("off", "ctr")
                    ]
                ),
                &alg(
                    "snake",
                    &[
                        ("grDir", "tR"),
                        ("flowDir", "row"),
                        ("contDir", "sameDir"),
                        ("off", "ctr")
                    ]
                ),
            ),
            shape(None, "", &[]),
            pres_of(""),
            constrs(&[
                "type=\"w\" for=\"ch\" forName=\"node\" refType=\"w\"",
                "type=\"h\" for=\"ch\" forName=\"node\" refType=\"w\" refFor=\"ch\" refForName=\"node\" fact=\"0.6\"",
                "type=\"w\" for=\"ch\" forName=\"sibTrans\" refType=\"w\" refFor=\"ch\" refForName=\"node\" fact=\"0.1\"",
                "type=\"sp\" refType=\"w\" refFor=\"ch\" refForName=\"sibTrans\"",
                "type=\"primFontSz\" for=\"ch\" forName=\"node\" op=\"equ\" val=\"65\"",
            ]),
            rules(&[]),
            for_each("Name1", "axis=\"ch\" ptType=\"node\"", &inner)
        ),
    )
}

fn vertical_bullets() -> String {
    let parent = node(
        "parentText",
        Some("node1"),
        &format!(
            "{}{}{}{}{}{}",
            vars(&["<dgm:chMax val=\"0\"/>", "<dgm:bulletEnabled val=\"1\"/>"]),
            alg("tx", &[("parTxLTRAlign", "l"), ("parTxRTLAlign", "r")]),
            shape(Some("roundRect"), "", &[]),
            pres_of(" axis=\"self\""),
            constrs(
                &margins("0.3")
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>()
            ),
            rules(&["type=\"h\" val=\"INF\""])
        ),
    );
    let child = node(
        "childText",
        Some("revTx"),
        &format!(
            "{}{}{}{}{}{}",
            vars(&["<dgm:bulletEnabled val=\"1\"/>"]),
            alg("tx", &[("stBulletLvl", "1"), ("lnSpAfChP", "20")]),
            shape(Some("rect"), "", &[]),
            pres_of(" axis=\"des\" ptType=\"node\""),
            constrs(&[
                "type=\"tMarg\" refType=\"primFontSz\" fact=\"0.1\"",
                "type=\"bMarg\" refType=\"primFontSz\" fact=\"0.1\"",
                "type=\"lMarg\" refType=\"w\" fact=\"0.09\"",
            ]),
            rules(&["type=\"h\" val=\"INF\""])
        ),
    );
    let after = format!(
        "<dgm:choose name=\"Name1\"><dgm:if name=\"Name2\" axis=\"ch\" ptType=\"node\" func=\"cnt\" op=\"gte\" val=\"1\">{child}</dgm:if><dgm:else name=\"Name3\"><dgm:choose name=\"Name4\"><dgm:if name=\"Name5\" axis=\"par ch\" ptType=\"doc node\" func=\"cnt\" op=\"gte\" val=\"2\">{}</dgm:if><dgm:else name=\"Name6\"/></dgm:choose></dgm:else></dgm:choose>",
        spacer("spacer")
    );
    node(
        "linear",
        None,
        &format!(
            "{}{}{}{}{}{}{}",
            vars(&[
                "<dgm:animLvl val=\"lvl\"/>",
                "<dgm:resizeHandles val=\"exact\"/>"
            ]),
            alg("lin", &[("linDir", "fromT"), ("vertAlign", "mid")]),
            shape(None, "", &[]),
            pres_of(""),
            constrs(&[
                "type=\"w\" for=\"ch\" forName=\"parentText\" refType=\"w\"",
                "type=\"h\" for=\"ch\" forName=\"parentText\" refType=\"primFontSz\" refFor=\"ch\" refForName=\"parentText\" fact=\"0.52\"",
                "type=\"w\" for=\"ch\" forName=\"childText\" refType=\"w\"",
                "type=\"h\" for=\"ch\" forName=\"childText\" refType=\"primFontSz\" refFor=\"ch\" refForName=\"parentText\" fact=\"0.46\"",
                "type=\"h\" for=\"ch\" forName=\"parentText\" op=\"equ\"",
                "type=\"primFontSz\" for=\"ch\" forName=\"parentText\" op=\"equ\" val=\"65\"",
                "type=\"primFontSz\" for=\"ch\" forName=\"childText\" refType=\"primFontSz\" refFor=\"ch\" refForName=\"parentText\" op=\"equ\"",
                "type=\"h\" for=\"ch\" forName=\"spacer\" refType=\"primFontSz\" refFor=\"ch\" refForName=\"parentText\" fact=\"0.08\"",
            ]),
            rules(&["type=\"primFontSz\" for=\"ch\" forName=\"parentText\" val=\"5\""]),
            for_each(
                "Name0",
                "axis=\"ch\" ptType=\"node\"",
                &format!("{parent}{after}")
            )
        ),
    )
}

fn horizontal_bullets() -> String {
    let par = node(
        "parTx",
        Some("alignNode1"),
        &format!(
            "{}{}{}{}{}{}",
            vars(&[
                "<dgm:chMax val=\"0\"/>",
                "<dgm:chPref val=\"0\"/>",
                "<dgm:bulletEnabled val=\"1\"/>"
            ]),
            alg("tx", &[]),
            shape(Some("rect"), "", &[]),
            pres_of(" axis=\"self\" ptType=\"node\""),
            constrs(&[
                "type=\"h\" refType=\"w\" op=\"lte\" fact=\"0.4\"",
                "type=\"h\"",
                "type=\"tMarg\" refType=\"primFontSz\" fact=\"0.32\"",
                "type=\"bMarg\" refType=\"primFontSz\" fact=\"0.32\"",
            ]),
            rules(&["type=\"h\" val=\"INF\""])
        ),
    );
    let des = node(
        "desTx",
        Some("alignAccFollowNode1"),
        &format!(
            "{}{}{}{}{}{}",
            vars(&["<dgm:bulletEnabled val=\"1\"/>"]),
            alg("tx", &[("stBulletLvl", "1")]),
            shape(Some("rect"), "", &[]),
            pres_of(" axis=\"des\" ptType=\"node\""),
            constrs(&[
                "type=\"secFontSz\" val=\"65\"",
                "type=\"primFontSz\" refType=\"secFontSz\"",
                "type=\"h\"",
                "type=\"lMarg\" refType=\"primFontSz\" fact=\"0.42\"",
                "type=\"tMarg\" refType=\"primFontSz\" fact=\"0.42\"",
                "type=\"bMarg\" refType=\"primFontSz\" fact=\"0.63\"",
            ]),
            rules(&["type=\"h\" val=\"INF\""])
        ),
    );
    let composite = node(
        "composite",
        None,
        &format!(
            "{}{}{}{}{}{par}{des}",
            alg("composite", &[]),
            shape(None, "", &[]),
            pres_of(""),
            constrs(&[
                "type=\"l\" for=\"ch\" forName=\"parTx\"",
                "type=\"w\" for=\"ch\" forName=\"parTx\" refType=\"w\"",
                "type=\"t\" for=\"ch\" forName=\"parTx\"",
                "type=\"l\" for=\"ch\" forName=\"desTx\"",
                "type=\"w\" for=\"ch\" forName=\"desTx\" refType=\"w\" refFor=\"ch\" refForName=\"parTx\"",
                "type=\"t\" for=\"ch\" forName=\"desTx\" refType=\"h\" refFor=\"ch\" refForName=\"parTx\"",
            ]),
            rules(&["type=\"h\" val=\"INF\""])
        ),
    );
    node(
        "hList",
        None,
        &format!(
            "{}{}{}{}{}{}{}",
            vars(&[
                "<dgm:dir/>",
                "<dgm:animLvl val=\"lvl\"/>",
                "<dgm:resizeHandles val=\"exact\"/>"
            ]),
            by_dir(
                "Name0",
                &alg("lin", &[]),
                &alg("lin", &[("linDir", "fromR")])
            ),
            shape(None, "", &[]),
            pres_of(""),
            constrs(&[
                "type=\"h\" for=\"ch\" forName=\"composite\" refType=\"h\"",
                "type=\"w\" for=\"ch\" forName=\"composite\" refType=\"w\"",
                "type=\"w\" for=\"des\" forName=\"parTx\"",
                "type=\"h\" for=\"des\" forName=\"parTx\" op=\"equ\"",
                "type=\"w\" for=\"des\" forName=\"desTx\"",
                "type=\"h\" for=\"des\" forName=\"desTx\" op=\"equ\"",
                "type=\"primFontSz\" for=\"des\" forName=\"parTx\" val=\"65\"",
                "type=\"secFontSz\" for=\"des\" forName=\"desTx\" refType=\"primFontSz\" refFor=\"des\" refForName=\"parTx\" op=\"equ\"",
                "type=\"h\" for=\"des\" forName=\"parTx\" refType=\"primFontSz\" refFor=\"des\" refForName=\"parTx\" fact=\"0.8\"",
                "type=\"h\" for=\"des\" forName=\"desTx\" refType=\"primFontSz\" refFor=\"des\" refForName=\"parTx\" fact=\"1.22\"",
                "type=\"w\" for=\"ch\" forName=\"space\" refType=\"w\" refFor=\"ch\" refForName=\"composite\" op=\"equ\" fact=\"0.14\"",
            ]),
            rules(&[
                "type=\"w\" for=\"ch\" forName=\"composite\" val=\"0\"",
                "type=\"primFontSz\" for=\"des\" forName=\"parTx\" val=\"5\"",
            ]),
            for_each(
                "Name1",
                "axis=\"ch\" ptType=\"node\"",
                &format!("{composite}{}", spacer("space"))
            )
        ),
    )
}

fn process() -> String {
    let inner = format!(
        "{}{}",
        text_node(
            "node",
            None,
            "roundRect",
            &[(1, "0.1")],
            " axis=\"desOrSelf\" ptType=\"node\"",
            "0.3",
            &[]
        ),
        sib_arrow("sibTrans2D1", "0.62")
    );
    node(
        "Name0",
        None,
        &format!(
            "{}{}{}{}{}{}{}",
            root_vars(&[]),
            by_dir(
                "Name1",
                &alg("lin", &[]),
                &alg("lin", &[("linDir", "fromR")])
            ),
            shape(None, "", &[]),
            pres_of(""),
            constrs(&[
                "type=\"w\" for=\"ch\" forName=\"node\" refType=\"w\"",
                "type=\"h\" for=\"ch\" forName=\"node\" refType=\"w\" refFor=\"ch\" refForName=\"node\" fact=\"0.6\"",
                "type=\"w\" for=\"ch\" forName=\"sibTrans\" refType=\"w\" refFor=\"ch\" refForName=\"node\" fact=\"0.4\"",
                "type=\"primFontSz\" for=\"ch\" forName=\"node\" op=\"equ\" val=\"65\"",
                "type=\"primFontSz\" for=\"des\" forName=\"connectorText\" op=\"equ\" val=\"55\"",
                "type=\"primFontSz\" for=\"des\" forName=\"connectorText\" refType=\"primFontSz\" refFor=\"ch\" refForName=\"node\" op=\"lte\" fact=\"0.8\"",
            ]),
            rules(&[]),
            for_each("Name2", "axis=\"ch\" ptType=\"node\"", &inner)
        ),
    )
}

fn chevron() -> String {
    let inner = format!(
        "{}{}",
        text_node(
            "parTxOnly",
            None,
            "chevron",
            &[],
            " axis=\"desOrSelf\" ptType=\"node\"",
            "0.1",
            &[]
        ),
        spacer("parTxOnlySpace")
    );
    node(
        "Name0",
        None,
        &format!(
            "{}{}{}{}{}{}{}",
            root_vars(&["<dgm:animLvl val=\"lvl\"/>"]),
            by_dir(
                "Name1",
                &alg("lin", &[]),
                &alg("lin", &[("linDir", "fromR")])
            ),
            shape(None, "", &[]),
            pres_of(""),
            constrs(&[
                "type=\"w\" for=\"ch\" forName=\"parTxOnly\" refType=\"w\"",
                "type=\"h\" for=\"ch\" forName=\"parTxOnly\" refType=\"w\" refFor=\"ch\" refForName=\"parTxOnly\" fact=\"0.4\"",
                "type=\"w\" for=\"ch\" forName=\"parTxOnlySpace\" refType=\"w\" refFor=\"ch\" refForName=\"parTxOnly\" fact=\"-0.1\"",
                "type=\"primFontSz\" for=\"ch\" forName=\"parTxOnly\" op=\"equ\" val=\"65\"",
            ]),
            rules(&[]),
            for_each("Name2", "axis=\"ch\" ptType=\"node\"", &inner)
        ),
    )
}

fn cycle() -> String {
    let inner = format!(
        "{}{}",
        text_node(
            "node",
            None,
            "ellipse",
            &[],
            " axis=\"desOrSelf\" ptType=\"node\"",
            "0.1",
            &[]
        ),
        sib_arrow("sibTrans2D1", "0.6")
    );
    node(
        "cycle",
        None,
        &format!(
            "{}{}{}{}{}{}{}",
            root_vars(&[]),
            by_dir(
                "Name0",
                &alg("cycle", &[("stAng", "0"), ("spanAng", "360")]),
                &alg("cycle", &[("stAng", "0"), ("spanAng", "-360")]),
            ),
            shape(None, "", &[]),
            pres_of(""),
            constrs(&[
                "type=\"w\" for=\"ch\" forName=\"node\" refType=\"w\"",
                "type=\"h\" for=\"ch\" forName=\"node\" refType=\"w\" refFor=\"ch\" refForName=\"node\"",
                "type=\"w\" for=\"ch\" forName=\"sibTrans\" refType=\"w\" refFor=\"ch\" refForName=\"node\" fact=\"0.4\"",
                "type=\"sp\" refType=\"w\" refFor=\"ch\" refForName=\"node\" fact=\"0.3\"",
                "type=\"primFontSz\" for=\"ch\" forName=\"node\" op=\"equ\" val=\"65\"",
                "type=\"primFontSz\" for=\"des\" forName=\"connectorText\" op=\"equ\" val=\"55\"",
                "type=\"primFontSz\" for=\"des\" forName=\"connectorText\" refType=\"primFontSz\" refFor=\"ch\" refForName=\"node\" op=\"lte\" fact=\"0.8\"",
            ]),
            rules(&[]),
            for_each("Name1", "axis=\"ch\" ptType=\"node\"", &inner)
        ),
    )
}

fn radial() -> String {
    let spoke = for_each(
        "Name3",
        "axis=\"precedSib\" ptType=\"parTrans\" st=\"-1\" cnt=\"1\"",
        &node(
            "parTrans",
            Some("parChTrans1D2"),
            &format!(
                "{}{}{}{}{}",
                alg(
                    "conn",
                    &[
                        ("dim", "1D"),
                        ("begPts", "auto"),
                        ("endPts", "auto"),
                        ("endSty", "noArr")
                    ]
                ),
                shape(Some("conn"), "", &[]),
                pres_of(" axis=\"self\""),
                constrs(&["type=\"begPad\"", "type=\"endPad\""]),
                rules(&[])
            ),
        ),
    );
    let child = text_node(
        "node",
        None,
        "ellipse",
        &[],
        " axis=\"desOrSelf\" ptType=\"node\"",
        "0.1",
        &[],
    );
    let center = text_node(
        "centerShape",
        Some("node0"),
        "ellipse",
        &[],
        " axis=\"self\"",
        "0.1",
        &[],
    );
    let body = format!(
        "{center}{}",
        for_each(
            "Name2",
            "axis=\"ch\" ptType=\"node\"",
            &format!("{spoke}{child}")
        )
    );
    node(
        "Name0",
        None,
        &format!(
            "{}{}{}{}{}{}{}",
            vars(&[
                "<dgm:chMax val=\"1\"/>",
                "<dgm:chPref val=\"1\"/>",
                "<dgm:dir/>",
                "<dgm:animLvl val=\"ctr\"/>",
                "<dgm:resizeHandles val=\"exact\"/>"
            ]),
            by_dir(
                "Name4",
                &alg(
                    "cycle",
                    &[("stAng", "0"), ("spanAng", "360"), ("ctrShpMap", "fNode")]
                ),
                &alg(
                    "cycle",
                    &[("stAng", "0"), ("spanAng", "-360"), ("ctrShpMap", "fNode")]
                ),
            ),
            shape(None, "", &[]),
            pres_of(""),
            constrs(&[
                "type=\"w\" for=\"ch\" forName=\"centerShape\" refType=\"w\"",
                "type=\"h\" for=\"ch\" forName=\"centerShape\" refType=\"w\" refFor=\"ch\" refForName=\"centerShape\"",
                "type=\"w\" for=\"ch\" forName=\"node\" refType=\"w\" refFor=\"ch\" refForName=\"centerShape\" fact=\"0.74\"",
                "type=\"h\" for=\"ch\" forName=\"node\" refType=\"w\" refFor=\"ch\" refForName=\"node\"",
                "type=\"sp\" refType=\"w\" refFor=\"ch\" refForName=\"centerShape\" fact=\"0.25\"",
                "type=\"primFontSz\" for=\"ch\" forName=\"centerShape\" op=\"equ\" val=\"65\"",
                "type=\"primFontSz\" for=\"ch\" forName=\"node\" refType=\"primFontSz\" refFor=\"ch\" refForName=\"centerShape\" op=\"equ\"",
            ]),
            rules(&[]),
            for_each("Name1", "axis=\"ch\" ptType=\"node\" cnt=\"1\"", &body)
        ),
    )
}

fn venn() -> String {
    let inner = text_node(
        "circ",
        Some("vennNode1"),
        "ellipse",
        &[],
        " axis=\"desOrSelf\" ptType=\"node\"",
        "0.1",
        &[],
    );
    node(
        "Name0",
        None,
        &format!(
            "{}{}{}{}{}{}{}",
            root_vars(&["<dgm:animLvl val=\"lvl\"/>"]),
            by_dir(
                "Name1",
                &alg("cycle", &[("stAng", "0"), ("spanAng", "360")]),
                &alg("cycle", &[("stAng", "0"), ("spanAng", "-360")]),
            ),
            shape(None, "", &[]),
            pres_of(""),
            constrs(&[
                "type=\"w\" for=\"ch\" forName=\"circ\" refType=\"w\"",
                "type=\"h\" for=\"ch\" forName=\"circ\" refType=\"w\" refFor=\"ch\" refForName=\"circ\"",
                "type=\"sp\" refType=\"w\" refFor=\"ch\" refForName=\"circ\" fact=\"-0.4\"",
                "type=\"primFontSz\" for=\"ch\" forName=\"circ\" op=\"equ\" val=\"65\"",
            ]),
            rules(&[]),
            for_each("Name2", "axis=\"ch\" ptType=\"node\"", &inner)
        ),
    )
}

fn pyramid() -> String {
    let inner = text_node(
        "Name2",
        None,
        "trapezoid",
        &[(1, "0.5")],
        " axis=\"desOrSelf\" ptType=\"node\"",
        "0.1",
        &[],
    );
    node(
        "Name0",
        None,
        &format!(
            "{}{}{}{}{}{}{}",
            root_vars(&["<dgm:animLvl val=\"lvl\"/>"]),
            by_dir(
                "Name3",
                &alg(
                    "pyra",
                    &[
                        ("linDir", "fromT"),
                        ("txDir", "fromT"),
                        ("pyraAcctPos", "aft")
                    ]
                ),
                &alg(
                    "pyra",
                    &[
                        ("linDir", "fromB"),
                        ("txDir", "fromT"),
                        ("pyraAcctPos", "aft")
                    ]
                ),
            ),
            shape(None, "", &[]),
            pres_of(""),
            constrs(&[
                "type=\"w\" for=\"ch\" forName=\"Name2\" refType=\"w\"",
                "type=\"h\" for=\"ch\" forName=\"Name2\" refType=\"h\"",
                "type=\"primFontSz\" for=\"ch\" forName=\"Name2\" op=\"equ\" val=\"65\"",
            ]),
            rules(&[]),
            for_each("Name1", "axis=\"ch\" ptType=\"node\"", &inner)
        ),
    )
}

/// Hierarchy (`hierarchy1`) and Organization Chart (`orgChart1`): a tree of
/// `hierRoot` / `hierChild` algorithms, recursive through a named `forEach`.
fn hierarchy(org: bool) -> String {
    let (geom, adj, ratio, root_style): (&str, &[(u32, &str)], &str, Option<&str>) = if org {
        ("rect", &[], "0.5", Some("node0"))
    } else {
        ("roundRect", &[(1, "0.1")], "0.67", None)
    };
    let connector = for_each(
        "Name5",
        "axis=\"precedSib\" ptType=\"parTrans\" st=\"-1\" cnt=\"1\"",
        &node(
            "Name6",
            None,
            &format!(
                "{}{}{}{}{}",
                alg(
                    "conn",
                    &[
                        ("connRout", "bend"),
                        ("dim", "1D"),
                        ("endSty", "noArr"),
                        ("begPts", "bCtr"),
                        ("endPts", "tCtr"),
                        ("bendPt", "end"),
                    ]
                ),
                shape(Some("conn"), "", &[]),
                pres_of(" axis=\"self\""),
                constrs(&["type=\"begPad\"", "type=\"endPad\""]),
                rules(&[])
            ),
        ),
    );
    let text = |name: &str, style: Option<&str>| {
        node(
            name,
            style,
            &format!(
                "{}{}{}{}{}{}",
                vars(&["<dgm:chPref val=\"3\"/>"]),
                alg("tx", &[]),
                shape(Some(geom), "", adj),
                pres_of(" axis=\"self\""),
                constrs(&[
                    "type=\"primFontSz\" val=\"65\"",
                    "type=\"lMarg\" refType=\"primFontSz\" fact=\"0.05\"",
                    "type=\"rMarg\" refType=\"primFontSz\" fact=\"0.05\"",
                    "type=\"tMarg\" refType=\"primFontSz\" fact=\"0.05\"",
                    "type=\"bMarg\" refType=\"primFontSz\" fact=\"0.05\"",
                ]),
                rules(&["type=\"primFontSz\" val=\"5\""])
            ),
        )
    };
    let composite = |name: &str, text_name: &str, style: Option<&str>| {
        node(
            name,
            None,
            &format!(
                "{}{}{}{}{}{}",
                alg("composite", &[]),
                shape(None, "", &[]),
                pres_of(""),
                constrs(&[
                    &format!("type=\"l\" for=\"ch\" forName=\"{text_name}\""),
                    &format!("type=\"t\" for=\"ch\" forName=\"{text_name}\""),
                    &format!("type=\"w\" for=\"ch\" forName=\"{text_name}\" refType=\"w\""),
                    &format!("type=\"h\" for=\"ch\" forName=\"{text_name}\" refType=\"h\""),
                ]),
                rules(&[]),
                text(text_name, style)
            ),
        )
    };
    let child_alg = alg("hierChild", &[]);
    let hier_root = |name: &str, comp: &str, children: &str| {
        node(
            name,
            None,
            &format!(
                "{}{}{}{}{}{}{}",
                alg("hierRoot", &[]),
                shape(None, "", &[]),
                pres_of(""),
                constrs(&[
                    "type=\"bendDist\" for=\"des\" ptType=\"parTrans\" refType=\"sp\" fact=\"0.5\""
                ]),
                rules(&[]),
                comp,
                children
            ),
        )
    };
    let child_box = |name: &str| {
        node(
            name,
            None,
            &format!(
                "{child_alg}{}{}{}{}",
                shape(None, "", &[]),
                pres_of(""),
                constrs(&[]),
                rules(&[])
            ),
        )
    };
    // Level 2 and below: each child with its connector, recursing.
    let recurse_children = node(
        "hierChild4",
        None,
        &format!(
            "{child_alg}{}{}{}{}{}",
            shape(None, "", &[]),
            pres_of(""),
            constrs(&[]),
            rules(&[]),
            for_each("Name7", "ref=\"rep2a\"", "")
        ),
    );
    let level2 = for_each(
        "rep2a",
        &format!(
            "axis=\"ch\" ptType=\"{}\"",
            if org { "nonAsst" } else { "node" }
        ),
        &format!(
            "{connector}{}",
            hier_root(
                "hierRoot2",
                &composite("rootComposite", "rootText", None),
                &recurse_children
            )
        ),
    );
    let assistants = if org {
        node(
            "hierChild3",
            None,
            &format!(
                "{child_alg}{}{}{}{}{}",
                shape(None, "", &[]),
                pres_of(""),
                constrs(&[]),
                rules(&[]),
                for_each(
                    "Name8",
                    "axis=\"ch\" ptType=\"asst\"",
                    &format!(
                        "{connector}{}",
                        hier_root(
                            "hierRoot3",
                            &composite("rootComposite3", "rootText3", None),
                            &child_box("hierChild6")
                        )
                    )
                )
            ),
        )
    } else {
        String::new()
    };
    let top_children = node(
        "hierChild2",
        None,
        &format!(
            "{child_alg}{}{}{}{}{level2}",
            shape(None, "", &[]),
            pres_of(""),
            constrs(&[]),
            rules(&[])
        ),
    );
    let top = for_each(
        "Name2",
        "axis=\"ch\" ptType=\"node\"",
        &hier_root(
            "hierRoot1",
            &composite("rootComposite1", "rootText1", root_style),
            &format!("{top_children}{assistants}"),
        ),
    );
    let mut root_vars_list = vec![
        "<dgm:chPref val=\"1\"/>",
        "<dgm:dir/>",
        "<dgm:animOne val=\"branch\"/>",
        "<dgm:animLvl val=\"lvl\"/>",
        "<dgm:resizeHandles/>",
    ];
    if org {
        root_vars_list.insert(0, "<dgm:orgChart val=\"1\"/>");
    }
    node(
        "hierChild1",
        None,
        &format!(
            "{}{}{}{}{}{}{top}",
            vars(&root_vars_list),
            by_dir(
                "Name0",
                &child_alg,
                &alg("hierChild", &[("linDir", "fromR")])
            ),
            shape(None, "", &[]),
            pres_of(""),
            constrs(&[
                "type=\"w\" for=\"des\" forName=\"rootComposite1\" refType=\"w\" fact=\"10\"",
                &format!(
                    "type=\"h\" for=\"des\" forName=\"rootComposite1\" refType=\"w\" refFor=\"des\" refForName=\"rootComposite1\" fact=\"{ratio}\""
                ),
                "type=\"w\" for=\"des\" forName=\"rootComposite\" refType=\"w\" refFor=\"des\" refForName=\"rootComposite1\"",
                "type=\"h\" for=\"des\" forName=\"rootComposite\" refType=\"h\" refFor=\"des\" refForName=\"rootComposite1\"",
                "type=\"w\" for=\"des\" forName=\"rootComposite3\" refType=\"w\" refFor=\"des\" refForName=\"rootComposite1\"",
                "type=\"h\" for=\"des\" forName=\"rootComposite3\" refType=\"h\" refFor=\"des\" refForName=\"rootComposite1\"",
                "type=\"primFontSz\" for=\"des\" ptType=\"node\" op=\"equ\"",
                "type=\"sp\" for=\"des\" op=\"equ\"",
                "type=\"sp\" for=\"des\" forName=\"hierRoot1\" refType=\"w\" refFor=\"des\" refForName=\"rootComposite1\" fact=\"0.35\"",
                "type=\"sibSp\" refType=\"w\" refFor=\"des\" refForName=\"rootComposite1\" fact=\"0.21\"",
                "type=\"sibSp\" for=\"des\" forName=\"hierChild2\" refType=\"sibSp\"",
                "type=\"sibSp\" for=\"des\" forName=\"hierChild4\" refType=\"sibSp\"",
            ]),
            rules(&[])
        ),
    )
}
