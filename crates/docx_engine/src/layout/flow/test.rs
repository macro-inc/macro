use crate::Document;
use crate::layout::inline::Kind;
use crate::layout::{Item, Layout, PlacedLine, StoryRef};
use crate::test_support::{Parts, docx, fonts, shape_paragraph};

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

/// A one-cell table row of `n` paragraphs, preceded by `before` filler
/// paragraphs; `tr` holds row properties.
fn tall_row(before: usize, n: usize, tr: &str) -> String {
    let filler: String = (0..before)
        .map(|i| format!("<w:p><w:r><w:t>Filler {i}</w:t></w:r></w:p>"))
        .collect();
    let cell: String = (0..n)
        .map(|i| format!("<w:p><w:r><w:t>Cell line {i}</w:t></w:r></w:p>"))
        .collect();
    format!(
        r#"{filler}<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:trPr>{tr}</w:trPr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>{cell}</w:tc></w:tr></w:tbl><w:p/>"#
    )
}

fn page_texts(l: &Layout, page: usize) -> Vec<String> {
    l.pages[page]
        .lines_of(&StoryRef::Body)
        .map(text)
        .filter(|t| !t.is_empty())
        .collect()
}

#[test]
fn table_rows_break_across_pages_between_lines() {
    let l = layout(
        &tall_row(40, 30, ""),
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    let first = page_texts(&l, 0);
    let second = page_texts(&l, 1);
    // The row starts below the filler on the first page and goes on.
    assert!(first.iter().any(|t| t == "Cell line 0"), "{first:?}");
    assert!(!first.iter().any(|t| t == "Cell line 29"), "{first:?}");
    assert!(second.iter().any(|t| t == "Cell line 29"), "{second:?}");
    let last_on_first = first.iter().filter(|t| t.starts_with("Cell")).count();
    assert_eq!(
        second.iter().filter(|t| t.starts_with("Cell")).count(),
        30 - last_on_first
    );
}

#[test]
fn rows_that_cannot_split_move_whole() {
    let l = layout(
        &tall_row(40, 30, "<w:cantSplit/>"),
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    assert!(!page_texts(&l, 0).iter().any(|t| t.starts_with("Cell")));
    assert!(page_texts(&l, 1).iter().any(|t| t == "Cell line 0"));
}

#[test]
fn rows_taller_than_a_page_split_instead_of_overflowing() {
    let l = layout(
        &tall_row(0, 120, ""),
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    assert!(l.pages.len() >= 3, "{}", l.pages.len());
    for page in &l.pages {
        for p in page.lines_of(&StoryRef::Body) {
            assert!(p.y + p.line().height <= page.height - 72.0 + 0.5, "{}", p.y);
        }
    }
}

const LETTER: &str = r#"<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>"#;

fn arial_10() -> Parts<'static> {
    Parts {
        styles: Some(ARIAL_10),
        ..Parts::default()
    }
}

#[test]
fn right_to_left_runs_size_lines_by_their_complex_script_size() {
    let para = |rpr: &str| {
        format!(
            r#"<w:p><w:r><w:rPr>{rpr}<w:sz w:val="40"/><w:szCs w:val="20"/></w:rPr><w:t>abc</w:t></w:r></w:p>"#
        )
    };
    let body = format!("{}{}{LETTER}", para("<w:rtl/>"), para(""));
    let l = layout(&body, &arial_10());
    let ls = lines(&l, &StoryRef::Body);
    let (rtl, ltr) = (ls[0].line().height, ls[1].line().height);
    assert!((ltr / rtl - 2.0).abs() < 0.01, "{rtl} {ltr}");
}

/// A two-column table 500pt wide placed by `tblpPr` attributes `pos`, of
/// `rows` rows of `lines` paragraphs.
fn floating_table(pos: &str, rows: usize, lines: usize) -> String {
    let cell = |c: &str, r: usize| -> String {
        (0..lines)
            .map(|i| format!("<w:p><w:r><w:t>{c}{r}.{i}</w:t></w:r></w:p>"))
            .collect()
    };
    let rows: String = (0..rows)
        .map(|r| {
            format!(
                r#"<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc>{}</w:tc><w:tc>{}</w:tc></w:tr>"#,
                cell("A", r),
                cell("B", r)
            )
        })
        .collect();
    format!(
        r#"<w:tbl><w:tblPr><w:tblpPr {pos}/><w:tblW w:w="10000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/><w:gridCol w:w="5000"/></w:tblGrid>{rows}</w:tbl>"#
    )
}

fn find<'a>(l: &'a Layout, page: usize, t: &str) -> &'a PlacedLine {
    l.pages[page]
        .lines_of(&StoryRef::Body)
        .find(|p| text(p) == t)
        .unwrap_or_else(|| panic!("no line {t:?} on page {page}"))
}

#[test]
fn floating_tables_sit_at_their_position() {
    let pos = r#"w:vertAnchor="text" w:horzAnchor="margin" w:tblpXSpec="center" w:tblpY="400" w:bottomFromText="200""#;
    let body = format!(
        "<w:p><w:r><w:t>Before</w:t></w:r></w:p>{}<w:p><w:r><w:t>After</w:t></w:r></w:p>{LETTER}",
        floating_table(pos, 1, 1)
    );
    let l = layout(&body, &arial_10());
    let before = find(&l, 0, "Before");
    let cell = find(&l, 0, "A0.0");
    let after = find(&l, 0, "After");
    // Centered on the 468pt text area, 20pt below the text it follows.
    assert!((cell.x - (72.0 - 16.0 + 5.4)).abs() < 0.1, "{}", cell.x);
    let top = before.y + before.line().height + 20.0;
    assert!((cell.y - top).abs() < 0.1, "{} {top}", cell.y);
    // Text goes on below it, at its distance from text.
    let bottom = cell.y + cell.line().height + 10.0;
    assert!((after.y - bottom).abs() < 0.1, "{} {bottom}", after.y);
}

#[test]
fn page_positioned_floating_tables_go_on_at_the_same_place() {
    let pos = r#"w:vertAnchor="page" w:horzAnchor="page" w:tblpX="1000" w:tblpY="3000""#;
    let body = format!("{}<w:p/>{LETTER}", floating_table(pos, 12, 6));
    let l = layout(&body, &arial_10());
    assert!(l.pages.len() >= 2);
    let first = find(&l, 0, "A0.0");
    assert!((first.y - 150.0).abs() < 0.1, "{}", first.y);
    assert!((first.x - 55.4).abs() < 0.1, "{}", first.x);
    let next = l.pages[1]
        .lines_of(&StoryRef::Body)
        .next()
        .expect("the table goes on");
    assert!((next.y - 150.0).abs() < 0.1, "{}", next.y);
}

#[test]
fn right_to_left_tables_start_at_the_right() {
    let table = r#"<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="4000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>First</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"#;
    let body = format!("{table}<w:p/>{LETTER}");
    let l = layout(&body, &arial_10());
    let first = find(&l, 0, "First");
    let second = find(&l, 0, "Second");
    // The first column is rightmost, the text of its cell ending at the
    // right margin (cell margins of 5.4pt, columns 100pt wide).
    assert!(
        (first.x - 5.4 + 100.0 - 5.4 - 540.0).abs() < 0.1,
        "{}",
        first.x
    );
    assert!((first.x - second.x - 100.0).abs() < 0.1, "{}", second.x);
}

#[test]
fn table_rows_make_room_for_their_borders() {
    let line =
        |side: &str| format!(r#"<w:{side} w:val="single" w:sz="16" w:space="0" w:color="auto"/>"#);
    let row = |t: &str| format!("<w:tr><w:tc><w:p><w:r><w:t>{t}</w:t></w:r></w:p></w:tc></w:tr>");
    let body = format!(
        r#"<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblBorders>{}{}{}</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>{}{}</w:tbl><w:p><w:r><w:t>After</w:t></w:r></w:p>{LETTER}"#,
        line("top"),
        line("insideH"),
        line("bottom"),
        row("One"),
        row("Two"),
    );
    let l = layout(&body, &arial_10());
    let (one, two, after) = (find(&l, 0, "One"), find(&l, 0, "Two"), find(&l, 0, "After"));
    let h = one.line().height;
    // Each row makes room for the 2pt line along its top, the last row for
    // the one along its bottom too.
    assert!((one.y - 74.0).abs() < 0.01, "{}", one.y);
    assert!((two.y - (one.y + h + 2.0)).abs() < 0.01, "{}", two.y);
    assert!((after.y - (two.y + h + 2.0)).abs() < 0.01, "{}", after.y);
}

#[test]
fn frames_in_the_margin_leave_the_text_beside_them() {
    let header = r#"<w:p><w:pPr><w:framePr w:w="400" w:h="400" w:hRule="exact" w:wrap="notBeside" w:vAnchor="text" w:hAnchor="page" w:x="11000" w:y="0"/></w:pPr><w:r><w:t>9</w:t></w:r></w:p><w:p><w:r><w:t>Header text</w:t></w:r></w:p>"#;
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
    let rest = hs.iter().find(|p| text(p) == "Header text").expect("text");
    // The frame is right of the text area: the text stays at the top.
    assert!((rest.y - 36.0).abs() < 0.01, "{}", rest.y);
}

#[test]
fn keeping_with_the_next_paragraph_stops_at_a_page_break() {
    let filler: String = (0..55)
        .map(|i| format!("<w:p><w:r><w:t>Filler {i}</w:t></w:r></w:p>"))
        .collect();
    let body = format!(
        r#"{filler}<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:br w:type="page"/><w:t>Heading</w:t></w:r></w:p><w:p><w:r><w:t>Text</w:t></w:r></w:p>{LETTER}"#
    );
    let l = layout(&body, &arial_10());
    assert_eq!(l.pages.len(), 2);
    assert!(page_texts(&l, 1).iter().any(|t| t == "Heading"));
}

fn drawing_rects(l: &Layout) -> Vec<pptx_engine::path::Rect> {
    l.pages[0]
        .all_items()
        .filter_map(|i| match i {
            Item::Drawing(d) => Some(d.rect),
            _ => None,
        })
        .collect()
}

#[test]
fn text_box_text_sits_in_its_shape() {
    let body = format!(
        "{}{LETTER}",
        shape_paragraph("page", 200, 300, Some("Inside"))
    );
    let l = layout(&body, &arial_10());
    let inside = l.pages[0]
        .all_items()
        .find_map(|i| match i {
            Item::Line(p) if text(p) == "Inside" => Some(p),
            _ => None,
        })
        .expect("the text box text");
    assert!(matches!(inside.para.story, StoryRef::TextBox(..)));
    // Inside the shape, past its default insets of 7.2pt and 3.6pt.
    assert!((inside.x - 207.2).abs() < 0.01, "{}", inside.x);
    assert!((inside.y - 303.6).abs() < 0.01, "{}", inside.y);
}

#[test]
fn drawings_in_table_cells_are_positioned_in_the_cell() {
    let cell = shape_paragraph("column", 10, 0, None);
    let body = format!(
        r#"<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc><w:tc>{cell}</w:tc></w:tr></w:tbl><w:p/>{LETTER}"#
    );
    let l = layout(&body, &arial_10());
    let rects = drawing_rects(&l);
    // The first cell's text lines up with the margin (tables before Word
    // 2013), so the second cell's text starts 100pt to the right of it.
    assert_eq!(rects.len(), 1);
    assert!(
        (rects[0].x - (72.0 + 100.0 + 10.0)).abs() < 0.01,
        "{}",
        rects[0].x
    );
}

const PAGE: &str = r#"<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>"#;

/// A section break paragraph ending a section of `cols` columns that
/// started `how` (`continuous` or `nextPage`).
fn section_end(how: &str, cols: &str) -> String {
    format!(r#"<w:p><w:pPr><w:sectPr><w:type w:val="{how}"/>{PAGE}{cols}</w:sectPr></w:pPr></w:p>"#)
}

fn para(t: &str) -> String {
    format!("<w:p><w:r><w:t>{t}</w:t></w:r></w:p>")
}

#[test]
fn sections_on_one_page_stack_their_columns() {
    let two = r#"<w:cols w:num="2" w:space="720"/>"#;
    let body = format!(
        r#"{}{}{}<w:p><w:r><w:br w:type="column"/><w:t>Right</w:t></w:r></w:p>{}{}<w:sectPr><w:type w:val="continuous"/>{PAGE}</w:sectPr>"#,
        para("Intro"),
        section_end("nextPage", ""),
        para("Left"),
        section_end("continuous", two),
        para("After"),
    );
    let l = layout(&body, &arial_10());
    let intro = find(&l, 0, "Intro");
    let h = intro.line().height;
    let (left, right, after) = (
        find(&l, 0, "Left"),
        find(&l, 0, "Right"),
        find(&l, 0, "After"),
    );
    // The two columns start below the first section (its empty section
    // break paragraph included), the second at 72 + 216 + 36.
    assert!((left.y - (72.0 + 2.0 * h)).abs() < 0.01, "{}", left.y);
    assert!((right.y - left.y).abs() < 0.01, "{}", right.y);
    assert!((right.x - 324.0).abs() < 0.01, "{}", right.x);
    // The next section starts below both columns: the column break and the
    // empty paragraph ending the columns take no room.
    assert!((after.y - (left.y + h)).abs() < 0.01, "{}", after.y);
}

#[test]
fn paragraphs_going_on_in_a_wider_column_fill_it() {
    let cols = r#"<w:cols w:num="2" w:space="720" w:equalWidth="0"><w:col w:w="2000" w:space="720"/><w:col w:w="6640"/></w:cols>"#;
    let words = "word ".repeat(600);
    let body = format!("{}<w:sectPr>{PAGE}{cols}</w:sectPr>", para(words.trim()));
    let l = layout(&body, &arial_10());
    let ls = lines(&l, &StoryRef::Body);
    let (narrow, wide): (Vec<&PlacedLine>, Vec<&PlacedLine>) =
        ls.iter().copied().partition(|p| p.x < 150.0);
    assert!(!narrow.is_empty() && !wide.is_empty());
    // The second column is 332pt wide: its lines hold more than the first
    // column's 100pt.
    let widest = wide.iter().map(|p| p.line().width).fold(0.0f32, f32::max);
    assert!(widest > 300.0, "{widest}");
    assert!(
        (wide[0].x - (72.0 + 100.0 + 36.0)).abs() < 0.01,
        "{}",
        wide[0].x
    );
}

#[test]
fn ending_full_columns_does_not_start_a_page() {
    // Two columns of 56 lines each fill the page; the empty paragraph that
    // ends their section would only fit on a page of its own.
    let filler: String = (0..112).map(|k| para(&format!("Line {k}"))).collect();
    let body = format!(
        "{filler}{}{}<w:sectPr>{PAGE}</w:sectPr>",
        section_end("nextPage", r#"<w:cols w:num="2" w:space="720"/>"#),
        para("Next"),
    );
    let l = layout(&body, &arial_10());
    assert_eq!(page_texts(&l, 0).len(), 112);
    assert_eq!(l.pages.len(), 2);
    assert_eq!(page_texts(&l, 1), vec!["Next".to_owned()]);
}

#[test]
fn suppressed_top_spacing_lifts_the_first_line_of_a_page() {
    // At least 18pt lines of 10pt text.
    let body = format!(
        r#"<w:p><w:pPr><w:spacing w:line="360" w:lineRule="atLeast"/></w:pPr><w:r><w:t>Top</w:t></w:r><w:r><w:br/><w:t>Next</w:t></w:r></w:p><w:sectPr>{PAGE}</w:sectPr>"#
    );
    let plain = layout(&body, &arial_10());
    assert!((find(&plain, 0, "Top").y - 72.0).abs() < 0.01);
    let settings = "<w:compat><w:suppressTopSpacing/></w:compat>";
    let l = layout(
        &body,
        &Parts {
            settings: Some(settings),
            ..arial_10()
        },
    );
    // The first line keeps only its text's size; the next is not lifted.
    let (top, next) = (find(&l, 0, "Top"), find(&l, 0, "Next"));
    assert!((top.y - (72.0 - 8.0)).abs() < 0.01, "{}", top.y);
    assert!((next.y - top.y - 18.0).abs() < 0.01, "{}", next.y);
}

#[test]
fn multiple_spacing_below_the_last_line_may_run_into_the_margin() {
    // Triple-spaced lines of 10pt text, 34.5pt each: the 19th line's text
    // ends within the 648pt column, its spacing below it does not.
    let body: String = (0..25)
        .map(|k| {
            format!(
                r#"<w:p><w:pPr><w:spacing w:line="720" w:lineRule="auto"/></w:pPr><w:r><w:t>Line {k}</w:t></w:r></w:p>"#
            )
        })
        .collect();
    let l = layout(&format!("{body}{LETTER}"), &arial_10());
    assert_eq!(page_texts(&l, 0).len(), 19);
    let last = find(&l, 0, "Line 18");
    let line = last.line();
    assert!(last.y + line.height > 720.0, "{}", last.y);
    assert!(last.y + line.height / 3.0 <= 720.0, "{}", last.y);
}

#[test]
fn paragraph_positions_count_from_above_the_space_before() {
    // A shape 10pt below the top of a paragraph with 12pt space before,
    // after a line of text, in the body and in a table cell.
    let shape = shape_paragraph("paragraph", 0, 10, None).replacen(
        "<w:p>",
        r#"<w:p><w:pPr><w:spacing w:before="240"/></w:pPr>"#,
        1,
    );
    let intro = para("Intro");
    let cell = format!(
        r#"<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>{intro}{shape}</w:tc></w:tr></w:tbl><w:p/>"#
    );
    for body in [format!("{intro}{shape}"), cell] {
        let l = layout(&format!("{body}{LETTER}"), &arial_10());
        let h = find(&l, 0, "Intro").line().height;
        let rects = drawing_rects(&l);
        assert_eq!(rects.len(), 1);
        assert!(
            (rects[0].y - (72.0 + h + 10.0)).abs() < 0.01,
            "{}",
            rects[0].y
        );
    }
}
