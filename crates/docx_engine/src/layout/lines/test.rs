use crate::Document;
use crate::layout::{Item, Layout, PlacedLine};
use crate::test_support::{Parts, docx, fonts};

fn layout(body: &str, parts: &Parts<'_>) -> (Document, Layout) {
    let doc = Document::open(docx(body, parts)).unwrap();
    let l = doc.layout(fonts());
    (doc, l)
}

fn lines(l: &Layout, page: usize) -> Vec<&PlacedLine> {
    l.pages[page]
        .items
        .iter()
        .filter_map(|i| match i {
            Item::Line(p) => Some(p),
            _ => None,
        })
        .collect()
}

fn line_text(p: &PlacedLine) -> String {
    let l = p.line();
    p.para.inline.clusters[l.start..l.end]
        .iter()
        .filter(|c| {
            !matches!(
                c.kind,
                crate::layout::inline::Kind::End | crate::layout::inline::Kind::Zero
            )
        })
        .map(|c| if c.ch == '\u{FFFC}' { '#' } else { c.ch })
        .collect()
}

const ARIAL_10: &str = r#"<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>"#;

fn para(text: &str) -> String {
    format!("<w:p><w:r><w:t xml:space=\"preserve\">{text}</w:t></w:r></w:p>")
}

#[test]
fn wraps_at_spaces_and_hangs_trailing_spaces() {
    let words = "lorem ipsum dolor sit amet ".repeat(20);
    let (_, l) = layout(
        &para(&words),
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    let ls = lines(&l, 0);
    assert!(ls.len() > 3);
    for p in &ls[..ls.len() - 1] {
        let line = p.line();
        // Lines fit the 6.5" text width and break after a space.
        assert!(line.width <= 468.0 + 0.1, "{}", line.width);
        assert!(line_text(p).ends_with(' '), "{:?}", line_text(p));
    }
    // Arial 10pt single spacing: 1.149 em.
    let h = ls[0].line().height;
    assert!((h - 11.499).abs() < 0.01, "{h}");
}

#[test]
fn breaks_long_words_where_they_overflow() {
    let word = "x".repeat(200);
    let (_, l) = layout(
        &para(&word),
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    let ls = lines(&l, 0);
    assert!(ls.len() >= 2);
    assert!(ls[0].line().width <= 468.0 + 0.1);
}

#[test]
fn tabs_use_custom_then_default_stops() {
    let body = r#"<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr><w:r><w:t>Left</w:t><w:tab/><w:t>Right</w:t></w:r></w:p>
        <w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r></w:p>"#;
    let (_, l) = layout(
        body,
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    let ls = lines(&l, 0);
    // "Right" ends at the right tab stop (6.5").
    let p = ls[0];
    let c = &p.para.inline.clusters;
    let last = (0..c.len())
        .rev()
        .find(|&i| c[i].kind == crate::layout::inline::Kind::Text)
        .unwrap();
    let end = p.para.lines.x[last] + p.para.lines.adv[last];
    assert!((end - 468.0).abs() < 0.05, "{end}");
    // A default stop every half inch.
    let p = ls[1];
    let b = p
        .para
        .inline
        .clusters
        .iter()
        .position(|c| c.ch == 'b')
        .unwrap();
    assert!((p.para.lines.x[b] - 36.0).abs() < 0.05);
}

#[test]
fn justifies_all_but_the_last_line() {
    let words = "justify these words please ".repeat(15);
    let body =
        format!(r#"<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>{words}</w:t></w:r></w:p>"#);
    let (_, l) = layout(
        &body,
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    let ls = lines(&l, 0);
    for p in &ls[..ls.len() - 1] {
        let line = p.line();
        let c = &p.para.inline.clusters;
        let last = (line.start..line.end)
            .rev()
            .find(|&i| c[i].kind == crate::layout::inline::Kind::Text)
            .unwrap();
        let end = p.para.lines.x[last] + p.para.lines.adv[last];
        assert!((end - 468.0).abs() < 0.05, "{end}");
    }
}

const COMPAT_15: &str = r#"<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>"#;

/// Line texts of a justified paragraph of `words` with a right indent that
/// makes the last of its first `fit` words cross the edge by `over` points.
fn justified_lines(words: &[&str], fit: usize, over: f32, settings: Option<&str>) -> Vec<String> {
    let parts = Parts {
        styles: Some(ARIAL_10),
        settings,
        ..Parts::default()
    };
    // The natural width of the first `fit` words on one line.
    let probe = para(&words[..fit].join(" "));
    let (_, l) = layout(&probe, &parts);
    let natural = lines(&l, 0)[0].line().width;
    let right = ((468.0 - (natural - over)) * 20.0).round();
    let body = format!(
        r#"<w:p><w:pPr><w:ind w:right="{right}"/><w:jc w:val="both"/></w:pPr><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#,
        words.join(" ")
    );
    let (_, l) = layout(&body, &parts);
    lines(&l, 0).iter().map(|p| line_text(p)).collect()
}

#[test]
fn justified_lines_shrink_spaces_for_a_word_that_barely_overflows() {
    let words = ["aaaa"; 14];
    // Word 2013 and later shrink the spaces to keep the tenth word.
    let shrunk = justified_lines(&words, 10, 3.0, Some(COMPAT_15));
    assert_eq!(shrunk[0].split_whitespace().count(), 10, "{shrunk:?}");
    // Earlier versions (and too large an overflow) wrap it.
    let old = justified_lines(&words, 10, 3.0, None);
    assert_eq!(old[0].split_whitespace().count(), 9, "{old:?}");
    let far = justified_lines(&words, 10, 7.0, Some(COMPAT_15));
    assert_eq!(far[0].split_whitespace().count(), 9, "{far:?}");
}

#[test]
fn justified_lines_do_not_shrink_for_a_short_word() {
    let mut words = vec!["aaaa"; 9];
    words.extend(["a", "aaaa", "aaaa"]);
    // Crossing by more than a third of its own width, a short word wraps.
    let l = justified_lines(&words, 10, 2.5, Some(COMPAT_15));
    assert_eq!(l[0].split_whitespace().count(), 9, "{l:?}");
}

#[test]
fn numbered_paragraphs_get_labels_and_hanging_tabs() {
    let numbering = r#"<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>"#;
    let body = r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Second</w:t></w:r></w:p>"#;
    let (_, l) = layout(
        body,
        &Parts {
            styles: Some(ARIAL_10),
            numbering: Some(numbering),
            ..Parts::default()
        },
    );
    let ls = lines(&l, 0);
    assert_eq!(line_text(ls[0]), "1.\tFirst");
    assert_eq!(line_text(ls[1]), "2.\tSecond");
    // The label hangs at 0.25" and the text starts at the 0.5" indent.
    let p = ls[0];
    assert!((p.para.lines.x[0] - 18.0).abs() < 0.05);
    let f = p
        .para
        .inline
        .clusters
        .iter()
        .position(|c| c.ch == 'F')
        .unwrap();
    assert!((p.para.lines.x[f] - 36.0).abs() < 0.05);
}

#[test]
fn page_breaks_and_widow_control() {
    let mut body = String::new();
    for i in 0..60 {
        body.push_str(&para(&format!("Paragraph {i}")));
    }
    body.push_str(r#"<w:p><w:r><w:br w:type="page"/></w:r></w:p>"#);
    body.push_str(&para("After the break"));
    let (_, l) = layout(
        &body,
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    assert!(l.pages.len() >= 2);
    let last = l.pages.len() - 1;
    assert!(
        lines(&l, last)
            .iter()
            .any(|p| line_text(p).contains("After the break"))
    );
}

/// The lines of the page after a paragraph that ends with a page break.
fn after_page_break(settings: Option<&str>) -> Vec<(f32, String)> {
    let body = format!(
        r#"{}<w:p><w:r><w:t>Before</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>{}"#,
        para("First"),
        para("After")
    );
    let (_, l) = layout(
        &body,
        &Parts {
            styles: Some(ARIAL_10),
            settings,
            ..Parts::default()
        },
    );
    assert_eq!(l.pages.len(), 2);
    lines(&l, 1).iter().map(|p| (p.y, line_text(p))).collect()
}

#[test]
fn the_mark_after_a_page_break_stays_with_it() {
    // The paragraph mark stays on the break's line, so the next page starts
    // with the next paragraph.
    let next = after_page_break(None);
    assert_eq!(next.len(), 1, "{next:?}");
    assert_eq!(next[0].1, "After");
    assert!((next[0].0 - 72.0).abs() < 0.01, "{next:?}");
    // Split apart, the mark starts the next page as an empty line.
    let split = after_page_break(Some("<w:compat><w:splitPgBreakAndParaMark/></w:compat>"));
    assert_eq!(split.len(), 2, "{split:?}");
    assert_eq!(split[0].1, "");
    assert!((split[0].0 - 72.0).abs() < 0.01, "{split:?}");
    assert!(split[1].0 > 72.0 + 10.0, "{split:?}");
}

#[test]
fn keep_with_next_moves_headings() {
    let mut body = String::new();
    for i in 0..56 {
        body.push_str(&para(&format!("Filler {i}")));
    }
    body.push_str(r#"<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>Heading</w:t></w:r></w:p>"#);
    body.push_str(&para(&"text ".repeat(40)));
    let (_, l) = layout(
        &body,
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    let first: Vec<String> = lines(&l, 0).iter().map(|p| line_text(p)).collect();
    let second: Vec<String> = lines(&l, 1).iter().map(|p| line_text(p)).collect();
    // The heading never ends a page without the start of the next paragraph.
    if first.last().is_some_and(|t| t.contains("Heading")) {
        panic!("heading stranded at the bottom: {first:?}");
    }
    assert!(
        first.iter().any(|t| t.contains("Heading")) || second.iter().any(|t| t.contains("Heading"))
    );
}

#[test]
fn headers_footnotes_and_page_fields() {
    let header = r#"<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>"#;
    let footnotes = r#"<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> The note.</w:t></w:r></w:p></w:footnote>"#;
    let body = r#"<w:p><w:r><w:t>Text</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r></w:p>
        <w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>"#;
    let (_, l) = layout(
        body,
        &Parts {
            styles: Some(ARIAL_10),
            header: Some(header),
            footnotes: Some(footnotes),
            ..Parts::default()
        },
    );
    let texts: Vec<String> = lines(&l, 0).iter().map(|p| line_text(p)).collect();
    assert!(texts.iter().any(|t| t == "Page 1"), "{texts:?}");
    assert!(texts.iter().any(|t| t == "Text1"), "{texts:?}");
    assert!(texts.iter().any(|t| t.contains("1 The note.")), "{texts:?}");
}

#[test]
fn the_paragraph_mark_only_sizes_lines_without_text() {
    // Text at 9pt with a 20pt paragraph mark: the line is as high as the
    // text; an empty paragraph takes the mark's height.
    let body = r#"<w:p><w:pPr><w:rPr><w:sz w:val="40"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>Small</w:t></w:r></w:p><w:p><w:pPr><w:rPr><w:sz w:val="40"/></w:rPr></w:pPr></w:p>"#;
    let (_, l) = layout(
        body,
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    let ls = lines(&l, 0);
    // Arial single spacing is 1.1499 em.
    let (text, empty) = (ls[0].line().height, ls[1].line().height);
    assert!((text - 9.0 * 1.1499).abs() < 0.01, "{text}");
    assert!((empty - 20.0 * 1.1499).abs() < 0.01, "{empty}");
}

#[test]
fn lines_of_mixed_fonts_take_the_tallest_ascent_with_its_own_leading() {
    // A 12pt Symbol bullet before 12pt Arial text. Symbol's ascent (1.005
    // em, no leading) tops Arial's leading plus ascent (0.938 em); Word
    // does not add Arial's leading on top of Symbol's ascent.
    let body = r#"<w:p><w:r><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/><w:sz w:val="24"/></w:rPr><w:t>a</w:t></w:r><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve"> text</w:t></w:r></w:p>"#;
    let (_, l) = layout(
        body,
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    let line = lines(&l, 0)[0].line().clone();
    let ascent = 12.0 * 2059.0 / 2048.0;
    let descent = 12.0 * 443.0 / 2048.0;
    assert!((line.baseline - ascent).abs() < 0.01, "{}", line.baseline);
    assert!(
        (line.height - (ascent + descent)).abs() < 0.01,
        "{}",
        line.height
    );
}

#[test]
fn tabs_to_stops_past_the_right_edge_go_to_the_next_line() {
    // Stops at 1" and 7" in a 6.5" wide text area: the second tab cannot
    // reach its stop on the line.
    let body = r#"<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="1440"/><w:tab w:val="left" w:pos="10080"/></w:tabs></w:pPr><w:r><w:t>from</w:t><w:tab/><w:t xml:space="preserve"> to</w:t><w:tab/><w:t>end</w:t></w:r></w:p>"#;
    let (_, l) = layout(
        body,
        &Parts {
            styles: Some(ARIAL_10),
            ..Parts::default()
        },
    );
    let ls = lines(&l, 0);
    assert_eq!(ls.len(), 2);
    assert_eq!(line_text(ls[0]), "from\t to");
    // On its own line the tab goes to the first stop.
    let p = ls[1];
    let e = p
        .para
        .inline
        .clusters
        .iter()
        .position(|c| c.ch == 'e')
        .unwrap();
    assert!(
        (p.para.lines.x[e] - 72.0).abs() < 0.05,
        "{}",
        p.para.lines.x[e]
    );
}
