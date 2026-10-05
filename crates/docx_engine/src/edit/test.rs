use super::test_util::*;
use super::*;
use crate::model::content::{Content, DeltaOp, Span};
use crate::test_support::{NS, Parts, fonts};

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
                visual: false,
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
            visual: false,
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

#[test]
fn typing_reports_a_band_around_the_changed_lines() {
    let mut paras = String::new();
    for i in 0..30 {
        paras.push_str(&p(&format!("Paragraph {i} with some text.")));
    }
    let mut s = open(&paras);
    s.pages(fonts());
    caret_at(&mut s, 3, 0);
    let r = type_text(&mut s, "x");
    assert_eq!(r.bands.len(), 1, "{:?}", r.bands);
    let band = r.bands[0];
    let caret = r.caret.unwrap();
    assert_eq!(band.page, 0);
    assert!(band.top <= caret.y && band.bottom >= caret.y + caret.height);
    assert!(band.bottom - band.top < 40.0, "{band:?}");
}

#[test]
fn selected_text_joins_paragraphs() {
    let mut s = open(&format!("{}{}", p("Hello world"), p("Second line")));
    select(&mut s, (0, 6), (1, 6));
    assert_eq!(s.selected_text(), "world\nSecond");
}

#[test]
#[ignore = "timing probe over a long document; run with --ignored --nocapture"]
fn zz_typing_profile() {
    // About sixty pages of contract-like paragraphs.
    let clause = "The Receiving Party shall hold the Disclosing Party's Confidential \
        Information in strict confidence and shall not disclose it to any third party \
        except to its Representatives who need to know it for the Purpose.";
    let body: String = (0..600).map(|i| p(&format!("{i}. {clause}"))).collect();
    let mut s = open(&body);
    let t = std::time::Instant::now();
    let pages = s.pages(fonts()).len();
    eprintln!("first layout {:?} ({pages} pages)", t.elapsed());
    let target = s.document().body().paragraphs()[20].clone();
    s.apply(
        &[EditOp::Select {
            anchor: Pos::new(target.clone(), 3),
            focus: Pos::new(target, 3),
        }],
        None,
        fonts(),
    )
    .unwrap();
    for i in 0..5 {
        let t = std::time::Instant::now();
        let r = s
            .apply(
                &[EditOp::InsertText { text: "x".into() }],
                Some("typing"),
                fonts(),
            )
            .unwrap();
        let total = t.elapsed();
        let t2 = std::time::Instant::now();
        let json = serde_json::to_string(&r).unwrap();
        eprintln!(
            "keystroke {i}: apply {total:?}, json {:?} ({} bytes)",
            t2.elapsed(),
            json.len()
        );
    }
    // Layout alone.
    let t = std::time::Instant::now();
    let cache = crate::layout::LayoutCache::new();
    s.document()
        .layout_cached(fonts(), &crate::layout::LayoutOptions::default(), &cache);
    eprintln!("cold layout {:?}", t.elapsed());
    let t = std::time::Instant::now();
    s.document()
        .layout_cached(fonts(), &crate::layout::LayoutOptions::default(), &cache);
    eprintln!("warm layout {:?}", t.elapsed());
}

const WITH_HEADER: &str = r#"<w:p><w:r><w:t>Body text</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>"#;

fn header_texts(doc: &Document) -> Vec<String> {
    let part = doc.part_story("/word/header1.xml").expect("header part");
    part.story
        .paragraphs()
        .iter()
        .map(|id| part.story.get(id).unwrap().content.text())
        .collect()
}

fn open_with_header() -> Session {
    let header = p("Confidential");
    open_with(
        WITH_HEADER,
        &Parts {
            header: Some(&header),
            ..Parts::default()
        },
    )
}

#[test]
fn headers_are_edited_in_place_and_written_to_their_part() {
    let mut s = open_with_header();
    let pages = s.pages(fonts());
    let area = pages[0].header.clone().expect("header area");
    assert!(area.editable);
    assert!(area.bottom >= 72.0 - 0.1, "{area:?}");
    // Header blocks have ids of their own.
    let header_id = s
        .document()
        .part_story("/word/header1.xml")
        .unwrap()
        .story
        .paragraphs()[0]
        .clone();
    assert!(header_id.as_str().starts_with("word/header1.xml#"));

    let r = run(
        &mut s,
        EditOp::EnterStory {
            page: 0,
            x: 300.0,
            y: 42.0,
        },
    );
    assert_eq!(r.story.kind, StoryKind::Header);
    assert_eq!(r.story.page, Some(0));
    assert_eq!(r.selection.focus.block, header_id);
    run(
        &mut s,
        EditOp::Move {
            unit: Unit::Document,
            forward: true,
            extend: false,
            visual: false,
        },
    );
    let r = type_text(&mut s, " draft");
    // Shared as the part's XML, not as body blocks.
    assert!(
        r.changes.iter().any(|c| matches!(
            c,
            Change::Entry { container, key, value: Some(v) }
                if container == "wordParts" && key.ends_with("header1.xml") && v.contains("Confidential draft")
        )),
        "{:?}",
        r.changes
    );
    assert!(!r.changes.iter().any(|c| matches!(c, Change::Text { .. })));
    let caret = r.caret.expect("caret");
    assert_eq!(caret.page, 0);
    assert!(caret.y < 72.0, "{caret:?}");
    assert_eq!(header_texts(s.document()), vec!["Confidential draft"]);
    assert_eq!(texts(&s), vec!["Body text"]);

    // Back to the body, where the caret was.
    let r = run(&mut s, EditOp::ExitStory);
    assert_eq!(r.story.kind, StoryKind::Body);
    assert_eq!(r.selection.focus.block, para(&s, 0));

    // The saved file has the new header.
    let saved = Document::open(s.document().save().unwrap()).unwrap();
    assert_eq!(header_texts(&saved), vec!["Confidential draft"]);
    assert_eq!(
        saved
            .body()
            .paragraphs()
            .iter()
            .map(|id| saved.body().get(id).unwrap().content.text())
            .collect::<Vec<_>>(),
        vec!["Body text"]
    );

    // Undo goes back into the header and removes the typing.
    let r = s.undo(fonts()).unwrap();
    assert_eq!(r.story.kind, StoryKind::Header);
    assert_eq!(header_texts(s.document()), vec!["Confidential"]);
    s.redo(fonts()).unwrap();
    assert_eq!(header_texts(s.document()), vec!["Confidential draft"]);
}

#[test]
fn double_clicking_the_body_leaves_the_header() {
    let mut s = open_with_header();
    run(
        &mut s,
        EditOp::EnterStory {
            page: 0,
            x: 300.0,
            y: 42.0,
        },
    );
    // Enter splits the header paragraph within the header.
    run(&mut s, EditOp::InsertParagraph);
    assert_eq!(header_texts(s.document()).len(), 2);
    assert_eq!(texts(&s), vec!["Body text"]);
    let r = run(
        &mut s,
        EditOp::EnterStory {
            page: 0,
            x: 100.0,
            y: 80.0,
        },
    );
    assert_eq!(r.story.kind, StoryKind::Body);
    assert_eq!(r.selection.focus.block, para(&s, 0));
}

#[test]
fn a_remote_header_change_keeps_the_caret_in_the_header() {
    let mut s = open_with_header();
    run(
        &mut s,
        EditOp::EnterStory {
            page: 0,
            x: 300.0,
            y: 42.0,
        },
    );
    run(
        &mut s,
        EditOp::Move {
            unit: Unit::Document,
            forward: true,
            extend: false,
            visual: false,
        },
    );
    // Another peer rewrites the header part.
    let xml = format!(
        r#"<w:hdr {NS}><w:p><w:r><w:t>Privileged</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:hdr>"#
    );
    let r = s
        .apply_remote(
            &[RemoteChange::Entry {
                container: "wordParts".to_owned(),
                key: "/word/header1.xml".to_owned(),
                value: Some(xml),
            }],
            fonts(),
        )
        .unwrap();
    assert_eq!(header_texts(s.document()), vec!["Privileged", "Second"]);
    assert_eq!(r.story.kind, StoryKind::Header);
    let first = s
        .document()
        .part_story("/word/header1.xml")
        .unwrap()
        .story
        .paragraphs()[0]
        .clone();
    assert_eq!(r.selection.focus.block, first);
    // Typing continues in the header.
    type_text(&mut s, "!");
    assert_eq!(
        header_texts(s.document())[0]
            .chars()
            .filter(|c| *c == '!')
            .count(),
        1
    );
}

#[test]
fn remote_text_at_the_caret_keeps_the_typists_place() {
    use crate::model::content::DeltaOp;
    // This session typed " " after "X"; meanwhile another person typed
    // " [two]" at the same spot, which the shared text put first.
    let mut s = open(&p("X"));
    caret_at(&mut s, 0, 1);
    type_text(&mut s, " ");
    let id = para(&s, 0);
    let mut record = BlockRecord::of(s.document().body().get(&id).unwrap());
    let mut shared = Content::from_delta(record.t.as_deref().unwrap());
    shared.insert(1, " [two]", Default::default());
    record.t = Some(shared.to_delta());
    let insert = |at: usize, text: &str| {
        vec![
            DeltaOp::Retain {
                retain: at,
                attributes: Default::default(),
            },
            DeltaOp::Insert {
                insert: text.to_owned(),
                attributes: Default::default(),
            },
        ]
    };
    let r = s
        .apply_remote(
            &[RemoteChange::Block {
                block: record.clone(),
                deltas: vec![insert(1, " [two]")],
            }],
            fonts(),
        )
        .unwrap();
    // The caret stays after this person's own space, at the end.
    assert_eq!(texts(&s), vec!["X [two] "]);
    assert_eq!(r.selection.focus.offset, 8);
    // Comparing texts alone would have put it inside the other's text.
    let mut s2 = open(&p("X"));
    caret_at(&mut s2, 0, 1);
    type_text(&mut s2, " ");
    let mut record2 = BlockRecord::of(s2.document().body().get(&para(&s2, 0)).unwrap());
    record2.t = record.t.clone();
    let r2 = s2
        .apply_remote(
            &[RemoteChange::Block {
                block: record2,
                deltas: Vec::new(),
            }],
            fonts(),
        )
        .unwrap();
    assert_eq!(r2.selection.focus.offset, 2);
    // Deltas that do not fit the text are ignored.
    let mut s3 = open(&p("X"));
    caret_at(&mut s3, 0, 1);
    type_text(&mut s3, " ");
    let mut record3 = BlockRecord::of(s3.document().body().get(&para(&s3, 0)).unwrap());
    record3.t = record.t.clone();
    let r3 = s3
        .apply_remote(
            &[RemoteChange::Block {
                block: record3,
                deltas: vec![insert(5, "zzz")],
            }],
            fonts(),
        )
        .unwrap();
    assert_eq!(r3.selection.focus.offset, 2);
}

#[test]
fn carets_and_selections_in_right_to_left_text() {
    // "shalom" in a right-to-left paragraph.
    let mut s = open(
        r#"<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>שלום</w:t></w:r></w:p>"#,
    );
    let block = para(&s, 0);
    let caret = |s: &mut Session, offset: usize| {
        s.caret_at(&Pos::new(block.clone(), offset), fonts())
            .unwrap()
            .x
    };
    // The text starts at the right margin (612 - 72) and runs leftwards.
    let start = caret(&mut s, 0);
    let middle = caret(&mut s, 2);
    let end = caret(&mut s, 4);
    assert!((start - 540.0).abs() < 1.0, "{start}");
    assert!(end < middle && middle < start, "{end} {middle} {start}");
    // A click just left of the right edge lands before the first letter.
    let hit = s.hit_test(0, start - 1.0, 80.0, fonts()).unwrap();
    assert_eq!(hit.offset, 0);
    let hit = s.hit_test(0, end + 1.0, 80.0, fonts()).unwrap();
    assert_eq!(hit.offset, 4);
    // The first two letters are selected on the right.
    let rects = s.range_rects(
        &Pos::new(block.clone(), 0),
        &Pos::new(block.clone(), 2),
        fonts(),
    );
    assert_eq!(rects.len(), 1);
    let r = &rects[0];
    assert!((r.x - middle).abs() < 0.5 && (r.x + r.w - start).abs() < 0.5);
}

#[test]
fn arrow_keys_move_visually_in_right_to_left_text() {
    let mut s = open(
        r#"<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>שלום</w:t></w:r></w:p>"#,
    );
    caret_at(&mut s, 0, 1);
    let arrow = |s: &mut Session, right: bool| {
        run(
            s,
            EditOp::Move {
                unit: Unit::Char,
                forward: right,
                extend: false,
                visual: true,
            },
        );
        s.selection().focus.offset
    };
    // Left goes on through the text, right goes back.
    assert_eq!(arrow(&mut s, false), 2);
    assert_eq!(arrow(&mut s, true), 1);
}

#[test]
fn format_state_reports_highlight_spacing_and_tables() {
    let mut s = open(&format!(
        r#"<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>marked</w:t></w:r></w:p><w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>{}</w:tc></w:tr></w:tbl>{}"#,
        p("cell"),
        p("after")
    ));
    caret_at(&mut s, 0, 2);
    let f = s.state(fonts()).format;
    assert_eq!(f.highlight.as_deref(), Some("yellow"));
    assert_eq!(f.line_spacing, Some(1.5));
    assert!(!f.table);
    caret_at(&mut s, 1, 1);
    let f = s.state(fonts()).format;
    assert!(f.table);
    assert_eq!(f.highlight, None);
    assert_eq!(f.line_spacing, Some(1.0));
}

const WITH_FOOTNOTE: &str = r#"<w:p><w:r><w:t>Body text</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r></w:p>"#;

const FOOTNOTES: &str = r#"<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> See the Agreement.</w:t></w:r></w:p></w:footnote>"#;

fn open_with_footnote() -> Session {
    open_with(
        WITH_FOOTNOTE,
        &Parts {
            footnotes: Some(FOOTNOTES),
            ..Parts::default()
        },
    )
}

/// The text of footnote 1 (its reference mark is an object character).
fn note_text(doc: &Document) -> Vec<String> {
    let note = &doc.footnotes().by_id[&1];
    note.story
        .paragraphs()
        .iter()
        .map(|id| {
            note.story
                .get(id)
                .unwrap()
                .content
                .text()
                .replace('\u{FFFC}', "^")
        })
        .collect()
}

fn enter_note(s: &mut Session) -> EditResult {
    let area = s.pages(fonts())[0].notes.clone().expect("notes area");
    run(
        s,
        EditOp::EnterStory {
            page: 0,
            x: 150.0,
            y: (area.top + area.bottom) / 2.0,
        },
    )
}

#[test]
fn footnotes_are_edited_in_place_and_written_to_their_part() {
    let mut s = open_with_footnote();
    let area = s.pages(fonts())[0].notes.clone().expect("notes area");
    assert!(area.top > 600.0, "{area:?}");
    let r = enter_note(&mut s);
    assert_eq!(r.story.kind, StoryKind::Footnote);
    assert_eq!(r.story.page, Some(0));
    let note_para = s.document().footnotes().by_id[&1].story.paragraphs()[0].clone();
    assert_eq!(r.selection.focus.block, note_para);
    run(
        &mut s,
        EditOp::Move {
            unit: Unit::Document,
            forward: true,
            extend: false,
            visual: false,
        },
    );
    let r = type_text(&mut s, " Exhibit A.");
    // Shared as the note's XML, not the whole notes part.
    assert!(
        matches!(
            &r.changes[..],
            [Change::Entry { container, key, value: Some(v) }]
                if container == "wordParts" && key == "/word/footnotes.xml|1"
                    && v.contains("See the Agreement. Exhibit A.")
        ),
        "{:?}",
        r.changes
    );
    let caret = r.caret.expect("caret");
    assert!(caret.y > 600.0, "{caret:?}");
    assert_eq!(
        note_text(s.document()),
        vec!["^ See the Agreement. Exhibit A."]
    );
    assert_eq!(texts(&s), vec!["Body text\u{FFFC}"]);

    // Back to the body, where the caret was.
    let r = run(&mut s, EditOp::ExitStory);
    assert_eq!(r.story.kind, StoryKind::Body);

    // The saved file has the new note, and the separators.
    let saved = Document::open(s.document().save().unwrap()).unwrap();
    assert_eq!(note_text(&saved), vec!["^ See the Agreement. Exhibit A."]);
    assert_eq!(saved.footnotes().by_id[&-1].kind, "separator");
    assert_eq!(saved.footnotes().by_id[&0].kind, "continuationSeparator");

    // Undo goes back into the note.
    let r = s.undo(fonts()).unwrap();
    assert_eq!(r.story.kind, StoryKind::Footnote);
    assert_eq!(note_text(s.document()), vec!["^ See the Agreement."]);
}

#[test]
fn clicking_the_body_leaves_a_note_and_enter_splits_it() {
    let mut s = open_with_footnote();
    enter_note(&mut s);
    // Entering the note it is in keeps the selection.
    run(
        &mut s,
        EditOp::Move {
            unit: Unit::Document,
            forward: true,
            extend: false,
            visual: false,
        },
    );
    let at = s.selection().clone();
    let r = enter_note(&mut s);
    assert_eq!(r.selection, at);
    run(&mut s, EditOp::InsertParagraph);
    type_text(&mut s, "Second");
    assert_eq!(
        note_text(s.document()),
        vec!["^ See the Agreement.", "Second"]
    );
    let r = run(
        &mut s,
        EditOp::EnterStory {
            page: 0,
            x: 100.0,
            y: 80.0,
        },
    );
    assert_eq!(r.story.kind, StoryKind::Body);
    assert_eq!(texts(&s), vec!["Body text\u{FFFC}"]);
}

#[test]
fn a_remote_note_change_keeps_the_caret_in_the_note() {
    let mut s = open_with_footnote();
    enter_note(&mut s);
    let xml = format!(
        r#"<w:footnotes {NS}>{}</w:footnotes>"#,
        FOOTNOTES.replace("See the Agreement.", "See the Merger Agreement.")
    );
    let r = s
        .apply_remote(
            &[RemoteChange::Entry {
                container: "wordParts".to_owned(),
                key: "/word/footnotes.xml".to_owned(),
                value: Some(xml),
            }],
            fonts(),
        )
        .unwrap();
    assert_eq!(r.story.kind, StoryKind::Footnote);
    assert_eq!(note_text(s.document()), vec!["^ See the Merger Agreement."]);
    let first = s.document().footnotes().by_id[&1].story.paragraphs()[0].clone();
    assert_eq!(r.selection.focus.block, first);
    type_text(&mut s, "x");
    assert!(note_text(s.document())[0].contains('x'));
}
