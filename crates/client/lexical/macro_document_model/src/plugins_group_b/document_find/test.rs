use super::*;
use crate::{EditorType, surface};

#[derive(Deserialize)]
struct Case {
    name: String,
    input: Value,
    searches: Vec<Search>,
}

#[derive(Deserialize)]
struct Search {
    query: String,
    pieces: Value,
}

fn editor(input: &Value) -> Result<Editor, Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("actual MarkdownSync surface");
    let state = editor.parse_editor_state_str(&input.to_string())?;
    editor.set_editor_state(state, TagSet::default())?;
    Ok(editor)
}

fn path(view: StateRef<'_>, mut key: NodeKey) -> Vec<usize> {
    let mut path = Vec::new();
    while let Some(parent) = view.parent(key) {
        path.push(
            view.children(parent)
                .position(|child| child == key)
                .expect("actual child"),
        );
        key = parent;
    }
    path.reverse();
    path
}

fn pure_query(
    editor: &Editor,
    name: &str,
    data: &Value,
    generation: u32,
) -> Result<Option<Value>, Error> {
    let before = editor.state().to_json()?;
    let selection = editor.state().selection().cloned();
    let max_key = editor.state().max_key();
    let result = surface::query(name, data, generation, editor.state());
    assert_eq!(editor.state().to_json()?, before);
    assert_eq!(editor.state().selection(), selection.as_ref());
    assert_eq!(editor.state().max_key(), max_key);
    result
}

// These same literal tuples are checked by source-find-oracle.test.ts against
// the pinned Source plugin and real Lexical registry; no test-only query API.
#[test]
fn committed_query_matches_source_utf16_leaf_pieces() -> Result<(), Error> {
    let cases: Vec<Case> = serde_json::from_str(include_str!("source-oracle.json"))?;
    assert_eq!(cases.len(), 15);
    for case in cases {
        let mut editor = editor(&case.input)?;
        editor.update(|tx| {
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::element(NodeKey::ROOT, ChildIndex(0)),
            ))))
        })?;
        let generation = editor.state().max_key().generation();
        for search in case.searches {
            let reply = pure_query(&editor, FIND, &json!({"search": search.query}), generation)?
                .expect("registered find query");
            let pieces: Vec<Piece> = serde_json::from_value(reply["pieces"].clone())?;
            let actual: Vec<Value> = pieces
                .into_iter()
                .map(|piece| {
                    let key = NodeKey::from_parts(KeyParts {
                        index: piece.key,
                        generation,
                    });
                    assert!(editor.state().view().kind(key).is_some());
                    json!({
                        "path": path(editor.state().view(), key),
                        "start": piece.start,
                        "end": piece.end,
                        "isReplace": piece.is_replace,
                        "pairKey": piece.pair_key,
                    })
                })
                .collect();
            assert_eq!(
                json!(actual),
                search.pieces,
                "{}: {:?}",
                case.name,
                search.query
            );
        }
    }
    Ok(())
}

#[test]
fn rejected_queries_preserve_state_and_require_current_generation_first() -> Result<(), Error> {
    let mut editor = editor(&json!({"root": {
        "type":"root", "version":1, "direction":null, "format":"", "indent":0,
        "children":[{"type":"paragraph","version":1,"children":[],
            "direction":null,"format":"","indent":0,"textFormat":0,"textStyle":""}]
    }}))?;
    editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
            Point::element(NodeKey::ROOT, ChildIndex(0)),
        ))))
    })?;
    let generation = editor.state().max_key().generation();
    let stale = generation.checked_add(1).expect("test generation");
    for data in [
        Value::Null,
        json!([]),
        json!(["query"]),
        json!(true),
        json!(42),
        json!("query"),
        json!({}),
        json!({"search":null}),
        json!({"search":1}),
        json!({"search":false}),
        json!({"search":"","extra":true}),
    ] {
        assert!(pure_query(&editor, FIND, &data, generation).is_err());
        assert!(matches!(
            pure_query(&editor, FIND, &data, stale),
            Err(Error::Invariant("application query generation"))
        ));
    }
    assert!(matches!(
        pure_query(&editor, FIND, &json!({"search":"ok"}), stale),
        Err(Error::Invariant("application query generation"))
    ));
    assert_eq!(
        pure_query(&editor, "unknown-find-query", &Value::Null, stale)?,
        None
    );
    assert_eq!(offset(0)?, 0);
    if usize::BITS > u32::BITS {
        assert!(matches!(
            offset(usize::MAX),
            Err(Error::Invariant("document find offset overflow"))
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
struct RawCase {
    name: String,
    text: Vec<u16>,
    query: Vec<u16>,
    ranges: Vec<[usize; 2]>,
}

// Source plugin controls provide these raw-unit expectations. This is PRIVATE
// pattern coverage, not admission of lone surrogates through the native ABI.
#[test]
fn private_literal_pattern_preserves_source_surrogate_units() -> Result<(), Error> {
    let cases: Vec<RawCase> = serde_json::from_str(include_str!("source-surrogate-oracle.json"))?;
    assert_eq!(cases.len(), 5);
    for case in cases {
        let pattern = literal_pattern(case.query.iter().copied());
        let regex = regress::Regex::with_flags(&pattern, "i").expect("literal unit pattern");
        let actual: Vec<_> = regex
            .find_from_ucs2(&case.text, 0)
            .map(|matched| [matched.start(), matched.end()])
            .collect();
        assert_eq!(actual, case.ranges, "{}", case.name);
    }
    Ok(())
}
