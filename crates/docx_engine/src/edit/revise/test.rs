use super::super::test_util::*;
use super::super::*;
use crate::test_support::{Parts, fonts};

const TRACKING: &str = "<w:trackRevisions/>";

fn tracked(body: &str) -> Session {
    let mut s = open_with(
        body,
        &Parts {
            settings: Some(TRACKING),
            ..Parts::default()
        },
    );
    s.set_author("Alice");
    s.set_now("2026-10-04T12:00:00Z");
    s
}

fn xml(s: &Session) -> String {
    s.document().document_xml()
}

fn count(haystack: &str, needle: &str) -> usize {
    haystack.matches(needle).count()
}

#[test]
fn typing_is_recorded_as_the_authors_insertion() {
    let mut s = tracked(&p("Hello"));
    caret_at(&mut s, 0, 5);
    type_text(&mut s, " world");
    type_text(&mut s, "!");
    let out = xml(&s);
    // One insertion, continued by the second keystroke.
    assert_eq!(count(&out, "<w:ins "), 1, "{out}");
    assert!(out.contains("w:author=\"Alice\""), "{out}");
    assert!(out.contains("w:date=\"2026-10-04T12:00:00Z\""), "{out}");
    assert!(
        out.contains("<w:t xml:space=\"preserve\"> world!</w:t>"),
        "{out}"
    );
    assert_eq!(texts(&s), vec!["Hello world!"]);
    let r = s.state(fonts());
    assert!(r.format.tracking);
    assert!(r.format.revision);
}

#[test]
fn deleting_marks_text_deleted_but_removes_the_authors_own_insertions() {
    let mut s = tracked(&p("Hello"));
    caret_at(&mut s, 0, 5);
    type_text(&mut s, "XY");
    // Backspace over the author's own insertion removes it.
    run(
        &mut s,
        EditOp::Delete {
            forward: false,
            unit: Unit::Char,
        },
    );
    assert_eq!(texts(&s), vec!["HelloX"]);
    // Backspace over original text marks it deleted; the caret steps
    // before it.
    run(
        &mut s,
        EditOp::Delete {
            forward: false,
            unit: Unit::Char,
        },
    );
    let r = run(
        &mut s,
        EditOp::Delete {
            forward: false,
            unit: Unit::Char,
        },
    );
    assert_eq!(texts(&s), vec!["Hello"]);
    assert_eq!(r.selection.focus.offset, 4);
    let out = xml(&s);
    assert!(out.contains("<w:del "), "{out}");
    assert!(out.contains("<w:delText>o</w:delText>"), "{out}");
    // Deleting a selection over a mix: own text goes, the rest is marked.
    let mut s = tracked(&p("one two"));
    caret_at(&mut s, 0, 3);
    type_text(&mut s, " new");
    select(&mut s, (0, 0), (0, 11));
    let r = run(
        &mut s,
        EditOp::Delete {
            forward: true,
            unit: Unit::Char,
        },
    );
    assert_eq!(texts(&s), vec!["one two"]);
    assert_eq!(r.selection.focus.offset, 7);
    assert!(!xml(&s).contains("<w:ins "));
}

#[test]
fn enter_records_an_inserted_paragraph_mark_and_backspace_takes_it_back() {
    let mut s = tracked(&p("Hello world"));
    caret_at(&mut s, 0, 5);
    run(&mut s, EditOp::InsertParagraph);
    assert_eq!(texts(&s), vec!["Hello", " world"]);
    let out = xml(&s);
    assert!(out.contains("<w:rPr><w:ins "), "{out}");
    // Backspace at the start of the second paragraph removes the mark the
    // author inserted.
    run(
        &mut s,
        EditOp::Delete {
            forward: false,
            unit: Unit::Char,
        },
    );
    assert_eq!(texts(&s), vec!["Hello world"]);
    assert!(!xml(&s).contains("<w:ins "));
    // Another author's mark is marked deleted instead.
    let mut s = tracked(&format!("{}{}", p("First"), p("Second")));
    caret_at(&mut s, 1, 0);
    run(
        &mut s,
        EditOp::Delete {
            forward: false,
            unit: Unit::Char,
        },
    );
    assert_eq!(texts(&s), vec!["First", "Second"]);
    assert!(xml(&s).contains("<w:rPr><w:del "), "{}", xml(&s));
}

#[test]
fn accepting_and_rejecting_changes() {
    let mut s = tracked(&p("The fee is ten dollars."));
    // Replace "ten" with "twenty".
    select(&mut s, (0, 11), (0, 14));
    type_text(&mut s, "twenty");
    assert_eq!(texts(&s), vec!["The fee is tentwenty dollars."]);
    let before = xml(&s);
    assert!(before.contains("<w:delText>ten</w:delText>"), "{before}");

    // Rejecting everything restores the original.
    let mut rejected = tracked(&p("The fee is ten dollars."));
    select(&mut rejected, (0, 11), (0, 14));
    type_text(&mut rejected, "twenty");
    run(&mut rejected, EditOp::RejectChanges { all: true });
    assert_eq!(texts(&rejected), vec!["The fee is ten dollars."]);
    assert!(!xml(&rejected).contains("<w:ins "));
    assert!(!xml(&rejected).contains("<w:del "));

    // Accepting at the caret takes just the change there.
    caret_at(&mut s, 0, 12);
    let r = run(&mut s, EditOp::AcceptChanges { all: false });
    assert!(r.changed);
    assert_eq!(texts(&s), vec!["The fee is twenty dollars."]);
    // The insertion was a separate revision; it is still there.
    assert!(xml(&s).contains("<w:ins "));
    run(&mut s, EditOp::AcceptChanges { all: true });
    assert!(!xml(&s).contains("<w:ins "));
    assert_eq!(texts(&s), vec!["The fee is twenty dollars."]);
}

#[test]
fn accepting_a_deleted_paragraph_mark_joins_the_paragraphs() {
    let mut s = tracked(&format!("{}{}", p("First"), p("Second")));
    caret_at(&mut s, 1, 0);
    run(
        &mut s,
        EditOp::Delete {
            forward: false,
            unit: Unit::Char,
        },
    );
    run(&mut s, EditOp::AcceptChanges { all: true });
    assert_eq!(texts(&s), vec!["FirstSecond"]);
}

#[test]
fn word_revisions_by_other_authors_resolve_by_id() {
    let body = r#"<w:p><w:r><w:t xml:space="preserve">Pay </w:t></w:r><w:del w:id="7" w:author="Bob" w:date="2025-01-01T00:00:00Z"><w:r><w:delText>30</w:delText></w:r></w:del><w:ins w:id="8" w:author="Bob" w:date="2025-01-01T00:00:00Z"><w:r><w:t>45</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> days</w:t></w:r></w:p>"#;
    let mut s = tracked(body);
    assert_eq!(texts(&s), vec!["Pay 3045 days"]);
    // The caret inside "45" is in revision 8 only.
    caret_at(&mut s, 0, 7);
    run(&mut s, EditOp::RejectChanges { all: false });
    assert_eq!(texts(&s), vec!["Pay 30 days"]);
    let out = xml(&s);
    assert!(out.contains("<w:del w:id=\"7\""), "{out}");
    caret_at(&mut s, 0, 5);
    run(&mut s, EditOp::RejectChanges { all: false });
    assert_eq!(texts(&s), vec!["Pay 30 days"]);
    assert!(!xml(&s).contains("<w:del "));
}

#[test]
fn turning_tracking_on_writes_the_shared_setting() {
    let mut s = open_with(
        &p("Text"),
        &Parts {
            settings: Some("<w:defaultTabStop w:val=\"720\"/>"),
            ..Parts::default()
        },
    );
    let r = run(&mut s, EditOp::SetTracking { on: true });
    assert!(r.format.tracking);
    let entry = r.changes.iter().find_map(|c| match c {
        Change::Entry {
            key,
            value: Some(v),
            ..
        } if key.ends_with("settings.xml") => Some(v.clone()),
        _ => None,
    });
    let settings = entry.expect("settings entry");
    // In schema order: before the default tab stop.
    let track = settings.find("<w:trackRevisions/>").expect("setting");
    assert!(
        track < settings.find("defaultTabStop").unwrap(),
        "{settings}"
    );
    // Typing is now tracked.
    caret_at(&mut s, 0, 4);
    type_text(&mut s, "!");
    assert!(xml(&s).contains("<w:ins "));
    let r = run(&mut s, EditOp::SetTracking { on: false });
    assert!(!r.format.tracking);
    type_text(&mut s, "?");
    assert_eq!(count(&xml(&s), "<w:ins "), 1);
    assert_eq!(texts(&s), vec!["Text!?"]);
}
