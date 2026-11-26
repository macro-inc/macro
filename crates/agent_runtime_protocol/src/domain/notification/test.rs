use super::RunErrorKind;

#[test]
fn a_failure_kind_from_a_newer_writer_reads_as_internal() {
    let known: RunErrorKind = serde_json::from_str("\"access_lost\"").unwrap();
    assert_eq!(known, RunErrorKind::AccessLost);
    let unknown: RunErrorKind = serde_json::from_str("\"a_kind_added_later\"").unwrap();
    assert_eq!(unknown, RunErrorKind::Internal);
}
