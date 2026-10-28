use super::*;
use loro::{LoroValue, ValueOrContainer};

const NDA: &[u8] = include_bytes!("../../../../../docx_engine/tests/fixtures/mutual-nda.docx");

fn text(doc: &LoroDoc, id: &str) -> LoroText {
    let Some(ValueOrContainer::Container(block)) = doc.get_map(container::BLOCKS).get(id) else {
        panic!("block {id} is missing");
    };
    let Some(ValueOrContainer::Container(text)) = block.into_map().unwrap().get("t") else {
        panic!("block {id} has no text");
    };
    text.into_text().unwrap()
}

#[test]
fn the_seed_holds_the_engine_state_the_editor_seeds() {
    let state = Document::open(NDA.to_vec())
        .unwrap()
        .collab_state()
        .unwrap();
    let doc = LoroDoc::new();
    doc.import(&seed_snapshot(NDA.to_vec()).unwrap()).unwrap();

    assert_eq!(
        doc.get_map(container::META)
            .get("formatVersion")
            .unwrap()
            .into_value()
            .unwrap(),
        LoroValue::Double(2.0)
    );
    assert_eq!(doc.get_map(container::PARTS).len(), state.parts.len());
    assert_eq!(doc.get_map(container::RELS).len(), state.rels.len());
    assert_eq!(doc.get_map(container::TYPES).len(), state.types.len());
    assert_eq!(doc.get_map(container::BLOCKS).len(), state.blocks.len());
    let paragraphs: Vec<_> = state.blocks.iter().filter(|b| b.k == "p").collect();
    assert!(!paragraphs.is_empty());
    for record in paragraphs {
        let stored: Vec<(String, serde_json::Value)> = text(&doc, record.id.as_str())
            .to_delta()
            .into_iter()
            .map(|op| match op {
                TextDelta::Insert { insert, attributes } => (
                    insert,
                    serde_json::to_value(attributes.unwrap_or_default()).unwrap(),
                ),
                other => panic!("a seed only inserts, got {other:?}"),
            })
            .collect();
        let engine: Vec<(String, serde_json::Value)> = record
            .t
            .iter()
            .flatten()
            .map(|op| match op {
                DeltaOp::Insert { insert, attributes } => {
                    (insert.clone(), serde_json::to_value(attributes).unwrap())
                }
                other => panic!("the engine seeds only inserts, got {other:?}"),
            })
            .collect();
        assert_eq!(stored, engine);
    }
}

#[test]
fn formatting_never_grows_over_text_typed_after_it() {
    let state = Document::open(NDA.to_vec())
        .unwrap()
        .collab_state()
        .unwrap();
    // The end of the first formatted span: its paragraph and character offset.
    let (id, end) = state
        .blocks
        .iter()
        .find_map(|block| {
            let mut offset = 0;
            for op in block.t.iter().flatten() {
                let DeltaOp::Insert { insert, attributes } = op else {
                    continue;
                };
                offset += insert.chars().count();
                if !attributes.is_empty() {
                    return Some((block.id.as_str().to_owned(), offset));
                }
            }
            None
        })
        .expect("the fixture has formatted text");
    let doc = LoroDoc::new();
    doc.import(&seed_snapshot(NDA.to_vec()).unwrap()).unwrap();
    // A peer that never configured text styles, so only the stored marks decide.
    let typed = text(&doc, &id);
    typed.insert(end, "\u{2063}").unwrap();
    let typed_op = typed
        .to_delta()
        .into_iter()
        .find(|op| matches!(op, TextDelta::Insert { insert, .. } if insert.contains('\u{2063}')))
        .unwrap();
    assert!(matches!(
        typed_op,
        TextDelta::Insert {
            attributes: None,
            ..
        }
    ));
}
