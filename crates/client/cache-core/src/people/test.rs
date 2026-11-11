#[test]
fn checked_in_transport_schema_matches_rust() {
    assert_eq!(
        super::schema::schemas(),
        serde_json::from_str::<serde_json::Value>(include_str!("schema.json")).unwrap(),
        "regenerate with bun run gen-cache-people-schema --rust in apps/web"
    );
}
