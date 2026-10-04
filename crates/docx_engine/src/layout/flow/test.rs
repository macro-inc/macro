use crate::Document;
use crate::layout::inline::Kind;
use crate::layout::{Item, Layout, PlacedLine, StoryRef};
use crate::test_support::{Parts, docx, fonts};

const ARIAL_10: &str = r#"<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>"#;

const SECTION: &str = r#"<w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>"#;

fn layout(body: &str, parts: &Parts<'_>) -> Layout {
    Document::open(docx(body, parts)).unwrap().layout(fonts())
}

fn lines<'a>(l: &'a Layout, story: &'a StoryRef) -> Vec<&'a PlacedLine> {
    l.pages[0].lines_of(story).collect()
}

fn text(p: &PlacedLine) -> String {
    let l = p.line();
    p.para.inline.clusters[l.start..l.end]
        .iter()
        .filter(|c| matches!(c.kind, Kind::Text | Kind::Space | Kind::Tab))
        .map(|c| if c.kind == Kind::Tab { '\t' } else { c.ch })
        .collect()
}

fn header_part() -> StoryRef {
    StoryRef::Part("/word/header1.xml".into())
}

#[test]
fn paragraphs_with_the_same_borders_share_one_box() {
    let bordered = |t: &str| {
        format!(
            r#"<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="6" w:color="auto"/></w:pBdr></w:pPr><w:r><w:t>{t}</w:t></w:r></w:p>"#
        )
    };
    let body = format!("{}{}", bordered("One"), bordered("Two"));
    let l = layout(
        &body,
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    let rules = l.pages[0]
        .items
        .iter()
        .filter(|i| matches!(i, Item::Rule { y0, y1, .. } if (y0 - y1).abs() < 0.01))
        .count();
    // One top border above the first and one bottom border below the last.
    assert_eq!(rules, 2);
    let ls = lines(&l, &StoryRef::Body);
    let gap = ls[1].y - (ls[0].y + ls[0].line().height);
    assert!(gap.abs() < 0.01, "border space between them: {gap}");
}

#[test]
fn header_frames_float_beside_the_header_text() {
    let header = r#"<w:p><w:pPr><w:framePr w:wrap="around" w:vAnchor="text" w:hAnchor="margin" w:xAlign="right" w:y="1"/><w:jc w:val="right"/></w:pPr><w:r><w:t>7</w:t></w:r></w:p><w:p><w:r><w:t>Header text</w:t></w:r></w:p>"#;
    let body = format!("<w:p><w:r><w:t>Body</w:t></w:r></w:p>{SECTION}");
    let l = layout(
        &body,
        &Parts {
            styles: Some(ARIAL_10),
            header: Some(header),
            ..Parts::default()
        },
    );
    let part = header_part();
    let hs = lines(&l, &part);
    let frame = hs.iter().find(|p| text(p) == "7").expect("frame line");
    let rest = hs.iter().find(|p| text(p) == "Header text").expect("text");
    // The frame takes no room: the text starts at the header distance, on
    // the frame's row, and the frame sits at the right margin.
    assert!((rest.y - 36.0).abs() < 0.01, "{}", rest.y);
    assert!((frame.y - rest.y - 0.05).abs() < 0.01, "{}", frame.y);
    let line = frame.line();
    let right = frame.x + line.left + line.width;
    assert!((right - 540.0).abs() < 1.0, "{right}");
}

#[test]
fn turning_numbering_off_drops_the_list_style_indent() {
    let styles = format!(
        r#"{ARIAL_10}<w:style w:type="paragraph" w:styleId="Bullets"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:ind w:left="924" w:hanging="357"/></w:pPr></w:style>"#
    );
    let numbering = r#"<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="-"/><w:pPr><w:ind w:left="1080" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>"#;
    let body = r#"<w:p><w:pPr><w:pStyle w:val="Bullets"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr></w:pPr><w:r><w:t>Plain</w:t></w:r></w:p>"#;
    let l = layout(
        body,
        &Parts {
            styles: Some(&styles),
            numbering: Some(numbering),
            ..Parts::default()
        },
    );
    let p = lines(&l, &StoryRef::Body)[0];
    assert_eq!(text(p), "Plain");
    assert!(p.line().left.abs() < 0.01, "{}", p.line().left);
}

#[test]
fn check_box_form_fields_show_a_box() {
    let body = r#"<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Check1"/><w:checkBox><w:sizeAuto/><w:default w:val="1"/></w:checkBox></w:ffData></w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> FORMCHECKBOX </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> Yes</w:t></w:r></w:p>"#;
    let l = layout(
        body,
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    let p = lines(&l, &StoryRef::Body)[0];
    assert_eq!(text(p), "\u{2612} Yes");
    let box_ = p
        .para
        .inline
        .clusters
        .iter()
        .find(|c| c.ch == '\u{2612}')
        .unwrap();
    assert!((box_.advance - 10.0).abs() < 0.01, "{}", box_.advance);
}

#[test]
fn header_paragraphs_do_not_take_body_list_labels() {
    let numbering = r#"<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>"#;
    let body = format!(
        r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Item</w:t></w:r></w:p>{SECTION}"#
    );
    let l = layout(
        &body,
        &Parts {
            styles: Some(ARIAL_10),
            numbering: Some(numbering),
            header: Some(r#"<w:p><w:r><w:t>Header</w:t></w:r></w:p>"#),
            ..Parts::default()
        },
    );
    assert_eq!(text(lines(&l, &StoryRef::Body)[0]), "1.\tItem");
    let part = header_part();
    assert_eq!(text(lines(&l, &part)[0]), "Header");
}

/// A one-inch picture anchored to its paragraph with `wrap`.
fn anchored_picture(wrap: &str, offset_emu: i64) -> String {
    format!(
        r#"<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>{offset_emu}</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="914400"/><wp:effectExtent l="0" t="0" r="0" b="0"/>{wrap}<wp:docPr id="1" name="p"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdX"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>"#
    )
}

#[test]
fn top_and_bottom_floats_push_text_below_them() {
    let body = format!(
        "<w:p>{}<w:r><w:t>Beside</w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p>",
        anchored_picture("<wp:wrapTopAndBottom/>", 0)
    );
    let l = layout(
        &body,
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    let ls = lines(&l, &StoryRef::Body);
    // The picture spans 72..144: its paragraph's text goes below it.
    assert!((ls[0].y - 144.0).abs() < 0.01, "{}", ls[0].y);
    // Text that ignores it stays put.
    let body = format!(
        "<w:p>{}<w:r><w:t>Over</w:t></w:r></w:p>",
        anchored_picture("<wp:wrapNone/>", 0)
    );
    let l = layout(
        &body,
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    assert!((lines(&l, &StoryRef::Body)[0].y - 72.0).abs() < 0.01);
}

#[test]
fn text_continues_below_a_band_further_down() {
    // A picture an inch below its paragraph: the paragraph's line stays on
    // top, the next paragraph jumps the band instead of the page.
    let body = format!(
        "<w:p>{}<w:r><w:t>Above</w:t></w:r></w:p><w:p><w:r><w:t>Below</w:t></w:r></w:p>",
        anchored_picture("<wp:wrapTopAndBottom/>", 914400 / 6)
    );
    let l = layout(
        &body,
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    assert_eq!(l.pages.len(), 1);
    let ls = lines(&l, &StoryRef::Body);
    assert!((ls[0].y - 72.0).abs() < 0.01, "{}", ls[0].y);
    assert!((ls[1].y - (72.0 + 12.0 + 72.0)).abs() < 0.01, "{}", ls[1].y);
}

#[test]
fn links_take_their_color_from_their_formatting() {
    use pptx_engine::model::color::Rgba;
    let styles = format!(
        r#"{ARIAL_10}<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0000FF"/><w:u w:val="single"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>"#
    );
    let link = |p_style: &str, r_style: &str| {
        format!(
            r#"<w:p><w:pPr>{p_style}</w:pPr><w:hyperlink w:anchor="x"><w:r><w:rPr>{r_style}</w:rPr><w:t>Link</w:t></w:r></w:hyperlink></w:p>"#
        )
    };
    let body = [
        link("", r#"<w:rStyle w:val="Hyperlink"/>"#),
        link("", ""),
        link(
            r#"<w:pStyle w:val="TOC1"/>"#,
            r#"<w:rStyle w:val="Hyperlink"/>"#,
        ),
    ]
    .concat();
    let l = layout(
        &body,
        &Parts {
            styles: Some(&styles),
            ..Parts::default()
        },
    );
    let colors: Vec<Rgba> = lines(&l, &StoryRef::Body)
        .iter()
        .map(|p| p.para.inline.runs[p.para.inline.clusters[0].run as usize].color)
        .collect();
    // The Hyperlink style's blue; no forced blue without it; table of
    // contents entries keep the entry's own color.
    assert_eq!(colors[0], Rgba::from_u8(0, 0, 0xFF));
    assert_eq!(colors[1], Rgba::BLACK);
    assert_eq!(colors[2], Rgba::BLACK);
}
