//! Decks and timing markup as PowerPoint writes it.

use super::*;

const P14: &str = "http://schemas.microsoft.com/office/powerpoint/2010/main";

fn para(text: &str) -> String {
    format!("<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>{text}</a:t></a:r></a:p>")
}

fn rect(id: u32, x: i64, y: i64, text: Option<&str>) -> String {
    let body = text
        .map(|t| format!("<p:txBody><a:bodyPr/><a:lstStyle/>{}</p:txBody>", para(t)))
        .unwrap_or_default();
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="Rectangle {id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></p:spPr>{body}</p:sp>"#
    )
}

/// The shapes of every test slide: 2 a text box with three paragraphs, 3 a
/// rectangle with text, 4 one without, 5 a group of 6 and 7.
pub(super) fn shapes() -> String {
    let text = text_box(
        2,
        0,
        0,
        3_000_000,
        1_500_000,
        &[para("One"), para("Two"), para("Three")].concat(),
    );
    let group = format!(
        r#"<p:grpSp><p:nvGrpSpPr><p:cNvPr id="5" name="Group 4"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="3000000"/><a:ext cx="3000000" cy="1000000"/><a:chOff x="0" y="3000000"/><a:chExt cx="3000000" cy="1000000"/></a:xfrm></p:grpSpPr>{}{}</p:grpSp>"#,
        rect(6, 0, 3_000_000, None),
        rect(7, 2_000_000, 3_000_000, None)
    );
    [
        text,
        rect(3, 4_000_000, 0, Some("Box")),
        rect(4, 6_000_000, 0, None),
        group,
    ]
    .concat()
}

/// A deck whose slides have [`shapes`] and end with the given markup
/// after `p:clrMapOvr` (a timing, or nothing).
pub(super) fn deck_with_timings(tails: &[&str]) -> Presentation {
    let shapes = shapes();
    let slides: Vec<&str> = tails.iter().map(|_| shapes.as_str()).collect();
    let mut package = crate::opc::Package::open(deck(&slides)).unwrap();
    for (i, tail) in tails.iter().enumerate() {
        let name = format!("/ppt/slides/slide{}.xml", i + 1);
        let xml = String::from_utf8(package.read(&name).unwrap().into_owned()).unwrap();
        let xml = xml
            .replace(
                &format!("<p:sld {NS}>"),
                &format!("<p:sld {NS} xmlns:p14=\"{P14}\">"),
            )
            .replace(
                "</p:clrMapOvr></p:sld>",
                &format!("</p:clrMapOvr>{tail}</p:sld>"),
            );
        package.write(&name, xml.into_bytes(), None);
    }
    Presentation::open(package.save().unwrap()).unwrap()
}

/// The empty timing PowerPoint writes for slides without animations.
pub(super) const EMPTY_TIMING: &str = r#"<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"/></p:par></p:tnLst></p:timing>"#;

const SEQ_CONDS: &str = r#"<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>"#;

/// Click 1: shape 3 fades in; after it, shape 2 flies in from the left
/// (250 ms delay) while shape 3 spins counterclockwise twice. Click 2:
/// shape 2 fades out.
pub(super) const MAIN_SEQUENCE: &str = concat!(
    r#"<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>"#,
    // Click group 1.
    r#"<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>"#,
    r#"<p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>"#,
    r#"<p:par><p:cTn id="5" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>"#,
    r#"<p:set><p:cBhvr><p:cTn id="6" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="3"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>"#,
    r#"<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="7" dur="500"/><p:tgtEl><p:spTgt spid="3"/></p:tgtEl></p:cBhvr></p:animEffect>"#,
    r#"</p:childTnLst></p:cTn></p:par>"#,
    r#"</p:childTnLst></p:cTn></p:par>"#,
    r#"<p:par><p:cTn id="8" fill="hold"><p:stCondLst><p:cond delay="500"/></p:stCondLst><p:childTnLst>"#,
    r#"<p:par><p:cTn id="9" presetID="2" presetClass="entr" presetSubtype="8" fill="hold" grpId="0" nodeType="afterEffect"><p:stCondLst><p:cond delay="250"/></p:stCondLst><p:childTnLst>"#,
    r#"<p:set><p:cBhvr><p:cTn id="10" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="2"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>"#,
    r##"<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="11" dur="500" fill="hold"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl><p:attrNameLst><p:attrName>ppt_x</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="0-#ppt_w/2"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#ppt_x"/></p:val></p:tav></p:tavLst></p:anim>"##,
    r##"<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="12" dur="500" fill="hold"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl><p:attrNameLst><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="#ppt_y"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#ppt_y"/></p:val></p:tav></p:tavLst></p:anim>"##,
    r#"</p:childTnLst></p:cTn></p:par>"#,
    r#"<p:par><p:cTn id="13" presetID="8" presetClass="emph" presetSubtype="0" repeatCount="2000" fill="hold" grpId="1" nodeType="withEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>"#,
    r#"<p:animRot by="-21600000"><p:cBhvr><p:cTn id="14" dur="2000" fill="hold"/><p:tgtEl><p:spTgt spid="3"/></p:tgtEl><p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>"#,
    r#"</p:childTnLst></p:cTn></p:par>"#,
    r#"</p:childTnLst></p:cTn></p:par>"#,
    r#"</p:childTnLst></p:cTn></p:par>"#,
    // Click group 2.
    r#"<p:par><p:cTn id="15" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>"#,
    r#"<p:par><p:cTn id="16" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>"#,
    r#"<p:par><p:cTn id="17" presetID="10" presetClass="exit" presetSubtype="0" fill="hold" grpId="1" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>"#,
    r#"<p:animEffect transition="out" filter="fade"><p:cBhvr><p:cTn id="18" dur="500"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cBhvr></p:animEffect>"#,
    r#"<p:set><p:cBhvr><p:cTn id="19" dur="1" fill="hold"><p:stCondLst><p:cond delay="499"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="2"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="hidden"/></p:to></p:set>"#,
    r#"</p:childTnLst></p:cTn></p:par>"#,
    r#"</p:childTnLst></p:cTn></p:par>"#,
    r#"</p:childTnLst></p:cTn></p:par>"#,
    r#"</p:childTnLst></p:cTn>"#,
    r#"<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>"#,
    r#"</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>"#,
    r#"<p:bldLst><p:bldP spid="3" grpId="0" animBg="1"/><p:bldP spid="2" grpId="0"/><p:bldP spid="3" grpId="1" animBg="1"/><p:bldP spid="2" grpId="1"/></p:bldLst></p:timing>"#
);

fn target(spid: u32, paragraph: Option<u32>) -> String {
    match paragraph {
        Some(p) => format!(
            r#"<p:tgtEl><p:spTgt spid="{spid}"><p:txEl><p:pRg st="{p}" end="{p}"/></p:txEl></p:spTgt></p:tgtEl>"#
        ),
        None => format!(r#"<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>"#),
    }
}

fn show(tgt: &str) -> String {
    format!(
        r#"<p:set><p:cBhvr><p:cTn id="0" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>{tgt}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>"#
    )
}

/// An effect `p:par` (`extra` = more attributes of its time node).
fn effect(head: &str, extra: &str, node: &str, behaviors: &str) -> String {
    format!(
        r#"<p:par><p:cTn id="0" {head}{extra} fill="hold" nodeType="{node}"><p:stCondLst><p:cond delay="0"/></p:stCondLst>{}<p:childTnLst>{behaviors}</p:childTnLst></p:cTn></p:par>"#,
        if extra.contains("indefinite") {
            r#"<p:endCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:endCondLst>"#
        } else {
            ""
        }
    )
}

fn group(delay: &str, children: &str) -> String {
    format!(
        r#"<p:par><p:cTn id="0" fill="hold"><p:stCondLst><p:cond delay="{delay}"/></p:stCondLst><p:childTnLst>{children}</p:childTnLst></p:cTn></p:par>"#
    )
}

fn fade_in(spid: u32, paragraph: Option<u32>, node: &str) -> String {
    let t = target(spid, paragraph);
    effect(
        r#"presetID="10" presetClass="entr" presetSubtype="0""#,
        r#" grpId="0""#,
        node,
        &format!(
            r#"{}<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="0" dur="500"/>{t}</p:cBhvr></p:animEffect>"#,
            show(&t)
        ),
    )
}

/// Shape 2's paragraphs 0 and 1 fade in on clicks; on the second click
/// group member 6 wipes in after them as shape 4 boomerangs in; then shape
/// 3 moves down until the next click, then a custom preset. Clicking shape
/// 4 pulses shape 3 (a trigger sequence).
pub(super) fn paragraph_build() -> String {
    let t6 = target(6, None);
    let wipe = effect(
        r#"presetID="22" presetClass="entr" presetSubtype="4""#,
        r#" grpId="0""#,
        "afterEffect",
        &format!(
            r#"{}<p:animEffect transition="in" filter="wipe(up)"><p:cBhvr><p:cTn id="0" dur="500"/>{t6}</p:cBhvr></p:animEffect>"#,
            show(&t6)
        ),
    );
    let t4 = target(4, None);
    let boomerang = effect(
        r#"presetID="25" presetClass="entr" presetSubtype="0""#,
        r#" grpId="0""#,
        "withEffect",
        &format!(
            r##"{}<p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="0" dur="500" decel="50000" fill="hold"/>{t4}<p:attrNameLst><p:attrName>ppt_x</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="#ppt_x+.4"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#ppt_x"/></p:val></p:tav></p:tavLst></p:anim>"##,
            show(&t4)
        ),
    );
    let t3 = target(3, None);
    let path = effect(
        r#"presetID="42" presetClass="path" presetSubtype="0""#,
        r#" repeatCount="indefinite" grpId="0""#,
        "clickEffect",
        &format!(
            r#"<p:animMotion origin="layout" path="M 0 0 L 0 0.25 E" pathEditMode="relative" rAng="0" ptsTypes="AA"><p:cBhvr><p:cTn id="0" dur="2000" fill="hold"/>{t3}<p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr><p:rCtr x="0" y="12500"/></p:animMotion>"#
        ),
    );
    let custom = effect(
        r#"presetID="99" presetClass="entr" presetSubtype="0""#,
        r#" grpId="1""#,
        "clickEffect",
        &format!(
            r#"{}<p:animEffect transition="in" filter="dissolve"><p:cBhvr><p:cTn id="0" dur="700"/>{t3}</p:cBhvr></p:animEffect>"#,
            show(&t3)
        ),
    );
    let pulse = effect(
        r#"presetID="26" presetClass="emph" presetSubtype="0""#,
        r#" grpId="5""#,
        "clickEffect",
        &format!(
            r#"<p:animScale><p:cBhvr><p:cTn id="0" dur="250" autoRev="1" fill="hold"/>{t3}</p:cBhvr><p:by x="105000" y="105000"/></p:animScale>"#
        ),
    );
    let main = [
        group(
            "indefinite",
            &group("0", &fade_in(2, Some(0), "clickEffect")),
        ),
        group(
            "indefinite",
            &[
                group("0", &fade_in(2, Some(1), "clickEffect")),
                group("500", &[wipe, boomerang].concat()),
            ]
            .concat(),
        ),
        group("indefinite", &group("0", &path)),
        group("indefinite", &group("0", &custom)),
    ]
    .concat();
    let trigger = format!(
        r#"<p:seq concurrent="1" nextAc="seek"><p:cTn id="0" restart="whenNotActive" fill="hold" evtFilter="cancelBubble" nodeType="interactiveSeq"><p:stCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="4"/></p:tgtEl></p:cond></p:stCondLst><p:endSync evt="end" delay="0"><p:rtn val="all"/></p:endSync><p:childTnLst>{}</p:childTnLst></p:cTn><p:nextCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="4"/></p:tgtEl></p:cond></p:nextCondLst></p:seq>"#,
        group("indefinite", &group("0", &pulse))
    );
    let timing = format!(
        r#"<p:timing><p:tnLst><p:par><p:cTn id="0" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="0" dur="indefinite" nodeType="mainSeq"><p:childTnLst>{main}</p:childTnLst></p:cTn>{SEQ_CONDS}</p:seq>{trigger}</p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst><p:bldP spid="2" grpId="0" build="p"/><p:bldP spid="3" grpId="0" animBg="1"/><p:bldP spid="3" grpId="1" animBg="1"/><p:bldP spid="3" grpId="5" animBg="1"/></p:bldLst></p:timing>"#
    );
    // Number the time nodes as PowerPoint does.
    let mut out = String::new();
    let mut next = 1;
    for (i, piece) in timing.split(r#"<p:cTn id="0""#).enumerate() {
        if i > 0 {
            out.push_str(&format!(r#"<p:cTn id="{next}""#));
            next += 1;
        }
        out.push_str(piece);
    }
    out
}
