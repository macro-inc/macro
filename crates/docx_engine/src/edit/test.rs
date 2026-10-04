use super::*;
use crate::model::content::{Content, DeltaOp, Span};
use crate::test_support::{NS, Parts, docx, fonts};

fn open(body: &str) -> Session {
    open_with(body, &Parts::default())
}

fn open_with(body: &str, parts: &Parts<'_>) -> Session {
    let doc = Document::open(docx(body, parts)).expect("open");
    Session::new(doc)
}

fn p(text: &str) -> String {
    format!(r#"<w:p><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>"#)
}

fn texts(s: &Session) -> Vec<String> {
    s.document()
        .body()
        .paragraphs()
        .iter()
        .map(|id| s.document().body().get(id).unwrap().content.text())
        .collect()
}

fn para(s: &Session, i: usize) -> BlockId {
    s.document().body().paragraphs()[i].clone()
}

fn caret_at(s: &mut Session, i: usize, offset: usize) {
    let block = para(s, i);
    s.apply(
        &[EditOp::Select {
            anchor: Pos::new(block.clone(), offset),
            focus: Pos::new(block, offset),
        }],
        None,
        fonts(),
    )
    .unwrap();
}

fn select(s: &mut Session, a: (usize, usize), f: (usize, usize)) {
    let anchor = Pos::new(para(s, a.0), a.1);
    let focus = Pos::new(para(s, f.0), f.1);
    s.apply(&[EditOp::Select { anchor, focus }], None, fonts())
        .unwrap();
}

fn run(s: &mut Session, op: EditOp) -> EditResult {
    s.apply(&[op], None, fonts()).unwrap()
}

fn type_text(s: &mut Session, text: &str) -> EditResult {
    s.apply(
        &[EditOp::InsertText {
            text: text.to_owned(),
        }],
        Some("typing"),
        fonts(),
    )
    .unwrap()
}

#[test]
fn typing_inserts_text_and_reports_a_delta() {
    let mut s = open(&p("Hello"));
    caret_at(&mut s, 0, 5);
    let r = type_text(&mut s, " world");
    assert_eq!(texts(&s), vec!["Hello world"]);
    assert_eq!(r.selection.focus.offset, 11);
    assert!(r.changed);
    match &r.changes[..] {
        [Change::Text { delta, .. }] => {
            assert_eq!(delta.len(), 2, "{delta:?}");
            assert!(matches!(delta[0], DeltaOp::Retain { retain: 5, .. }));
            assert!(matches!(&delta[1], DeltaOp::Insert { insert, .. } if insert == " world"));
        }
        other => panic!("{other:?}"),
    }
    // The typed text has the formatting of the text before it.
    let b = s.document().body().get(&para(&s, 0)).unwrap();
    assert_eq!(b.content.spans().len(), 1);
    assert!(r.caret.is_some());
}

#[test]
fn enter_splits_and_backspace_joins() {
    let mut s = open(&p("Hello world"));
    caret_at(&mut s, 0, 5);
    let first = para(&s, 0);
    let r = run(&mut s, EditOp::InsertParagraph);
    assert_eq!(texts(&s), vec!["Hello", " world"]);
    // The first half keeps the paragraph's id.
    assert_eq!(para(&s, 0), first);
    assert_eq!(r.selection.focus.offset, 0);
    assert_eq!(r.selection.focus.block, para(&s, 1));
    assert!(r.changes.iter().any(|c| matches!(c, Change::Block { .. })));
    assert!(r.changes.iter().any(|c| matches!(c, Change::Text { .. })));
    let r = run(
        &mut s,
        EditOp::Delete {
            forward: false,
            unit: Unit::Char,
        },
    );
    assert_eq!(texts(&s), vec!["Hello world"]);
    assert_eq!(r.selection.focus, Pos::new(first.clone(), 5));
    assert!(r.changes.iter().any(|c| matches!(c, Change::Remove { .. })));
}

#[test]
fn enter_at_the_start_keeps_the_text_paragraph() {
    let mut s = open(&p("Text"));
    let id = para(&s, 0);
    caret_at(&mut s, 0, 0);
    run(&mut s, EditOp::InsertParagraph);
    assert_eq!(texts(&s), vec!["", "Text"]);
    assert_eq!(para(&s, 1), id);
    assert_eq!(s.selection().focus, Pos::new(id, 0));
}

#[test]
fn deleting_across_paragraphs_joins_the_ends() {
    let mut s = open(&format!("{}{}{}", p("One two"), p("Three"), p("Four five")));
    select(&mut s, (0, 3), (2, 4));
    run(
        &mut s,
        EditOp::Delete {
            forward: false,
            unit: Unit::Char,
        },
    );
    assert_eq!(texts(&s), vec!["One five"]);
    assert_eq!(s.selection().focus.offset, 3);
}

#[test]
fn typing_over_a_selection_replaces_it() {
    let mut s = open(&format!("{}{}", p("abc"), p("def")));
    select(&mut s, (1, 2), (0, 1));
    type_text(&mut s, "X");
    assert_eq!(texts(&s), vec!["aXf"]);
}

#[test]
fn deleting_into_a_table_empties_covered_cells() {
    let cell = |t: &str| format!("<w:tc>{}</w:tc>", p(t));
    let body = format!(
        "{}<w:tbl><w:tblGrid><w:gridCol w:w=\"2000\"/><w:gridCol w:w=\"2000\"/></w:tblGrid><w:tr>{}{}</w:tr><w:tr>{}{}</w:tr></w:tbl>{}",
        p("Before"),
        cell("A1"),
        cell("B1"),
        cell("A2"),
        cell("B2"),
        p("After")
    );
    let mut s = open(&body);
    // From inside "Before" to the middle of B2.
    select(&mut s, (0, 3), (4, 1));
    run(
        &mut s,
        EditOp::Delete {
            forward: true,
            unit: Unit::Char,
        },
    );
    // The fully covered first row goes; the covered cell of the second is emptied.
    assert_eq!(texts(&s), vec!["Bef", "", "2", "After"]);
    let rows = s
        .document()
        .body()
        .blocks()
        .filter(|b| b.kind == BlockKind::Row)
        .count();
    assert_eq!(rows, 1);
}

#[test]
fn a_whole_table_in_the_range_goes() {
    let body = format!(
        "{}<w:tbl><w:tr><w:tc>{}</w:tc></w:tr></w:tbl>{}",
        p("Before"),
        p("Cell"),
        p("After")
    );
    let mut s = open(&body);
    select(&mut s, (0, 2), (2, 2));
    type_text(&mut s, "-");
    assert_eq!(texts(&s), vec!["Be-ter"]);
    assert!(
        s.document()
            .body()
            .blocks()
            .all(|b| b.kind == BlockKind::Paragraph)
    );
}

#[test]
fn toggling_bold_sets_and_clears_direct_formatting() {
    let mut s = open(&p("Hello world"));
    select(&mut s, (0, 0), (0, 5));
    let r = run(
        &mut s,
        EditOp::ToggleFormat {
            format: Toggle::Bold,
        },
    );
    assert!(r.format.bold);
    let b = s.document().body().get(&para(&s, 0)).unwrap();
    assert_eq!(b.content.spans().len(), 2);
    assert_eq!(b.content.spans()[0].attrs.get("r:w:b"), Some("<w:b/>"));
    assert_eq!(b.content.spans()[0].attrs.get("r:w:bCs"), Some("<w:bCs/>"));
    // Only attributes changed: the delta retains with attributes.
    match &r.changes[..] {
        [Change::Text { delta, .. }] => {
            assert!(
                matches!(&delta[0], DeltaOp::Retain { retain: 5, attributes } if attributes.contains_key("r:w:b"))
            );
        }
        other => panic!("{other:?}"),
    }
    let r = run(
        &mut s,
        EditOp::ToggleFormat {
            format: Toggle::Bold,
        },
    );
    assert!(!r.format.bold);
    let b = s.document().body().get(&para(&s, 0)).unwrap();
    assert_eq!(b.content.spans().len(), 1);
}

#[test]
fn toggling_off_style_bold_writes_an_explicit_off() {
    let styles = r#"<w:style w:type="paragraph" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>"#;
    let body = r#"<w:p><w:pPr><w:pStyle w:val="Strong"/></w:pPr><w:r><w:t>Bold</w:t></w:r></w:p>"#;
    let mut s = open_with(
        body,
        &Parts {
            styles: Some(styles),
            ..Parts::default()
        },
    );
    select(&mut s, (0, 0), (0, 4));
    let r = run(
        &mut s,
        EditOp::ToggleFormat {
            format: Toggle::Bold,
        },
    );
    assert!(!r.format.bold);
    let b = s.document().body().get(&para(&s, 0)).unwrap();
    assert_eq!(
        b.content.spans()[0].attrs.get("r:w:b"),
        Some(r#"<w:b w:val="0"/>"#)
    );
}

#[test]
fn formatting_at_a_caret_applies_to_typed_text() {
    let mut s = open(&p("ab"));
    caret_at(&mut s, 0, 1);
    let r = run(
        &mut s,
        EditOp::ToggleFormat {
            format: Toggle::Italic,
        },
    );
    assert!(r.format.italic);
    assert!(!r.changed);
    type_text(&mut s, "X");
    let b = s.document().body().get(&para(&s, 0)).unwrap();
    let spans: Vec<(&str, bool)> = b
        .content
        .spans()
        .iter()
        .map(|sp| (sp.text.as_str(), sp.attrs.has("r:w:i")))
        .collect();
    assert_eq!(spans, vec![("a", false), ("X", true), ("b", false)]);
}

#[test]
fn set_format_and_paragraph_properties() {
    let mut s = open(&p("Text"));
    select(&mut s, (0, 0), (0, 4));
    let r = run(
        &mut s,
        EditOp::SetFormat {
            patch: RunPatch {
                size: Some(Some(14.0)),
                color: Some(Some("#ff0000".into())),
                font: Some(Some("Arial".into())),
                highlight: None,
            },
        },
    );
    assert_eq!(r.format.size, Some(14.0));
    assert_eq!(r.format.color.as_deref(), Some("FF0000"));
    assert_eq!(r.format.font.as_deref(), Some("Arial"));
    let r = run(
        &mut s,
        EditOp::SetParagraph {
            patch: ParaPatch {
                align: Some(Alignment::Center),
                space_after: Some(12.0),
                ..ParaPatch::default()
            },
        },
    );
    assert_eq!(r.format.align, Some(Alignment::Center));
    let b = s.document().body().get(&para(&s, 0)).unwrap();
    assert_eq!(
        b.props,
        r#"<w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr>"#
    );
    assert!(
        r.changes
            .iter()
            .any(|c| matches!(c, Change::Fields { fields, .. } if fields.contains_key("x")))
    );
}

#[test]
fn json_operations_parse() {
    let ops: Vec<EditOp> = serde_json::from_str(
        r#"[{"op":"insertText","text":"a"},{"op":"move","unit":"word","forward":true,"extend":true},
            {"op":"setFormat","size":12,"color":null},{"op":"toggleFormat","format":"bold"},
            {"op":"setParagraph","align":"justify","lineSpacing":{"rule":"auto","value":1.5}},
            {"op":"delete","forward":false},{"op":"insertBreak","kind":"page"}]"#,
    )
    .unwrap();
    assert_eq!(ops.len(), 7);
    match &ops[2] {
        EditOp::SetFormat { patch } => {
            assert_eq!(patch.size, Some(Some(12.0)));
            assert_eq!(patch.color, Some(None));
            assert_eq!(patch.font, None);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn undo_and_redo_restore_the_document() {
    let mut s = open(&p("Hello"));
    caret_at(&mut s, 0, 5);
    type_text(&mut s, " a");
    type_text(&mut s, "b");
    run(&mut s, EditOp::InsertParagraph);
    type_text(&mut s, "Next");
    assert_eq!(texts(&s), vec!["Hello ab", "Next"]);
    s.undo(fonts()).unwrap();
    assert_eq!(texts(&s), vec!["Hello ab", ""]);
    s.undo(fonts()).unwrap();
    assert_eq!(texts(&s), vec!["Hello ab"]);
    // Typing merged into one step.
    let r = s.undo(fonts()).unwrap();
    assert_eq!(texts(&s), vec!["Hello"]);
    assert_eq!(r.selection.focus.offset, 5);
    assert!(s.undo(fonts()).is_none());
    s.redo(fonts()).unwrap();
    s.redo(fonts()).unwrap();
    assert_eq!(texts(&s), vec!["Hello ab", ""]);
    s.redo(fonts()).unwrap();
    assert_eq!(texts(&s), vec!["Hello ab", "Next"]);
}

#[test]
fn caret_geometry_and_hit_testing_agree() {
    let mut s = open(&p("The quick brown fox jumps over the lazy dog."));
    let block = para(&s, 0);
    let mut last_x = -1.0;
    for offset in [0, 4, 10, 20, 44] {
        let c = s
            .caret_at(&Pos::new(block.clone(), offset), fonts())
            .unwrap();
        assert!(c.x > last_x, "offset {offset}: {c:?}");
        last_x = c.x;
        assert_eq!(c.page, 0);
        let hit = s
            .hit_test(0, c.x + 0.5, c.y + c.height / 2.0, fonts())
            .unwrap();
        assert_eq!(hit.offset, offset);
        assert_eq!(hit.block, block);
    }
}

#[test]
fn moving_by_characters_words_and_lines() {
    let long = "word ".repeat(60);
    let mut s = open(&format!("{}{}", p("ab cd"), p(long.trim_end())));
    caret_at(&mut s, 0, 0);
    let mv = |s: &mut Session, unit: Unit, forward: bool| {
        run(
            s,
            EditOp::Move {
                unit,
                forward,
                extend: false,
            },
        )
        .selection
        .focus
    };
    assert_eq!(mv(&mut s, Unit::Char, true).offset, 1);
    assert_eq!(mv(&mut s, Unit::Word, true).offset, 3);
    assert_eq!(mv(&mut s, Unit::LineBoundary, true).offset, 5);
    // Past the end of the paragraph into the next.
    let next = mv(&mut s, Unit::Char, true);
    assert_eq!(next, Pos::new(para(&s, 1), 0));
    // Down into the second line of the long paragraph.
    let down = mv(&mut s, Unit::Line, true);
    assert_eq!(down.block, para(&s, 1));
    assert!(down.offset > 0, "{down:?}");
    let up = mv(&mut s, Unit::Line, false);
    assert_eq!(up.offset, 0);
    assert_eq!(mv(&mut s, Unit::Char, false), Pos::new(para(&s, 0), 5));
    // Extending keeps the anchor.
    let r = run(
        &mut s,
        EditOp::Move {
            unit: Unit::Word,
            forward: false,
            extend: true,
        },
    );
    assert_eq!(r.selection.anchor.offset, 5);
    assert_eq!(r.selection.focus.offset, 3);
    assert!(!r.rects.is_empty());
}

#[test]
fn word_and_paragraph_selection() {
    let mut s = open(&p("Hello brave world"));
    let block = para(&s, 0);
    let r = run(
        &mut s,
        EditOp::SelectWord {
            at: Pos::new(block.clone(), 8),
        },
    );
    assert_eq!(
        (r.selection.anchor.offset, r.selection.focus.offset),
        (6, 11)
    );
    let r = run(
        &mut s,
        EditOp::SelectParagraph {
            at: Pos::new(block, 3),
        },
    );
    assert_eq!(
        (r.selection.anchor.offset, r.selection.focus.offset),
        (0, 17)
    );
}

#[test]
fn enter_on_an_empty_list_item_ends_the_list() {
    let numbering = r#"<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>"#;
    let body = r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Item</w:t></w:r></w:p>"#;
    let mut s = open_with(
        body,
        &Parts {
            numbering: Some(numbering),
            ..Parts::default()
        },
    );
    caret_at(&mut s, 0, 4);
    let r = run(&mut s, EditOp::InsertParagraph);
    assert!(r.format.list);
    let r = run(&mut s, EditOp::InsertParagraph);
    assert!(!r.format.list);
    assert_eq!(texts(&s), vec!["Item", ""]);
}

#[test]
fn page_breaks_add_a_page() {
    let mut s = open(&p("Before"));
    caret_at(&mut s, 0, 6);
    let r = run(
        &mut s,
        EditOp::InsertBreak {
            kind: BreakKind::Page,
        },
    );
    type_text(&mut s, "After");
    assert_eq!(s.pages(fonts()).len(), 2);
    assert!(r.pages.is_some());
}

#[test]
fn page_fingerprints_change_only_where_content_changed() {
    let mut paras = String::new();
    for i in 0..80 {
        paras.push_str(&p(&format!(
            "Paragraph number {i} with some text to fill the line."
        )));
    }
    let mut s = open(&paras);
    let before = s.pages(fonts());
    assert!(before.len() >= 2);
    caret_at(&mut s, 0, 0);
    let r = type_text(&mut s, "x");
    let after = r.pages.expect("relaid");
    assert_eq!(after.len(), before.len());
    assert_ne!(before[0].fingerprint, after[0].fingerprint);
    assert_eq!(before.last(), after.last());
}

#[test]
fn edits_save_and_reopen() {
    let mut s = open(&p("Hello"));
    caret_at(&mut s, 0, 5);
    type_text(&mut s, " world");
    run(&mut s, EditOp::InsertParagraph);
    type_text(&mut s, "Second");
    select(&mut s, (1, 0), (1, 6));
    run(
        &mut s,
        EditOp::ToggleFormat {
            format: Toggle::Bold,
        },
    );
    let bytes = s.save().unwrap();
    let doc = Document::open(bytes).unwrap();
    let t: Vec<String> = doc
        .body()
        .paragraphs()
        .iter()
        .map(|id| doc.body().get(id).unwrap().content.text())
        .collect();
    assert_eq!(t, vec!["Hello world", "Second"]);
    let second = doc.body().get(&doc.body().paragraphs()[1]).unwrap();
    assert!(second.content.spans()[0].attrs.has("r:w:b"));
    let xml = doc.document_xml();
    assert!(
        xml.contains(
            NS.split_whitespace()
                .next()
                .unwrap()
                .split('=')
                .next()
                .unwrap()
        )
    );
}

/// Deterministic pseudo-random numbers.
struct Rng(u64);

impl Rng {
    fn next(&mut self, n: usize) -> usize {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((self.0 >> 33) as usize) % n.max(1)
    }
}

#[test]
fn content_deltas_reproduce_random_edits() {
    let mut rng = Rng(7);
    let attrs = [
        Attrs::empty(),
        Attrs::from_pairs([("r:w:b", "<w:b/>")]),
        Attrs::from_pairs([("r:w:i", "<w:i/>")]),
        Attrs::from_pairs([("r:w:b", "<w:b/>"), ("r:w:i", "<w:i/>")]),
    ];
    let words = ["alpha", " ", "βeta", "😀", "x", "\t", "longer text"];
    for _ in 0..300 {
        let mut before = Content::new();
        for _ in 0..rng.next(6) {
            before.push(
                words[rng.next(words.len())],
                attrs[rng.next(attrs.len())].clone(),
            );
        }
        let mut after = before.clone();
        for _ in 0..1 + rng.next(3) {
            let len = after.len();
            let at = rng.next(len + 1);
            // Keep offsets on character boundaries.
            let at = crate::model::content::utf16_len(
                &after.text()[..crate::model::content::byte_at(&after.text(), at)],
            );
            match rng.next(3) {
                0 => after.insert(
                    at,
                    words[rng.next(words.len())],
                    attrs[rng.next(attrs.len())].clone(),
                ),
                1 => {
                    let end = (at + rng.next(6)).min(len);
                    let end = crate::model::content::utf16_len(
                        &after.text()[..crate::model::content::byte_at(&after.text(), end)],
                    );
                    after.delete(at, end.max(at));
                }
                _ => {
                    let end = (at + rng.next(8)).min(len);
                    let end = crate::model::content::utf16_len(
                        &after.text()[..crate::model::content::byte_at(&after.text(), end)],
                    );
                    let a = attrs[rng.next(attrs.len())].clone();
                    after.map_attrs(at, end.max(at), |_| a.clone());
                }
            }
        }
        let delta = content_delta(&before, &after);
        let mut applied = before.clone();
        applied.apply_delta(&delta);
        assert_eq!(applied, after, "delta {delta:?}");
        // The delta survives JSON.
        let json = serde_json::to_string(&delta).unwrap();
        let back: Vec<DeltaOp> = serde_json::from_str(&json).unwrap();
        assert_eq!(back, delta);
    }
    let _ = Span {
        text: String::new(),
        attrs: Attrs::empty(),
    };
}

#[test]
fn lists_toggle_on_and_off_and_create_the_numbering_part() {
    let mut s = open(&format!("{}{}{}", p("One"), p("Two"), p("Three")));
    select(&mut s, (0, 0), (1, 1));
    let r = run(
        &mut s,
        EditOp::ToggleList {
            kind: ListKind::Bullet,
        },
    );
    assert!(r.format.list);
    // The new part reaches the shared maps: its XML, relationship and type.
    assert!(r.changes.iter().any(|c| matches!(c, Change::Entry { container, key, .. } if container == "wordParts" && key == "/word/numbering.xml")));
    assert!(r.changes.iter().any(|c| matches!(c, Change::Entry { container, value: Some(v), .. } if container == "wordRels" && v.contains("numbering"))));
    assert!(r.changes.iter().any(|c| matches!(c, Change::Entry { container, key, .. } if container == "wordTypes" && key.contains("numbering"))));
    let kinds = s.list_kinds(&s.document().body().paragraphs());
    assert!(kinds[0].is_some_and(|(k, _, _)| k == ListKind::Bullet));
    assert!(kinds[1].is_some());
    assert!(kinds[2].is_none());
    // A numbered list started separately on the third paragraph.
    select(&mut s, (2, 0), (2, 0));
    run(
        &mut s,
        EditOp::ToggleList {
            kind: ListKind::Number,
        },
    );
    let kinds = s.list_kinds(&s.document().body().paragraphs());
    assert!(kinds[2].is_some_and(|(k, _, _)| k == ListKind::Number));
    // Off again.
    select(&mut s, (0, 0), (1, 0));
    let r = run(
        &mut s,
        EditOp::ToggleList {
            kind: ListKind::Bullet,
        },
    );
    assert!(!r.format.list);
    let kinds = s.list_kinds(&s.document().body().paragraphs());
    assert!(kinds[0].is_none() && kinds[1].is_none());
    // Saved and reopened, the numbering part is valid.
    let doc = Document::open(s.save().unwrap()).unwrap();
    assert!(doc.parts().numbering.num_ids().count() >= 2);
}

#[test]
fn numbered_items_continue_the_list_before_them() {
    let mut s = open(&format!("{}{}", p("First"), p("Second")));
    caret_at(&mut s, 0, 0);
    run(
        &mut s,
        EditOp::ToggleList {
            kind: ListKind::Number,
        },
    );
    caret_at(&mut s, 1, 0);
    run(
        &mut s,
        EditOp::ToggleList {
            kind: ListKind::Number,
        },
    );
    let kinds = s.list_kinds(&s.document().body().paragraphs());
    let (a, b) = (kinds[0].unwrap(), kinds[1].unwrap());
    assert_eq!(a.1, b.1, "same list instance");
    // Tab-style indent moves the item a level down.
    run(&mut s, EditOp::Indent { forward: true });
    let kinds = s.list_kinds(&s.document().body().paragraphs());
    assert_eq!(kinds[1].unwrap().2, 1);
    // The labels lay out as 1. and a.
    let layout = s.layout(fonts());
    let labels: Vec<String> = layout.pages[0]
        .items
        .iter()
        .filter_map(|i| match i {
            crate::layout::Item::Line(l) => Some(l),
            _ => None,
        })
        .map(|l| {
            let pb = &l.para;
            pb.inline.clusters[..pb.inline.label_len]
                .iter()
                .map(|c| c.ch)
                .filter(|c| !c.is_whitespace() && *c != '\t')
                .collect()
        })
        .collect();
    assert_eq!(labels, vec!["1.", "a."]);
}

#[test]
fn tables_insert_and_change_shape() {
    let mut s = open(&p("Before"));
    caret_at(&mut s, 0, 6);
    let r = run(&mut s, EditOp::InsertTable { rows: 2, cols: 3 });
    let count =
        |s: &Session, k: BlockKind| s.document().body().blocks().filter(|b| b.kind == k).count();
    assert_eq!(count(&s, BlockKind::Table), 1);
    assert_eq!(count(&s, BlockKind::Row), 2);
    assert_eq!(count(&s, BlockKind::Cell), 6);
    // The caret is in the first cell, and a paragraph follows the table.
    let first_cell = r.selection.focus.block.clone();
    type_text(&mut s, "A1");
    assert_eq!(
        s.document().body().get(&first_cell).unwrap().content.text(),
        "A1"
    );
    let top = s.document().body().children(None).to_vec();
    assert_eq!(top.len(), 3);
    assert_eq!(
        s.document().body().get(&top[2]).unwrap().kind,
        BlockKind::Paragraph
    );
    run(&mut s, EditOp::InsertRow { below: true });
    assert_eq!(count(&s, BlockKind::Row), 3);
    run(&mut s, EditOp::InsertColumn { right: true });
    assert_eq!(count(&s, BlockKind::Cell), 12);
    run(&mut s, EditOp::DeleteColumn);
    assert_eq!(count(&s, BlockKind::Cell), 9);
    run(&mut s, EditOp::DeleteRow);
    assert_eq!(count(&s, BlockKind::Row), 2);
    // It lays out and saves.
    assert_eq!(s.pages(fonts()).len(), 1);
    let doc = Document::open(s.save().unwrap()).unwrap();
    assert_eq!(
        doc.body()
            .blocks()
            .filter(|b| b.kind == BlockKind::Cell)
            .count(),
        6
    );
    run(&mut s, EditOp::DeleteTable);
    assert_eq!(count(&s, BlockKind::Table), 0);
}
