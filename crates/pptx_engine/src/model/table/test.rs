use super::*;
use crate::model::presentation::Presentation;
use crate::model::shape::{Graphic, Inherit, ShapeKind, WalkCtx, resolve_tree, sp_tree};
use crate::test_support::deck;

fn table_xml(style: &str, flags: &str, rows: &str) -> String {
    format!(
        r#"<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table 3"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="1110000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr {flags}><a:tableStyleId>{style}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="1828800"/><a:gridCol w="1828800"/></a:tblGrid>{rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#
    )
}

fn cell(text: &str, attrs: &str, tcpr: &str) -> String {
    format!(r#"<a:tc {attrs}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>{text}</a:t></a:r></a:p></a:txBody><a:tcPr {tcpr}/></a:tc>"#)
}

fn resolve(xml: &str) -> Table {
    let mut p = Presentation::open(deck(&[xml])).unwrap();
    let ctx = p.slide_context(0).unwrap();
    let tree = sp_tree(&ctx.slide.doc).unwrap();
    let shapes = resolve_tree(&WalkCtx { ctx: &ctx, inherit: Inherit::Slide }, &ctx.slide, tree);
    let ShapeKind::Frame(Graphic::Table(tbl)) = &shapes[0].kind else { panic!("not a table") };
    let id = ctx.slide.doc.text(ctx.slide.doc.descendants(*tbl).into_iter().find(|&n| ctx.slide.doc.local(n) == "tableStyleId").unwrap());
    let style = find_table_style(&ctx, None, id.trim());
    resolve_table(&ctx, &ctx.slide, *tbl, style.as_ref())
}

#[test]
fn medium_style_2_accent_1_defaults() {
    let rows = format!(
        "<a:tr h=\"370840\">{}{}</a:tr><a:tr h=\"370840\">{}{}</a:tr><a:tr h=\"370840\">{}{}</a:tr>",
        cell("Metric", "", ""),
        cell("FY24", "", ""),
        cell("Revenue", "", ""),
        cell("$1,234", "", ""),
        cell("Margin", "", ""),
        cell("23%", "", "")
    );
    let t = resolve(&table_xml("{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}", "firstRow=\"1\" bandRow=\"1\"", &rows));
    assert_eq!(t.cols, vec![144.0, 144.0]);
    let accent1 = Rgba::from_hex("4472C4").unwrap();
    assert_eq!(t.rows[0].cells[0].fill, Fill::Solid(accent1), "header row is accent1");
    let head = &t.rows[0].cells[0].text.as_ref().unwrap().paragraphs[0].runs[0].props;
    assert!(head.bold);
    assert_eq!(head.fill, Fill::Solid(Rgba::WHITE));
    // Row 1 is band1H (tint 40%), row 2 band2H falls back to the whole table (tint 20%).
    let (Fill::Solid(b1), Fill::Solid(b2)) = (&t.rows[1].cells[0].fill, &t.rows[2].cells[0].fill) else { panic!() };
    assert!(b1.r < b2.r, "band1 is darker than band2");
    let body = &t.rows[1].cells[0].text.as_ref().unwrap().paragraphs[0].runs[0].props;
    assert!(!body.bold);
    assert_eq!(body.fill, Fill::Solid(Rgba::BLACK));
    // Header bottom border is the thick white line; inside borders are 1pt white.
    let bottom = t.rows[0].cells[0].border(Edge::Bottom).unwrap().resolve().unwrap();
    assert_eq!(bottom.width, 3.0);
    let inner = t.rows[1].cells[0].border(Edge::Right).unwrap().resolve().unwrap();
    assert_eq!(inner.width, 1.0);
}

#[test]
fn direct_cell_properties_and_merges() {
    let rows = format!(
        "<a:tr h=\"370840\">{}{}</a:tr><a:tr h=\"370840\">{}{}</a:tr>",
        cell("Merged", "gridSpan=\"2\"", "anchor=\"ctr\" marL=\"0\""),
        cell("", "hMerge=\"1\"", ""),
        cell("A", "", ""),
        format!(r#"<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" b="1"/><a:t>B</a:t></a:r></a:p></a:txBody><a:tcPr><a:lnR w="25400"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:lnR><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:tcPr></a:tc>"#)
    );
    let t = resolve(&table_xml("{2D5ABB26-0587-4C30-8999-92F81FD0307C}", "", &rows));
    let m = &t.rows[0].cells[0];
    assert_eq!(m.grid_span, 2);
    assert!(t.rows[0].cells[1].h_merge);
    assert_eq!(m.anchor, Anchor::Middle);
    assert_eq!(m.margins[0], 0.0);
    let b = &t.rows[1].cells[1];
    assert_eq!(b.fill, Fill::Solid(Rgba::from_hex("00FF00").unwrap()));
    let right = b.border(Edge::Right).unwrap().resolve().unwrap();
    assert_eq!(right.width, 2.0);
    assert!(b.text.as_ref().unwrap().paragraphs[0].runs[0].props.bold);
}

#[test]
fn every_builtin_style_parses() {
    for (id, _, _) in super::super::table_style::STYLES_FOR_TEST {
        let xml = super::super::table_style::builtin_style_xml(id).unwrap();
        XmlDoc::parse(xml.as_bytes(), "s").unwrap();
    }
}
