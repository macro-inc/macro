use super::*;
use crate::edit::{EditOp, Pos, RemoteChange, Session};
use crate::model::block::BlockId;
use crate::model::content::Content;
use crate::test_support::{Parts, docx, fonts};
use std::collections::BTreeMap;

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name),
    )
    .expect("fixture")
}

fn texts(doc: &Document) -> Vec<String> {
    doc.body()
        .paragraphs()
        .iter()
        .map(|id| doc.body().get(id).unwrap().content.text())
        .collect()
}

/// The shared containers as the web app holds them.
#[derive(Default, Clone)]
struct Shared {
    blocks: BTreeMap<BlockId, BlockRecord>,
    parts: BTreeMap<String, String>,
    rels: BTreeMap<String, String>,
    types: BTreeMap<String, String>,
}

impl Shared {
    fn seed(state: &CollabState) -> Self {
        Self {
            blocks: state
                .blocks
                .iter()
                .map(|b| (b.id.clone(), b.clone()))
                .collect(),
            parts: state.parts.clone(),
            rels: state.rels.clone(),
            types: state.types.clone(),
        }
    }

    fn state(&self) -> CollabState {
        // Parents before children, as a reader walking the maps would order them.
        let mut blocks: Vec<BlockRecord> = self.blocks.values().cloned().collect();
        blocks.sort_by_key(|b| (!b.p.is_empty(), b.id.clone()));
        CollabState {
            parts: self.parts.clone(),
            types: self.types.clone(),
            rels: self.rels.clone(),
            blocks,
        }
    }

    /// Applies one peer's changes; returns what another peer is told.
    fn apply(&mut self, changes: &[Change]) -> Vec<RemoteChange> {
        let mut out = Vec::new();
        for c in changes {
            match c {
                Change::Block { block } => {
                    self.blocks.insert(block.id.clone(), block.clone());
                    out.push(RemoteChange::Block {
                        block: block.clone(),
                        deltas: Vec::new(),
                    });
                }
                Change::Fields { id, fields } => {
                    let b = self.blocks.get_mut(id).expect("block");
                    for (k, v) in fields {
                        match k.as_str() {
                            "p" => b.p = v.clone(),
                            "o" => b.o = v.clone(),
                            "a" => b.a = v.clone(),
                            "x" => b.x = v.clone(),
                            _ => {}
                        }
                    }
                    out.push(RemoteChange::Block {
                        block: b.clone(),
                        deltas: Vec::new(),
                    });
                }
                Change::Text { id, delta } => {
                    let b = self.blocks.get_mut(id).expect("block");
                    let mut content = Content::from_delta(b.t.as_deref().unwrap_or_default());
                    content.apply_delta(delta);
                    b.t = Some(content.to_delta());
                    out.push(RemoteChange::Block {
                        block: b.clone(),
                        deltas: vec![delta.clone()],
                    });
                }
                Change::Remove { id } => {
                    self.blocks.remove(id);
                    out.push(RemoteChange::Remove { id: id.clone() });
                }
                Change::Entry {
                    container,
                    key,
                    value,
                } => {
                    let map = match container.as_str() {
                        container::PARTS => &mut self.parts,
                        container::RELS => &mut self.rels,
                        _ => &mut self.types,
                    };
                    match value {
                        Some(v) => map.insert(key.clone(), v.clone()),
                        None => map.remove(key),
                    };
                    out.push(RemoteChange::Entry {
                        container: container.clone(),
                        key: key.clone(),
                        value: value.clone(),
                    });
                }
            }
        }
        out
    }
}

#[test]
fn shared_state_round_trips_a_real_document() {
    let doc = Document::open(fixture("complex-msa.docx")).unwrap();
    let pages = doc.layout(fonts()).pages.len();
    let state = doc.collab_state().unwrap();
    assert!(state.parts.values().any(|v| v.contains(Shell::BLOCKS)));
    assert!(
        state
            .rels
            .keys()
            .any(|k| k.starts_with("/word/_rels/document.xml.rels|"))
    );
    assert!(state.types.contains_key("override|/word/document.xml"));
    // Through JSON, as it crosses to the web app.
    let json = serde_json::to_string(&state).unwrap();
    let back: CollabState = serde_json::from_str(&json).unwrap();
    let shared = Document::from_collab_state(&back, 42).unwrap();
    assert_eq!(texts(&shared), texts(&doc));
    assert_eq!(shared.layout(fonts()).pages.len(), pages);
    // And it saves as a normal package.
    let saved = Document::open(shared.save().unwrap()).unwrap();
    assert_eq!(texts(&saved), texts(&doc));
    assert_eq!(
        saved.collab_state().unwrap().blocks.len(),
        state.blocks.len()
    );
}

#[test]
fn two_peers_converge_through_the_shared_maps() {
    let body = r#"<w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:p><w:r><w:t>Beta</w:t></w:r></w:p>"#;
    let doc = Document::open(docx(body, &Parts::default())).unwrap();
    let mut shared = Shared::seed(&doc.collab_state().unwrap());
    let mut a = Session::from_collab(&shared.state(), 1).unwrap();
    let mut b = Session::from_collab(&shared.state(), 2).unwrap();
    let first = a.document().body().paragraphs()[0].clone();
    // A types and splits a paragraph.
    let r = a
        .apply(
            &[
                EditOp::Select {
                    anchor: Pos::new(first.clone(), 5),
                    focus: Pos::new(first.clone(), 5),
                },
                EditOp::InsertText {
                    text: " one".into(),
                },
                EditOp::InsertParagraph,
                EditOp::InsertText {
                    text: "Inserted".into(),
                },
            ],
            None,
            fonts(),
        )
        .unwrap();
    let remote = shared.apply(&r.changes);
    // B has its caret at the end of "Alpha" and keeps it on that text.
    b.apply(
        &[EditOp::Select {
            anchor: Pos::new(first.clone(), 5),
            focus: Pos::new(first.clone(), 5),
        }],
        None,
        fonts(),
    )
    .unwrap();
    let rb = b.apply_remote(&remote, fonts()).unwrap();
    assert_eq!(texts(b.document()), vec!["Alpha one", "Inserted", "Beta"]);
    assert_eq!(texts(b.document()), texts(a.document()));
    assert!(rb.pages.is_some());
    // B's edit goes back to A.
    let second = b.document().body().paragraphs()[2].clone();
    let r = b
        .apply(
            &[
                EditOp::Select {
                    anchor: Pos::new(second.clone(), 0),
                    focus: Pos::new(second.clone(), 4),
                },
                EditOp::ToggleFormat {
                    format: crate::edit::Toggle::Bold,
                },
            ],
            None,
            fonts(),
        )
        .unwrap();
    let remote = shared.apply(&r.changes);
    a.apply_remote(&remote, fonts()).unwrap();
    let bold = |s: &Session| {
        let id = s.document().body().paragraphs()[2].clone();
        s.document().body().get(&id).unwrap().content.spans()[0]
            .attrs
            .has("r:w:b")
    };
    assert!(bold(&a));
    assert!(bold(&b));
    // A fresh peer reading the maps sees the same document.
    let c = Session::from_collab(&shared.state(), 3).unwrap();
    assert_eq!(texts(c.document()), texts(a.document()));
}

#[test]
fn new_blocks_get_peer_unique_ids() {
    let body = r#"<w:p><w:r><w:t>Text</w:t></w:r></w:p>"#;
    let doc = Document::open(docx(body, &Parts::default())).unwrap();
    let state = doc.collab_state().unwrap();
    let mut ids = Vec::new();
    for seed in [1, 2] {
        let mut s = Session::from_collab(&state, seed).unwrap();
        let first = s.document().body().paragraphs()[0].clone();
        let r = s
            .apply(
                &[
                    EditOp::Select {
                        anchor: Pos::new(first.clone(), 4),
                        focus: Pos::new(first, 4),
                    },
                    EditOp::InsertParagraph,
                ],
                None,
                fonts(),
            )
            .unwrap();
        ids.push(r.selection.focus.block.clone());
    }
    assert_ne!(ids[0], ids[1]);
}

#[test]
fn part_changes_from_peers_reload_styles() {
    let styles = r#"<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>"#;
    let body = r#"<w:p><w:r><w:t>Some text</w:t></w:r></w:p>"#;
    let doc = Document::open(docx(
        body,
        &Parts {
            styles: Some(styles),
            ..Parts::default()
        },
    ))
    .unwrap();
    let state = doc.collab_state().unwrap();
    let mut s = Session::from_collab(&state, 9).unwrap();
    assert_eq!(s.state(fonts()).format.size, Some(10.0));
    let bigger = state.parts["/word/styles.xml"].replace("w:val=\"20\"", "w:val=\"40\"");
    let r = s
        .apply_remote(
            &[RemoteChange::Entry {
                container: container::PARTS.into(),
                key: "/word/styles.xml".into(),
                value: Some(bigger),
            }],
            fonts(),
        )
        .unwrap();
    assert_eq!(r.format.size, Some(20.0));
}

/// Texts of a peer's footnotes by id.
fn footnote_texts(doc: &Document) -> BTreeMap<i64, String> {
    doc.footnotes()
        .by_id
        .iter()
        .filter(|(_, n)| n.is_text())
        .map(|(id, n)| {
            let text: Vec<String> = n
                .story
                .paragraphs()
                .iter()
                .map(|p| n.story.get(p).unwrap().content.text())
                .collect();
            (*id, text.join("\n").replace('\u{FFFC}', "^"))
        })
        .collect()
}

#[test]
fn notes_are_shared_one_by_one_and_merge() {
    let reference = |id: i64| {
        format!(
            r#"<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="{id}"/></w:r>"#
        )
    };
    let body = format!(
        r#"<w:p><w:r><w:t>Alpha</w:t></w:r>{}</w:p><w:p><w:r><w:t>Beta</w:t></w:r>{}</w:p>"#,
        reference(1),
        reference(2)
    );
    let note = |id: i64, text: &str| {
        format!(
            r#"<w:footnote w:id="{id}"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> {text}</w:t></w:r></w:p></w:footnote>"#
        )
    };
    let notes = format!(
        r#"<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>{}{}"#,
        note(1, "First note."),
        note(2, "Second note.")
    );
    let doc = Document::open(docx(
        &body,
        &Parts {
            footnotes: Some(&notes),
            ..Parts::default()
        },
    ))
    .unwrap();
    let state = doc.collab_state().unwrap();
    // The part's own entry holds no notes; each note has its own.
    let part = "/word/footnotes.xml";
    assert!(
        !state.parts[part].contains("<w:footnote "),
        "{}",
        state.parts[part]
    );
    for id in [-1, 1, 2] {
        assert!(state.parts.contains_key(&format!("{part}|{id}")), "{id}");
    }
    let mut shared = Shared::seed(&state);
    let mut a = Session::from_collab(&shared.state(), 1).unwrap();
    let mut b = Session::from_collab(&shared.state(), 2).unwrap();
    assert_eq!(footnote_texts(a.document()), footnote_texts(&doc));

    // Each types at the end of a different note at the same time.
    let type_in = |s: &mut Session, id: i64, text: &str| {
        let para = s.document().footnotes().by_id[&id].story.paragraphs()[0].clone();
        let len = s.document().footnotes().by_id[&id]
            .story
            .get(&para)
            .unwrap()
            .content
            .len();
        s.apply(
            &[
                EditOp::Select {
                    anchor: Pos::new(para.clone(), len),
                    focus: Pos::new(para, len),
                },
                EditOp::InsertText { text: text.into() },
            ],
            None,
            fonts(),
        )
        .unwrap()
    };
    let ra = type_in(&mut a, 1, " (A)");
    let rb = type_in(&mut b, 2, " (B)");
    // Only the edited note is shared, not the part.
    let keys = |r: &crate::edit::EditResult| -> Vec<String> {
        r.changes
            .iter()
            .filter_map(|c| match c {
                Change::Entry { key, .. } => Some(key.clone()),
                _ => None,
            })
            .collect()
    };
    assert_eq!(keys(&ra), vec![format!("{part}|1")]);
    assert_eq!(keys(&rb), vec![format!("{part}|2")]);
    let to_b = shared.apply(&ra.changes);
    let to_a = shared.apply(&rb.changes);
    a.apply_remote(&to_a, fonts()).unwrap();
    b.apply_remote(&to_b, fonts()).unwrap();
    let want: BTreeMap<i64, String> = [
        (1, "^ First note. (A)".to_owned()),
        (2, "^ Second note. (B)".to_owned()),
    ]
    .into();
    assert_eq!(footnote_texts(a.document()), want);
    assert_eq!(footnote_texts(b.document()), want);
    // A fresh peer, and a saved file, have both.
    let c = Session::from_collab(&shared.state(), 3).unwrap();
    assert_eq!(footnote_texts(c.document()), want);
    let saved = Document::open(c.document().save().unwrap()).unwrap();
    assert_eq!(footnote_texts(&saved), want);
    assert_eq!(saved.footnotes().by_id[&-1].kind, "separator");
}

#[test]
fn a_new_note_reaches_other_peers() {
    let doc = Document::open(docx(
        r#"<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>"#,
        &Parts::default(),
    ))
    .unwrap();
    let mut shared = Shared::seed(&doc.collab_state().unwrap());
    let mut a = Session::from_collab(&shared.state(), 1).unwrap();
    let mut b = Session::from_collab(&shared.state(), 2).unwrap();
    let first = a.document().body().paragraphs()[0].clone();
    let r = a
        .apply(
            &[
                EditOp::Select {
                    anchor: Pos::new(first.clone(), 5),
                    focus: Pos::new(first, 5),
                },
                EditOp::InsertNote { endnote: false },
                EditOp::InsertText {
                    text: "Noted.".into(),
                },
            ],
            None,
            fonts(),
        )
        .unwrap();
    let remote = shared.apply(&r.changes);
    b.apply_remote(&remote, fonts()).unwrap();
    let texts_b: Vec<String> = footnote_texts(b.document()).into_values().collect();
    assert_eq!(texts_b, vec!["^ Noted.".to_owned()]);
    assert_eq!(footnote_texts(b.document()), footnote_texts(a.document()));
    let c = Session::from_collab(&shared.state(), 3).unwrap();
    assert_eq!(footnote_texts(c.document()), footnote_texts(a.document()));
    // B lays the note out at the foot of its page.
    assert!(b.pages(fonts())[0].notes.is_some());
}
