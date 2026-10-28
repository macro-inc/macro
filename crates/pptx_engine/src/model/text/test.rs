use super::*;
use crate::model::presentation::Presentation;
use crate::model::shape::{ShapeKind, WalkCtx, resolve_tree, sp_tree};
use crate::test_support::{deck, text_box};

fn body(xml: &str) -> TextBody {
    let sp = text_box(2, 0, 0, 2540000, 1270000, xml);
    let mut p = Presentation::open(deck(&[&sp])).unwrap();
    let ctx = p.slide_context(0).unwrap();
    let tree = sp_tree(&ctx.slide.doc).unwrap();
    let w = WalkCtx {
        ctx: &ctx,
        inherit: Inherit::Slide,
    };
    let shapes = resolve_tree(&w, &ctx.slide, tree);
    assert!(matches!(shapes[0].kind, ShapeKind::Shape));
    shapes[0].text.clone().unwrap()
}

#[test]
fn runs_breaks_fields_and_links() {
    let t = body(
        r#"<a:p><a:r><a:rPr lang="en-US" i="1" u="sng" baseline="30000" spc="100"/><a:t>a</a:t></a:r><a:br><a:rPr lang="en-US"/></a:br><a:fld id="{1}" type="slidenum"><a:rPr lang="en-US"/><a:t>&lt;#&gt;</a:t></a:fld><a:r><a:rPr lang="en-US"><a:hlinkClick r:id="rId1"/></a:rPr><a:t>link</a:t></a:r></a:p>"#,
    );
    let p = &t.paragraphs[0];
    assert_eq!(p.text(), "a\n1link");
    let r0 = &p.runs[0].props;
    assert!(r0.italic);
    assert_eq!(r0.underline, Underline::Single);
    assert_eq!(r0.baseline, 0.3);
    assert_eq!(r0.spacing, 1.0);
    assert_eq!(p.runs[2].kind, RunKind::Field("slidenum".into()));
    let link = &p.runs[3];
    assert_eq!(
        link.props.fill,
        Fill::Solid(Rgba::from_hex("0563C1").unwrap()),
        "hyperlinks use the hlink color"
    );
    assert_eq!(link.props.underline, Underline::Single);
}

/// The text of the first paragraph of a two-slide deck's second slide,
/// with `first` as the deck's first slide number and `clock` set.
fn fields_text(first: Option<u32>, clock: Option<crate::model::field::FieldTime>) -> String {
    let xml = r#"<a:p><a:fld id="{1}" type="slidenum"><a:rPr lang="en-US"/><a:t>9</a:t></a:fld><a:r><a:rPr lang="en-US"/><a:t> | </a:t></a:r><a:fld id="{2}" type="datetime4"><a:rPr lang="en-US"/><a:t>March 1, 2019</a:t></a:fld></a:p>"#;
    let sp = text_box(2, 0, 0, 2540000, 1270000, xml);
    let mut bytes = deck(&[&sp, &sp]);
    if let Some(first) = first {
        let mut pkg = crate::opc::Package::open(bytes).unwrap();
        let main = String::from_utf8(pkg.read("/ppt/presentation.xml").unwrap().into_owned())
            .unwrap()
            .replace(
                "<p:presentation ",
                &format!("<p:presentation firstSlideNum=\"{first}\" "),
            );
        pkg.write("/ppt/presentation.xml", main.into_bytes(), None);
        bytes = pkg.save().unwrap();
    }
    let mut p = Presentation::open(bytes).unwrap();
    p.set_clock(clock);
    let ctx = p.slide_context(1).unwrap();
    let tree = sp_tree(&ctx.slide.doc).unwrap();
    let w = WalkCtx {
        ctx: &ctx,
        inherit: Inherit::Slide,
    };
    resolve_tree(&w, &ctx.slide, tree)[0]
        .text
        .as_ref()
        .unwrap()
        .paragraphs[0]
        .text()
}

#[test]
fn slide_numbers_and_dates_resolve_per_slide() {
    // Without a clock, dates show their cached text.
    assert_eq!(fields_text(None, None), "2 | March 1, 2019");
    // Numbering starts at the deck's first slide number.
    assert_eq!(fields_text(Some(0), None), "1 | March 1, 2019");
    assert_eq!(fields_text(Some(10), None), "11 | March 1, 2019");
    let now = crate::model::field::FieldTime {
        year: 2026,
        month: 10,
        day: 4,
        hour: 18,
        minute: 30,
        second: 0,
    };
    assert_eq!(fields_text(None, Some(now)), "2 | October 4, 2026");
}

#[test]
fn body_properties_and_autofit() {
    let sp = r#"<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="12700" anchor="b" anchorCtr="1" vert="vert270" numCol="2" spcCol="91440"><a:normAutofit fontScale="62500" lnSpcReduction="20000"/></a:bodyPr><a:lstStyle/><a:p><a:endParaRPr lang="en-US" sz="1200"/></a:p></p:txBody></p:sp>"#;
    let mut p = Presentation::open(deck(&[sp])).unwrap();
    let ctx = p.slide_context(0).unwrap();
    let tree = sp_tree(&ctx.slide.doc).unwrap();
    let shapes = resolve_tree(
        &WalkCtx {
            ctx: &ctx,
            inherit: Inherit::Slide,
        },
        &ctx.slide,
        tree,
    );
    let t = shapes[0].text.as_ref().unwrap();
    let b = &t.body;
    assert!(!b.wrap);
    assert_eq!(b.insets, [0.0, 1.0, 7.2, 3.6]);
    assert_eq!(b.anchor, Anchor::Bottom);
    assert!(b.anchor_ctr);
    assert_eq!(b.vert, Vert::Vert270);
    assert_eq!((b.num_col, b.spc_col), (2, 7.2));
    assert_eq!(
        b.autofit,
        Autofit::Normal {
            font_scale: 0.625,
            line_reduction: 0.2
        }
    );
    assert_eq!(t.paragraphs[0].end_props.size, 12.0);
    assert!(t.is_empty());
}

#[test]
fn list_style_levels_and_tabs() {
    let t = body(
        r#"<a:p><a:pPr marL="342900" indent="-342900"><a:lnSpc><a:spcPts val="2400"/></a:lnSpc><a:buFont typeface="Wingdings"/><a:buAutoNum type="romanUcPeriod" startAt="3"/><a:tabLst><a:tab pos="914400" algn="r"/></a:tabLst></a:pPr><a:r><a:rPr lang="en-US"/><a:t>x</a:t></a:r></a:p>"#,
    );
    let pp = &t.paragraphs[0].props;
    assert_eq!(pp.mar_l, 27.0);
    assert_eq!(pp.line_spacing, Spacing::Points(24.0));
    assert_eq!(
        pp.bullet.kind,
        BulletKind::AutoNum {
            scheme: "romanUcPeriod".into(),
            start: 3
        }
    );
    assert_eq!(pp.bullet.font.as_deref(), Some("Wingdings"));
    assert_eq!(
        pp.tabs,
        vec![TabStop {
            pos: 72.0,
            align: TabAlign::Right
        }]
    );
    assert_eq!(
        t.paragraphs[0].runs[0].props.latin, "Calibri",
        "+mn-lt via otherStyle"
    );
}

/// Old decks put a bullet in the presentation-wide default style and none in
/// the master title style; titles still show no bullet.
#[test]
fn titles_take_no_bullet_from_the_default_text_style() {
    use crate::opc::Package;
    let title = r#"<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title" idx="4294967295"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="304800" y="152400"/><a:ext cx="8839200" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Build-A-Table</a:t></a:r></a:p></p:txBody></p:sp>"#;
    let note = text_box(
        3,
        0,
        2540000,
        2540000,
        1270000,
        r#"<a:p><a:r><a:rPr lang="en-US"/><a:t>Note</a:t></a:r></a:p>"#,
    );
    let mut pkg = Package::open(deck(&[&format!("{title}{note}")])).unwrap();
    let edit = |pkg: &mut Package, part: &str, from: &str, to: &str| {
        let xml = String::from_utf8(pkg.read(part).unwrap().into_owned()).unwrap();
        assert!(xml.contains(from), "{part}");
        pkg.write(part, xml.replacen(from, to, 1).into_bytes(), None);
    };
    edit(
        &mut pkg,
        "/ppt/presentation.xml",
        r#"<a:lvl1pPr marL="0" algn="l" defTabSz="914400">"#,
        r#"<a:lvl1pPr marL="0" algn="l" defTabSz="914400"><a:buChar char="•"/>"#,
    );
    edit(
        &mut pkg,
        "/ppt/slideMasters/slideMaster1.xml",
        "<a:buNone/>",
        "",
    );
    let mut p = Presentation::open(pkg.save().unwrap()).unwrap();
    let ctx = p.slide_context(0).unwrap();
    let tree = sp_tree(&ctx.slide.doc).unwrap();
    let w = WalkCtx {
        ctx: &ctx,
        inherit: Inherit::Slide,
    };
    let shapes = resolve_tree(&w, &ctx.slide, tree);
    let bullet = |i: usize| {
        shapes[i].text.as_ref().unwrap().paragraphs[0]
            .props
            .bullet
            .kind
            .clone()
    };
    assert_eq!(bullet(0), BulletKind::None, "title");
    assert_eq!(
        bullet(1),
        BulletKind::Char("•".into()),
        "other text keeps the default"
    );
}
