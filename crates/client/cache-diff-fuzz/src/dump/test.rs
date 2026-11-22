use super::*;

/// A cache file holding `sql`, dumped with `ignore` and `json_facts`.
fn dump(sql: &str, ignore: &[(&str, &str)], json_facts: &[&str]) -> BTreeMap<String, Vec<String>> {
    dump_with(sql, false, ignore, json_facts)
}

/// As [`dump`], with the search index decoded when `search` is set.
fn dump_with(
    sql: &str,
    search: bool,
    ignore: &[(&str, &str)],
    json_facts: &[&str],
) -> BTreeMap<String, Vec<String>> {
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
    let out = tables(&path, false, false, search, &ignore, &json_facts).unwrap();
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
         INSERT INTO facts VALUES (1, 7), (2, NULL);
         CREATE TABLE named (Attribute TEXT COLLATE NOCASE);
         INSERT INTO named VALUES ('tag'), ('TAG');",
        &[("value", "07"), ("value", "NULL"), ("attribute", "tag")],
        &[],
    );
    assert_eq!(out["facts"].len(), 2);
    assert_eq!(out["named"], vec![r#"["t:TAG"]"#]);
}

#[test]
fn json_facts_dropped_from_layer_projections_only() {
    let names = ["view".to_owned()];
    let layer = |mutations: &str, data: &str| {
        format!(
            r#"@macro-cache/optimistic-source:{{"mutationData":{data},"projectionMutations":{mutations}}}"#
        )
    };
    let data = r#"{"facets":[{"attribute":"view","value":4}],"tags":["view"]}"#;
    assert_eq!(
        without_json_facts(
            &layer(
                r#"[{"Replace":{"sort_facts":[{"attribute":"view","value":1}]}},{"Patch":{"sorts":[{"attribute":"view","value":1},{"attribute":"keep","value":2}]}},{"Unknown":{"affected_attributes":["inbox","view"]}},{"Unknown":{"affected_attributes":["view"]}}]"#,
                data
            ),
            &names
        ),
        layer(
            r#"[{"Replace":{"sort_facts":[]}},{"Patch":{"sorts":[{"attribute":"keep","value":2}]}},{"Unknown":{"affected_attributes":["inbox"]}},{"Unknown":{"affected_attributes":["view"]}}]"#,
            data
        )
    );
    // Other text, JSON or not, stays as it is.
    for text in [
        "chapter [1, 2]",
        r#"[ {"attribute":"view","value":1} ]"#,
        "@macro-cache/optimistic-source:[view",
    ] {
        assert_eq!(without_json_facts(text, &names), text);
    }
}

#[test]
fn json_facts_only_in_layer_text() {
    let source = r#"@macro-cache/optimistic-source:{"projectionMutations":[{"Patch":{"sorts":[{"attribute":"view","value":1}]}}]}"#;
    let out = dump(
        &format!(
            "CREATE TABLE optimistic_layers (id INTEGER, source TEXT, bytes BLOB);
             INSERT INTO optimistic_layers VALUES (1, '{source}', CAST('{source}' AS BLOB));
             CREATE TABLE search_documents (search_text TEXT);
             INSERT INTO search_documents VALUES ('{source}');"
        ),
        &[],
        &["view"],
    );
    let row: Vec<String> = serde_json::from_str(&out["optimistic_layers"][0]).unwrap();
    assert_eq!(
        row[1],
        r#"t:@macro-cache/optimistic-source:{"projectionMutations":[{"Patch":{"sorts":[]}}]}"#
    );
    assert_eq!(row[2], format!("b:{source}"));
    // Only the layers table holds projections.
    let other: Vec<String> = serde_json::from_str(&out["search_documents"][0]).unwrap();
    assert_eq!(other[0], format!("t:{source}"));
}

#[test]
fn clustered_search_rows_dump_as_search_documents() {
    let before = dump_with(
        "CREATE TABLE search_documents (profile TEXT, __typename TEXT, id TEXT, bucket TEXT, search_text TEXT, timestamp_ms INTEGER, source_hash TEXT);
         INSERT INTO search_documents VALUES ('quick-access-v1', 'Doc', 'a', 'docs', 'alpha', 5, 'h1'), ('quick-access-v1', 'Mail', 'b', 'mail', 'beta', 7, 'h2');",
        true,
        &[],
        &[],
    );
    // Slots and row ids in another order than the rows were first written in.
    let after = dump_with(
        "CREATE TABLE search_slots (slot INTEGER PRIMARY KEY, profile INTEGER, bucket TEXT);
         INSERT INTO search_slots VALUES (1, 1, 'mail'), (2, 1, 'docs');
         CREATE TABLE search_rows (slot INTEGER, profile INTEGER, __typename TEXT, id TEXT, search_text TEXT, timestamp_ms INTEGER, source_hash TEXT);
         INSERT INTO search_rows (rowid, slot, profile, __typename, id, search_text, timestamp_ms, source_hash) VALUES
           (35184372088837, 2, 1, 'Doc', 'a', 'alpha', 5, 'h1'), (17592186044417, 1, 1, 'Mail', 'b', 'beta', 7, 'h2');",
        true,
        &[],
        &[],
    );
    assert_eq!(before, after);
    // A row in a slot of another profile, and a bucket with two slots, show.
    let broken = dump_with(
        "CREATE TABLE search_slots (slot INTEGER PRIMARY KEY, profile INTEGER, bucket TEXT);
         INSERT INTO search_slots VALUES (1, 2, 'mail'), (2, 1, 'docs'), (3, 1, 'docs');
         CREATE TABLE search_rows (slot INTEGER, profile INTEGER, __typename TEXT, id TEXT, search_text TEXT, timestamp_ms INTEGER, source_hash TEXT);
         INSERT INTO search_rows VALUES (2, 1, 'Doc', 'a', 'alpha', 5, 'h1'), (1, 1, 'Mail', 'b', 'beta', 7, 'h2');",
        true,
        &[],
        &[],
    );
    assert_ne!(before["search_documents"], broken["search_documents"]);
    assert_eq!(broken["search_slots_shared"].len(), 1);
    // Each defect alone: a row id in another slot's range (a bucket move that kept
    // its row id), a text profile, and a storage 13 table left behind.
    for (rows, extra) in [
        (
            "(17592186044417, 2, 1, 'Doc', 'a', 'alpha', 5, 'h1'), (17592186044418, 1, 1, 'Mail', 'b', 'beta', 7, 'h2')",
            "",
        ),
        (
            "(35184372088837, 2, 'quick-access-v1', 'Doc', 'a', 'alpha', 5, 'h1'), (17592186044417, 1, 1, 'Mail', 'b', 'beta', 7, 'h2')",
            "",
        ),
        (
            "(35184372088837, 2, 1, 'Doc', 'a', 'alpha', 5, 'h1'), (17592186044417, 1, 1, 'Mail', 'b', 'beta', 7, 'h2')",
            "CREATE TABLE search_documents (profile TEXT); INSERT INTO search_documents VALUES ('quick-access-v1');",
        ),
    ] {
        let defect = dump_with(
            &format!(
                "CREATE TABLE search_slots (slot INTEGER PRIMARY KEY, profile INTEGER, bucket TEXT);
                 INSERT INTO search_slots VALUES (1, 1, 'mail'), (2, 1, 'docs');
                 CREATE TABLE search_rows (slot INTEGER, profile INTEGER, __typename TEXT, id TEXT, search_text TEXT, timestamp_ms INTEGER, source_hash TEXT);
                 INSERT INTO search_rows (rowid, slot, profile, __typename, id, search_text, timestamp_ms, source_hash) VALUES {rows}; {extra}"
            ),
            true,
            &[],
            &[],
        );
        assert_ne!(before, defect, "{rows} {extra}");
    }
}
