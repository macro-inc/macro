use super::*;

#[test]
fn serde_tags_by_kind() {
    let native = McpServerRef::native("https://mcp.linear.app/mcp");
    let json = serde_json::to_value(&native).expect("serializes");
    assert_eq!(
        json,
        serde_json::json!({ "kind": "native", "url": "https://mcp.linear.app/mcp" })
    );

    let pipedream: McpServerRef =
        serde_json::from_value(serde_json::json!({ "kind": "pipedream", "app_slug": "linear" }))
            .expect("deserializes");
    assert_eq!(pipedream, McpServerRef::pipedream("linear"));
}

#[test]
fn round_trips_through_storage_columns() {
    for reference in [
        McpServerRef::native("https://mcp.linear.app/mcp"),
        McpServerRef::pipedream("google_sheets"),
    ] {
        let rebuilt = McpServerRef::from_columns(reference.kind().as_str(), reference.reference())
            .expect("stored columns rebuild the reference");
        assert_eq!(rebuilt, reference);
    }
}

#[test]
fn refuses_unknown_kinds_and_empty_references() {
    assert_eq!(
        McpServerRef::from_columns("carrier_pigeon", "x"),
        Err(McpServerRefParseError::UnknownKind(
            "carrier_pigeon".to_owned()
        ))
    );
    assert_eq!(
        McpServerRef::from_columns("native", ""),
        Err(McpServerRefParseError::EmptyReference)
    );
}

#[test]
fn display_names_kind_and_reference() {
    assert_eq!(
        McpServerRef::pipedream("linear").to_string(),
        "pipedream:linear"
    );
}
