#[test]
fn the_read_only_database_host_reads_and_never_writes() {
    let read_only = crate::DATABASE_READ_ONLY_TOOL_USE_PROMPT.to_string();
    assert!(read_only.contains("QueryDatabase's registered description"));
    assert!(read_only.contains("This host is read-only"));
    assert!(!read_only.contains("SaveDatabaseQuery"));
}
