use super::*;
use serde::Deserialize;

/// Records and the rows the web's TypeScript port shapes from them
/// (`channel-list-row.test.ts` writes it with `UPDATE_CHANNEL_LIST_ROW_CORPUS=1`).
#[derive(Deserialize)]
struct Case {
    name: String,
    record: Json,
    row: Json,
}

#[test]
fn shapes_the_rows_the_web_port_shapes() {
    let corpus: Vec<Case> =
        serde_json::from_str(include_str!("corpus.json")).expect("corpus is JSON");
    assert!(
        corpus.len() > 100,
        "the corpus holds hand and generated cases"
    );
    for case in corpus {
        assert_eq!(channel_list_row(&case.record), case.row, "{}", case.name);
    }
}

#[test]
fn sends_other_soup_types_as_selected() {
    let document =
        serde_json::json!({"__typename": "GraphqlSoupDocument", "id": "d", "documentName": "x"});
    assert_eq!(channel_list_row(&document), document);
}

#[test]
fn names_only_the_shapes_it_has() {
    assert_eq!(live_row_shape(None).unwrap(), None);
    assert_eq!(
        live_row_shape(Some("channel-list"))
            .unwrap()
            .map(|shape| shape.name()),
        Some(CHANNEL_LIST_ROW)
    );
    assert!(live_row_shape(Some("grouped")).is_err());
}
