//! Helpers shared by the editing tests.

use super::*;
use crate::test_support::{Parts, docx, fonts};

pub(crate) fn open(body: &str) -> Session {
    open_with(body, &Parts::default())
}

pub(crate) fn open_with(body: &str, parts: &Parts<'_>) -> Session {
    let doc = Document::open(docx(body, parts)).expect("open");
    Session::new(doc)
}

pub(crate) fn p(text: &str) -> String {
    format!(r#"<w:p><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>"#)
}

pub(crate) fn texts(s: &Session) -> Vec<String> {
    s.document()
        .body()
        .paragraphs()
        .iter()
        .map(|id| s.document().body().get(id).unwrap().content.text())
        .collect()
}

pub(crate) fn para(s: &Session, i: usize) -> BlockId {
    s.document().body().paragraphs()[i].clone()
}

pub(crate) fn caret_at(s: &mut Session, i: usize, offset: usize) {
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

pub(crate) fn select(s: &mut Session, a: (usize, usize), f: (usize, usize)) {
    let anchor = Pos::new(para(s, a.0), a.1);
    let focus = Pos::new(para(s, f.0), f.1);
    s.apply(&[EditOp::Select { anchor, focus }], None, fonts())
        .unwrap();
}

pub(crate) fn run(s: &mut Session, op: EditOp) -> EditResult {
    s.apply(&[op], None, fonts()).unwrap()
}

pub(crate) fn type_text(s: &mut Session, text: &str) -> EditResult {
    s.apply(
        &[EditOp::InsertText {
            text: text.to_owned(),
        }],
        Some("typing"),
        fonts(),
    )
    .unwrap()
}
