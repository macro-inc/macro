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
