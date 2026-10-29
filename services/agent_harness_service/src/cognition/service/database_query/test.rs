use super::*;
use serde_json::json;

fn request(schema: serde_json::Value) -> DatabaseQueryRequest {
    DatabaseQueryRequest {
        model: "test".into(),
        prompt: "Count books".into(),
        sql: String::new(),
        schema,
        error: None,
    }
}

#[test]
fn direct_proposals_require_a_selected_source_with_user_columns() {
    for schema in [
        json!({"name": "Automatic", "tables": []}),
        json!({"databaseId": "books", "tables": []}),
        json!({"databaseId": "books", "tables": [{"columns": []}]}),
        json!({"databaseId": "books", "tables": [{"platform": true, "columns": [{}]}]}),
    ] {
        assert!(!request(schema).has_schema());
    }
    assert!(
        request(json!({"databaseId": "books", "tables": [{"columns": [{"name": "Genre"}]}]}))
            .has_schema()
    );
}

#[test]
fn final_agent_json_preserves_all_chart_fields_without_a_formatter() {
    let value = json!({
        "answerable": true, "databaseId": "books",
        "sql": "SELECT Genre, COUNT(*) AS Books FROM Books GROUP BY Genre",
        "title": "Books by genre", "explanation": "Counts books by genre.",
        "displayMode": "bar",
        "chart": {"x": "Genre", "y": ["Books"], "title": "Books by genre", "color": null, "stack": false}
    });
    for text in [value.to_string(), format!("```json\n{value}\n```")] {
        let answer = parse_answer(&text).unwrap();
        assert_eq!(serde_json::to_value(answer).unwrap(), value);
    }
}

#[test]
fn prose_and_malformed_chart_answers_require_formatting() {
    assert!(parse_answer("I found your books.").is_err());
    assert!(parse_answer(r#"{"answerable":true,"sql":"SELECT 1"}"#).is_err());
    assert!(parse_answer(r#"{"answerable":true,"sql":"SELECT 1","explanation":"","title":"Books","displayMode":"histogram","chart":null}"#).is_err());
}

#[test]
fn answer_schema_is_owned_by_the_server_and_includes_chart_modes() {
    let schema = answer_schema().schema;
    assert_eq!(schema["properties"]["sql"]["type"], "string");
    assert_eq!(
        schema["$defs"]["DatabaseQueryDisplayMode"]["enum"],
        json!(["scalar", "table", "bar", "line", "area", "scatter", "pie"])
    );
}
