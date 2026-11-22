use super::*;

/// A cache file holding `sql`, dumped with `ignore` and `json_facts`.
fn dump(sql: &str, ignore: &[(&str, &str)], json_facts: &[&str]) -> BTreeMap<String, Vec<String>> {
    let dir = std::env::temp_dir().join(format!(
        "cache-diff-fuzz-dump-{}-{}",
        std::process::id(),
        fnv(sql)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("cache.db");
    {
        let io: Arc<dyn IO> = Arc::new(PlatformIO::new().unwrap());
        let database = Database::open(
            io,
            path.to_str().unwrap(),
            OpenOptions::new(Arc::new(SqliteDialect)),
        )
        .unwrap();
        let connection = database.connect().unwrap();
        connection.prepare_execute_batch(sql).unwrap();
        connection.close().unwrap();
    }
    let ignore: Vec<_> = ignore
        .iter()
        .map(|(column, value)| (column.to_string(), value.to_string()))
        .collect();
    let json_facts: Vec<_> = json_facts.iter().map(|name| name.to_string()).collect();
    let out = tables(&path, false, false, &ignore, &json_facts).unwrap();
    let _ = std::fs::remove_dir_all(&dir);
    out
}

fn fnv(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

#[test]
fn ignored_rows_only_in_tables_declaring_the_column() {
    let out = dump(
        "CREATE TABLE records (id TEXT, value TEXT);
         INSERT INTO records VALUES ('a', 'attribute');
         CREATE TABLE facts (document_id INTEGER, attribute TEXT, value INTEGER);
         INSERT INTO facts VALUES (1, 'attribute', 1), (1, 'keep', 2);",
        &[("attribute", "attribute"), ("rowid", "1")],
        &[],
    );
    assert_eq!(out["records"].len(), 1);
    assert_eq!(
        out["facts"],
        vec![r#"["Numeric(Integer(1))","t:keep","Numeric(Integer(2))"]"#]
    );
}

#[test]
fn ignored_rows_match_text_only() {
    let out = dump(
        "CREATE TABLE facts (document_id INTEGER, value NUMERIC);
         INSERT INTO facts VALUES (1, 7), (2, NULL);",
        &[("value", "07"), ("value", "NULL")],
        &[],
    );
    assert_eq!(out["facts"].len(), 2);
}

#[test]
fn json_facts_dropped_from_layers_only_where_named() {
    let layer = r#"p:[{"Patch":{"sorts":[{"attribute":"view","value":1},{"attribute":"keep","value":2}]}},{"Unknown":{"affected_attributes":["inbox","view"]}},{"Unknown":{"affected_attributes":["view"]}},{"vars":{"tags":["view","keep"]}}]"#;
    let names = ["view".to_owned()];
    assert_eq!(
        without_json_facts(layer, &names),
        r#"p:[{"Patch":{"sorts":[{"attribute":"keep","value":2}]}},{"Unknown":{"affected_attributes":["inbox"]}},{"Unknown":{"affected_attributes":["view"]}},{"vars":{"tags":["view","keep"]}}]"#
    );
    // Not JSON after the prefix: left as it is.
    assert_eq!(without_json_facts("p:[view", &names), "p:[view");
    // Escapes and spacing decode first.
    assert_eq!(
        without_json_facts(
            r#"[ {"attribute":"view","value":{"x":1}} , {"attribute":"view","value":3} ,2]"#,
            &names
        ),
        r#"[{"attribute":"view","value":{"x":1}},2]"#
    );
}

#[test]
fn json_facts_leave_blobs_alone() {
    let out = dump(
        r#"CREATE TABLE layers (id INTEGER, source TEXT, bytes BLOB);
           INSERT INTO layers VALUES (1, '[{"attribute":"view","value":1}]', CAST('[{"attribute":"view","value":1}]' AS BLOB));"#,
        &[],
        &["view"],
    );
    assert_eq!(
        out["layers"],
        vec![r#"["Numeric(Integer(1))","t:[]","b:[{\"attribute\":\"view\",\"value\":1}]"]"#]
    );
}
