use super::super::test_util::*;
use super::super::*;
use crate::test_support::{Parts, fonts};

fn find(s: &mut Session, query: &str, options: FindOptions) -> Vec<(usize, usize, usize)> {
    let paras = s.document().body().paragraphs();
    s.find(query, &options, fonts())
        .matches
        .iter()
        .map(|m| {
            let i = paras.iter().position(|id| *id == m.from.block).unwrap();
            assert_eq!(m.from.block, m.to.block);
            (i, m.from.offset, m.to.offset)
        })
        .collect()
}

fn plain(s: &mut Session, query: &str) -> Vec<(usize, usize, usize)> {
    find(s, query, FindOptions::default())
}

fn replace(s: &mut Session, query: &str, with: &str, all: bool) -> EditResult {
    run(
        s,
        EditOp::Replace {
            query: query.to_owned(),
            options: FindOptions::default(),
            with: with.to_owned(),
            all,
        },
    )
}

#[test]
fn finds_text_across_runs_ignoring_case_unless_asked() {
    let body = format!(
        r#"{}<w:p><w:r><w:t xml:space="preserve">The Com</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>pany shall pay the company.</w:t></w:r></w:p>"#,
        p("Company overview")
    );
    let mut s = open(&body);
    assert_eq!(
        plain(&mut s, "company"),
        vec![(0, 0, 7), (1, 4, 11), (1, 26, 33)]
    );
    let exact = FindOptions {
        match_case: true,
        ..FindOptions::default()
    };
    assert_eq!(find(&mut s, "company", exact), vec![(1, 26, 33)]);
    // Every match has highlight rectangles on the first page.
    let r = s.find("company", &FindOptions::default(), fonts());
    assert!(
        r.matches
            .iter()
            .all(|m| !m.rects.is_empty() && m.rects.iter().all(|r| r.page == 0))
    );
    assert!(plain(&mut s, "").is_empty());
    assert!(plain(&mut s, "absent").is_empty());
}

#[test]
fn whole_words_and_typographic_quotes() {
    let mut s = open(&format!(
        "{}{}",
        p("Art, artist and art."),
        p("The Company\u{2019}s \u{201C}Shares\u{201D}\u{00A0}today")
    ));
    assert_eq!(plain(&mut s, "art").len(), 3);
    let whole = FindOptions {
        whole_word: true,
        ..FindOptions::default()
    };
    assert_eq!(find(&mut s, "art", whole), vec![(0, 0, 3), (0, 16, 19)]);
    assert_eq!(plain(&mut s, "Company's"), vec![(1, 4, 13)]);
    assert_eq!(plain(&mut s, "\"Shares\" today"), vec![(1, 14, 28)]);
}

#[test]
fn skips_deleted_text_and_field_codes_and_stops_at_objects() {
    let body = concat!(
        r#"<w:p><w:r><w:t xml:space="preserve">shall </w:t></w:r><w:del w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:delText xml:space="preserve">not </w:delText></w:r></w:del><w:r><w:t>pay</w:t></w:r></w:p>"#,
        r#"<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>"#,
        r#"<w:p><w:r><w:t>ab</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>cd</w:t></w:r></w:p>"#,
    );
    let mut s = open(body);
    // The text reads "shall pay" once the deletion is accepted.
    assert_eq!(plain(&mut s, "shall pay"), vec![(0, 0, 13)]);
    assert!(plain(&mut s, "not").is_empty());
    let exact = FindOptions {
        match_case: true,
        ..FindOptions::default()
    };
    assert!(find(&mut s, "PAGE", exact).is_empty());
    assert_eq!(plain(&mut s, "1").len(), 1);
    // A page break is an object: no match runs across it.
    assert!(plain(&mut s, "bc").is_empty());
    assert_eq!(plain(&mut s, "cd").len(), 1);
}

#[test]
fn current_match_follows_the_selection() {
    let mut s = open(&format!("{}{}", p("one two one"), p("one")));
    caret_at(&mut s, 0, 5);
    let r = s.find("one", &FindOptions::default(), fonts());
    assert_eq!(r.matches.len(), 3);
    assert_eq!(r.current, Some(1));
    // A selection holding a match makes it current.
    select(&mut s, (1, 0), (1, 3));
    assert_eq!(
        s.find("one", &FindOptions::default(), fonts()).current,
        Some(2)
    );
    // Past the last match, the search wraps to the first.
    caret_at(&mut s, 1, 3);
    assert_eq!(
        s.find("one", &FindOptions::default(), fonts()).current,
        Some(0)
    );
}

#[test]
fn the_search_stops_at_its_limit() {
    let s = open(&p("aaaa"));
    let paras = s.document().body().paragraphs();
    let (found, truncated) =
        super::find(s.document().body(), &paras, "a", &FindOptions::default(), 3);
    assert_eq!(found.len(), 3);
    assert!(truncated);
}

#[test]
fn replace_takes_the_selected_match_and_moves_to_the_next() {
    let body = format!(
        r#"<w:p><w:r><w:t xml:space="preserve">Pay the </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Seller</w:t></w:r><w:r><w:t xml:space="preserve"> now.</w:t></w:r></w:p>{}"#,
        p("The Seller agrees.")
    );
    let mut s = open(&body);
    caret_at(&mut s, 0, 0);
    // The selection holds no match yet: the first click selects one.
    let r = replace(&mut s, "seller", "Buyer", false);
    assert!(!r.changed);
    assert_eq!(texts(&s), vec!["Pay the Seller now.", "The Seller agrees."]);
    let sel = s.selection().clone();
    assert_eq!((sel.anchor.offset, sel.focus.offset), (8, 14));
    // Now it replaces, in the replaced text's formatting, and selects the
    // next match.
    let r = replace(&mut s, "seller", "Buyer", false);
    assert!(r.changed);
    assert_eq!(texts(&s), vec!["Pay the Buyer now.", "The Seller agrees."]);
    let content = &s.document().body().get(&para(&s, 0)).unwrap().content;
    assert!(content.attrs_at(9).unwrap().has("r:w:b"));
    assert!(!content.attrs_at(14).unwrap().has("r:w:b"));
    let sel = s.selection().clone();
    assert_eq!(sel.anchor.block, para(&s, 1));
    assert_eq!((sel.anchor.offset, sel.focus.offset), (4, 10));
    replace(&mut s, "seller", "Buyer", false);
    assert_eq!(texts(&s), vec!["Pay the Buyer now.", "The Buyer agrees."]);
    // No match left: the caret stays after the replacement.
    let sel = s.selection().clone();
    assert!(sel.is_collapsed());
    assert_eq!(sel.focus.offset, 9);
}

#[test]
fn replace_all_is_one_step_and_keeps_the_caret_on_its_text() {
    let mut s = open(&format!("{}{}", p("a cat, a cat"), p("cat")));
    caret_at(&mut s, 0, 10);
    let r = replace(&mut s, "cat", "tiger", true);
    assert!(r.changed);
    assert_eq!(texts(&s), vec!["a tiger, a tiger", "tiger"]);
    // The caret was inside the second match: it goes to its start.
    let sel = s.selection().clone();
    assert_eq!(
        (sel.focus.block.clone(), sel.focus.offset),
        (para(&s, 0), 11)
    );
    s.undo(fonts()).unwrap();
    assert_eq!(texts(&s), vec!["a cat, a cat", "cat"]);
    // An empty replacement deletes.
    caret_at(&mut s, 0, 12);
    replace(&mut s, "cat", "", true);
    assert_eq!(texts(&s), vec!["a , a ", ""]);
    assert_eq!(s.selection().focus.offset, 6);
}

#[test]
fn replacing_while_tracking_records_the_change() {
    let mut s = open_with(
        &p("the Seller"),
        &Parts {
            settings: Some("<w:trackRevisions/>"),
            ..Parts::default()
        },
    );
    s.set_author("Alice");
    replace(&mut s, "Seller", "Buyer", true);
    let xml = s.document().document_xml();
    assert!(xml.contains("<w:delText>Seller</w:delText>"), "{xml}");
    assert!(xml.contains("<w:t>Buyer</w:t>"), "{xml}");
    assert!(xml.contains("w:author=\"Alice\""), "{xml}");
    // The deleted text is no longer found; the inserted text is.
    assert!(plain(&mut s, "Seller").is_empty());
    assert_eq!(plain(&mut s, "Buyer").len(), 1);
}
