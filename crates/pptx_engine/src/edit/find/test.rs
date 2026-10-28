use super::*;
use crate::edit::{EditOp, NewShape};
use crate::test_support::{deck, fonts, text_box};

fn run(text: &str, attrs: &str) -> String {
    format!("<a:r><a:rPr lang=\"en-US\"{attrs}/><a:t>{text}</a:t></a:r>")
}

fn para(runs: &str) -> String {
    format!("<a:p>{runs}</a:p>")
}

fn group(id: u32, members: &str) -> String {
    format!(
        r#"<p:grpSp><p:nvGrpSpPr><p:cNvPr id="{id}" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/><a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/></a:xfrm></p:grpSpPr>{members}</p:grpSp>"#
    )
}

fn texts(pres: &mut Presentation) -> Vec<Vec<String>> {
    pres.outline()
        .unwrap()
        .slides
        .iter()
        .map(|s| {
            let mut out = Vec::new();
            fn walk(shapes: &[crate::inspect::ShapeOutline], out: &mut Vec<String>) {
                for s in shapes {
                    for p in &s.paragraphs {
                        out.push(p.text.clone());
                    }
                    if let Some(t) = &s.table {
                        out.extend(t.rows.iter().flatten().cloned());
                    }
                    walk(&s.children, out);
                }
            }
            walk(&s.shapes, &mut out);
            out
        })
        .collect()
}

/// A two-slide deck: formatted runs, a group, and (added later) a table.
fn sample() -> Presentation {
    let one = text_box(
        2,
        0,
        0,
        3_000_000,
        1_000_000,
        &(para(&(run("The qu", " b=\"1\"") + &run("ick fox", " i=\"1\"")))
            + &para(&run("Quick quicker QUICK", ""))),
    );
    let member = text_box(4, 0, 0, 100, 100, &para(&run("a quick note", "")));
    let two = text_box(2, 0, 0, 100, 100, &para(&run("nothing here", ""))) + &group(3, &member);
    let mut pres = Presentation::open(deck(&[&one, &two])).unwrap();
    pres.apply(
        &[EditOp::AddShape {
            slide: 257,
            shape: NewShape::Table {
                cells: vec![vec!["quick".into(), "slow".into()]],
            },
            x: 0.0,
            y: 200.0,
            w: 200.0,
            h: 40.0,
        }],
        fonts(),
    )
    .unwrap();
    pres
}

#[test]
fn finds_across_runs_groups_and_cells_in_slide_order() {
    let mut pres = sample();
    let all = pres.find_text("quick", FindOptions::default()).unwrap();
    let at = |m: &TextMatch| (m.slide, m.shape, m.cell, m.paragraph, m.start, m.end);
    assert_eq!(
        all.iter().map(at).collect::<Vec<_>>(),
        vec![
            (256, 2, None, 0, 4, 9),
            (256, 2, None, 1, 0, 5),
            (256, 2, None, 1, 6, 11),
            (256, 2, None, 1, 14, 19),
            (257, 4, None, 0, 2, 7),
            (257, 5, Some(CellRef { row: 0, col: 0 }), 0, 0, 5),
        ]
    );
    let cased = FindOptions {
        match_case: true,
        whole_word: false,
    };
    assert_eq!(pres.find_text("Quick", cased).unwrap().len(), 1);
    let words = FindOptions {
        match_case: false,
        whole_word: true,
    };
    let whole: Vec<(usize, usize)> = pres
        .find_text("quick", words)
        .unwrap()
        .iter()
        .filter(|m| m.slide == 256)
        .map(|m| (m.paragraph, m.start))
        .collect();
    assert_eq!(whole, vec![(0, 4), (1, 0), (1, 14)]);
    assert!(
        pres.find_text("", FindOptions::default())
            .unwrap()
            .is_empty()
    );
    let json = serde_json::to_value(&all[5]).unwrap();
    assert_eq!(json["cell"]["row"], 0);
    assert!(serde_json::to_value(&all[0]).unwrap().get("cell").is_none());
}

#[test]
fn replaces_keeping_the_first_matched_characters_format() {
    let mut pres = sample();
    let r = pres
        .apply(
            &[EditOp::ReplaceText {
                find: "QUICK".into(),
                replace: "slow".into(),
                match_case: false,
                whole_word: true,
                slide: Some(256),
            }],
            fonts(),
        )
        .unwrap();
    assert_eq!(r.replaced, 3);
    assert_eq!(r.changed_slides, vec![256]);
    assert_eq!(texts(&mut pres)[0], ["The slow fox", "slow quicker slow"]);
    // "qu" was bold and "ick" italic: the replacement is bold only.
    let doc = pres.xml("/ppt/slides/slide1.xml").unwrap();
    let runs: Vec<(String, bool, bool)> = doc
        .descendants(doc.root())
        .into_iter()
        .filter(|&n| doc.local(n) == "r")
        .take(3)
        .map(|r| {
            let pr = doc.child(r, Ns::A, "rPr").unwrap();
            (
                doc.text(r),
                doc.attr_bool(pr, "b").unwrap_or(false),
                doc.attr_bool(pr, "i").unwrap_or(false),
            )
        })
        .collect();
    assert_eq!(
        runs,
        vec![
            ("The ".to_owned(), true, false),
            ("slow".to_owned(), true, false),
            (" fox".to_owned(), false, true),
        ]
    );
    // The whole deck: group members and table cells too; empty replacements delete.
    let r = pres
        .apply(
            &[EditOp::ReplaceText {
                find: "quick".into(),
                replace: String::new(),
                match_case: true,
                whole_word: false,
                slide: None,
            }],
            fonts(),
        )
        .unwrap();
    assert_eq!(r.replaced, 3);
    assert_eq!(
        texts(&mut pres),
        [
            vec!["The slow fox", "slow er slow"],
            vec!["nothing here", "a  note", "", "slow"],
        ]
    );
    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    assert!(reopened.integrity_problems().unwrap().is_empty());
}

#[test]
fn replace_rejects_breaks_and_skips_fields() {
    let field = r#"<a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="en-US"/><a:t>12</a:t></a:fld>"#;
    let slide = text_box(2, 0, 0, 100, 100, &para(&(run("Page 1", "") + field)));
    let mut pres = Presentation::open(deck(&[&slide])).unwrap();
    let replace = |find: &str, with: &str| EditOp::ReplaceText {
        find: find.into(),
        replace: with.into(),
        match_case: false,
        whole_word: false,
        slide: None,
    };
    for op in [replace("", "x"), replace("a\nb", "x"), replace("a", "x\ny")] {
        assert!(matches!(
            pres.apply(&[op], fonts()),
            Err(Error::InvalidEdit(_))
        ));
    }
    // "112" spans a run and a field: fields are never split.
    let r = pres.apply(&[replace("112", "x")], fonts()).unwrap();
    assert_eq!(r.replaced, 0);
    let r = pres.apply(&[replace("1", "One")], fonts()).unwrap();
    assert_eq!(r.replaced, 1);
    assert_eq!(texts(&mut pres)[0], ["Page One12"]);
    let op: EditOp =
        serde_json::from_str(r#"{"op":"replaceText","find":"page","replace":"Sheet","matchCase":null,"wholeWord":null,"slide":null}"#)
            .unwrap();
    assert_eq!(pres.apply(&[op], fonts()).unwrap().replaced, 1);
}
