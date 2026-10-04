use super::super::test_util::*;
use super::super::*;
use crate::test_support::{Parts, fonts};

/// Texts of a story's paragraphs, objects shown as `^`.
fn story_texts(story: &crate::model::block::Story) -> Vec<String> {
    story
        .paragraphs()
        .iter()
        .map(|id| {
            story
                .get(id)
                .unwrap()
                .content
                .text()
                .replace('\u{FFFC}', "^")
        })
        .collect()
}

#[test]
fn inserting_a_footnote_creates_the_part_and_moves_into_the_note() {
    let mut s = open_with(
        &p("The Seller shall deliver the Shares."),
        &Parts {
            styles: Some(
                r#"<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>"#,
            ),
            ..Parts::default()
        },
    );
    caret_at(&mut s, 0, 36);
    let r = run(&mut s, EditOp::InsertNote { endnote: false });
    assert_eq!(r.story.kind, StoryKind::Footnote);
    // The reference is in the body, styled like Word's.
    let body = s.document().document_xml();
    assert!(body.contains("<w:footnoteReference w:id="), "{body}");
    assert!(
        body.contains(r#"<w:rStyle w:val="FootnoteReference"/>"#),
        "{body}"
    );
    // The note holds its mark and a space; the caret is after them.
    let notes = s.document().footnotes();
    let (&id, note) = notes
        .by_id
        .iter()
        .find(|(_, n)| n.is_text())
        .expect("a note");
    assert!(body.contains(&format!(r#"w:id="{id}""#)));
    assert_eq!(story_texts(&note.story), vec!["^ "]);
    assert_eq!(r.selection.focus.offset, 2);
    // Word's separators come with a new part, and the styles are added.
    assert_eq!(notes.by_id.values().filter(|n| !n.is_text()).count(), 2);
    let styles = &s.document().parts().styles;
    assert!(styles.id_by_name("footnote text").is_some());
    assert!(styles.id_by_name("footnote reference").is_some());
    // Typing goes into the note, which shows at the foot of the page.
    type_text(&mut s, "As amended.");
    let note = &s.document().footnotes().by_id[&id];
    assert_eq!(story_texts(&note.story), vec!["^ As amended."]);
    let area = s.pages(fonts())[0].notes.clone().expect("notes area");
    assert!(area.top > 600.0, "{area:?}");
    // Leaving the note goes back to just after the reference.
    let r = run(&mut s, EditOp::ExitStory);
    assert_eq!(r.story.kind, StoryKind::Body);
    assert_eq!(r.selection.focus.offset, 37);
    // The saved file opens with the note, its reference and its part.
    let saved = Document::open(s.document().save().unwrap()).unwrap();
    assert_eq!(
        story_texts(&saved.footnotes().by_id[&id].story),
        vec!["^ As amended."]
    );
    let types = String::from_utf8(
        saved
            .package()
            .read("/[Content_Types].xml")
            .unwrap()
            .into_owned(),
    )
    .unwrap();
    assert!(types.contains("footnotes+xml"), "{types}");
}

#[test]
fn a_second_endnote_goes_into_the_existing_part() {
    let mut s = open(&p("Alpha Beta"));
    caret_at(&mut s, 0, 5);
    run(&mut s, EditOp::InsertNote { endnote: true });
    type_text(&mut s, "First.");
    run(&mut s, EditOp::ExitStory);
    caret_at(&mut s, 0, 11);
    let r = run(&mut s, EditOp::InsertNote { endnote: true });
    assert_eq!(r.story.kind, StoryKind::Endnote);
    type_text(&mut s, "Second.");
    let notes = s.document().endnotes();
    let texts: Vec<Vec<String>> = notes
        .by_id
        .values()
        .filter(|n| n.is_text())
        .map(|n| story_texts(&n.story))
        .collect();
    assert_eq!(texts.len(), 2, "{texts:?}");
    assert!(texts.contains(&vec!["^ First.".to_owned()]));
    assert!(texts.contains(&vec!["^ Second.".to_owned()]));
    // Without a styles part, the reference is a plain superscript.
    assert!(
        s.document()
            .document_xml()
            .contains(r#"<w:vertAlign w:val="superscript"/>"#)
    );
}

#[test]
fn notes_are_inserted_from_the_body_only() {
    let mut s = open(&p("Alpha"));
    caret_at(&mut s, 0, 5);
    run(&mut s, EditOp::InsertNote { endnote: false });
    // Inside the note, inserting another note does nothing.
    let r = run(&mut s, EditOp::InsertNote { endnote: false });
    assert!(!r.changed);
    assert_eq!(r.story.kind, StoryKind::Footnote);
}

const WITH_NOTE: &str = r#"<w:p><w:r><w:t>Alpha</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r><w:r><w:t xml:space="preserve"> Beta</w:t></w:r></w:p>"#;

const NOTES: &str = r#"<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Defined terms.</w:t></w:r></w:p></w:footnote>"#;

fn copy_alpha_with_its_note(s: &mut Session) -> Vec<ClipParagraph> {
    let first = para(s, 0);
    s.apply(
        &[EditOp::Select {
            anchor: Pos::new(first.clone(), 0),
            focus: Pos::new(first, 6),
        }],
        None,
        fonts(),
    )
    .unwrap();
    s.copy_selection().paragraphs
}

/// The ids of the notes the body refers to, in order.
fn references(s: &Session) -> Vec<i64> {
    let xml = s.document().document_xml();
    xml.match_indices("<w:footnoteReference w:id=\"")
        .map(|(i, m)| {
            let rest = &xml[i + m.len()..];
            rest[..rest.find('"').unwrap()].parse().unwrap()
        })
        .collect()
}

#[test]
fn pasting_a_note_reference_copies_the_note() {
    let mut s = open_with(
        WITH_NOTE,
        &Parts {
            footnotes: Some(NOTES),
            ..Parts::default()
        },
    );
    let clip = copy_alpha_with_its_note(&mut s);
    caret_at(&mut s, 0, 11);
    run(
        &mut s,
        EditOp::Paste {
            paragraphs: clip.clone(),
            same_document: true,
        },
    );
    let refs = references(&s);
    assert_eq!(refs.len(), 2, "{refs:?}");
    assert_eq!(refs[0], 1);
    assert_ne!(refs[1], 1);
    // The copy has the note's text.
    let copy = &s.document().footnotes().by_id[&refs[1]];
    assert_eq!(story_texts(&copy.story), vec!["^ Defined terms."]);
    // From another document, the reference is left behind.
    let mut other = open(&p("Gamma"));
    caret_at(&mut other, 0, 5);
    run(
        &mut other,
        EditOp::Paste {
            paragraphs: clip,
            same_document: false,
        },
    );
    assert_eq!(texts(&other), vec!["GammaAlpha"]);
    assert!(references(&other).is_empty());
}
