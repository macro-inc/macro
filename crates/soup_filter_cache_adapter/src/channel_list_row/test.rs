use super::*;
use serde::Deserialize;

use crate::live_query::LiveQueryRequest;

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
    assert_eq!(live_row_shape(None), None);
    assert_eq!(
        live_row_shape(Some(LiveRowName::ChannelList)).map(|shape| shape.name()),
        Some(CHANNEL_LIST_ROW)
    );
    let request = |row: &str| {
        serde_json::from_value::<LiveQueryRequest>(serde_json::json!({
            "id": "view",
            "document": "fragment F on GraphqlSoupChannel { id }",
            "fragmentName": "F",
            "row": row,
        }))
    };
    assert_eq!(
        request("channel-list").unwrap().row,
        Some(LiveRowName::ChannelList)
    );
    assert!(request("grouped").is_err());
}
