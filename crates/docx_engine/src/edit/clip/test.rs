use super::super::test_util::*;
use super::super::*;
use crate::test_support::Parts;
use std::collections::BTreeMap;

const STYLES: &str = r#"<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style>"#;

fn open_styled(body: &str) -> Session {
    open_with(
        body,
        &Parts {
            styles: Some(STYLES),
            ..Parts::default()
        },
    )
}

fn heading(text: &str) -> String {
    format!(
        r#"<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>"#
    )
}

fn bold_p(plain: &str, bold: &str) -> String {
    format!(
        r#"<w:p><w:r><w:t xml:space="preserve">{plain}</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">{bold}</w:t></w:r></w:p>"#
    )
}

fn style_of(s: &Session, i: usize) -> String {
    s.document().body().get(&para(s, i)).unwrap().props.clone()
}

fn bold_at(s: &Session, i: usize, offset: usize) -> bool {
    s.document()
        .body()
        .get(&para(s, i))
        .unwrap()
        .content
        .attrs_at(offset)
        .is_some_and(|a| a.has("r:w:b"))
}

fn paste(s: &mut Session, paragraphs: Vec<ClipParagraph>, same: bool) -> EditResult {
    run(
        s,
        EditOp::Paste {
            paragraphs,
            same_document: same,
        },
    )
}

#[test]
fn copying_and_pasting_in_one_document_keeps_formatting() {
    let mut s = open_styled(&format!(
        "{}{}{}",
        heading("Term"),
        bold_p("Plain ", "bold"),
        p("Target.")
    ));
    // Copy the heading's mark and the next paragraph.
    select(&mut s, (0, 0), (1, 10));
    let clip = s.copy_selection();
    assert_eq!(clip.paragraphs.len(), 2);
    assert_eq!(clip.text, "Term\nPlain bold");
    assert!(clip.html.contains("<h1"), "{}", clip.html);
    assert!(clip.html.contains("font-weight:bold"), "{}", clip.html);
    // Paste at the end of the last paragraph.
    caret_at(&mut s, 2, 7);
    let r = paste(&mut s, clip.paragraphs, true);
    assert_eq!(
        texts(&s),
        vec!["Term", "Plain bold", "Target.Term", "Plain bold"]
    );
    // The first pasted paragraph's mark ends the target paragraph, which
    // becomes a heading; the last runs into the rest, formatted as copied.
    assert!(style_of(&s, 2).contains("Heading1"));
    assert!(!style_of(&s, 3).contains("Heading1"));
    assert!(bold_at(&s, 3, 7));
    assert!(!bold_at(&s, 3, 2));
    assert_eq!(r.selection.focus, Pos::new(para(&s, 3), 10));
}

#[test]
fn pasting_one_paragraph_keeps_the_target_paragraph() {
    let mut s = open_styled(&format!("{}{}", heading("Heading"), bold_p("a ", "b")));
    select(&mut s, (1, 0), (1, 3));
    let clip = s.copy_selection();
    caret_at(&mut s, 0, 7);
    paste(&mut s, clip.paragraphs, true);
    assert_eq!(texts(&s)[0], "Headinga b");
    assert!(style_of(&s, 0).contains("Heading1"));
    assert!(bold_at(&s, 0, 9));
}

#[test]
fn pasted_html_takes_headings_lists_and_flags() {
    let mut s = open_styled(&p("Start"));
    caret_at(&mut s, 0, 5);
    let runs = |t: &str, bold: bool| ClipRun {
        text: t.to_owned(),
        bold,
        ..ClipRun::default()
    };
    paste(
        &mut s,
        vec![
            ClipParagraph {
                runs: vec![runs(" more", false)],
                ..ClipParagraph::default()
            },
            ClipParagraph {
                runs: vec![runs("Scope", false)],
                heading: Some(1),
                ..ClipParagraph::default()
            },
            ClipParagraph {
                runs: vec![runs("first ", false), runs("item", true)],
                list: Some(ListKind::Number),
                ..ClipParagraph::default()
            },
            ClipParagraph {
                runs: vec![runs("second item", false)],
                list: Some(ListKind::Number),
                ..ClipParagraph::default()
            },
            ClipParagraph {
                runs: vec![runs("End", false)],
                ..ClipParagraph::default()
            },
        ],
        false,
    );
    assert_eq!(
        texts(&s),
        vec!["Start more", "Scope", "first item", "second item", "End"]
    );
    assert!(style_of(&s, 1).contains("Heading1"));
    assert!(style_of(&s, 2).contains("numPr"));
    assert!(style_of(&s, 3).contains("numPr"));
    // Both items are one list.
    let num = |i: usize| {
        let props = style_of(&s, i);
        let at = props.find("numId w:val=\"").unwrap() + 13;
        props[at..].split('"').next().unwrap().to_owned()
    };
    assert_eq!(num(2), num(3));
    assert!(bold_at(&s, 2, 7));
    assert!(!bold_at(&s, 2, 1));
    // Saved and reopened, the numbering part exists.
    let saved = Document::open(s.document().save().unwrap()).unwrap();
    assert!(
        saved
            .parts()
            .numbering
            .level(num(2).parse().unwrap(), 0, &saved.parts().styles)
            .is_some()
    );
}

#[test]
fn pasting_into_another_document_drops_what_belongs_to_the_first() {
    let mut s = open_styled(&p("Here: "));
    caret_at(&mut s, 0, 6);
    let mut link_attrs = BTreeMap::new();
    link_attrs.insert(
        "wrap".to_owned(),
        r#"[["<w:hyperlink r:id=\"rId9\">","</w:hyperlink>"]]"#.to_owned(),
    );
    let mut picture = BTreeMap::new();
    picture.insert(
        "obj".to_owned(),
        r#"<w:drawing><a:blip r:embed="rId7"/></w:drawing>"#.to_owned(),
    );
    paste(
        &mut s,
        vec![ClipParagraph {
            runs: vec![
                ClipRun {
                    text: "link".to_owned(),
                    attrs: Some(link_attrs),
                    ..ClipRun::default()
                },
                ClipRun {
                    text: "\u{FFFC}".to_owned(),
                    attrs: Some(picture),
                    ..ClipRun::default()
                },
            ],
            props: Some(
                r#"<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="12"/></w:numPr></w:pPr>"#
                    .to_owned(),
            ),
            ..ClipParagraph::default()
        }],
        false,
    );
    assert_eq!(texts(&s), vec!["Here: link"]);
    let xml = s.document().document_xml();
    assert!(!xml.contains("rId9"), "{xml}");
    assert!(!xml.contains("rId7"), "{xml}");
}

#[test]
fn pasting_while_tracking_records_an_insertion() {
    let mut s = open_with(
        &p("Fee: "),
        &Parts {
            settings: Some("<w:trackRevisions/>"),
            ..Parts::default()
        },
    );
    s.set_author("Ann");
    caret_at(&mut s, 0, 5);
    paste(
        &mut s,
        vec![ClipParagraph {
            runs: vec![ClipRun {
                text: "$100".to_owned(),
                ..ClipRun::default()
            }],
            ..ClipParagraph::default()
        }],
        false,
    );
    let xml = s.document().document_xml();
    assert!(
        xml.contains("<w:ins ") && xml.contains("w:author=\"Ann\""),
        "{xml}"
    );
    assert_eq!(texts(&s), vec!["Fee: $100"]);
}

#[test]
fn pasted_native_markup_that_is_not_well_formed_is_left_out() {
    let mut s = open_styled(&p("Target."));
    caret_at(&mut s, 0, 0);
    let attrs = |pairs: &[(&str, &str)]| {
        Some(
            pairs
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect::<BTreeMap<_, _>>(),
        )
    };
    let runs = vec![
        // Bold is kept; a run property that closes the run early is not.
        ClipRun {
            text: "kept ".into(),
            attrs: attrs(&[
                ("r:w:b", "<w:b/>"),
                ("r:w:i", "</w:rPr></w:r><w:r><w:instrText>INCLUDETEXT"),
                ("ra:w:rsidR\"/><w:x", "1"),
                ("unknown", "<w:y/>"),
            ]),
            ..ClipRun::default()
        },
        // An object that is not one element drops the run.
        ClipRun {
            text: "\u{FFFC}".into(),
            attrs: attrs(&[("obj", "<w:br/><w:br/>")]),
            ..ClipRun::default()
        },
        // A wrapper that does not close itself is dropped.
        ClipRun {
            text: "wrapped".into(),
            attrs: attrs(&[(
                "wrap",
                r#"[["<w:ins w:id=\"1\" w:author=\"x\">","</w:ins><w:p>"]]"#,
            )]),
            ..ClipRun::default()
        },
    ];
    let paragraphs = vec![ClipParagraph {
        runs,
        props: Some("<w:pPr><w:jc w:val=\"center\"/>".into()),
        ..ClipParagraph::default()
    }];
    paste(&mut s, paragraphs, false);
    assert_eq!(texts(&s), vec!["kept wrappedTarget."]);
    assert!(bold_at(&s, 0, 0));
    let xml = s.document().document_xml();
    assert!(!xml.contains("INCLUDETEXT"), "{xml}");
    assert!(!xml.contains("w:x"), "{xml}");
    assert!(!xml.contains("<w:y/>"), "{xml}");
    assert!(!xml.contains("<w:ins"), "{xml}");
    assert!(!xml.contains("<w:jc"), "{xml}");
    // What is written parses.
    crate::xml::XmlTree::parse(xml.as_bytes(), "document.xml").expect("well-formed");
}
