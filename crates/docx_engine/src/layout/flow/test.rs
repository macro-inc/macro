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

/// `before` filler lines, then a one-column table of `rows`, each given
/// as (row properties, cell content).
fn table_after(before: usize, rows: &[(&str, &str)]) -> String {
    let filler: String = (0..before)
        .map(|i| format!("<w:p><w:r><w:t>Filler {i}</w:t></w:r></w:p>"))
        .collect();
    let rows: String = rows
        .iter()
        .map(|(tr, cell)| {
            format!(
                r#"<w:tr><w:trPr>{tr}</w:trPr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>{cell}</w:tc></w:tr>"#
            )
        })
        .collect();
    format!(
        r#"{filler}<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>{rows}</w:tbl><w:p/>{LETTER}"#
    )
}

#[test]
fn rows_break_between_lines_as_widow_control_allows() {
    // A four-line paragraph whose first three lines fit on the page: two
    // stay, two go on, so neither page has a single line of it.
    let cell = r#"<w:p><w:r><w:t>L1</w:t><w:br/><w:t>L2</w:t><w:br/><w:t>L3</w:t><w:br/><w:t>L4</w:t></w:r></w:p>"#;
    let l = layout(&table_after(53, &[("", cell)]), &arial_10());
    let cells = |page| -> Vec<String> {
        page_texts(&l, page)
            .into_iter()
            .filter(|t| t.starts_with('L'))
            .collect()
    };
    assert_eq!(cells(0), ["L1", "L2"]);
    assert_eq!(cells(1), ["L3", "L4"]);
    // Two one-line paragraphs with room for one: the row leaves no single
    // line behind and goes over whole.
    let cell = r#"<w:p><w:r><w:t>L1</w:t></w:r></w:p><w:p><w:r><w:t>L2</w:t></w:r></w:p>"#;
    let l = layout(&table_after(55, &[("", cell)]), &arial_10());
    assert!(!page_texts(&l, 0).iter().any(|t| t.starts_with('L')));
    assert_eq!(
        page_texts(&l, 1)
            .into_iter()
            .filter(|t| t.starts_with('L'))
            .collect::<Vec<_>>(),
        ["L1", "L2"]
    );
}

#[test]
fn header_rows_and_rows_kept_with_the_next_stay_together() {
    let para =
        |t: &str, ppr: &str| format!("<w:p><w:pPr>{ppr}</w:pPr><w:r><w:t>{t}</w:t></w:r></w:p>");
    let header = ("<w:tblHeader/>", para("Head", ""));
    let kept = ("", para("Kept", "<w:keepNext/>"));
    let (row, free, last) = (para("Row", ""), para("Free", ""), para("Last", ""));
    for (filler, rows) in [
        // Room for one more line: not the header alone.
        (
            55,
            vec![(header.0, header.1.as_str()), ("", &row), ("", &row)],
        ),
        // Room for three: the first row, not both kept rows without the
        // last.
        (
            53,
            vec![
                ("", &free),
                (kept.0, kept.1.as_str()),
                (kept.0, kept.1.as_str()),
                ("", &last),
            ],
        ),
    ] {
        let l = layout(&table_after(filler, &rows), &arial_10());
        let first = page_texts(&l, 0);
        let second = page_texts(&l, 1);
        // A header row never ends a page alone; rows kept with the next
        // go over with the row they keep with.
        assert!(
            !first.iter().any(|t| t == "Head" || t == "Kept"),
            "{first:?}"
        );
        assert!(
            second.iter().any(|t| t == "Kept" || t == "Head"),
            "{second:?}"
        );
    }
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
    // The two columns start right below the first section's text (its
    // empty section break paragraph takes no room), the second at
    // 72 + 216 + 36.
    assert!((left.y - (72.0 + h)).abs() < 0.01, "{}", left.y);
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
fn empty_breaks_to_continuous_sections_take_no_room_below_text() {
    // An empty paragraph ending a section before a continuous one adds no
    // line below text; one that starts the page keeps its line.
    let continuous = format!("<w:sectPr><w:type w:val=\"continuous\"/>{PAGE}</w:sectPr>");
    let body = format!(
        "{}{}{}{continuous}",
        para("One"),
        section_end("continuous", ""),
        para("Two"),
    );
    let l = layout(&body, &arial_10());
    let (one, two) = (find(&l, 0, "One"), find(&l, 0, "Two"));
    assert!(
        (two.y - (one.y + one.line().height)).abs() < 0.01,
        "{}",
        two.y
    );
    let body = format!("{}{}{continuous}", section_end("nextPage", ""), para("Two"));
    let l = layout(&body, &arial_10());
    let two = find(&l, 0, "Two");
    assert!(two.y > 72.0 + 1.0, "{}", two.y);
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

/// A right-to-left paragraph (or not) of runs marked right to left.
fn rtl_para(bidi: bool, rpr: &str, text: &str) -> String {
    let ppr = if bidi { "<w:pPr><w:bidi/></w:pPr>" } else { "" };
    format!(
        r#"<w:p>{ppr}<w:r><w:rPr>{rpr}<w:rtl/></w:rPr><w:t xml:space="preserve">{text}</w:t></w:r></w:p>"#
    )
}

#[test]
fn right_to_left_paragraphs_read_from_the_right() {
    let body = format!(
        "{}{LETTER}",
        rtl_para(true, "", "\u{05E9}\u{05DC}\u{05D5}\u{05DD} abc 12")
    );
    let l = layout(&body, &arial_10());
    let ls = lines(&l, &StoryRef::Body);
    let pl = ls[0];
    let (x, adv) = (&pl.para.lines.x, &pl.para.lines.adv);
    let width = 468.0;
    // The first letter sits at the right edge, the next ones to its left.
    assert!((x[0] + adv[0] - width).abs() < 0.5, "{} {}", x[0], adv[0]);
    assert!(x[1] < x[0] && x[2] < x[1]);
    // Latin text and numbers keep their own order inside it.
    let at = |c: char| {
        let i = pl
            .para
            .inline
            .clusters
            .iter()
            .position(|k| k.ch == c)
            .unwrap();
        x[i]
    };
    assert!(at('a') < at('b') && at('b') < at('c'));
    assert!(at('1') < at('2'));
    // ...and come after (left of) the Hebrew word.
    assert!(at('c') < x[3]);
}

#[test]
fn hebrew_and_arabic_take_the_weight_of_their_run() {
    let body = format!(
        "{}{}{LETTER}",
        rtl_para(true, "<w:b/><w:bCs/>", "\u{05E9}"),
        rtl_para(true, "", "\u{05E9}")
    );
    let l = layout(&body, &arial_10());
    let ls = lines(&l, &StoryRef::Body);
    let face = |i: usize| ls[i].para.inline.clusters[0].font.unwrap();
    let (bold, regular) = (face(0), face(1));
    assert_eq!(fonts().family(bold.face), "Noto Sans Hebrew");
    assert_ne!(bold.face, regular.face, "a bold face, not the regular one");
    assert!(!bold.synthetic_bold);
}

#[test]
fn arabic_letters_join() {
    // beh seen meem, then lam alef.
    let body = format!(
        "{}{LETTER}",
        rtl_para(true, "", "\u{0628}\u{0633}\u{0645} \u{0644}\u{0627}")
    );
    let l = layout(&body, &arial_10());
    let ls = lines(&l, &StoryRef::Body);
    let clusters = &ls[0].para.inline.clusters;
    let face = clusters[0].font.unwrap().face;
    let glyph = |c: char| fonts().glyph(face, c).unwrap();
    assert_eq!(fonts().family(face), "Noto Sans Arabic");
    assert_eq!(clusters[0].glyph, glyph('\u{FE91}'), "initial beh");
    assert_eq!(clusters[1].glyph, glyph('\u{FEB4}'), "medial seen");
    assert_eq!(clusters[2].glyph, glyph('\u{FEE2}'), "final meem");
    assert_eq!(clusters[4].glyph, glyph('\u{FEFB}'), "lam-alef");
    assert_eq!(clusters[5].kind, Kind::Zero);
}

/// A paragraph with 12pt space before (and `ppr` besides, and `spacing`
/// attributes), `run` before its text `t`.
fn spaced(t: &str, ppr: &str, spacing: &str, run: &str) -> String {
    format!(
        r#"<w:p><w:pPr>{ppr}<w:spacing w:before="240" {spacing}/></w:pPr><w:r>{run}<w:t>{t}</w:t></w:r></w:p>"#
    )
}

#[test]
fn space_before_stays_at_a_page_top_only_after_a_page_break() {
    let page_break = r#"<w:br w:type="page"/>"#;
    let body = [
        para("One"),
        // Starting a page of its own is no hard break.
        spaced("Two", "<w:pageBreakBefore/>", "", ""),
        format!("<w:p><w:r>{page_break}</w:r></w:p>"),
        spaced("Three", "", "", ""),
        // A paragraph that starts with a page break starts after it.
        spaced("Four", "", "", page_break),
        // (Exactly spaced lines leave the space out there.)
        spaced("Five", "", r#"w:line="300" w:lineRule="exact""#, page_break),
    ]
    .concat();
    let l = layout(&format!("{body}{LETTER}"), &arial_10());
    assert_eq!(l.pages.len(), 5);
    for (page, t, y) in [
        (1, "Two", 72.0),
        (2, "Three", 84.0),
        (3, "Four", 84.0),
        (4, "Five", 72.0),
    ] {
        let line = find(&l, page, t);
        assert!((line.y - y).abs() < 0.01, "{t}: {}", line.y);
    }
    // A heading kept with the paragraph after it moves to the next page
    // without its space before.
    let filler: String = (0..54).map(|k| para(&format!("Line {k}"))).collect();
    let body = format!(
        "{filler}{}{}{LETTER}",
        spaced("Heading", "<w:keepNext/>", "", ""),
        para(&"word ".repeat(200)),
    );
    let l = layout(&body, &arial_10());
    let heading = find(&l, 1, "Heading");
    assert!((heading.y - 72.0).abs() < 0.01, "{}", heading.y);
}

#[test]
fn sections_keep_space_before_from_word_2013_on() {
    let body = format!(
        "{}{}{}<w:sectPr>{PAGE}</w:sectPr>",
        para("One"),
        section_end("nextPage", ""),
        spaced("Two", "", "", ""),
    );
    for (mode, y) in [(14, 72.0), (15, 84.0)] {
        let settings = format!(
            r#"<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/></w:compat>"#
        );
        let l = layout(
            &body,
            &Parts {
                settings: Some(&settings),
                ..arial_10()
            },
        );
        let two = find(&l, 1, "Two");
        assert!((two.y - y).abs() < 0.01, "mode {mode}: {}", two.y);
    }
}

#[test]
fn footnotes_leave_room_for_the_continuation_notice() {
    let separator = r#"<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>"#;
    // An empty paragraph with a 20pt mark: 23pt high.
    let notice = r#"<w:footnote w:type="continuationNotice" w:id="0"><w:p><w:pPr><w:rPr><w:sz w:val="40"/></w:rPr></w:pPr></w:p></w:footnote>"#;
    let note = r#"<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> The note.</w:t></w:r></w:p></w:footnote>"#;
    let body = format!(
        r#"<w:p><w:r><w:t>Text</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>{LETTER}"#
    );
    let note_bottom = |footnotes: &str| {
        let l = layout(
            &body,
            &Parts {
                footnotes: Some(footnotes),
                ..arial_10()
            },
        );
        let line = l.pages[0]
            .lines_of(&StoryRef::Footnote(1))
            .next()
            .expect("the note");
        line.y + line.line().height
    };
    let plain = note_bottom(&format!("{separator}{note}"));
    assert!((plain - 720.0).abs() < 0.01, "{plain}");
    let with_notice = note_bottom(&format!("{separator}{notice}{note}"));
    assert!(
        (with_notice - (720.0 - 20.0 * 1.1499)).abs() < 0.01,
        "{with_notice}"
    );
}

#[test]
fn space_after_must_fit_above_footnotes() {
    // One-line paragraphs 11.5pt high with 12pt after, the first with a
    // footnote: the notes (default 12pt separator and an 11.5pt note) end
    // the column at 696.5.
    let paras = |note: bool| -> String {
        (0..30)
            .map(|k| {
                let reference = if note && k == 0 {
                    r#"<w:r><w:footnoteReference w:id="1"/></w:r>"#
                } else {
                    ""
                };
                format!(
                    r#"<w:p><w:pPr><w:spacing w:after="240"/></w:pPr><w:r><w:t>P{k}</w:t></w:r>{reference}</w:p>"#
                )
            })
            .collect()
    };
    let footnotes = r#"<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> The note.</w:t></w:r></w:p></w:footnote>"#;
    let count = |note: bool| {
        let l = layout(
            &format!("{}{LETTER}", paras(note)),
            &Parts {
                footnotes: Some(footnotes),
                ..arial_10()
            },
        );
        page_texts(&l, 0).len()
    };
    // The 27th paragraph's line would fit above the notes, its space after
    // would not. Without notes the space after may run into the margin.
    assert_eq!(count(true), 26);
    assert_eq!(count(false), 28);
}
