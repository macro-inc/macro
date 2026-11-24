use super::*;

#[test]
fn mentions_read_as_their_visible_labels() {
    let markdown = concat!(
        "Ask <m-user-mention>{\"userId\":\"macro|grace@example.com\",\"email\":\"grace@example.com\"}</m-user-mention>",
        " about <m-document-mention>{\"documentId\":\"0193a0c4-0000-7000-8000-000000000001\",\"blockName\":\"md\",\"documentName\":\"Roadmap\"}</m-document-mention>",
    );

    assert_eq!(visible_text(markdown), "Ask grace about Roadmap");
}

#[test]
fn text_that_is_not_markup_stays_as_written() {
    assert_eq!(
        visible_text("a < b and Vec<String>"),
        "a < b and Vec<String>"
    );
}

#[test]
fn a_title_column_that_is_not_searchable_leaves_the_title_empty() {
    let cells = vec![
        CellInput {
            kind: None,
            values: Some(serde_json::json!({"type": "Number", "value": 4})),
            option_labels: Vec::new(),
        },
        CellInput {
            kind: Some(SearchableKind::Text),
            values: Some(serde_json::json!({"type": "String", "value": "  notes  "})),
            option_labels: Vec::new(),
        },
    ];

    assert_eq!(
        row_text(&cells),
        RowText {
            title: String::new(),
            cell_text: vec!["notes".to_owned()],
        }
    );
}
