use super::*;
use crate::model::presentation::Presentation;
use crate::test_support::{deck, text_box};

fn shapes(slide: &str) -> (Presentation, Vec<Shape>) {
    let mut p = Presentation::open(deck(&[slide])).unwrap();
    let ctx = p.slide_context(0).unwrap();
    let tree = sp_tree(&ctx.slide.doc).unwrap();
    let w = WalkCtx {
        ctx: &ctx,
        inherit: Inherit::Slide,
    };
    let shapes = resolve_tree(&w, &ctx.slide, tree);
    (p, shapes)
}

#[test]
fn placeholders_inherit_position_from_master() {
    let title = r#"<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Quarterly results</a:t></a:r></a:p></p:txBody></p:sp>"#;
    let (_, shapes) = shapes(title);
    let s = &shapes[0];
    assert_eq!(s.placeholder.as_ref().unwrap().kind, "title");
    assert!(
        (s.xfrm.x - 66.0).abs() < 0.01 && (s.xfrm.w - 828.0).abs() < 0.01,
        "{:?}",
        s.xfrm
    );
    let text = s.text.as_ref().unwrap();
    assert_eq!(
        text.body.anchor,
        crate::model::text::Anchor::Middle,
        "anchor from master"
    );
    let run = &text.paragraphs[0].runs[0];
    assert_eq!(run.props.size, 44.0, "title style size");
    assert_eq!(run.props.latin, "Calibri Light", "+mj-lt resolved");
}

#[test]
fn body_placeholder_levels_and_bullets() {
    let body = r#"<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>One</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:rPr lang="en-US" sz="2000" b="1"/><a:t>Two</a:t></a:r></a:p></p:txBody></p:sp>"#;
    let (_, shapes) = shapes(body);
    let text = shapes[0].text.as_ref().unwrap();
    let p0 = &text.paragraphs[0];
    assert_eq!(
        p0.props.bullet.kind,
        crate::model::text::BulletKind::Char("\u{2022}".into())
    );
    assert_eq!(p0.props.mar_l, 18.0);
    assert_eq!(p0.props.indent, -18.0);
    assert_eq!(p0.runs[0].props.size, 28.0);
    let p1 = &text.paragraphs[1];
    assert_eq!(p1.props.level, 1);
    assert_eq!(p1.props.mar_l, 54.0);
    assert_eq!(p1.runs[0].props.size, 20.0, "direct size wins");
    assert!(p1.runs[0].props.bold);
}

#[test]
fn style_matrix_fill_and_font_ref() {
    let sp = r#"<p:sp><p:nvSpPr><p:cNvPr id="4" name="Rect"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="5400000" flipH="1"><a:off x="12700" y="25400"/><a:ext cx="1270000" cy="635000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst></a:prstGeom></p:spPr><p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="3"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style><p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US"/><a:t>KPI</a:t></a:r></a:p></p:txBody></p:sp>"#;
    let (_, shapes) = shapes(sp);
    let s = &shapes[0];
    assert_eq!(s.fill, Fill::Solid(Rgba::from_hex("ED7D31").unwrap()));
    let line = s.line.resolve().unwrap();
    assert_eq!(line.width, 1.0, "lnRef idx 2 → 12700 EMU");
    assert!(s.effects.outer_shadow.is_some(), "effectRef idx 3");
    assert_eq!((s.xfrm.rot, s.xfrm.flip_h), (90.0, true));
    match &s.geometry {
        GeometryRef::Preset(name, adj) => {
            assert_eq!(name, "roundRect");
            assert_eq!(adj, &vec![("adj".to_owned(), 30000.0)]);
        }
        GeometryRef::Custom(..) => panic!(),
    }
    let run = &s.text.as_ref().unwrap().paragraphs[0].runs[0];
    assert_eq!(
        run.props.fill,
        Fill::Solid(Rgba::WHITE),
        "fontRef color beats otherStyle"
    );
    assert_eq!(run.props.size, 18.0);
}

#[test]
fn groups_and_alternate_content() {
    let grp = format!(
        r#"<p:grpSp><p:nvGrpSpPr><p:cNvPr id="5" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="1270000" y="0"/><a:ext cx="1270000" cy="1270000"/><a:chOff x="0" y="0"/><a:chExt cx="2540000" cy="2540000"/></a:xfrm></p:grpSpPr>{}</p:grpSp><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:v="urn:schemas-microsoft-com:vml" Requires="v">{}</mc:Choice><mc:Fallback>{}</mc:Fallback></mc:AlternateContent>"#,
        text_box(
            6,
            0,
            0,
            2540000,
            2540000,
            "<a:p><a:r><a:t>in group</a:t></a:r></a:p>"
        ),
        text_box(7, 0, 0, 100, 100, "<a:p><a:r><a:t>choice</a:t></a:r></a:p>"),
        text_box(
            8,
            0,
            0,
            100,
            100,
            "<a:p><a:r><a:t>fallback</a:t></a:r></a:p>"
        ),
    );
    let (_, shapes) = shapes(&grp);
    assert_eq!(shapes.len(), 2);
    let ShapeKind::Group(children) = &shapes[0].kind else {
        panic!()
    };
    assert_eq!(children[0].id, 6);
    let to_parent = shapes[0]
        .xfrm
        .local_to_parent()
        .pre_concat(&shapes[0].xfrm.child_to_local());
    let corner = to_parent.apply(crate::path::Point::new(200.0, 200.0));
    assert!(
        (corner.x - 200.0).abs() < 0.01 && (corner.y - 100.0).abs() < 0.01,
        "{corner:?}"
    );
    assert_eq!(shapes[1].text.as_ref().unwrap().text(), "fallback");
}

#[test]
fn background_and_master_shapes_flag() {
    let (mut p, _) = shapes("");
    let ctx = p.slide_context(0).unwrap();
    assert_eq!(background_fill(&ctx), Fill::Solid(Rgba::WHITE));
    assert!(shows_master_shapes(&ctx.slide.doc));
}
